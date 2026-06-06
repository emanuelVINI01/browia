import type { ToolRegistry } from "./types";
import { chromeDataTools } from "./tools/chromeData";
import { domTools } from "./tools/dom";
import { elementCacheTools } from "./tools/elementCache";
import { extensionStorageTools } from "./tools/extensionStorage";
import { networkTools } from "./tools/network";
import { createOrchestrationTools } from "./tools/orchestration";
import { pageTools } from "./tools/page";
import { tabTools } from "./tools/tabs";

const baseToolRegistry: ToolRegistry = {
  ...tabTools,
  ...domTools,
  ...elementCacheTools,
  ...pageTools,
  ...networkTools,
  ...extensionStorageTools,
  ...chromeDataTools,
};

export const toolRegistry: ToolRegistry = {
  ...baseToolRegistry,
  ...createOrchestrationTools(async (call) => {
    const handler = baseToolRegistry[call.name];

    if (!handler) {
      throw new Error(`Unknown MCP tool for call_on_condition: ${call.name}`);
    }

    return handler(call.params);
  }),
};
