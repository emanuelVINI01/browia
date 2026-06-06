import type { Message } from "./storageService";

export class GeminiService {
  static async sendMessage(
    apiKey: string,
    model: string,
    systemPrompt: string,
    history: Message[]
  ): Promise<string> {
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

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Erro do Gemini: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMsg = errorJson.error.message;
        }
      } catch {
        // Fallback to raw text
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("Resposta vazia ou inválida recebida do Gemini API.");
    }

    return text;
  }
}
