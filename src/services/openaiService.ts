import type { Message } from "./storageService";

export class OpenaiService {
  static async sendMessage(
    apiKey: string,
    model: string,
    systemPrompt: string,
    history: Message[]
  ): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    if (!apiKey) {
      throw new Error("Chave de API do OpenAI não configurada.");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === "tool" ? "user" : msg.role,
        content: msg.content,
      })),
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `Erro do OpenAI: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const usage = data.usage;
    return {
      text: data.choices[0]?.message?.content || "",
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    };
  }
}
