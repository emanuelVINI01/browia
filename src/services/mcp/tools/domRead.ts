import { serializeCurrentDom, type DomSemanticNode, type DomSemanticTree } from "../../domSerializer";
import type { ElementQueryResult, ToolRegistry } from "../types";
import { requireParam, resolveTabId } from "../utils";

export const domReadTools: ToolRegistry = {
  get_dom_tree: getDomTree,
  query_elements: queryElements,
  wait_for_element: waitForElement,
  extract_page_text: extractPageText,
  get_selection: getSelection,
};

export async function getDomTree(params: Record<string, string>): Promise<DomSemanticTree> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: serializeCurrentDom,
  });
  const tree = result[0]?.result;

  if (!tree) {
    throw new Error("Unable to read DOM tree from active tab.");
  }

  return tree;
}

async function queryElements(params: Record<string, string>): Promise<ElementQueryResult[]> {
  const query = requireParam(params, "query").toLowerCase();
  const visibleOnly = params.visibleOnly !== "false";
  const limit = Math.min(Math.max(Number(params.limit ?? "20"), 1), 100);
  const tree = await getDomTree(params);
  const results: ElementQueryResult[] = [];

  function walk(node: DomSemanticNode): void {
    if (results.length >= limit) {
      return;
    }

    const searchable = [
      node.tag,
      node.text,
      ...Object.entries(node.attributes).map(([key, value]) => `${key} ${String(value)}`),
    ]
      .join(" ")
      .toLowerCase();

    if ((!visibleOnly || node.visible) && searchable.includes(query)) {
      results.push({
        vortexId: node.vortexId,
        tag: node.tag,
        text: node.text,
        visible: node.visible,
        attributes: node.attributes,
        rect: node.rect,
      });
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  if (tree.root) {
    walk(tree.root);
  }

  return results;
}

async function waitForElement(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const query = requireParam(params, "query").toLowerCase();
  const timeoutMs = Math.min(Math.max(Number(params.timeoutMs ?? "5000"), 250), 30000);
  const visibleOnly = params.visibleOnly !== "false";
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (needle: string, maxWaitMs: number, requireVisible: boolean) =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        let intervalId = 0;

        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        };

        const matches = (element: Element) => {
          const haystack = [
            element.tagName,
            element.textContent ?? "",
            ...Array.from(element.attributes).map((attr) => `${attr.name} ${attr.value}`),
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(needle) && (!requireVisible || isVisible(element));
        };

        const scan = () => {
          const element = Array.from(document.body?.querySelectorAll("*") ?? []).find(matches);

          if (element) {
            const existingId = element.getAttribute("data-vortex-id");
            const vortexId = existingId ? Number(existingId) : Date.now();
            element.setAttribute("data-vortex-id", String(vortexId));
            window.clearInterval(intervalId);
            resolve({ ok: true, vortexId, tag: element.tagName.toLowerCase() });
            return;
          }

          if (Date.now() - startedAt >= maxWaitMs) {
            window.clearInterval(intervalId);
            resolve({ ok: false, error: "Element wait timed out." });
          }
        };

        intervalId = window.setInterval(scan, 250);
        scan();
      }),
    args: [query, timeoutMs, visibleOnly],
  });

  return result[0]?.result;
}

async function extractPageText(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const maxChars = Math.min(Math.max(Number(params.maxChars ?? "20000"), 100), 200000);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (limit: number) => {
      const text = (document.body?.innerText ?? "")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      return {
        title: document.title,
        url: window.location.href,
        text: text.slice(0, limit),
        truncated: text.length > limit,
      };
    },
    args: [maxChars],
  });

  return result[0]?.result;
}

async function getSelection(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      text: window.getSelection()?.toString() ?? "",
    }),
  });

  return result[0]?.result;
}
