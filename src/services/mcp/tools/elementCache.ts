import type { CachedElementRecord, ElementCache, ToolRegistry } from "../types";
import { ELEMENT_CACHE_KEY } from "../types";
import { requireNumber, requireParam, resolveTabId } from "../utils";
import { alterElementDom, interactElement } from "./dom";

export const elementCacheTools: ToolRegistry = {
  cache_element: cacheElement,
  list_cached_elements: listCachedElements,
  get_cached_element: getCachedElement,
  remove_cached_element: removeCachedElement,
  clear_cached_elements: clearCachedElements,
  resolve_cached_element: resolveCachedElement,
  interact_cached_element: interactCachedElement,
  alter_cached_element: alterCachedElement,
};

async function cacheElement(params: Record<string, string>): Promise<CachedElementRecord> {
  const tabId = await resolveTabId(params.tabId);
  const vortexId = requireNumber(params, "vortexId");
  const key = params.key ?? `element_${Date.now()}`;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (targetVortexId: number, cacheKey: string, cacheNote: string | undefined) => {
      const element = document.querySelector<HTMLElement>(
        `[data-vortex-id="${String(targetVortexId)}"]`,
      );

      if (!element) {
        return { ok: false, error: `Element ${targetVortexId} not found.` };
      }

      const stableNames = [
        "data-e2e",
        "data-testid",
        "data-test",
        "data-cy",
        "aria-label",
        "role",
        "name",
        "id",
        "placeholder",
        "title",
        "alt",
        "type",
      ];
      const escapeCss = (value: string) =>
        window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
      const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();
      const directText = Array.from(element.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => cleanText(child.textContent ?? ""))
        .filter(Boolean)
        .join(" ");
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const attributes: Record<string, string | boolean | number> = {};
      const locators: string[] = [];

      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();

        if (name === "class" || name === "style" || name === "data-vortex-id") {
          continue;
        }

        if (stableNames.includes(name) || name.startsWith("data-")) {
          attributes[name] = attribute.value === "" ? true : attribute.value;
          locators.push(`${element.tagName.toLowerCase()}[${name}="${escapeCss(attribute.value)}"]`);
          locators.push(`[${name}="${escapeCss(attribute.value)}"]`);
        }
      }

      if (element.id) {
        locators.unshift(`#${escapeCss(element.id)}`);
      }

      const path: string[] = [];
      let current: Element | null = element;

      while (current && current !== document.body) {
        const parent: Element | null = current.parentElement;
        const tag = current.tagName.toLowerCase();

        if (!parent) {
          break;
        }

        const sameTagSiblings = Array.from(parent.children).filter(
          (child: Element) => child.tagName === current?.tagName,
        );
        path.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
        current = parent;
      }

      if (path.length > 0) {
        locators.push(`body > ${path.join(" > ")}`);
      }

      return {
        ok: true,
        record: {
          key: cacheKey,
          vortexId: targetVortexId,
          tag: element.tagName.toLowerCase(),
          text: directText,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0,
          attributes,
          rect: {
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
            w: Math.round(rect.width * 100) / 100,
            h: Math.round(rect.height * 100) / 100,
          },
          url: window.location.href,
          title: document.title,
          note: cacheNote,
          locators: Array.from(new Set(locators)).slice(0, 20),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },
    args: [vortexId, key, params.note],
  });
  const payload = result[0]?.result;

  if (!payload?.ok || !payload.record) {
    throw new Error(payload?.error ?? "Unable to cache element.");
  }

  const cache = await readElementCache();
  const record: CachedElementRecord = { ...payload.record, tabId };
  cache[key] = record;
  await writeElementCache(cache);

  return record;
}

async function listCachedElements(params: Record<string, string>): Promise<CachedElementRecord[]> {
  const cache = await readElementCache();
  const urlContains = params.urlContains?.toLowerCase();

  return Object.values(cache)
    .filter((record) => !urlContains || record.url.toLowerCase().includes(urlContains))
    .map((record) => ({
      ...record,
      locators: record.locators.slice(0, 5),
    }));
}

async function getCachedElement(params: Record<string, string>): Promise<CachedElementRecord> {
  const key = requireParam(params, "key");
  const cache = await readElementCache();
  const record = cache[key];

  if (!record) {
    throw new Error(`Cached element not found: ${key}`);
  }

  return record;
}

async function removeCachedElement(params: Record<string, string>): Promise<unknown> {
  const key = requireParam(params, "key");
  const cache = await readElementCache();
  const existed = Boolean(cache[key]);
  delete cache[key];
  await writeElementCache(cache);

  return { ok: true, key, existed };
}

async function clearCachedElements(params: Record<string, string>): Promise<unknown> {
  if (params.urlContains) {
    const cache = await readElementCache();
    const urlContains = params.urlContains.toLowerCase();
    let removed = 0;

    for (const [key, record] of Object.entries(cache)) {
      if (record.url.toLowerCase().includes(urlContains)) {
        delete cache[key];
        removed++;
      }
    }

    await writeElementCache(cache);
    return { ok: true, removed };
  }

  await writeElementCache({});
  return { ok: true, removed: "all" };
}

async function resolveCachedElement(params: Record<string, string>): Promise<unknown> {
  const key = requireParam(params, "key");
  const record = await getCachedElement({ key });
  const tabId = await resolveTabId(params.tabId ?? (record.tabId ? String(record.tabId) : undefined));
  const resolved = await resolveCachedElementInTab(tabId, record);

  if (resolved.ok && typeof resolved.vortexId === "number") {
    const cache = await readElementCache();
    cache[key] = {
      ...record,
      vortexId: resolved.vortexId,
      tabId,
      updatedAt: new Date().toISOString(),
    };
    await writeElementCache(cache);
  }

  return resolved;
}

async function interactCachedElement(params: Record<string, string>): Promise<unknown> {
  const key = requireParam(params, "key");
  const record = await getCachedElement({ key });
  const tabId = await resolveTabId(params.tabId ?? (record.tabId ? String(record.tabId) : undefined));
  const resolved = await resolveCachedElementInTab(tabId, record);

  if (!resolved.ok || typeof resolved.vortexId !== "number") {
    return resolved;
  }

  return interactElement({ ...params, tabId: String(tabId), vortexId: String(resolved.vortexId) });
}

async function alterCachedElement(params: Record<string, string>): Promise<unknown> {
  const key = requireParam(params, "key");
  const record = await getCachedElement({ key });
  const tabId = await resolveTabId(params.tabId ?? (record.tabId ? String(record.tabId) : undefined));
  const resolved = await resolveCachedElementInTab(tabId, record);

  if (!resolved.ok || typeof resolved.vortexId !== "number") {
    return resolved;
  }

  return alterElementDom({ ...params, tabId: String(tabId), vortexId: String(resolved.vortexId) });
}

async function readElementCache(): Promise<ElementCache> {
  const stored = await chrome.storage.local.get(ELEMENT_CACHE_KEY);
  const cache = stored[ELEMENT_CACHE_KEY];

  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    return {};
  }

  return cache as ElementCache;
}

async function writeElementCache(cache: ElementCache): Promise<void> {
  await chrome.storage.local.set({ [ELEMENT_CACHE_KEY]: cache });
}

async function resolveCachedElementInTab(
  tabId: number,
  record: CachedElementRecord,
): Promise<{ ok: boolean; vortexId?: number; method?: string; error?: string }> {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (cachedRecord: CachedElementRecord) => {
      const hasUsableRect = (element: Element) => {
        const rect = element.getBoundingClientRect();

        return rect.width > 0 || rect.height > 0;
      };
      const assign = (element: Element, method: string) => {
        const existing = element.getAttribute("data-vortex-id");
        const vortexId = existing ? Number(existing) : Date.now();
        element.setAttribute("data-vortex-id", String(vortexId));

        return { ok: true, vortexId, method };
      };
      const currentByVortex = document.querySelector(
        `[data-vortex-id="${String(cachedRecord.vortexId)}"]`,
      );

      if (currentByVortex && hasUsableRect(currentByVortex)) {
        return assign(currentByVortex, "vortexId");
      }

      for (const locator of cachedRecord.locators) {
        try {
          const element = document.querySelector(locator);

          if (element && hasUsableRect(element)) {
            return assign(element, `locator:${locator}`);
          }
        } catch {
          continue;
        }
      }

      const candidates = Array.from(document.querySelectorAll(cachedRecord.tag));
      const stableNames = [
        "data-e2e",
        "data-testid",
        "data-test",
        "data-cy",
        "aria-label",
        "role",
        "name",
        "id",
        "placeholder",
        "title",
        "alt",
      ];
      const stableEntries = Object.entries(cachedRecord.attributes).filter(([name]) =>
        stableNames.includes(name),
      );
      const text = cachedRecord.text.toLowerCase();
      const scored = candidates
        .map((element) => {
          let score = 0;

          for (const [name, value] of stableEntries) {
            if (element.getAttribute(name) === String(value)) {
              score += 5;
            }
          }

          const elementText = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();

          if (text && elementText.includes(text)) {
            score += 2;
          }

          if (hasUsableRect(element)) {
            score += 1;
          }

          return { element, score };
        })
        .sort((a, b) => b.score - a.score);

      if (scored[0] && scored[0].score > 0) {
        return assign(scored[0].element, "fuzzy");
      }

      return { ok: false, error: `Unable to resolve cached element: ${cachedRecord.key}` };
    },
    args: [record],
  });

  return result[0]?.result ?? { ok: false, error: "Unable to resolve cached element." };
}
