export interface ElementLocator {
  type: "css" | "aria" | "ariaContains" | "role" | "id";
  value?: string;
  role?: string;
  nameIncludes?: string;
}

export interface RecipeActionStep {
  tool: string;
  action?: string;
  target?: string;
  key?: string;
  value?: string;
}

export interface RecipeAction {
  steps: RecipeActionStep[];
}

export interface SiteRecipe {
  domain: string;
  aliases?: string[];
  description: string;
  elements: Record<string, ElementLocator[]>;
  actions?: Record<string, RecipeAction>;
}

export const SITE_RECIPES: Record<string, SiteRecipe> = {
  "chatgpt.com": {
    domain: "chatgpt.com",
    description: "ChatGPT web app",
    elements: {
      composer: [
        { type: "css", value: "#prompt-textarea" },
        { type: "aria", value: "Converse com o ChatGPT" },
        { type: "role", role: "textbox", nameIncludes: "ChatGPT" },
        { type: "css", value: "[contenteditable='true']" }
      ],
      sendButton: [
        { type: "css", value: "[data-testid='send-button']" },
        { type: "aria", value: "Enviar mensagem" },
        { type: "aria", value: "Send message" }
      ]
    },
    actions: {
      sendMessage: {
        steps: [
          { tool: "resolve_element", target: "composer" },
          { tool: "interact_element", action: "type" },
          { tool: "press_key", key: "Enter" }
        ]
      }
    }
  },
  "google.com": {
    domain: "google.com",
    description: "Google Search",
    elements: {
      searchBox: [
        { type: "css", value: "textarea[name='q']" },
        { type: "css", value: "input[name='q']" },
        { type: "ariaContains", value: "Pesquisar" },
        { type: "ariaContains", value: "Search" }
      ],
      searchButton: [
        { type: "css", value: "input[name='btnK']" },
        { type: "ariaContains", value: "Pesquisa Google" },
        { type: "ariaContains", value: "Google Search" }
      ]
    }
  },
  "youtube.com": {
    domain: "youtube.com",
    description: "YouTube",
    elements: {
      searchBox: [
        { type: "css", value: "input#search" },
        { type: "ariaContains", value: "Pesquisar" },
        { type: "ariaContains", value: "Search" }
      ],
      searchButton: [
        { type: "css", value: "button#search-icon-legacy" },
        { type: "ariaContains", value: "Pesquisar" },
        { type: "ariaContains", value: "Search" }
      ]
    }
  }
};
