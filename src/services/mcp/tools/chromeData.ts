import type { ToolRegistry } from "../types";
import { optionalBoolean, optionalSameSite, requireParam } from "../utils";

export const chromeDataTools: ToolRegistry = {
  cookies_get: cookiesGet,
  cookies_get_all: cookiesGetAll,
  cookies_set: cookiesSet,
  cookies_remove: cookiesRemove,
  bookmarks_search: bookmarksSearch,
  bookmarks_create: bookmarksCreate,
  bookmarks_remove: bookmarksRemove,
  history_search: historySearch,
  history_delete_url: historyDeleteUrl,
  history_delete_range: historyDeleteRange,
};

async function cookiesGet(params: Record<string, string>): Promise<unknown> {
  return chrome.cookies.get({
    url: requireParam(params, "url"),
    name: requireParam(params, "name"),
    storeId: params.storeId,
  });
}

async function cookiesGetAll(params: Record<string, string>): Promise<unknown> {
  return chrome.cookies.getAll({
    url: params.url,
    name: params.name,
    domain: params.domain,
    path: params.path,
    secure: optionalBoolean(params.secure),
    session: optionalBoolean(params.session),
    storeId: params.storeId,
  });
}

async function cookiesSet(params: Record<string, string>): Promise<unknown> {
  return chrome.cookies.set({
    url: requireParam(params, "url"),
    name: requireParam(params, "name"),
    value: params.value ?? "",
    domain: params.domain,
    path: params.path,
    secure: optionalBoolean(params.secure),
    httpOnly: optionalBoolean(params.httpOnly),
    expirationDate: params.expirationDate ? Number(params.expirationDate) : undefined,
    storeId: params.storeId,
    sameSite: optionalSameSite(params.sameSite),
  });
}

async function cookiesRemove(params: Record<string, string>): Promise<unknown> {
  return chrome.cookies.remove({
    url: requireParam(params, "url"),
    name: requireParam(params, "name"),
    storeId: params.storeId,
  });
}

async function bookmarksSearch(params: Record<string, string>): Promise<unknown> {
  return chrome.bookmarks.search(params.query ?? "");
}

async function bookmarksCreate(params: Record<string, string>): Promise<unknown> {
  return chrome.bookmarks.create({
    parentId: params.parentId,
    index: params.index ? Number(params.index) : undefined,
    title: params.title,
    url: params.url,
  });
}

async function bookmarksRemove(params: Record<string, string>): Promise<unknown> {
  const id = requireParam(params, "id");

  if (params.recursive === "true") {
    await chrome.bookmarks.removeTree(id);
  } else {
    await chrome.bookmarks.remove(id);
  }

  return { ok: true, id };
}

async function historySearch(params: Record<string, string>): Promise<unknown> {
  const maxResults = Math.min(Math.max(Number(params.maxResults ?? "100"), 1), 1000);

  return chrome.history.search({
    text: params.text ?? "",
    startTime: params.startTime ? Number(params.startTime) : undefined,
    endTime: params.endTime ? Number(params.endTime) : undefined,
    maxResults,
  });
}

async function historyDeleteUrl(params: Record<string, string>): Promise<unknown> {
  const url = requireParam(params, "url");
  await chrome.history.deleteUrl({ url });

  return { ok: true, url };
}

async function historyDeleteRange(params: Record<string, string>): Promise<unknown> {
  const startTime = Number(requireParam(params, "startTime"));
  const endTime = Number(requireParam(params, "endTime"));
  await chrome.history.deleteRange({ startTime, endTime });

  return { ok: true, startTime, endTime };
}
