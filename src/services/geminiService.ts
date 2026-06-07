import type { Message } from "./storageService";

interface GeminiRetryInfo {
  attempt: number;
  maxRetries: number;
  waitMs: number;
  retryAfterMs: number | null;
  retryDelayMs: number | null;
  source: "retry-after" | "retry-info" | "message" | "backoff";
}

interface GeminiSendOptions {
  maxRetries?: number;
  onRateLimitRetry?: (info: GeminiRetryInfo) => void;
}

export class GeminiService {
  static async sendMessage(
    apiKey: string,
    model: string,
    systemPrompt: string,
    history: Message[],
    options: GeminiSendOptions = {},
    signal?: AbortSignal,
  ): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    if (!apiKey) {
      throw new Error("Chave de API do Gemini não configurada.");
    }

    // Map history to Gemini API format
    // Roles in Gemini: "user" or "model"
    const contents = history.map((msg) => {
      const role = msg.role === "assistant" ? "model" : "user";
      return {
        role,
        parts: [{ text: msg.content }],
      };
    });

    // Clean up contents to ensure alternating roles ("user" -> "model" -> "user")
    // If consecutive roles are the same, we merge their texts
    const cleanContents: typeof contents = [];
    for (const content of contents) {
      const last = cleanContents[cleanContents.length - 1];
      if (last && last.role === content.role) {
        last.parts[0].text += "\n\n" + content.parts[0].text;
      } else {
        cleanContents.push(content);
      }
    }

    const payload = {
      contents: cleanContents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.2,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const maxRetries = options.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string") {
          throw new Error("Resposta vazia ou inválida recebida do Gemini API.");
        }
        const usage = data.usageMetadata;
        return {
          text,
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount,
        };
      }

      const errorText = await response.text();
      const errorJson = parseJsonObject(errorText);

      if (response.status === 429 && attempt < maxRetries) {
        const retryInfo = buildRetryInfo(response.headers, errorJson, errorText, attempt + 1, maxRetries);

        if (retryInfo.waitMs <= 120_000) {
          options.onRateLimitRetry?.(retryInfo);
          await sleep(retryInfo.waitMs, signal);
          continue;
        }
      }

      const retryInfo = response.status === 429
        ? buildRetryInfo(response.headers, errorJson, errorText, attempt + 1, maxRetries)
        : null;
      const errorMsg = getGeminiErrorMessage(errorJson, response, errorText);
      const suffix = retryInfo
        ? ` Retry calculado: ${formatDuration(retryInfo.waitMs)} via ${retryInfo.source}.`
        : "";
      throw new Error(`${errorMsg}${suffix}`);
    }

    throw new Error("Erro do Gemini: limite de retries atingido.");
  }
}

function buildRetryInfo(
  headers: Headers,
  errorJson: Record<string, unknown> | null,
  errorText: string,
  attempt: number,
  maxRetries: number,
): GeminiRetryInfo {
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
  const retryDelayMs = parseGeminiRetryDelay(errorJson) ?? parseRetryDelayFromMessage(errorText);
  const fallbackMs = Math.min(2 ** Math.max(0, attempt - 1) * 1000, 10_000);
  const waitMs = Math.max(retryAfterMs ?? 0, retryDelayMs ?? 0, fallbackMs) + 350;
  let source: GeminiRetryInfo["source"] = "backoff";

  if (retryAfterMs !== null && retryAfterMs >= (retryDelayMs ?? 0) && retryAfterMs >= fallbackMs) {
    source = "retry-after";
  } else if (parseGeminiRetryDelay(errorJson) !== null) {
    source = "retry-info";
  } else if (parseRetryDelayFromMessage(errorText) !== null) {
    source = "message";
  }

  return {
    attempt,
    maxRetries,
    waitMs,
    retryAfterMs,
    retryDelayMs,
    source,
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

function parseGeminiRetryDelay(errorJson: Record<string, unknown> | null): number | null {
  const details = errorJson?.error && typeof errorJson.error === "object"
    ? (errorJson.error as { details?: unknown }).details
    : null;

  if (!Array.isArray(details)) {
    return null;
  }

  for (const detail of details) {
    if (!detail || typeof detail !== "object") {
      continue;
    }

    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof retryDelay === "string") {
      return parseDuration(retryDelay);
    }
  }

  return null;
}

function parseRetryDelayFromMessage(errorText: string): number | null {
  const match = /retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i.exec(errorText);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 1000;
}

function parseDuration(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(normalized);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  if (!Number.isFinite(amount)) {
    return null;
  }

  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getGeminiErrorMessage(
  errorJson: Record<string, unknown> | null,
  response: Response,
  errorText: string,
): string {
  const error = errorJson?.error;

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return errorText.trim() || `Erro do Gemini: ${response.status} ${response.statusText}`;
}

function formatDuration(ms: number): string {
  return `${Math.ceil(ms / 1000)}s`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    }
    if (signal) signal.addEventListener("abort", onAbort);
  });
}
