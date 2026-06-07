import { toolRegistry } from "./mcp/toolRegistry";
import type { ToolCall } from "./mcp/types";
import { parseXmlCommands } from "./mcp/xmlParser";

export type { CachedElementRecord, ElementQueryResult, PageResource, ToolCall } from "./mcp/types";

export function normalizeToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (toolName === "interact_element") {
    if (normalized.value === undefined && typeof normalized.text === "string") {
      normalized.value = normalized.text;
      delete normalized.text;
    }

    const v = normalized.vortexId;

    if (typeof v === "string") {
      if (/^\d+$/.test(v)) {
        normalized.vortexId = Number(v);
      } else {
        // Não é número. Provavelmente é id/selector/locator.
        delete normalized.vortexId;

        if (v.startsWith("#") || v.startsWith(".") || v.includes("[") || v.includes("=") || v.includes(">")) {
          normalized.selector = v;
        } else {
          normalized.id = v;
        }
      }
    }
  }
  return normalized;
}

export class McpEngine {
  static parseXmlCommands(aiOutput: string): ToolCall[] {
    return parseXmlCommands(aiOutput);
  }

  static async executeTool(call: ToolCall): Promise<unknown> {
    const handler = toolRegistry[call.name];

    if (!handler) {
      throw new Error(`Unknown MCP tool: ${call.name}`);
    }

    const normalizedParams = normalizeToolArgs(call.name, call.params);
    return handler(normalizedParams);
  }
}
