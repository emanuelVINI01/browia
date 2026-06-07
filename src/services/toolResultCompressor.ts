import type { DomSemanticNode, DomSemanticTree } from "./domSerializer";

export interface CompressionContext {
  originalGoal: string;
  intent?: string;
  currentUrl?: string;
  currentDomain?: string;
  lastTool?: string;
  maxTokensBudget?: number;
}

export interface ScrapableElement {
  tag: string;
  text?: string;
  ariaLabel?: string | null;
  role?: string | null;
  id?: string;
  name?: string | null;
  placeholder?: string | null;
  vortexId?: string | number | null;
  attributes?: Record<string, string | boolean | number>;
  visible?: boolean;
}

export interface CompactElement {
  vortexId: number;
  tag: string;
  id?: string;
  text?: string;
  ariaLabel?: string;
  role?: string;
  placeholder?: string;
  attributes?: Record<string, string | boolean | number>;
}

export function deriveKeywords(goal: string, domain?: string, intent?: string): string[] {
  const cleanGoal = goal.toLowerCase();
  const words = cleanGoal.split(/\W+/).filter(w => w.length > 2);
  const keywords = new Set<string>(words);
  
  if (intent) {
    const cleanIntent = intent.toLowerCase();
    const intentWords = cleanIntent.split(/\W+/).filter(w => w.length > 2);
    intentWords.forEach(w => keywords.add(w));
  }
  
  // Portuguese and English synonym mappings for common web intents
  const synonymMap: Record<string, string[]> = {
    chat: ["gpt", "mensagem", "message", "prompt", "textarea", "composer", "input", "enviar", "send", "converse", "escrever", "msg"],
    gpt: ["chat", "mensagem", "message", "prompt", "textarea", "composer", "input", "enviar", "send", "converse", "escrever"],
    pesquisa: ["search", "pesquisar", "busca", "buscar", "q", "input", "textbox", "query", "google", "find"],
    search: ["pesquisar", "pesquisa", "busca", "buscar", "q", "input", "textbox", "query", "google", "find"],
    busca: ["pesquisar", "pesquisa", "search", "buscar", "q", "input", "textbox", "query", "google", "find"],
    login: ["entrar", "signin", "sign-in", "username", "password", "senha", "email", "conta", "account"],
    perfil: ["profile", "conta", "account", "avatar", "foto", "user", "usuario", "usuário", "me"],
    profile: ["perfil", "conta", "account", "avatar", "foto", "user", "usuario", "usuário", "me"],
    comprar: ["buy", "carrinho", "cart", "adicionar", "add", "checkout", "checkout-button", "pagar", "pay", "compra"],
    enviar: ["send", "submit", "confirmar", "comprar", "publicar", "salvar", "enter", "click", "btn", "button", "botao", "botão"],
    send: ["enviar", "submit", "confirmar", "comprar", "publicar", "salvar", "enter", "click", "btn", "button", "botao", "botão"],
  };

  for (const word of words) {
    if (synonymMap[word]) {
      synonymMap[word].forEach(syn => keywords.add(syn));
    }
  }

  // Domain-specific boosts
  if (domain) {
    const dom = domain.toLowerCase();
    if (dom.includes("chatgpt.com") || dom.includes("claude.ai") || dom.includes("copilot")) {
      ["prompt", "textarea", "composer", "message", "send", "chat", "submit", "converse", "textbox"].forEach(w => keywords.add(w));
    } else if (dom.includes("google.com") || dom.includes("bing.com") || dom.includes("yahoo.com")) {
      ["search", "q", "input", "query", "pesquisar", "busca", "textarea"].forEach(w => keywords.add(w));
    } else if (dom.includes("youtube.com")) {
      ["search", "input", "query", "pesquisar", "buscar", "video", "play", "button"].forEach(w => keywords.add(w));
    }
  }

  return Array.from(keywords);
}

export function rankElementsForGoal(
  elements: ScrapableElement[],
  goal: string,
  domain?: string,
  intent?: string
): ScrapableElement[] {
  const keywords = deriveKeywords(goal, domain, intent);
  
  const scoredElements = elements.map(el => {
    let score = 0;
    
    const tag = el.tag.toLowerCase();
    const role = (el.role || "").toLowerCase();
    const type = (el.attributes?.type || "").toString().toLowerCase();
    const id = (el.id || "").toLowerCase();
    const name = (el.name || "").toLowerCase();
    const aria = (el.ariaLabel || "").toLowerCase();
    const text = (el.text || "").toLowerCase();
    const placeholder = (el.placeholder || "").toLowerCase();

    // 1. Tag & Role relevance boost
    if (tag === "input" || tag === "textarea" || el.attributes?.contenteditable === true || el.attributes?.contenteditable === "true") {
      score += 20;
    }
    if (tag === "button" || role === "button" || type === "submit" || type === "button") {
      score += 15;
    }
    if (tag === "a" || role === "link") {
      score += 5;
    }
    
    // 2. Keyword relevance
    for (const keyword of keywords) {
      if (id.includes(keyword)) score += 12;
      if (name.includes(keyword)) score += 10;
      if (aria.includes(keyword)) score += 10;
      if (placeholder.includes(keyword)) score += 10;
      if (text.includes(keyword)) score += 6;
    }
    
    // 3. Specific common identifiers/names
    if (id === "prompt-textarea" || id === "composer" || id === "message-input" || id === "search" || id === "q") {
      score += 20;
    }
    
    // 4. Visibility boost
    if (el.visible !== false) {
      score += 8;
    }
    
    return { element: el, score };
  });
  
  scoredElements.sort((a, b) => b.score - a.score);
  return scoredElements.map(se => se.element);
}

export function compressToolResultForModel(
  toolName: string,
  result: unknown,
  context: CompressionContext
): unknown {
  if (!result) return result;

  try {
    if (toolName === "get_page_inventory") {
      const inventory = result as {
        url: string;
        title: string;
        counts: Record<string, number>;
        headings: ScrapableElement[];
        controls: ScrapableElement[];
        landmarks: ScrapableElement[];
      };

      // Filter sidebar/history/redundant sections by default from controls & headings
      const filteredControls = (inventory.controls || []).filter(c => {
        const text = (c.text || "").toLowerCase();
        const id = (c.id || "").toLowerCase();
        const aria = (c.ariaLabel || "").toLowerCase();
        // Remove typical sidebar elements
        const isSidebar = text.includes("histórico") || text.includes("conversas antigas") || id.includes("sidebar") || aria.includes("history");
        return !isSidebar;
      });

      const ranked = rankElementsForGoal(filteredControls, context.originalGoal, context.currentDomain, context.intent);
      
      // Keep top 12 relevant controls
      const topControls = ranked.slice(0, 12).map(c => {
        const clean: CompactElement = {
          vortexId: typeof c.vortexId === "string" ? parseInt(c.vortexId, 10) : (c.vortexId ?? 0),
          tag: c.tag,
        };
        if (c.id) clean.id = c.id;
        if (c.text) clean.text = c.text.substring(0, 120);
        if (c.ariaLabel) clean.ariaLabel = c.ariaLabel;
        if (c.role) clean.role = c.role;
        if (c.placeholder) clean.placeholder = c.placeholder;
        
        // Include minimal important attributes
        const importantAttrs: Record<string, string | boolean | number> = {};
        if (c.attributes) {
          for (const key of ["type", "name", "value", "contenteditable"]) {
            if (c.attributes[key] !== undefined) {
              importantAttrs[key] = c.attributes[key];
            }
          }
        }
        if (Object.keys(importantAttrs).length > 0) {
          clean.attributes = importantAttrs;
        }

        return clean;
      });

      // Filter headings as well
      const relevantHeadings = (inventory.headings || [])
        .map(h => h.text || "")
        .filter(Boolean)
        .slice(0, 10);

      return {
        title: inventory.title,
        url: inventory.url,
        counts: {
          buttons: inventory.counts?.buttons ?? 0,
          inputs: inventory.counts?.inputs ?? 0,
          forms: inventory.counts?.forms ?? 0,
          links: inventory.counts?.links ?? 0,
        },
        relevantControls: topControls,
        relevantHeadings,
      };
    }

    if (toolName === "get_dom_tree") {
      const tree = result as DomSemanticTree;
      const flatList: ScrapableElement[] = [];

      function traverse(node: DomSemanticNode) {
        if (!node) return;
        const attributes = node.attributes || {};
        const isInteractive = 
          ["input", "textarea", "select", "button", "a"].includes(node.tag) ||
          attributes.contenteditable === true ||
          attributes.contenteditable === "true" ||
          attributes.role === "button" ||
          attributes.role === "link";

        if (isInteractive && node.visible) {
          flatList.push({
            tag: node.tag,
            vortexId: node.vortexId,
            text: node.text,
            id: (attributes.id as string) || undefined,
            name: (attributes.name as string) || undefined,
            ariaLabel: (attributes["aria-label"] as string) || undefined,
            placeholder: (attributes.placeholder as string) || undefined,
            attributes: attributes,
            visible: node.visible,
          });
        }

        if (node.children) {
          for (const child of node.children) {
            traverse(child);
          }
        }
      }

      if (tree.root) {
        traverse(tree.root);
      }

      const ranked = rankElementsForGoal(flatList, context.originalGoal, context.currentDomain, context.intent);
      const topCandidates = ranked.slice(0, 15).map(c => ({
        vortexId: c.vortexId,
        tag: c.tag,
        id: c.id,
        text: c.text ? c.text.substring(0, 100) : undefined,
        ariaLabel: c.ariaLabel,
        placeholder: c.placeholder,
        attributes: c.attributes ? { type: c.attributes.type, name: c.attributes.name, value: c.attributes.value } : undefined,
      }));

      return {
        url: tree.url,
        title: tree.title,
        topCandidates,
        message: "DOM tree compressed. Only showing top interactive and relevant elements.",
      };
    }

    if (toolName === "extract_page_text") {
      const pageText = result as { title: string; url: string; text: string; truncated: boolean };
      const maxChars = context.intent === "read" || context.originalGoal.toLowerCase().match(/\b(resum|ler|extrair)\b/) ? 3000 : 800;
      return {
        title: pageText.title,
        url: pageText.url,
        text: pageText.text ? pageText.text.substring(0, maxChars) : "",
        truncated: (pageText.text?.length || 0) > maxChars,
      };
    }

    if (toolName === "query_elements") {
      const elements = result as ScrapableElement[];
      const ranked = rankElementsForGoal(elements, context.originalGoal, context.currentDomain, context.intent);
      return ranked.slice(0, 10).map(c => ({
        vortexId: c.vortexId,
        tag: c.tag,
        id: c.id,
        text: c.text ? c.text.substring(0, 120) : undefined,
        ariaLabel: c.ariaLabel,
        placeholder: c.placeholder,
      }));
    }

    if (toolName === "get_links") {
      const links = result as Array<{ text: string; href: string; vortexId?: string }>;
      const keywords = deriveKeywords(context.originalGoal, context.currentDomain);
      const scored = links.map(l => {
        let score = 0;
        const text = l.text.toLowerCase();
        const href = l.href.toLowerCase();
        for (const kw of keywords) {
          if (text.includes(kw)) score += 10;
          if (href.includes(kw)) score += 5;
        }
        return { link: l, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 15).map(s => s.link);
    }

    if (toolName === "get_images") {
      const images = result as Array<{ src: string; alt: string; title: string; vortexId?: string }>;
      const keywords = deriveKeywords(context.originalGoal, context.currentDomain);
      const scored = images.map(img => {
        let score = 0;
        const alt = img.alt.toLowerCase();
        const title = img.title.toLowerCase();
        for (const kw of keywords) {
          if (alt.includes(kw)) score += 10;
          if (title.includes(kw)) score += 5;
        }
        return { img, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 10).map(s => s.img);
    }

    if (toolName === "get_forms") {
      const forms = result as Array<{
        action: string;
        method: string;
        name?: string;
        id?: string;
        vortexId?: string;
        fields: ScrapableElement[];
      }>;

      return forms.slice(0, 5).map(f => ({
        id: f.id,
        name: f.name,
        action: f.action,
        vortexId: f.vortexId,
        fields: f.fields.slice(0, 10).map(field => ({
          tag: field.tag,
          id: field.id,
          name: field.name,
          placeholder: field.placeholder,
          ariaLabel: field.ariaLabel,
          vortexId: field.vortexId,
        })),
      }));
    }
  } catch (error) {
    console.error(`Error compressing result for tool ${toolName}:`, error);
  }

  return result;
}
