# Browia 🌌 — IA Browser Agent Extension

**Browia** é uma extensão de navegador de última geração (Manifest V3) que acopla um painel lateral (Sidepanel) onde um agente autônomo de Inteligência Artificial opera a aba ativa do seu navegador em tempo real utilizando o **Model Context Protocol (MCP)** e chamadas de ferramentas locais.

O projeto foi construído seguindo rigorosamente os princípios de **Responsabilidade Única (SRP)**, arquitetura orientada a serviços e uma experiência visual premium baseada no tema **Dracula/Gold**.

---

## 🚀 Principais Funcionalidades

1. **Agente IA Autônomo e Multiprovedor**
   - Suporte completo às APIs oficiais da **OpenAI** (com modelos predefinidos de GPT-4o, o1, o3-mini, GPT-4), **Google Gemini** (suportando a família 1.5, 2.0, 2.5, 3.1 e 3.5) e instâncias do **Ollama** locais ou remotas.
   - Sincronização automática de modelos instalados no computador do usuário ao conectar-se ao Ollama.

2. **Loop de Execução MCP Inteligente**
   - Execução autônoma de até 12 iterações por tarefa do usuário.
   - Recuperação automática de interrupções físicas e fluxo de persistência de estado em tempo real para proteger a sessão caso a gaveta lateral da extensão se feche no meio de um processo.

3. **Separação Inteligente de Ferramentas (Safe vs. Sensitive)**
   - **Ferramentas Seguras (Leitura/Inspeção):** Ações puramente diagnósticas (como `list_tabs`, `get_dom_tree`, `query_elements`, `extract_page_text`, `capture_screenshot`) são executadas automaticamente em segundo plano, acelerando a navegação autônoma.
   - **Ferramentas Sensíveis (Mutação/Navegação):** Ações que modificam estados (como `click_element`, `interact_element`, `type_text`, `navigate_tab`, `download_file`) são pausadas temporariamente, disparando um painel interativo de aprovação do usuário.

4. **Bypass Dinâmico de CORS/403 no Ollama**
   - Configuração automática do `chrome.declarativeNetRequest` em segundo plano para interceptar chamadas HTTP locais destinadas aos endpoints do Ollama (`/api/chat` e `/api/tags`) e remover o cabeçalho `Origin` imposto pelas extensões de navegador. Isso elimina o erro `403 Forbidden` sem precisar forçar o usuário a ajustar as variáveis de ambiente locais do seu servidor LLM.

5. **Linha do Tempo Visual e Logs Colapsáveis**
   - Conversa limpa de payloads XML e tags cruas.
   - Agrupamento automático de chamadas e respostas de ferramentas em blocos de logs colapsáveis elegantes com formatação de código estruturada, sumários de elementos DOM, abas Chrome e scrollbar horizontal embutido para payloads extensos de JSON.
   - Ocultação inteligente de raciocínios intermediários do agente em seções expansíveis de logs para manter o histórico de chat limpo.

6. **Textarea de Input Inteligente**
   - Campo de texto auto-expansível (cresce dinamicamente entre `38px` e `140px`) que suporta quebras de linha com **Shift+Enter** e envio automático com **Enter** padrão.
   - Padding de segurança e alinhamento que impede o texto de invadir ou passar por baixo do botão de envio.

7. **Internacionalização Multi-idiomas (i18n)**
   - Suporte nativo completo a **8 idiomas**: Português (`pt`), Inglês (`en`), Espanhol (`es`), Francês (`fr`), Alemão (`de`), Italiano (`it`), Japonês (`ja`) e Chinês (`zh`).
   - Detecção automática do idioma do navegador Chrome com fallback seguro para o inglês e seletor manual na interface de configurações.

---

## 🎨 Design System & Estética (Dracula/Gold)

A interface do Browia foi projetada sob o estilo dark-premium do tema **Dracula/Gold**:
* **Superfícies:** Fundo cinza-obsidiana profundo (`#0f0b06`) combinado com bordas translúcidas de vidro (`rgba(255, 255, 255, 0.08)`).
* **Tipografia:** Uso das fontes de alta legibilidade `Sora` (títulos) e `Inter` (corpo e controles) via Google Fonts.
* **Cores de Destaque:** Dourado/Âmbar (`#d6a84f`) como cor primária de botões e focos, verde-neon de sucesso (`#1ee28a`) e terracota (`#d74e35`) para alertas e exclusões.
* **Animações (Framer Motion):** Transições suaves e elásticas de entrada de mensagens (fade-in e slide-up de 12px), transições staggered (em cascata) para etapas de planos, efeitos de escala interativa em cards e botões (`whileHover`, `whileTap`) e indicador animado de sessão ativa deslizante por ID de layout.

---

## 🛠️ Tecnologias Utilizadas

* **Framework:** React 19 + TypeScript 6
* **Estilização:** Tailwind CSS v4 + Vanilla CSS
* **Build System:** Vite 8
* **Animações:** Framer Motion 12
* **Ícones:** Lucide React
* **Navegador:** Chrome Extension APIs (Manifest V3 - Service Worker, Offscreen Document, Scripting e DeclarativeNetRequest)

---

## 📂 Organização da Base de Código

A estrutura do projeto separa rigorosamente a lógica de negócio dos componentes visuais:

```text
src/
├── assets/                      # Recursos estáticos (como prompt de sistema base)
├── config/                      # Configurações de presets e modelos de IA suportados
├── components/                  # Componentes visuais de renderização pura (Sem lógica)
│   ├── ChatContainer.tsx        # Timeline do chat, sugestões rápidas e input textarea
│   ├── MessageItem.tsx          # Bolhas de mensagem do usuário/IA com formatação de código
│   ├── SessionList.tsx          # Lista lateral do histórico de conversas
│   ├── SettingsPanel.tsx        # Modal de chaves de API, idioma e endpoints
│   ├── ExecutionApprovalPanel.ts# Card estruturado de aprovação de ações sensíveis
│   ├── ExecutionStepCard.tsx    # Card colapsável de logs e payloads de ferramentas
│   └── settings/                # Subseções e menus do painel de configurações
├── hooks/                       # React Hooks customizados (Controle de estado)
│   └── useAgentSession.ts       # Hook de integração das sessões com o runtime offscreen
├── i18n/                        # Internacionalização
│   ├── locales/                 # Dicionários traduzidos dos 8 idiomas suportados
│   ├── index.tsx                # Provedor e hook de tradução com mesclagem de fallback
│   └── types.ts                 # Contratos de tipagem das chaves de tradução
├── services/                    # Camada de lógica e integrações de rede (Services)
│   ├── agentLoop.ts             # Máquina de estados e loop autônomo do agente MCP
│   ├── mcpEngine.ts             # Parser XML e executor central de comandos no navegador
│   ├── openaiService.ts         # Integração com a API de ChatCompletions da OpenAI
│   ├── geminiService.ts         # Integração com a API de geração de conteúdo do Gemini
│   ├── ollamaService.ts         # Integração com o Ollama local e listagem de tags
│   ├── storageService.ts        # Gerenciamento local persistente de sessões e chaves
│   └── mcp/                     # Registro individual e código-fonte de cada ferramenta MCP
├── App.tsx                      # Dashboard magro que compõe a UI da extensão
├── background.ts                # Service Worker em segundo plano (Inicialização e DNR)
├── offscreen.ts                 # Script de runtime offscreen para manter o agente ativo
├── main.tsx                     # Inicializador do React DOM
└── globals.css                  # Mapeamento do tema Dracula/Gold com Tailwind v4
```

---

## ⚙️ Instalação e Desenvolvimento

### Pré-requisitos
* **Node.js** (versão 18 ou superior recomendado)
* **npm** ou seu gerenciador de pacotes favorito

### 1. Clonar e Instalar as Dependências
```bash
git clone https://github.com/[seu-usuario]/browia.git
cd browia
npm install
```

### 2. Rodar em Ambiente de Desenvolvimento
Para testar a interface no seu navegador local em tempo real:
```bash
npm run dev
```

### 3. Compilar a Extensão para Produção
Gera os arquivos otimizados e prontos para distribuição MV3 na pasta `dist/`:
```bash
npm run build
```
*(Nota: O script de compilação gera e valida automaticamente a estrutura do Service Worker, documento offscreen e o `manifest.json` do ecossistema).*

### 4. Carregar a Extensão no Google Chrome
1. Abra o navegador Chrome e acesse `chrome://extensions/`.
2. No canto superior direito, ative o **Modo do desenvolvedor** (Developer Mode).
3. No canto superior esquerdo, clique em **Carregar sem compactação** (Load unpacked).
4. Selecione a pasta **`dist`** gerada dentro do diretório do projeto.
5. Fixe o ícone do **Browia** na barra de ferramentas e clique nele para abrir o painel lateral!

---

## 🔒 Segurança e Tratamento de Dados

* **Chaves de API:** Suas credenciais da OpenAI e Gemini, bem como endpoints do Ollama, são armazenados localmente e criptografados no armazenamento seguro do seu navegador (`chrome.storage.local`). Nenhum dado pessoal ou de credencial é enviado a servidores de terceiros.
* **Permissões Mínimas:** A extensão solicita apenas permissões essenciais para operar (como leitura e escrita na aba ativa do navegador para execução de ações MCP).

---

## 📄 Licença

Este projeto está licenciado sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para obter mais detalhes.
