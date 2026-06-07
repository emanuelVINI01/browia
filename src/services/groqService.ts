import type { Message } from "./storageService";

type GroqChatRole = "system" | "user" | "assistant";

interface GroqRetryInfo {
  attempt: number;
  maxRetries: number;
  waitMs: number;
  retryAfterMs: number | null;
  resetTokensMs: number | null;
  remainingTokens: string | null;
  limitTokens: string | null;
}

interface GroqSendOptions {
  maxRetries?: number;
  onRateLimitRetry?: (info: GroqRetryInfo) => void;
}

export class GroqService {
  static async sendMessage(
    apiKey: string,
    model: string,
    systemPrompt: string,
    history: Message[],
    options: GroqSendOptions = {},
    signal?: AbortSignal,
  ): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    if (!apiKey) {
      throw new Error("Chave de API do Groq não configurada.");
    }

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.map((message) => ({
        role: normalizeRole(message.role),
        content: message.content,
      })),
    ];

    const maxRetries = options.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
        }),
        signal,
      });

      if (response.ok) {
        const data = await response.json();
        const usage = data.usage;
        return {
          text: data.choices?.[0]?.message?.content || "",
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
        };
      }

      if (response.status === 429 && attempt < maxRetries) {
        const retryInfo = buildRetryInfo(response.headers, attempt + 1, maxRetries);

        if (retryInfo.waitMs <= 120_000) {
          options.onRateLimitRetry?.(retryInfo);
          await sleep(retryInfo.waitMs, signal);
          continue;
        }
      }

      const errorData = await response.json().catch(() => ({}));
      const retryInfo = response.status === 429 ? buildRetryInfo(response.headers, attempt + 1, maxRetries) : null;
      const message = errorData?.error?.message || `Erro do Groq: ${response.status} ${response.statusText}`;
      const suffix = retryInfo
        ? ` Headers: remaining_tokens=${retryInfo.remainingTokens ?? "n/a"}, reset_tokens=${formatDuration(retryInfo.resetTokensMs)}, retry_after=${formatDuration(retryInfo.retryAfterMs)}.`
        : "";
      throw new Error(`${message}${suffix}`);
    }

    throw new Error("Erro do Groq: limite de retries atingido.");
  }
}

function normalizeRole(role: Message["role"]): GroqChatRole {
  if (role === "assistant" || role === "system") {
    return role;
  }

  return "user";
}

function buildRetryInfo(headers: Headers, attempt: number, maxRetries: number): GroqRetryInfo {
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
  const resetTokensMs = parseGroqDuration(headers.get("x-ratelimit-reset-tokens"));
  const fallbackMs = Math.min(2 ** Math.max(0, attempt - 1) * 1000, 10_000);
  const waitMs = Math.max(retryAfterMs ?? 0, resetTokensMs ?? 0, fallbackMs) + 350;

  return {
    attempt,
    maxRetries,
    waitMs,
    retryAfterMs,
    resetTokensMs,
    remainingTokens: headers.get("x-ratelimit-remaining-tokens"),
    limitTokens: headers.get("x-ratelimit-limit-tokens"),
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function parseGroqDuration(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  let totalMs = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === "ms") totalMs += amount;
    if (unit === "s") totalMs += amount * 1000;
    if (unit === "m") totalMs += amount * 60_000;
    if (unit === "h") totalMs += amount * 3_600_000;
  }

  if (matched) {
    return Math.max(0, totalMs);
  }

  const seconds = Number(normalized);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return "n/a";
  }

  return `${Math.ceil(ms / 1000)}s`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    }
    if (signal) signal.addEventListener("abort", onAbort);
  });
}
