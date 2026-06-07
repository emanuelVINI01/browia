/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolRegistry } from "../types";
import { resolveTabId, requireParam } from "../utils";
import { resolveElement } from "./domRead";
import { interactElement } from "./domActions";
import { extractPageText, getDomTree } from "./domRead";
import { SITE_RECIPES } from "../../siteRecipes";

function cleanParams(obj: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

export const macroActionTools: ToolRegistry = {
  search_current_site_or_engine: searchCurrentSiteOrEngine,
  summarize_current_page_compact: summarizeCurrentPageCompact,
  click_target_by_description: clickTargetByDescription,
};

async function searchCurrentSiteOrEngine(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const query = requireParam(params, "query");

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";
  const domain = new URL(url).hostname.replace("www.", "");

  let searchBoxVortexId: number | undefined = undefined;

  // Check Google or YouTube recipes
  if (domain.includes("google.com")) {
    const recipe = SITE_RECIPES["google.com"];
    for (const loc of recipe.elements.searchBox) {
      const res = await resolveElement(cleanParams({
        tabId: String(tabId),
        selector: loc.type === "css" ? loc.value : undefined,
        ariaContains: loc.type === "ariaContains" ? loc.value : undefined,
      })) as any;

      if (res && res.success && res.element?.vortexId) {
        searchBoxVortexId = res.element.vortexId;
        break;
      }
    }
  } else if (domain.includes("youtube.com")) {
    const recipe = SITE_RECIPES["youtube.com"];
    for (const loc of recipe.elements.searchBox) {
      const res = await resolveElement(cleanParams({
        tabId: String(tabId),
        selector: loc.type === "css" ? loc.value : undefined,
        ariaContains: loc.type === "ariaContains" ? loc.value : undefined,
      })) as any;

      if (res && res.success && res.element?.vortexId) {
        searchBoxVortexId = res.element.vortexId;
        break;
      }
    }
  }

  // General fallback search input
  if (!searchBoxVortexId) {
    const generalRes = await resolveElement({
      tabId: String(tabId),
      selector: "input[type='search'], input[name='q'], textarea[name='q'], #search",
      visibleOnly: "true",
      interactiveOnly: "true",
    }) as any;

    if (generalRes && generalRes.success && generalRes.element?.vortexId) {
      searchBoxVortexId = generalRes.element.vortexId;
    }
  }

  if (!searchBoxVortexId) {
    throw new Error("Could not find search input element on page.");
  }

  // Type search query
  await interactElement({
    tabId: String(tabId),
    vortexId: String(searchBoxVortexId),
    action: "type",
    value: query,
  });

  // Submit search via Enter key
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (targetVortexId: number) => {
      const el = document.querySelector(`[data-vortex-id="${targetVortexId}"]`);
      if (el) {
        const eventInit = { key: "Enter", code: "Enter", bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        el.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        el.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      }
    },
    args: [searchBoxVortexId],
  });

  return { ok: true, message: `Searched for "${query}" successfully.` };
}

async function summarizeCurrentPageCompact(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const maxChars = params.maxChars ? Number(params.maxChars) : 1500;

  const textResult = (await extractPageText({
    tabId: String(tabId),
    maxChars: String(maxChars * 4),
  })) as any;

  if (!textResult || !textResult.text) {
    throw new Error("Could not extract page text.");
  }

  const rawText = textResult.text;

  const cleanedTextResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const main = (document.querySelector("main, article, #content, .content") || document.body) as HTMLElement | null;
      return (main?.innerText || "").replace(/\s+/g, " ").trim();
    }
  });

  const cleanedText = cleanedTextResult[0]?.result || rawText;

  return {
    title: textResult.title,
    url: textResult.url,
    summaryText: cleanedText.substring(0, maxChars),
    truncated: cleanedText.length > maxChars,
  };
}

async function clickTargetByDescription(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const description = requireParam(params, "description");

  const resolveResult = (await resolveElement({
    tabId: String(tabId),
    textContains: description,
    ariaContains: description,
    placeholderContains: description,
    nameContains: description,
    visibleOnly: "true",
    interactiveOnly: "true",
  })) as any;

  if (resolveResult && resolveResult.success && resolveResult.element?.vortexId) {
    await interactElement({
      tabId: String(tabId),
      vortexId: String(resolveResult.element.vortexId),
      action: "click",
    });
    return { ok: true, message: `Clicked element resolved by description "${description}".`, element: resolveResult.element };
  }

  // Fallback: search via DOM candidates
  const searchResults = (await getDomTree({
    tabId: String(tabId),
    maxNodes: "200",
    onlyVisible: "true",
    onlyInteractive: "true",
  })) as any;

  if (searchResults?.topCandidates && searchResults.topCandidates.length > 0) {
    const match = searchResults.topCandidates.find((c: any) => 
      (c.text || "").toLowerCase().includes(description.toLowerCase()) ||
      (c.ariaLabel || "").toLowerCase().includes(description.toLowerCase()) ||
      (c.id || "").toLowerCase().includes(description.toLowerCase())
    );

    if (match) {
      await interactElement({
        tabId: String(tabId),
        vortexId: String(match.vortexId),
        action: "click",
      });
      return { ok: true, message: `Clicked matched candidate element for description "${description}".`, element: match };
    }
  }

  throw new Error(`Could not find an element matching description "${description}" to click.`);
}
