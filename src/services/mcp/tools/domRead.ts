/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import { serializeCurrentDom, type DomSemanticNode, type DomSemanticTree } from "../../domSerializer";
import type { ElementQueryResult, ToolRegistry } from "../types";
import { requireParam, resolveTabId } from "../utils";

export const domReadTools: ToolRegistry = {
  get_dom_tree: getDomTree,
  query_elements: queryElements,
  wait_for_element: waitForElement,
  extract_page_text: extractPageText,
  get_selection: getSelection,
  resolve_element: resolveElement,
};

// Traverses page to assign vortex IDs sequentially in DOM order if they don't exist yet.
// Keeps vortex IDs consistent between get_page_inventory and get_dom_tree.
function ensureVortexIdsOnPage() {
  const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"]);
  let vortexCounter = 1;
  function traverse(element: Element) {
    if (ignoredTags.has(element.tagName)) return;
    if (!element.hasAttribute("data-vortex-id")) {
      element.setAttribute("data-vortex-id", String(vortexCounter));
    }
    vortexCounter++;
    for (const child of Array.from(element.children)) {
      traverse(child);
    }
  }
  if (document.body) {
    traverse(document.body);
  }
}

export async function getDomTree(params: Record<string, string>): Promise<DomSemanticTree> {
  const tabId = await resolveTabId(params.tabId);
  
  const hasOptions = 
    params.maxDepth !== undefined || 
    params.maxNodes !== undefined || 
    params.onlyVisible !== undefined || 
    params.onlyInteractive !== undefined || 
    params.includeTextMaxLength !== undefined;

  if (hasOptions) {
    const options = {
      maxDepth: params.maxDepth ? Number(params.maxDepth) : undefined,
      maxNodes: params.maxNodes ? Number(params.maxNodes) : undefined,
      onlyVisible: params.onlyVisible !== "false",
      onlyInteractive: params.onlyInteractive === "true",
      includeTextMaxLength: params.includeTextMaxLength ? Number(params.includeTextMaxLength) : undefined,
      queryHint: params.queryHint,
    };

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"]);
        const maxDepth = opts.maxDepth ?? 6;
        const maxNodes = opts.maxNodes ?? 300;
        const onlyVisible = opts.onlyVisible !== false;
        const onlyInteractive = opts.onlyInteractive === true;
        const includeTextMaxLength = opts.includeTextMaxLength ?? 80;
        
        let nodeCount = 0;
        let vortexCounter = 1;

        function traverseAssign(element: Element) {
          if (ignoredTags.has(element.tagName)) return;
          if (!element.hasAttribute("data-vortex-id")) {
            element.setAttribute("data-vortex-id", String(vortexCounter));
          }
          vortexCounter++;
          for (const child of Array.from(element.children)) {
            traverseAssign(child);
          }
        }
        if (document.body) {
          traverseAssign(document.body);
        }

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

        const isInteractive = (element: Element) => {
          const tag = element.tagName.toLowerCase();
          const role = element.getAttribute("role");
          const contentEditable = element.getAttribute("contenteditable");
          return (
            ["input", "textarea", "select", "button", "a"].includes(tag) ||
            contentEditable === "true" ||
            contentEditable === "" ||
            ["button", "link", "checkbox", "textbox"].includes(role || "")
          );
        };

        const cleanText = (value: string): string => {
          return value.replace(/\s+/g, " ").trim();
        };

        const serializeElement = (element: Element, depth: number): any => {
          if (ignoredTags.has(element.tagName) || nodeCount >= maxNodes || depth > maxDepth) {
            return null;
          }

          const rect = element.getBoundingClientRect();
          const visible = isVisible(element);
          
          if (onlyVisible && !visible) {
            return null;
          }

          const interactive = isInteractive(element);
          nodeCount++;
          const vortexId = Number(element.getAttribute("data-vortex-id") || "0");
          
          let textContent = "";
          if (element.childNodes.length > 0) {
            const textParts: string[] = [];
            for (const child of Array.from(element.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE && child.textContent) {
                const t = cleanText(child.textContent);
                if (t) textParts.push(t);
              }
            }
            textContent = textParts.join(" ").substring(0, includeTextMaxLength);
          }

          const attributes: Record<string, string | boolean | number> = {};
          for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            if (["id", "name", "type", "role", "placeholder", "aria-label"].includes(name)) {
              attributes[name] = attr.value;
            }
          }

          const children: any[] = [];
          for (const child of Array.from(element.children)) {
            const serializedChild = serializeElement(child, depth + 1);
            if (serializedChild) {
              children.push(serializedChild);
            }
          }

          if (onlyInteractive && !interactive && children.length === 0) {
            nodeCount--;
            return null;
          }

          return {
            vortexId,
            tag: element.tagName.toLowerCase(),
            text: textContent,
            visible,
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            },
            attributes,
            children,
          };
        };

        return {
          url: window.location.href,
          title: document.title,
          capturedAt: new Date().toISOString(),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          },
          root: document.body ? serializeElement(document.body, 0) : null,
        };
      },
      args: [options],
    });
    const tree = result[0]?.result;
    if (!tree) {
      throw new Error("Unable to read DOM tree with custom options.");
    }
    return tree as DomSemanticTree;
  }

  // Fallback to standard DOM tree representation
  await chrome.scripting.executeScript({
    target: { tabId },
    func: ensureVortexIdsOnPage,
  });

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

  const tabId = await resolveTabId(params.tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: ensureVortexIdsOnPage,
  });

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

export async function extractPageText(params: Record<string, string>): Promise<unknown> {
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

export interface ResolveElementInput {
  vortexId?: number;
  selector?: string;
  id?: string;
  ariaLabel?: string;
  ariaContains?: string;
  text?: string;
  textContains?: string;
  role?: string;
  tag?: string;
  name?: string;
  nameContains?: string;
  placeholder?: string;
  placeholderContains?: string;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  nearText?: string;
  index?: number;
}

export async function resolveElement(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const input: ResolveElementInput = {
    vortexId: params.vortexId ? Number(params.vortexId) : undefined,
    selector: params.selector,
    id: params.id,
    ariaLabel: params.ariaLabel,
    ariaContains: params.ariaContains,
    text: params.text,
    textContains: params.textContains,
    role: params.role,
    tag: params.tag,
    name: params.name,
    nameContains: params.nameContains,
    placeholder: params.placeholder,
    placeholderContains: params.placeholderContains,
    visibleOnly: params.visibleOnly !== "false",
    interactiveOnly: params.interactiveOnly === "true",
    nearText: params.nearText,
    index: params.index ? Number(params.index) : undefined,
  };

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (inp) => {
      const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"]);
      let vortexCounter = 1;
      
      function traverse(element: Element) {
        if (ignoredTags.has(element.tagName)) return;
        if (!element.hasAttribute("data-vortex-id")) {
          element.setAttribute("data-vortex-id", String(vortexCounter));
        }
        vortexCounter++;
        for (const child of Array.from(element.children)) {
          traverse(child);
        }
      }
      if (document.body) {
        traverse(document.body);
      }

      const allElements = Array.from(document.querySelectorAll("*")).filter(el => !ignoredTags.has(el.tagName));
      
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

      const isInteractive = (element: Element) => {
        const tag = element.tagName.toLowerCase();
        const roleStr = element.getAttribute("role");
        const contentEditable = element.getAttribute("contenteditable");
        return (
          ["input", "textarea", "select", "button", "a"].includes(tag) ||
          contentEditable === "true" ||
          contentEditable === "" ||
          ["button", "link", "checkbox", "textbox"].includes(roleStr || "")
        );
      };

      let candidates = allElements;
      
      if (inp.visibleOnly !== false) {
        candidates = candidates.filter(isVisible);
      }
      
      if (inp.interactiveOnly) {
        candidates = candidates.filter(isInteractive);
      }

      const scored = candidates.map(el => {
        let score = 0;
        const tag = el.tagName.toLowerCase();
        const id = el.id || "";
        const nameAttr = el.getAttribute("name") || "";
        const ariaLabelAttr = el.getAttribute("aria-label") || "";
        const textVal = (el.textContent || "").trim();
        const placeholderAttr = el.getAttribute("placeholder") || "";
        const roleAttr = el.getAttribute("role") || "";

        if (inp.vortexId && Number(el.getAttribute("data-vortex-id")) === Number(inp.vortexId)) {
          score += 500;
        }

        if (inp.selector) {
          try {
            if (el.matches(inp.selector)) {
              score += 100;
            }
          } catch {}
        }

        if (inp.id && id.toLowerCase() === inp.id.toLowerCase()) {
          score += 90;
        }

        if (inp.ariaLabel && ariaLabelAttr.toLowerCase() === inp.ariaLabel.toLowerCase()) {
          score += 80;
        } else if (inp.ariaContains && ariaLabelAttr.toLowerCase().includes(inp.ariaContains.toLowerCase())) {
          score += 40;
        }

        if (inp.text && textVal.toLowerCase() === inp.text.toLowerCase()) {
          score += 70;
        } else if (inp.textContains && textVal.toLowerCase().includes(inp.textContains.toLowerCase())) {
          score += 30;
        }

        if (inp.placeholder && placeholderAttr.toLowerCase() === inp.placeholder.toLowerCase()) {
          score += 60;
        } else if (inp.placeholderContains && placeholderAttr.toLowerCase().includes(inp.placeholderContains.toLowerCase())) {
          score += 25;
        }

        if (inp.name && nameAttr.toLowerCase() === inp.name.toLowerCase()) {
          score += 50;
        } else if (inp.nameContains && nameAttr.toLowerCase().includes(inp.nameContains.toLowerCase())) {
          score += 20;
        }

        if (inp.role && roleAttr.toLowerCase() === inp.role.toLowerCase()) {
          score += 15;
        }
        if (inp.tag && tag === inp.tag.toLowerCase()) {
          score += 10;
        }

        return { element: el, score };
      });

      let matches = scored.filter(s => s.score > 0);
      if (matches.length === 0 && !inp.selector && !inp.id && !inp.ariaLabel && !inp.ariaContains && !inp.text && !inp.textContains && !inp.placeholder && !inp.placeholderContains && !inp.name && !inp.nameContains && !inp.role && !inp.tag) {
        matches = scored.map(s => ({
          element: s.element,
          score: isInteractive(s.element) ? 10 : 1
        }));
      }

      matches.sort((a, b) => b.score - a.score);

      if (matches.length === 0) {
        return { success: false, reason: "No matching elements found." };
      }

      const best = matches[0];
      const confidence = best.score;
      const bestEl = best.element;
      const vortexIdVal = Number(bestEl.getAttribute("data-vortex-id") || "0");
      const rectVal = bestEl.getBoundingClientRect();
      
      const topCandidates = matches.slice(0, 5).map(m => ({
        vortexId: Number(m.element.getAttribute("data-vortex-id") || "0"),
        tag: m.element.tagName.toLowerCase(),
        id: m.element.id || undefined,
        text: (m.element.textContent || "").trim().substring(0, 100),
        ariaLabel: m.element.getAttribute("aria-label") || undefined,
        role: m.element.getAttribute("role") || undefined,
        placeholder: m.element.getAttribute("placeholder") || undefined,
        confidence: m.score,
      }));

      if (confidence >= 30 || matches.length === 1) {
        return {
          success: true,
          element: {
            vortexId: vortexIdVal,
            selector: inp.selector || undefined,
            id: bestEl.id || undefined,
            tag: bestEl.tagName.toLowerCase(),
            role: bestEl.getAttribute("role") || undefined,
            text: (bestEl.textContent || "").trim().substring(0, 100),
            ariaLabel: bestEl.getAttribute("aria-label") || undefined,
            placeholder: bestEl.getAttribute("placeholder") || undefined,
            rect: { x: Math.round(rectVal.x), y: Math.round(rectVal.y), w: Math.round(rectVal.width), h: Math.round(rectVal.height) },
            confidence,
            reason: `Matched with score ${confidence}.`
          },
          candidates: topCandidates
        };
      }

      return {
        success: false,
        reason: "Ambiguous matches. Please refine locator.",
        candidates: topCandidates
      };
    },
    args: [input],
  });

  return result[0]?.result;
}
