import type { StorageAreaName } from "./types";

export async function resolveTabId(tabId?: string): Promise<number> {
  if (tabId) {
    const parsedTabId = Number(tabId);

    if (Number.isFinite(parsedTabId)) {
      return parsedTabId;
    }
  }

  const hasTabs = typeof chrome !== "undefined" && typeof chrome.tabs !== "undefined";
  const hasScripting = typeof chrome !== "undefined" && typeof chrome.scripting !== "undefined";
  console.log(`[Browia resolveTabId] Requesting tab resolution. chrome.tabs: ${hasTabs}, chrome.scripting: ${hasScripting}`);

  if (typeof chrome === "undefined" || !chrome.tabs) {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      console.log("[Browia resolveTabId] chrome.tabs is unavailable. Dispatching RESOLVE_ACTIVE_TAB_ID to background...");
      const bgResponse = await chrome.runtime.sendMessage({
        type: "RESOLVE_ACTIVE_TAB_ID"
      });

      const resolvedTabId = bgResponse?.result?.tabId ?? bgResponse?.tabId;

      if (bgResponse?.ok && typeof resolvedTabId === "number") {
        console.log(`[Browia resolveTabId] Background successfully resolved active tab: ${resolvedTabId}`);
        return resolvedTabId;
      } else {
        throw new Error(bgResponse?.error || "Failed to resolve active tab from background.");
      }
    }
    throw new Error("chrome.tabs API is not available. If you recently updated the manifest permissions, please reload the extension in chrome://extensions.");
  }

  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tabs || tabs.length === 0) {
    tabs = await chrome.tabs.query({ active: true });
  }
  const activeTabId = tabs?.[0]?.id;

  if (typeof activeTabId !== "number") {
    throw new Error("No active tab found.");
  }

  return activeTabId;
}

export function tabSnapshot(tab: chrome.tabs.Tab): {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
} {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
  };
}

export function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];

  if (!value) {
    throw new Error(`Missing required parameter: ${name}`);
  }

  return value;
}

export function requireNumber(params: Record<string, string>, name: string): number {
  const value = Number(requireParam(params, name));

  if (!Number.isFinite(value)) {
    throw new Error(`Parameter ${name} must be a number.`);
  }

  return value;
}

export function parseJsonObject(
  value: string | undefined,
  name: string,
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Parameter ${name} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

export function parseJsonArray(value: string | undefined, name: string): string[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Parameter ${name} must be a JSON string array.`);
  }

  return parsed;
}

export function resolveStorageArea(areaName: string | undefined): chrome.storage.StorageArea {
  const area = (areaName ?? "local") as StorageAreaName;

  if (area === "local") {
    return chrome.storage.local;
  }

  if (area === "sync") {
    return chrome.storage.sync;
  }

  if (area === "session") {
    return chrome.storage.session;
  }

  throw new Error("Storage area must be local, sync, or session.");
}

export function optionalConflictAction(
  value: string | undefined,
): `${chrome.downloads.FilenameConflictAction}` | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "uniquify" || value === "overwrite" || value === "prompt") {
    return value;
  }

  throw new Error("conflictAction must be uniquify, overwrite, or prompt.");
}

export function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === "true";
}

export function optionalSameSite(
  value: string | undefined,
): `${chrome.cookies.SameSiteStatus}` | undefined {
  if (!value) {
    return undefined;
  }

  if (
    value === "no_restriction" ||
    value === "lax" ||
    value === "strict" ||
    value === "unspecified"
  ) {
    return value;
  }

  throw new Error("sameSite must be no_restriction, lax, strict, or unspecified.");
}

export function createDataUrl(content: string, mimeType: string, encoding: string): string {
  if (encoding === "base64") {
    return `data:${mimeType};base64,${content}`;
  }

  return `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
}

export function decodeHtmlText(value: string): string {
  const entityMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }

    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }

    return entityMap[normalized] ?? `&${entity};`;
  });
}

export function htmlToText(html: string): string {
  return decodeHtmlText(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function resolveDuckDuckGoUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const redirect = url.searchParams.get("uddg");

    return redirect ? decodeURIComponent(redirect) : url.toString();
  } catch {
    return rawUrl;
  }
}
