import type { ToolCall, ToolRegistry } from "../types";
import { parseJsonObject, requireParam } from "../utils";

type ToolExecutor = (call: ToolCall) => Promise<unknown>;

export function createOrchestrationTools(executeTool: ToolExecutor): ToolRegistry {
  return {
    call_on_condition: (params) => callOnCondition(params, executeTool),
  };
}

async function callOnCondition(
  params: Record<string, string>,
  executeTool: ToolExecutor,
): Promise<unknown> {
  const condition = requireParam(params, "condition");
  const thenTool = requireParam(params, "thenTool");
  const thenParams = toStringRecord(parseJsonObject(params.thenParams, "thenParams"));
  const waitResult = await waitForCondition(condition, params, executeTool);
  const continueOnTimeout = params.continueOnTimeout === "true";

  if (!isOkResult(waitResult) && !continueOnTimeout) {
    return {
      ok: false,
      skipped: true,
      condition,
      waitResult,
      error: "Condition was not satisfied before timeout.",
    };
  }

  if (thenTool === "call_on_condition") {
    throw new Error("call_on_condition cannot call itself recursively.");
  }

  const toolResult = await executeTool({
    name: thenTool,
    params: thenParams,
  });

  return {
    ok: true,
    condition,
    waitResult,
    thenTool,
    thenResult: toolResult,
  };
}

async function waitForCondition(
  condition: string,
  params: Record<string, string>,
  executeTool: ToolExecutor,
): Promise<unknown> {
  if (condition === "page_ready") {
    return executeTool({
      name: "wait_for_page_ready",
      params: pickParams(params, [
        "tabId",
        "timeoutMs",
        "idleMs",
        "minElements",
        "minTextLength",
        "urlIncludes",
        "textIncludes",
      ]),
    });
  }

  if (condition === "navigation_or_dom_change") {
    return executeTool({
      name: "wait_for_navigation_or_dom_change",
      params: pickParams(params, ["tabId", "timeoutMs", "idleMs", "previousUrl", "previousSignature"]),
    });
  }

  if (condition === "element_present") {
    return executeTool({
      name: "wait_for_element",
      params: {
        tabId: params.tabId ?? "",
        query: requireParam(params, "query"),
        timeoutMs: params.timeoutMs ?? "15000",
        visibleOnly: params.visibleOnly ?? "true",
      },
    });
  }

  if (condition === "text_present") {
    return executeTool({
      name: "wait_for_page_ready",
      params: {
        tabId: params.tabId ?? "",
        timeoutMs: params.timeoutMs ?? "15000",
        idleMs: params.idleMs ?? "750",
        textIncludes: requireParam(params, "textIncludes"),
      },
    });
  }

  if (condition === "url_includes") {
    return executeTool({
      name: "wait_for_page_ready",
      params: {
        tabId: params.tabId ?? "",
        timeoutMs: params.timeoutMs ?? "15000",
        idleMs: params.idleMs ?? "750",
        urlIncludes: requireParam(params, "urlIncludes"),
      },
    });
  }

  if (condition === "delay") {
    const timeoutMs = Math.min(Math.max(Number(params.timeoutMs ?? "1000"), 0), 60000);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return { ok: true, waitedMs: timeoutMs };
  }

  throw new Error(`Unsupported condition: ${condition}`);
}

function isOkResult(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }

  return (result as { ok?: unknown }).ok === true;
}

function pickParams(params: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((key) => params[key] !== undefined).map((key) => [key, params[key]]));
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" ? entry : JSON.stringify(entry),
    ]),
  );
}
