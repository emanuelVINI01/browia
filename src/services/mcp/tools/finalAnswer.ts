import type { ToolRegistry } from "../types";
import { requireParam } from "../utils";

export const finalAnswerTools: ToolRegistry = {
  final_answer: finalAnswer,
};

async function finalAnswer(params: Record<string, string>): Promise<unknown> {
  const answer = requireParam(params, "answer").trim();

  return {
    ok: true,
    answer,
  };
}
