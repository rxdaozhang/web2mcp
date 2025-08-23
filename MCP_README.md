# Dynamic MCP Server for Web2MCP

This directory contains dynamic MCP (Model Context Protocol) servers that can programmatically register function signatures and route all calls to a shared executor function.

## Files Overview

- `dynamicMcpServer.ts` - Dynamic MCP server with JSON config loading
- `exampleMcpConfig.json` - Example configuration file defining function signatures
- `MCP_README.md` - This documentation file

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build and Run the Server

```bash
# Build the server (recommended for production)
npm run build:mcp

# Run the built server
npm run start:mcp

# Or run directly with tsx (development)
npx tsx dynamicMcpServer.ts

# Use custom config file
npx tsx dynamicMcpServer.ts myCustomConfig.json
# or
node dist/dynamicMcpServer.js myCustomConfig.json
```

## Configuration Format

The optimal format for storing function signatures is JSON with JSON Schema for parameters. Here's an example:

```json
{
  "server": {
    "name": "web2mcp-dynamic-server",
    "version": "0.1.0"
  },
  "tools": [
    {
      "name": "crawl_website",
      "description": "Crawl a website and extract information",
      "input_schema": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "format": "uri",
            "description": "The URL to crawl"
          },
          "max_depth": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10,
            "default": 2,
            "description": "Maximum depth for crawling"
          }
        },
        "required": ["url"],
        "additionalProperties": false
      }
    }
  ]
}
```

## How It Works

### 1. Function Registry
- Store function signatures in JSON format with JSON Schema validation
- Each function has a name, description, and input schema
- The schema defines parameter types, validation rules, and defaults

### 2. Dynamic Registration
- At startup, the server loads the registry
- Each function is dynamically registered as an MCP tool
- All tools route to a single shared executor function

### 3. Shared Executor
- One function handles all tool calls: `executeTool(name, args)`
- You can implement specific handlers for known functions
- Unknown functions fall back to a universal handler
- The universal handler can forward to your backend system

## Universal Handler

The server uses a universal handler pattern where all function calls are routed through a single executor. You can implement specific handlers for known functions, and unknown functions fall back to the universal handler which can forward to your backend system.

### Build for Distribution

```bash
# Build the server
npm run build:mcp

# The built file will be in dist/dynamicMcpServer.js
# This can be distributed and run on any system with Node.js
```

### Testing with MCP Inspector

```bash
# Test the server using the MCP Inspector
npx @modelcontextprotocol/inspector node dist/dynamicMcpServer.js

# This opens a web interface where you can test all registered tools
# and see the MCP protocol communication in real-time
```
