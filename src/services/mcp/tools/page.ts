import type { ToolRegistry } from "../types";
import { optionalConflictAction, requireParam, resolveTabId } from "../utils";

export const pageTools: ToolRegistry = {
  wait_for_page_ready: waitForPageReady,
  wait_for_navigation_or_dom_change: waitForNavigationOrDomChange,
  capture_screenshot: captureScreenshot,
  download_screenshot: downloadScreenshot,
  copy_text_to_clipboard: copyTextToClipboard,
  read_clipboard: readClipboard,
  get_page_inventory: getPageInventory,
  get_links: getLinks,
  get_images: getImages,
  get_forms: getForms,
  get_meta_tags: getMetaTags,
  get_performance_entries: getPerformanceEntries,
  page_storage_get: pageStorageGet,
  page_storage_set: pageStorageSet,
  page_storage_remove: pageStorageRemove,
  page_storage_clear: pageStorageClear,
};

async function waitForPageReady(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const timeoutMs = Math.min(Math.max(Number(params.timeoutMs ?? "15000"), 500), 60000);
  const idleMs = Math.min(Math.max(Number(params.idleMs ?? "1000"), 250), 10000);
  const minElements = Math.min(Math.max(Number(params.minElements ?? "1"), 0), 100000);
  const minTextLength = Math.min(Math.max(Number(params.minTextLength ?? "0"), 0), 1000000);
  const urlIncludes = params.urlIncludes;
  const textIncludes = params.textIncludes?.toLowerCase();
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      maxWaitMs: number,
      stableMs: number,
      requiredElements: number,
      requiredTextLength: number,
      requiredUrlPart: string | undefined,
      requiredTextPart: string | undefined,
    ) =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        let stableSince = 0;
        let lastSignature = "";
        let intervalId = 0;

        const sample = () => {
          const bodyText = document.body?.innerText ?? "";
          const elementCount = document.body?.querySelectorAll("*").length ?? 0;
          const signature = [
            document.readyState,
            window.location.href,
            document.title,
            elementCount,
            bodyText.length,
            document.images.length,
            document.links.length,
          ].join("|");
          const hasRequiredUrl = !requiredUrlPart || window.location.href.includes(requiredUrlPart);
          const hasRequiredText = !requiredTextPart || bodyText.toLowerCase().includes(requiredTextPart);
          const meetsFloor =
            elementCount >= requiredElements &&
            bodyText.length >= requiredTextLength &&
            hasRequiredUrl &&
            hasRequiredText;

          if (signature === lastSignature && meetsFloor) {
            stableSince ||= Date.now();
          } else {
            stableSince = 0;
            lastSignature = signature;
          }

          const isReadyState = document.readyState === "interactive" || document.readyState === "complete";
          const isStable = stableSince > 0 && Date.now() - stableSince >= stableMs;

          if (isReadyState && isStable) {
            window.clearInterval(intervalId);
            resolve({
              ok: true,
              url: window.location.href,
              title: document.title,
              readyState: document.readyState,
              elementCount,
              textLength: bodyText.length,
              waitedMs: Date.now() - startedAt,
            });
            return;
          }

          if (Date.now() - startedAt >= maxWaitMs) {
            window.clearInterval(intervalId);
            resolve({
              ok: false,
              error: "Page readiness wait timed out.",
              url: window.location.href,
              title: document.title,
              readyState: document.readyState,
              elementCount,
              textLength: bodyText.length,
              waitedMs: Date.now() - startedAt,
            });
          }
        };

        intervalId = window.setInterval(sample, 250);
        sample();
      }),
    args: [timeoutMs, idleMs, minElements, minTextLength, urlIncludes, textIncludes],
  });

  return result[0]?.result;
}

async function waitForNavigationOrDomChange(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const timeoutMs = Math.min(Math.max(Number(params.timeoutMs ?? "15000"), 500), 60000);
  const idleMs = Math.min(Math.max(Number(params.idleMs ?? "750"), 250), 10000);
  const previousUrl = params.previousUrl;
  const previousSignature = params.previousSignature;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      maxWaitMs: number,
      stableMs: number,
      oldUrl: string | undefined,
      oldSignature: string | undefined,
    ) =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        const initialUrl = oldUrl || window.location.href;
        const makeSignature = () => {
          const bodyText = document.body?.innerText ?? "";
          return [
            window.location.href,
            document.title,
            document.body?.querySelectorAll("*").length ?? 0,
            bodyText.length,
          ].join("|");
        };
        const initialSignature = oldSignature || makeSignature();
        let changedAt = 0;
        let stableSince = 0;
        let lastSignature = "";
        let intervalId = 0;

        const sample = () => {
          const signature = makeSignature();
          const changed = window.location.href !== initialUrl || signature !== initialSignature;

          if (changed && !changedAt) {
            changedAt = Date.now();
          }

          if (changed && signature === lastSignature) {
            stableSince ||= Date.now();
          } else {
            stableSince = 0;
            lastSignature = signature;
          }

          if (changedAt && stableSince && Date.now() - stableSince >= stableMs) {
            window.clearInterval(intervalId);
            resolve({
              ok: true,
              changed: true,
              url: window.location.href,
              title: document.title,
              signature,
              waitedMs: Date.now() - startedAt,
            });
            return;
          }

          if (Date.now() - startedAt >= maxWaitMs) {
            window.clearInterval(intervalId);
            resolve({
              ok: false,
              changed: false,
              error: "Navigation or DOM change wait timed out.",
              url: window.location.href,
              title: document.title,
              signature,
              waitedMs: Date.now() - startedAt,
            });
          }
        };

        intervalId = window.setInterval(sample, 250);
        sample();
      }),
    args: [timeoutMs, idleMs, previousUrl, previousSignature],
  });

  return result[0]?.result;
}

async function captureScreenshot(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const tab = await chrome.tabs.get(tabId);
  const format = params.format === "jpeg" ? "jpeg" : "png";
  const quality = params.quality ? Math.min(Math.max(Number(params.quality), 0), 100) : undefined;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format, quality });

  return { ok: true, tabId, format, dataUrl };
}

async function downloadScreenshot(params: Record<string, string>): Promise<unknown> {
  const screenshot = (await captureScreenshot(params)) as { dataUrl: string; format: string };
  const filename = params.filename ?? `screenshot-${Date.now()}.${screenshot.format}`;
  const downloadId = await chrome.downloads.download({
    url: screenshot.dataUrl,
    filename,
    saveAs: params.saveAs === "true",
    conflictAction: optionalConflictAction(params.conflictAction),
  });

  return { ok: true, downloadId, filename };
}

async function copyTextToClipboard(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const text = requireParam(params, "text");
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (value: string) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return { ok: true, method: "navigator.clipboard" };
      }

      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();

      return { ok, method: "execCommand" };
    },
    args: [text],
  });

  return result[0]?.result;
}

async function readClipboard(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => ({
      text: navigator.clipboard?.readText ? await navigator.clipboard.readText() : "",
    }),
  });

  return result[0]?.result;
}

async function getPageInventory(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element: Element) => {
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
      const compact = (element: Element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
        ariaLabel: element.getAttribute("aria-label"),
        role: element.getAttribute("role"),
        id: element.id || undefined,
        name: element.getAttribute("name"),
        vortexId: element.getAttribute("data-vortex-id"),
      });
      const elements = Array.from(document.querySelectorAll("*"));

      return {
        url: window.location.href,
        title: document.title,
        counts: {
          elements: elements.length,
          links: document.links.length,
          images: document.images.length,
          forms: document.forms.length,
          inputs: document.querySelectorAll("input, textarea, select").length,
          buttons: document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")
            .length,
          headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        },
        headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(compact).slice(0, 50),
        controls: Array.from(
          document.querySelectorAll("button, input, textarea, select, [role='button'], [contenteditable='true']"),
        )
          .filter(visible)
          .map(compact)
          .slice(0, 100),
        landmarks: Array.from(document.querySelectorAll("main, nav, header, footer, aside, section, [role]"))
          .filter(visible)
          .map(compact)
          .slice(0, 100),
      };
    },
  });

  return result[0]?.result;
}

async function getLinks(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const limit = Math.min(Math.max(Number(params.limit ?? "200"), 1), 1000);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (maxItems: number) =>
      Array.from(document.links)
        .map((link) => ({
          text: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: link.href,
          target: link.target,
          rel: link.rel,
          vortexId: link.getAttribute("data-vortex-id"),
        }))
        .slice(0, maxItems),
    args: [limit],
  });

  return result[0]?.result;
}

async function getImages(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const limit = Math.min(Math.max(Number(params.limit ?? "200"), 1), 1000);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (maxItems: number) =>
      Array.from(document.images)
        .map((image) => ({
          src: image.currentSrc || image.src,
          alt: image.alt,
          title: image.title,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          vortexId: image.getAttribute("data-vortex-id"),
        }))
        .slice(0, maxItems),
    args: [limit],
  });

  return result[0]?.result;
}

async function getForms(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () =>
      Array.from(document.forms).map((form) => ({
        action: form.action,
        method: form.method,
        name: form.name,
        id: form.id,
        vortexId: form.getAttribute("data-vortex-id"),
        fields: Array.from(form.elements).map((field) => {
          const element = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

          return {
            tag: element.tagName.toLowerCase(),
            type: "type" in element ? element.type : undefined,
            name: element.getAttribute("name"),
            id: element.id || undefined,
            value: "value" in element ? element.value : undefined,
            placeholder: element.getAttribute("placeholder"),
            ariaLabel: element.getAttribute("aria-label"),
            vortexId: element.getAttribute("data-vortex-id"),
          };
        }),
      })),
  });

  return result[0]?.result;
}

async function getMetaTags(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title,
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
      meta: Array.from(document.querySelectorAll<HTMLMetaElement>("meta")).map((meta) => ({
        name: meta.name || undefined,
        property: meta.getAttribute("property") ?? undefined,
        httpEquiv: meta.httpEquiv || undefined,
        content: meta.content,
      })),
    }),
  });

  return result[0]?.result;
}

async function getPerformanceEntries(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const type = params.type;
  const limit = Math.min(Math.max(Number(params.limit ?? "200"), 1), 1000);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (entryType: string | undefined, maxItems: number) => {
      const entries = entryType ? performance.getEntriesByType(entryType) : performance.getEntries();

      return entries.slice(0, maxItems).map((entry) => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
      }));
    },
    args: [type, limit],
  });

  return result[0]?.result;
}

async function pageStorageGet(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const area = params.area === "session" ? "session" : "local";
  const key = params.key;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageArea: "local" | "session", storageKey: string | undefined) => {
      const storage = storageArea === "session" ? window.sessionStorage : window.localStorage;

      if (storageKey) {
        return { [storageKey]: storage.getItem(storageKey) };
      }

      return Object.fromEntries(
        Array.from({ length: storage.length }, (_, index) => {
          const currentKey = storage.key(index) ?? "";

          return [currentKey, storage.getItem(currentKey)];
        }),
      );
    },
    args: [area, key],
  });

  return result[0]?.result;
}

async function pageStorageSet(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const area = params.area === "session" ? "session" : "local";
  const key = requireParam(params, "key");
  const value = requireParam(params, "value");
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageArea: "local" | "session", storageKey: string, storageValue: string) => {
      const storage = storageArea === "session" ? window.sessionStorage : window.localStorage;
      storage.setItem(storageKey, storageValue);

      return { ok: true, area: storageArea, key: storageKey };
    },
    args: [area, key, value],
  });

  return result[0]?.result;
}

async function pageStorageRemove(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const area = params.area === "session" ? "session" : "local";
  const key = requireParam(params, "key");
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageArea: "local" | "session", storageKey: string) => {
      const storage = storageArea === "session" ? window.sessionStorage : window.localStorage;
      storage.removeItem(storageKey);

      return { ok: true, area: storageArea, key: storageKey };
    },
    args: [area, key],
  });

  return result[0]?.result;
}

async function pageStorageClear(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const area = params.area === "session" ? "session" : "local";
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageArea: "local" | "session") => {
      const storage = storageArea === "session" ? window.sessionStorage : window.localStorage;
      storage.clear();

      return { ok: true, area: storageArea };
    },
    args: [area],
  });

  return result[0]?.result;
}
