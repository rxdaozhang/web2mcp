#!/usr/bin/env node
// NOTE: Do not use stdio (including console.log) in this script

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z, type ZodTypeAny } from "zod";
import OpenAI from "openai";
import dotenv from "dotenv";
import { initializeStagehand, login, navigate_to_page, getConfig, type PathObject } from "./sharedUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: ".env" });

// Configuration
const config = {
  openaiApiKey: process.env.OPENAI_API_KEY || "your-openai-key"
};

// Types for the configuration
interface ToolConfig {
  name: string;
  description: string;
  input_schema: any;
}

interface ServerConfig {
  server: {
    name: string;
    version: string;
  };
  tools: ToolConfig[];
}

const NO_INPUTS_STR = 'No inputs available.'

// Types for page actions

interface PageAction {
  operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'UNSPECIFIED';
  type: string;
  selector: string;
  elementCount: number;
  hasHeaders?: boolean;
  hasRows?: boolean;
  inputs?: Array<{
    type: string;
    required: boolean;
    label: string;
    placeholder?: string;
    options?: string[];
    description: string;
    selector: string;
  }>;
  textContent: string;
  path: PathObject[];
}

// Dynamic MCP Server
export class DynamicMcpServer {
  private server: McpServer;
  private transport: StdioServerTransport;
  private registeredTools: Set<string> = new Set();
  private loadedConfig: ServerConfig | null = null;
  private pageActions: PageAction[] = [];

  constructor(name: string = "dynamic-mcp-server", version: string = "0.1.0") {
    this.server = new McpServer({
      name,
      version,
      capabilities: {
        resources: {},
        tools: {},
      },
    });
    this.transport = new StdioServerTransport();
  }

  jsonSchemaToZodShape(schema: any): Record<string, ZodTypeAny> {
    if (!schema || schema.type !== "object") return {};
    const required = new Set<string>(schema.required ?? []);
    const props = schema.properties ?? {};
    const shape: Record<string, ZodTypeAny> = {};
  
    for (const [key, def] of Object.entries<any>(props)) {
      let t: ZodTypeAny;
  
      if (def?.enum?.length) {
        // enums: require string enums here; extend if needed
        t = z.enum(def.enum as [string, ...string[]]);
      } else {
        switch (def.type) {
          case "string":  t = z.string(); break;
          case "boolean": t = z.boolean(); break;
          case "number":  t = z.number(); break;
          case "integer": t = z.number().int(); break;
          case "array":   t = z.array(z.any()); break;       // extend as needed
          case "object":  t = z.object({}); break;           // extend nested objects if you use them
          default:        t = z.any();
        }
      }
  
      if (def.description) t = t.describe(def.description);
      if (def.default !== undefined) t = t.default(def.default);
      if (!required.has(key)) t = t.optional();
  
      shape[key] = t;
    }
  
    return shape;
  }

  // Load configuration from JSON file
  loadConfigFromFile(configPath: string): void {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config: ServerConfig = JSON.parse(configContent);
      
      // Store the loaded configuration
      this.loadedConfig = config;
      
      // Update server name and version if provided
      if (config.server) {
        this.server = new McpServer({
          name: config.server.name,
          version: config.server.version,
          capabilities: {
            resources: {},
            tools: {},
          },
        });
      }
      
      // Register all tools from the config
      this.registerToolsFromConfig(config.tools);
      
      console.error(`Loaded ${config.tools.length} tools from config file: ${configPath}`);
    } catch (error) {
      console.error(`Error loading config from ${configPath}:`, error);
      throw error;
    }
  }

  // Load page actions from JSON file
  loadPageActionsFromFile(pageActionsPath: string): void {
    try {
      const pageActionsContent = readFileSync(pageActionsPath, 'utf-8');
      const pageActions: PageAction[] = JSON.parse(pageActionsContent);
      
      // Store the loaded page actions
      this.pageActions = pageActions;
      
      console.error(`Loaded ${pageActions.length} page actions from file: ${pageActionsPath}`);
    } catch (error) {
      console.error(`Error loading page actions from ${pageActionsPath}:`, error);
      throw error;
    }
  }

  // Register tools from configuration
  registerToolsFromConfig(tools: ToolConfig[]): void {
    for (const tool of tools) {
      this.registerTool(tool.name, tool.description, tool.input_schema);
    }
  }


  // Register a single tool
  registerTool(name: string, description: string, inputSchema: any): void {
    if (this.registeredTools.has(name)) {
      console.warn(`Tool '${name}' is already registered. Skipping.`);
      return;
    }

    const zodShape = this.jsonSchemaToZodShape(inputSchema);

    this.server.registerTool(
      name,
      { title: name, description, inputSchema: zodShape },
      async (args: any): Promise<any> => {
        const result = await this.universalHandler(name, args);

        const content: TextContent[] = [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ];

        return { content };
      }
    );

    this.registeredTools.add(name);
    console.error(`Registered tool: ${name}`);
  }

  private async universalHandler(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    console.error(`Universal handler called with: ${name}`, args);
    
    // Find the tool configuration for this function
    const toolConfig = this.findToolConfig(name);
    
    if (!toolConfig) {
      return { 
        error: `Tool configuration not found for: ${name}`,
        handled_by: "universalHandler"
      };
    }
    
    // Format the message as requested
    const pageActionPrompt = `A user has just invoked this function:

${JSON.stringify(toolConfig, null, 2)}

With the arguments:
${Object.keys(args).length === 0 ? 'No arguments' : Object.entries(args).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`).join('\n')}

Return the index in the following operation list that corresponds to satisfying this request. ONLY respond with the index and no additional output:

${this.pageActions.map((action, index) => `${index}: ${JSON.stringify(action, null, 2)}`).join('\n\n')}`;
    
    // Call ChatGPT to determine the appropriate page action index
    let selectedIndex: number | null = null;
    try {
      selectedIndex = await this.callChatGPT(pageActionPrompt);
      
      // Validate the index is within bounds
      if (selectedIndex < 0 || selectedIndex >= this.pageActions.length) {
        console.error(`ChatGPT returned invalid index: ${selectedIndex}, but pageActions length is ${this.pageActions.length}`);
        selectedIndex = null;
      }
    } catch (error) {
      console.error('Failed to get page action index from ChatGPT:', error);
      selectedIndex = null;
    }
    
    // Execute the page action
    try {
      const executionResult = await this.executePageAction(selectedIndex, toolConfig, args);
      return {
        ok: true,
        name,
        args,
        selectedPageAction: selectedIndex !== null ? this.pageActions[selectedIndex] : null,
        executionResult
      };
    } catch (error) {
      return {
        ok: false,
        name,
        args,
        error: error instanceof Error ? error.message : 'Unknown error',
                  selectedPageAction: selectedIndex !== null ? this.pageActions[selectedIndex] : null
      };
    }
  }

  private findToolConfig(name: string): ToolConfig | null {
    if (!this.loadedConfig) {
      return null;
    }
    
    return this.loadedConfig.tools.find(tool => tool.name === name) || null;
  }

  private async callChatGPT(message: string): Promise<number> {
    try {
      // Initialize OpenAI client
      const openai = new OpenAI({
        apiKey: config.openaiApiKey,
      });
      
      console.error('Calling ChatGPT to determine page action index...');
      
      // Make the API call
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: message
          }
        ]
      });
      
      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response received from ChatGPT');
      }
      
      // Parse the response as an integer
      const index = parseInt(response.trim());
      if (isNaN(index)) {
        throw new Error(`Invalid response from ChatGPT: "${response}" - expected a number`);
      }
      
      console.error(`ChatGPT returned index: ${index}`);
      return index;
    } catch (error) {
      console.error('Error calling ChatGPT:', error);
      throw error;
    }
  }

  // Get list of registered tools
  getRegisteredTools(): string[] {
    return Array.from(this.registeredTools);
  }

  // Start the server
  async start(): Promise<void> {
    await this.server.connect(this.transport);
    console.error(`Dynamic MCP Server started with ${this.registeredTools.size} tools`);
    console.error("Registered tools:", this.getRegisteredTools());
  }

  // Stop the server
  async stop(): Promise<void> {
    console.error("Dynamic MCP Server stopped");
  }

  // Execute a page action using Stagehand
  async executePageAction(pageActionIndex: number | null, toolConfig: ToolConfig, args?: Record<string, unknown>): Promise<any> {
    let pageAction: PageAction;
    
    if (pageActionIndex === null) {
      // Default page action when no specific action is determined
      pageAction = {
        operation: 'UNSPECIFIED',
        type: 'default',
        selector: 'body',
        elementCount: 1,
        textContent: `${toolConfig.name}: ${toolConfig.description}`,
        path: []
      };
    } else if (pageActionIndex < 0 || pageActionIndex >= this.pageActions.length) {
      throw new Error(`Invalid page action index: ${pageActionIndex}`);
    } else {
      pageAction = this.pageActions[pageActionIndex];
    }
    console.error(`Starting browser automation for: ${pageAction.operation} - ${pageAction.type}`);

    try {
      const config = getConfig();
      const { stagehand, page } = await initializeStagehand(config, true); // Suppress logs in MCP server
      
      console.error('Performing login...');
      await login(stagehand, config.url, config.username, config.password);
      const rootUrl = page.url(); // Store the root URL (post-login page)
      
      console.error('Navigating to target page...');
      // Navigate to the page if there's a path
      if (pageAction.path && pageAction.path.length > 0) {
        await navigate_to_page(stagehand, rootUrl, pageAction.path);
      }
      
      // Use the tool configuration passed from universalHandler
      
      // Build input context from page action inputs
      const inputContext = pageAction.inputs ? pageAction.inputs.map(input => 
        `- ${input.description} (selector: ${input.selector})`
      ).join('\n') : NO_INPUTS_STR;
      
      // Use Browserbase's agent capability to handle form interactions and actions
      const agent = stagehand.agent({
        provider: "openai",
        instructions: 'You are a helpful assistant that can use a web browser.',
        model: "computer-use-preview",
        options: {
          apiKey: process.env.OPENAI_API_KEY || "your-openai-key"
        },
      });

      let actionResult = "";
      try {
        const agentResponse = await agent.execute({
          instruction: `You will be executing the following task:
        
        Task: ${toolConfig.name}
        Description: ${toolConfig.description}
        
        ${args && Object.keys(args).length > 0 ? `Arguments provided:
        ${Object.entries(args).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`).join('\n')}` : 'No arguments provided'}
        
        Page action details:
        - Operation: ${pageAction.operation}
        - Description: ${pageAction.textContent}
        
        Available inputs that might be related to this task:
        ${inputContext}

        ${inputContext != NO_INPUTS_STR ? 'You MUST click submit/complete the requested action. Do NOT ask for further permission.' : ''}
        
        If you run into issues, then you MUST find the buttons on the screen to solve those issues - do NOT ask for permission.

        ${pageAction.operation.toLowerCase() == 'read' ? 'Return the requested information.' : 'Return whether the request action was successful.'}`,
          maxSteps: 60
        });
        
        actionResult = JSON.stringify(agentResponse);
      } catch (agentError) {
        console.error('Agent execution error:', agentError);
        actionResult = `Agent execution failed: ${agentError instanceof Error ? agentError.message : 'Unknown error'}`;
      }
      
      const result = {
        success: true,
        pageAction: pageAction,
        currentUrl: page.url(),
        message: actionResult
      };
      
      console.error('Cleaning up: Closing Stagehand...');
      // Close the stagehand instance
      await stagehand.close();
      
      console.error('Browser automation completed successfully');
      return result;
    } catch (error) {
      console.error('Error executing page action:', error);
      return {
        success: false,
        pageAction: pageAction,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Main execution function
async function main(): Promise<void> {
  console.error("Starting dynamic MCP server")
  const server = new DynamicMcpServer();
  
  // Get config file from CLI argument, fallback to exampleMcpConfig.json
  const configFile = process.argv[2] || join(__dirname, "..", "test", "exampleMcpConfig.json");
  
  // Get page actions file from CLI argument, fallback to exampleSummaryPageActions.json
  const pageActionsFile = process.argv[3] || join(__dirname, "..", "test", "exampleSummaryPageActions.json");
  
  // Load configuration from JSON file
  try {
    server.loadConfigFromFile(configFile);
    console.error(`Loaded config from: ${configFile}`);
  } catch (error) {
    console.error(`Error loading config file '${configFile}':`, error);
    process.exit(1);
  }
  
  // Load page actions from JSON file
  try {
    server.loadPageActionsFromFile(pageActionsFile);
    console.error(`Loaded page actions from: ${pageActionsFile}`);
  } catch (error) {
    console.error(`Error loading page actions file '${pageActionsFile}':`, error);
    process.exit(1);
  }
  
  // Start the server
  await server.start();
}

// Export for use as a module
export { main };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
