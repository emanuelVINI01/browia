import type { Message } from "./storageService";

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaService {
  static cleanEndpoint(endpoint: string): string {
    let url = endpoint.trim();
    if (!url) {
      url = "http://localhost:11434";
    }
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    return url;
  }

  static async listModels(endpoint: string): Promise<string[]> {
    const baseUrl = this.cleanEndpoint(endpoint);
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Servidor Ollama retornou status ${response.status}`);
      }
      const data = (await response.json()) as { models: OllamaModel[] };
      return data.models.map((m) => m.name);
    } catch (err) {
      console.error("Erro ao listar modelos Ollama:", err);
      // Return some default common models as fallback
      return ["llama3", "mistral", "gemma2", "qwen2.5", "codellama", "phi3"];
    }
  }

  static async sendMessage(
    endpoint: string,
    model: string,
    systemPrompt: string,
    history: Message[]
  ): Promise<string> {
    const baseUrl = this.cleanEndpoint(endpoint);
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === "tool" ? "user" : msg.role,
        content: msg.content,
      })),
    ];

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Erro do Ollama: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data = await response.json();
    return data.message?.content || "";
  }
}
