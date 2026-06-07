export interface ToolCall {
  name: string;
  params: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (params: Record<string, any>) => Promise<unknown>;
export type ToolRegistry = Record<string, ToolHandler>;

export interface PageResource {
  type: "script" | "stylesheet";
  url: string;
  status?: number;
  source?: string;
  truncated?: boolean;
  error?: string;
}

export interface ElementQueryResult {
  vortexId: number;
  tag: string;
  text: string;
  visible: boolean;
  attributes: Record<string, string | boolean | number>;
  rect: { x: number; y: number; w: number; h: number };
}

export interface CachedElementRecord extends ElementQueryResult {
  key: string;
  tabId?: number;
  url: string;
  title: string;
  note?: string;
  locators: string[];
  createdAt: string;
  updatedAt: string;
}

export type InteractionAction = "click" | "type" | "clear" | "hover";
export type ResourceDescriptor = { type: "script" | "stylesheet"; url: string };
export type StorageAreaName = "local" | "sync" | "session";
export type ElementCache = Record<string, CachedElementRecord>;

export const ELEMENT_CACHE_KEY = "__mcp_element_cache_v1";
