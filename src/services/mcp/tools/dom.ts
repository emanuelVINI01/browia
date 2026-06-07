import type { ToolRegistry } from "../types";
import { domActionTools } from "./domActions";
import { domReadTools } from "./domRead";

export { alterElementDom, interactElement } from "./domActions";
export { getDomTree, resolveElement } from "./domRead";

export const domTools: ToolRegistry = {
  ...domReadTools,
  ...domActionTools,
};
