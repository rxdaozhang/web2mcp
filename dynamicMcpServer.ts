#!/usr/bin/env node
// NOTE: Do not use stdio (including console.log) in this script

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Enhanced Dynamic MCP Server
export class EnhancedMcpServer {
  private server: McpServer;
  private transport: StdioServerTransport;
  private registeredTools: Set<string> = new Set();

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

  // Load configuration from JSON file
  loadConfigFromFile(configPath: string): void {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config: ServerConfig = JSON.parse(configContent);
      
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

  // Register tools from configuration
  registerToolsFromConfig(tools: ToolConfig[]): void {
    for (const tool of tools) {
      this.registerTool(tool.name, tool.description, tool.input_schema);
    }
  }

  // Register a single tool
  registerTool(
    name: string,
    description: string,
    inputSchema: any
  ): void {
    if (this.registeredTools.has(name)) {
      console.warn(`Tool '${name}' is already registered. Skipping.`);
      return;
    }

    this.server.tool(
      name,
      description,
      inputSchema,
      async (args: any) => {
        const result = await this.universalHandler(name, args);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
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
    // TODO: Implement page traversal and website interaction
    return { 
      ok: true, 
      handled_by: "universalHandler", 
      name, 
      args,
      message: "User #1 has name John Doe"
    };
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
  
  // Load configuration from JSON file
  try {
    server.loadConfigFromFile(configFile);
    console.error(`Loaded config from: ${configFile}`);
  } catch (error) {
    console.error(`Error loading config file '${configFile}':`, error);
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
