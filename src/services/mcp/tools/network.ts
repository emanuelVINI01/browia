import type { PageResource, ResourceDescriptor, ToolRegistry } from "../types";
import {
  createDataUrl,
  decodeHtmlText,
  htmlToText,
  optionalConflictAction,
  parseJsonObject,
  requireParam,
  resolveDuckDuckGoUrl,
  resolveTabId,
} from "../utils";

export const networkTools: ToolRegistry = {
  get_page_resources: getPageResources,
  http_request: httpRequest,
  search_web: searchWeb,
  download_file: downloadFile,
};

async function getPageResources(params: Record<string, string>): Promise<PageResource[]> {
  const tabId = await resolveTabId(params.tabId);
  const maxBytes = Number(params.maxBytes ?? "1000000");
  const descriptorsResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const resources: ResourceDescriptor[] = [];

      for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
        if (script.src) {
          resources.push({ type: "script", url: script.src });
        }
      }

      for (const link of Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
      )) {
        if (link.href) {
          resources.push({ type: "stylesheet", url: link.href });
        }
      }

      return resources;
    },
  });
  const descriptors = descriptorsResult[0]?.result ?? [];

  return Promise.all(
    descriptors.map(async (descriptor): Promise<PageResource> => {
      try {
        const response = await fetch(descriptor.url);
        const source = await response.text();
        const truncated = Number.isFinite(maxBytes) && maxBytes > 0 && source.length > maxBytes;

        return {
          ...descriptor,
          status: response.status,
          source: truncated ? source.slice(0, maxBytes) : source,
          truncated,
        };
      } catch (error) {
        return {
          ...descriptor,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

async function httpRequest(params: Record<string, string>): Promise<unknown> {
  const url = requireParam(params, "url");
  const method = params.method ?? "GET";
  const headers = parseJsonObject(params.headers, "headers") as Record<string, string>;
  const body = params.body;
  const responseType = params.responseType ?? "text";
  const response = await fetch(url, {
    method,
    headers,
    body: method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? undefined : body,
  });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (responseType === "json") {
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: await response.json(),
    };
  }

  if (responseType === "arrayBuffer") {
    const buffer = await response.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const binary = bytes.map((byte) => String.fromCharCode(byte)).join("");

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: btoa(binary),
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: await response.text(),
  };
}

async function searchWeb(params: Record<string, string>): Promise<unknown> {
  const query = requireParam(params, "query");
  const limit = Math.min(Math.max(Number(params.limit ?? "5"), 1), 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await response.text();
  const results: Array<{ title: string; url: string }> = [];
  const resultRegex =
    /<a\b[^>]*class=(["'])[^"']*\bresult__a\b[^"']*\1[^>]*href=(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const rawUrl = decodeHtmlText(match[3]);
    const resolvedUrl = resolveDuckDuckGoUrl(rawUrl);
    const title = htmlToText(match[4]);

    if (resolvedUrl && title) {
      results.push({ title, url: resolvedUrl });
    }
  }

  return { query, engine: "duckduckgo-html", results };
}

async function downloadFile(params: Record<string, string>): Promise<unknown> {
  const url =
    params.url ??
    createDataUrl(
      requireParam(params, "content"),
      params.mimeType ?? "application/octet-stream",
      params.encoding ?? "text",
    );
  const downloadId = await chrome.downloads.download({
    url,
    filename: params.filename,
    saveAs: params.saveAs === "true",
    conflictAction: optionalConflictAction(params.conflictAction),
  });

  return { ok: true, downloadId };
}
