export type AiProvider = "openai" | "gemini" | "groq" | "ollama";

export interface ModelPreset {
  id: string;
  label: string;
  note?: string;
  recommended?: boolean;
}

export const openAiModels: ModelPreset[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", recommended: true },
  { id: "o1", label: "o1" },
  { id: "o3-mini", label: "o3 mini" },
  { id: "gpt-4", label: "GPT-4" },
  { id: "gpt-5-preview", label: "GPT-5 preview" },
];

export const geminiModels: ModelPreset[] = [
  {
    id: "gemma-4-26b-a4b-it",
    label: "Gemma 4 26B A4B",
    note: "15 RPM, TPM ilimitado, 1.500 RPD",
    recommended: true,
  },
  {
    id: "gemma-4-31b-it",
    label: "Gemma 4 31B",
    note: "15 RPM, TPM ilimitado, 1.500 RPD",
    recommended: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    note: "15 RPM, 250K TPM, 500 RPD",
    recommended: true,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    note: "5 RPM, 250K TPM, 20 RPD no nível gratuito",
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    note: "10 RPM, 250K TPM, 20 RPD",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    note: "5 RPM, 250K TPM, 20 RPD",
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    note: "5 RPM, 250K TPM, 20 RPD",
  },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
];

export const groqModels: ModelPreset[] = [
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B",
    note: "30 RPM, 30K TPM, 1K RPD, 500K TPD",
    recommended: true,
  },
  {
    id: "groq/compound-mini",
    label: "Groq Compound Mini",
    note: "30 RPM, 70K TPM, 250 RPD, tokens/dia sem limite",
    recommended: true,
  },
  {
    id: "groq/compound",
    label: "Groq Compound",
    note: "30 RPM, 70K TPM, 250 RPD, tokens/dia sem limite",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    note: "30 RPM, 6K TPM, 14.4K RPD, 500K TPD",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    note: "30 RPM, 12K TPM, 1K RPD, 100K TPD",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT OSS 120B",
    note: "30 RPM, 8K TPM, 1K RPD, 200K TPD",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT OSS 20B",
    note: "30 RPM, 8K TPM, 1K RPD, 200K TPD",
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B",
    note: "60 RPM, 6K TPM, 1K RPD, 500K TPD",
  },
];

export function getPresetIds(provider: AiProvider): string[] {
  if (provider === "openai") return openAiModels.map((model) => model.id);
  if (provider === "gemini") return geminiModels.map((model) => model.id);
  if (provider === "groq") return groqModels.map((model) => model.id);
  return [];
}

export function getDefaultModel(provider: AiProvider, ollamaModels: string[] = []): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "gemini") return "gemma-4-26b-a4b-it";
  if (provider === "groq") return "meta-llama/llama-4-scout-17b-16e-instruct";
  return ollamaModels[0] ?? "llama3";
}
