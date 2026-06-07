import type { ToolRegistry } from "../types";
import { requireParam } from "../utils";

export const agentStatusTools: ToolRegistry = {
  think: statusTool("think"),
  advise: statusTool("advise"),
};

function statusTool(kind: "think" | "advise") {
  return async (params: Record<string, string>): Promise<unknown> => {
    const message = requireParam(params, "message").trim();

    return {
      ok: true,
      kind,
      message,
    };
  };
}
