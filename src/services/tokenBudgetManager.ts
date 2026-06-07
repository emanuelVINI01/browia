export interface ProviderBudget {
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
  maxStepsPerTask: number;
  minDelayBetweenRequestsMs?: number;
}

export const PROVIDER_BUDGETS: Record<string, ProviderBudget> = {
  openai: {
    maxInputTokensPerCall: 25000,
    maxOutputTokensPerCall: 800,
    maxStepsPerTask: 10,
  },
  groq: {
    maxInputTokensPerCall: 8000,
    maxOutputTokensPerCall: 300,
    maxStepsPerTask: 8,
  },
  gemini: {
    maxInputTokensPerCall: 30000,
    maxOutputTokensPerCall: 500,
    maxStepsPerTask: 8,
    minDelayBetweenRequestsMs: 4000,
  },
  ollama: {
    maxInputTokensPerCall: 4000,
    maxOutputTokensPerCall: 200,
    maxStepsPerTask: 5,
  },
};

export class TokenBudgetManager {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalToolResultTokens = 0;
  private requestCount = 0;
  private provider: string;

  constructor(provider: string) {
    this.provider = provider.toLowerCase();
  }

  getBudget(): ProviderBudget {
    return PROVIDER_BUDGETS[this.provider] || PROVIDER_BUDGETS.openai;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  recordCall(inputPrompt: string, outputResponse: string, actualInputTokens?: number, actualOutputTokens?: number): { inputTokens: number; outputTokens: number } {
    const inputTokens = actualInputTokens !== undefined ? actualInputTokens : this.estimateTokens(inputPrompt);
    const outputTokens = actualOutputTokens !== undefined ? actualOutputTokens : this.estimateTokens(outputResponse);
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.requestCount++;
    return { inputTokens, outputTokens };
  }

  recordToolResult(outputResponse: string): { outputTokens: number } {
    const outputTokens = this.estimateTokens(outputResponse);
    this.totalToolResultTokens += outputTokens;
    return { outputTokens };
  }

  isBudgetExceeded(upcomingInputLength?: number): { exceeded: boolean; reason?: string } {
    void upcomingInputLength;
    return { exceeded: false };
  }

  getStats() {
    return {
      provider: this.provider,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalToolResultTokens: this.totalToolResultTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens + this.totalToolResultTokens,
      requestCount: this.requestCount,
      budget: this.getBudget(),
    };
  }
}
