import type { ToolRegistry } from "../types";
import { parseJsonArray, parseJsonObject, requireParam, resolveStorageArea } from "../utils";

export const extensionStorageTools: ToolRegistry = {
  storage_get: storageGet,
  storage_set: storageSet,
  storage_remove: storageRemove,
  storage_clear: storageClear,
};

async function storageGet(params: Record<string, string>): Promise<unknown> {
  const area = resolveStorageArea(params.area);
  const keys = params.keys ? parseJsonArray(params.keys, "keys") : undefined;

  return area.get(keys);
}

async function storageSet(params: Record<string, string>): Promise<unknown> {
  const area = resolveStorageArea(params.area);
  const values = parseJsonObject(requireParam(params, "values"), "values");
  await area.set(values);

  return { ok: true, keys: Object.keys(values) };
}

async function storageRemove(params: Record<string, string>): Promise<unknown> {
  const area = resolveStorageArea(params.area);
  const keys = parseJsonArray(requireParam(params, "keys"), "keys");
  await area.remove(keys);

  return { ok: true, keys };
}

async function storageClear(params: Record<string, string>): Promise<unknown> {
  const area = resolveStorageArea(params.area);
  await area.clear();

  return { ok: true, area: params.area ?? "local" };
}
