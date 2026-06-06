import type { ToolRegistry } from "../types";
import { requireParam, resolveTabId, tabSnapshot } from "../utils";

export const tabTools: ToolRegistry = {
  list_tabs: listTabs,
  create_tab: createTab,
  focus_tab: focusTab,
  close_tab: closeTab,
  navigate_tab: navigateTab,
  reload_tab: reloadTab,
  get_tab_info: getTabInfo,
  set_tab_zoom: setTabZoom,
  get_tab_zoom: getTabZoom,
  go_back: (params) => goHistory(params, "back"),
  go_forward: (params) => goHistory(params, "forward"),
};

async function listTabs(): Promise<Array<{ id?: number; url?: string; title?: string }>> {
  const tabs = await chrome.tabs.query({});

  return tabs.map((tab) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
  }));
}

async function createTab(params: Record<string, string>): Promise<unknown> {
  const tab = await chrome.tabs.create({
    url: params.url,
    active: params.active !== "false",
    pinned: params.pinned === "true",
  });

  if (!tab) {
    throw new Error("Unable to create tab.");
  }

  return tabSnapshot(tab);
}

async function focusTab(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const tab = await chrome.tabs.update(tabId, { active: true });

  if (!tab) {
    throw new Error(`Unable to focus tab ${tabId}.`);
  }

  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return tabSnapshot(tab);
}

async function closeTab(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  await chrome.tabs.remove(tabId);

  return { ok: true, tabId };
}

async function navigateTab(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const url = requireParam(params, "url");
  const tab = await chrome.tabs.update(tabId, { url });

  if (!tab) {
    throw new Error(`Unable to navigate tab ${tabId}.`);
  }

  return tabSnapshot(tab);
}

async function reloadTab(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  await chrome.tabs.reload(tabId, { bypassCache: params.bypassCache === "true" });

  return { ok: true, tabId };
}

async function getTabInfo(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const tab = await chrome.tabs.get(tabId);

  return tabSnapshot(tab);
}

async function setTabZoom(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const factor = Number(requireParam(params, "factor"));

  if (!Number.isFinite(factor) || factor < 0.25 || factor > 5) {
    throw new Error("Zoom factor must be a number between 0.25 and 5.");
  }

  await chrome.tabs.setZoom(tabId, factor);

  return { ok: true, tabId, factor };
}

async function getTabZoom(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const factor = await chrome.tabs.getZoom(tabId);

  return { tabId, factor };
}

async function goHistory(
  params: Record<string, string>,
  direction: "back" | "forward",
): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (historyDirection: "back" | "forward") => {
      if (historyDirection === "back") {
        window.history.back();
      } else {
        window.history.forward();
      }

      return { ok: true, direction: historyDirection };
    },
    args: [direction],
  });

  return result[0]?.result;
}
