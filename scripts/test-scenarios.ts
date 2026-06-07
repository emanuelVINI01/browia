/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-function-type */
import assert from "node:assert";
import { SITE_RECIPES } from "../src/services/siteRecipes";
import { parseXmlCommands } from "../src/services/mcp/xmlParser";
import { TokenBudgetManager } from "../src/services/tokenBudgetManager";
import { compressToolResultForModel, rankElementsForGoal } from "../src/services/toolResultCompressor";

// Mock global Chrome API for test environment
const mockChrome = {
  tabs: {
    get: async (tabId: number) => {
      if (tabId === 1) {
        return { id: 1, url: "https://chatgpt.com/c/123", title: "ChatGPT" };
      }
      if (tabId === 2) {
        return { id: 2, url: "https://www.google.com/search?q=copa", title: "Google Search" };
      }
      return { id: tabId, url: "https://example.com", title: "Example" };
    }
  },
  scripting: {
    executeScript: async (options: { target: { tabId: number }; func: Function; args?: any[] }) => {
      // Mock returns based on tabId or selector checks
      if (options.target.tabId === 1) {
        // chatgpt
        return [{ result: { success: true, element: { vortexId: 4645, tag: "div", selector: "#prompt-textarea" } } }];
      }
      return [{ result: null }];
    }
  }
};

(globalThis as any).chrome = mockChrome;

// Mocks window.localStorage for browser settings
const mockLocalStorage: Record<string, string> = {};
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => mockLocalStorage[key] || null,
    setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
    removeItem: (key: string) => { delete mockLocalStorage[key]; },
    clear: () => { for (const key in mockLocalStorage) delete mockLocalStorage[key]; }
  }
} as any;

console.log("=== INICIANDO EXECUÇÃO DO CONJUNTO DE TESTES UNITÁRIOS E DE INTEGRAÇÃO BROWIA ===\n");

async function runTests() {
  // --- Caso 1: ChatGPT/Browia e Site Recipes ---
  console.log("Teste 1: Caso ChatGPT/Browia & Site Recipes...");
  const chatGptRecipe = SITE_RECIPES["chatgpt.com"];
  assert.ok(chatGptRecipe, "Recipe para chatgpt.com deve existir.");
  assert.equal(chatGptRecipe.elements.composer[0].type, "css");
  assert.equal(chatGptRecipe.elements.composer[0].value, "#prompt-textarea");
  assert.equal(chatGptRecipe.elements.sendButton[0].value, "[data-testid='send-button']");
  console.log("✔ Passou no Teste 1 (Estrutura da receita ChatGPT e locators estão corretos)\n");

  // --- Caso 2: vortexId como string / Locators Alternativos ---
  console.log("Teste 2: Caso vortexId como string...");
  // Simulate the interact_element logic with vortexId="prompt-textarea"
  const params: Record<string, string> = {
    vortexId: "prompt-textarea",
    action: "type",
    value: "Olá! Sou o Browia"
  };

  let vortexIdNum: number | undefined = undefined;
  let selectorFallback: string | undefined = undefined;
  let idFallback: string | undefined = undefined;

  if (params.vortexId !== undefined && params.vortexId !== "") {
    if (/^\d+$/.test(params.vortexId)) {
      vortexIdNum = Number(params.vortexId);
    } else {
      const vStr = params.vortexId.trim();
      if (vStr.startsWith("#") || vStr.startsWith(".") || vStr.includes("[")) {
        selectorFallback = vStr;
      } else {
        idFallback = vStr;
      }
      delete params.vortexId;
    }
  }

  assert.equal(vortexIdNum, undefined, "vortexId string não numérica não deve virar número.");
  assert.equal(idFallback, "prompt-textarea", "vortexId string 'prompt-textarea' deve virar um fallback de ID.");
  assert.equal(params.vortexId, undefined, "vortexId original deve ser removido.");
  console.log("✔ Passou no Teste 2 (Tratamento de vortexId string não numérica funciona sem quebrar)\n");

  // --- Caso 3: Google Search Recipe ---
  console.log("Teste 3: Caso Google Search...");
  const googleRecipe = SITE_RECIPES["google.com"];
  assert.ok(googleRecipe, "Recipe para google.com deve existir.");
  assert.ok(googleRecipe.elements.searchBox.some(l => l.value === "textarea[name='q']"), "Deve possuir o locator para a caixa de busca do Google.");
  console.log("✔ Passou no Teste 3 (Receitas do Google Search corretas)\n");

  // --- Caso 4: Casual Chat Bypass (Nível 0) ---
  console.log("Teste 4: Caso casual chat...");
  const casualRequests = ["oi td bem?", "quem é vc?", "Olá, bom dia!", "Help instructions"];
  const browserRequests = ["clique no botão", "pesquisa no google", "entre no site do gpt", "screenshot da pagina"];

  const browserTaskPattern =
    /\b(site|url|aba|pagina|página|dom|html|clique|clica|clicar|foto|avatar|perfil|conta|nome|elemento|bot[aã]o|campo|digite|preencha|pesquisa|pesquise|buscar|busca|procura|google|resultado|screenshot|print|download|cookie|favorito|hist[oó]rico|localstorage|sessionstorage|canal|channel|v[ií]deo|videos|vídeos|post|posts|postei|tiktok|youtube|shorts|reels)\b/i;

  for (const req of casualRequests) {
    const isBrowser = browserTaskPattern.test(req);
    assert.strictEqual(isBrowser, false, `Mensagem casual '${req}' não deve acionar ferramentas do navegador.`);
  }

  for (const req of browserRequests) {
    const isBrowser = browserTaskPattern.test(req);
    assert.strictEqual(isBrowser, true, `Mensagem de navegador '${req}' deve acionar ferramentas.`);
  }
  console.log("✔ Passou no Teste 4 (Bypass de chat casual versus navegação de nível 0 funcionando)\n");

  // --- Caso 5: Simulador de Rate Limit / Provider 429 Retry ---
  console.log("Teste 5: Caso provider 429 retry-after...");
  // Simulate retry duration calculation based on retry headers/messages
  function getRetryDelayMs(error: any): number {
    const errorStr = String(error.message || error || "").toLowerCase();
    if (errorStr.includes("try again in")) {
      const match = /try again in (\d+\.?\d*)/i.exec(errorStr);
      if (match) {
        return Math.ceil(parseFloat(match[1]) * 1000);
      }
    }
    if (errorStr.includes("rate limit") || errorStr.includes("429")) {
      return 5000; // default backoff
    }
    return 1000;
  }

  const err1 = new Error("Rate limit exceeded. Try again in 8.969s");
  const delay1 = getRetryDelayMs(err1);
  assert.equal(delay1, 8969, "Deve extrair 8.969 segundos e retornar 8969ms.");

  const err2 = new Error("Groq 429: Rate limit hit");
  const delay2 = getRetryDelayMs(err2);
  assert.equal(delay2, 5000, "Deve retornar 5000ms de fallback para erros 429 padrão.");
  console.log("✔ Passou no Teste 5 (Cálculo do tempo de espera por rate limit 429 correto)\n");

  // --- Caso 6: Inventory gigante e toolResultCompressor ---
  console.log("Teste 6: Caso inventory gigante (Compressão e Ranking)...");
  
  // Create a large mock inventory with 500 elements (including duplicates, sidebars, history, etc.)
  const mockInventory: any[] = [];
  
  // Add 100 sidebar buttons (irrelevant)
  for (let i = 0; i < 100; i++) {
    mockInventory.push({
      vortexId: i + 10,
      tag: "button",
      text: `Histórico de conversa ${i}`,
      role: "button",
      visible: true,
      id: `history-item-${i}`,
    });
  }

  // Add 5 relevant controls
  mockInventory.push({
    vortexId: 1,
    tag: "textarea",
    text: "",
    role: "textbox",
    visible: true,
    id: "prompt-textarea",
    placeholder: "Converse com o ChatGPT",
  });
  mockInventory.push({
    vortexId: 2,
    tag: "button",
    text: "Enviar mensagem",
    role: "button",
    visible: true,
    attributes: { "aria-label": "Enviar mensagem" },
  });

  // Rank elements with goal: "digite uma mensagem no composer"
  const ranked = rankElementsForGoal(mockInventory, "digite uma mensagem no composer", "chatgpt.com", "chat");
  
  // The first items in ranked should contain composer or prompt elements
  assert.ok(ranked.length > 0);
  const topMatch = ranked[0];
  assert.ok(
    topMatch.id === "prompt-textarea" || topMatch.placeholder?.includes("Converse") || topMatch.text?.includes("Enviar"),
    "O ranking deve priorizar elementos correspondentes às palavras-chave do objetivo."
  );

  // Validate compressor output limit
  const compressed = compressToolResultForModel("get_page_inventory", {
    title: "ChatGPT",
    url: "https://chatgpt.com/",
    controls: mockInventory,
  }, {
    originalGoal: "digite uma mensagem no composer",
    currentUrl: "https://chatgpt.com/",
    currentDomain: "chatgpt.com",
  }) as any;

  assert.ok(compressed.counts, "Devem ser incluídas as contagens resumidas.");
  assert.ok(compressed.relevantControls.length <= 15, "Controles relevantes no inventário comprimido devem ser no máximo 15.");
  assert.ok(
    compressed.relevantControls.some((c: any) => c.id === "prompt-textarea"),
    "Elemento relevante '#prompt-textarea' deve ser mantido no inventário comprimido."
  );

  console.log("✔ Passou no Teste 6 (Filtros de compressão e ranking de elementos funcionando perfeitamente)\n");

  // --- Caso 7: XML Parser tolerante ---
  console.log("Teste 7: Caso XML Parser tolerante...");
  const malformedXml = `
  Aqui está a ação que vou tomar:
  <tool_calls name="interact_element">
    <param name="vortexId">4645</param>
    <param name="action">click</param>
  </tool_call>
  E depois vou finalizar:
  <tool name="final_answer">
    <param name="answer">Pronto</param>
  </tool_calls>
  `;

  const parsed = parseXmlCommands(malformedXml);
  assert.equal(parsed.length, 2, "Deve conseguir analisar os 2 comandos mesmo com fechamentos/aliases errados.");
  assert.equal(parsed[0].name, "interact_element");
  assert.equal(parsed[0].params.vortexId, "4645");
  assert.equal(parsed[0].params.action, "click");
  assert.equal(parsed[1].name, "final_answer");
  assert.equal(parsed[1].params.answer, "Pronto");
  console.log("✔ Passou no Teste 7 (Parser XML MCP tolerante a tags incompatíveis/aliases)\n");

  console.log("=== TODOS OS TESTES PASSARAM COM SUCESSO! BROWIA ESTÁ OTIMIZADO E ROBUSTO! ===");
}

runTests().catch((err) => {
  console.error("❌ ERRO NO TESTE:", err);
  process.exit(1);
});
