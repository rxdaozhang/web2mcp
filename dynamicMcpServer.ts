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

// Types for page actions
interface PathObject {
  intra_page_path: string;
  is_new_link: boolean;
}

interface PageAction {
  operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
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
  }>;
  textContent: string;
  path: PathObject[];
}

// Enhanced Dynamic MCP Server
export class EnhancedMcpServer {
  private server: McpServer;
  private transport: StdioServerTransport;
  private registeredTools: Set<string> = new Set();
  private loadedConfig: ServerConfig | null = null;
  private pageActions: PageAction[] = [];

  constructor(name: string = "enhanced-mcp-server", version: string = "0.1.0") {
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
    const message = `A user has just invoked this function:

${JSON.stringify(toolConfig, null, 2)}

With the arguments:
${Object.keys(args).length === 0 ? 'No arguments' : Object.entries(args).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`).join('\n')}

Return the index in the following operation list that corresponds to satisfying this request. ONLY respond with the index and no additional output:

${this.pageActions.map((action, index) => `${index}: ${JSON.stringify(action, null, 2)}`).join('\n\n')}`;
    
    // Call ChatGPT to determine the appropriate page action index
    let selectedIndex: number | null = null;
    try {
      selectedIndex = await this.callChatGPT(message);
      
      // Validate the index is within bounds
      if (selectedIndex < 0 || selectedIndex >= this.pageActions.length) {
        console.error(`ChatGPT returned invalid index: ${selectedIndex}, but pageActions length is ${this.pageActions.length}`);
        selectedIndex = null;
      }
    } catch (error) {
      console.error('Failed to get page action index from ChatGPT:', error);
      selectedIndex = null;
    }
    
    // TODO: Implement page traversal and website interaction using pageActions
    return { 
      ok: true, 
      handled_by: "universalHandler", 
      name, 
      args,
      message,
      availablePageActions: this.pageActions.length,
      pageActions: this.pageActions,
      selectedPageActionIndex: selectedIndex,
      selectedPageAction: selectedIndex !== null ? this.pageActions[selectedIndex] : null
    };
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
    console.error(`Enhanced MCP Server started with ${this.registeredTools.size} tools`);
    console.error("Registered tools:", this.getRegisteredTools());
  }

  // Stop the server
  async stop(): Promise<void> {
    console.error("Enhanced MCP Server stopped");
  }
}

// Main execution function
async function main(): Promise<void> {
  console.error("Starting dynamic MCP server")
  const server = new EnhancedMcpServer();
  
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
