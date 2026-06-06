import { toolRegistry } from "./mcp/toolRegistry";
import type { ToolCall } from "./mcp/types";
import { parseXmlCommands } from "./mcp/xmlParser";

export type { CachedElementRecord, ElementQueryResult, PageResource, ToolCall } from "./mcp/types";

export class McpEngine {
  static parseXmlCommands(aiOutput: string): ToolCall[] {
    return parseXmlCommands(aiOutput);
  }

  static async executeTool(call: ToolCall): Promise<unknown> {
    const handler = toolRegistry[call.name];

    if (!handler) {
      throw new Error(`Unknown MCP tool: ${call.name}`);
    }

    return handler(call.params);
  }
}
