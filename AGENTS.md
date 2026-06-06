<!-- BEGIN:nextjs-agent-rules -->
# Template Rules

- Next 16 App Router: confira `node_modules/next/dist/docs/` antes de assumir APIs antigas.
- Reutilize primeiro o que ja existe em `src/components/ui`, `src/components/layout`, `src/components/states` e `src/components/navigation`.
- `app/` compoe rotas; logica de negocio, formatacao, mapeamento, fetch e integracao ficam em `src/services`, `src/utils`, `src/hooks`, `src/lib` ou `src/mappers` quando existir.
- Single Responsibility sempre:
  pagina compoe;
  componente renderiza;
  hook controla estado/efeitos/integracao;
  util e puro;
  service fala com auth, API ou banco;
  mapper transforma dado para UI.
- Refatore de verdade, nao cosmeticamente: quebre componentes, hooks e funcoes quando estiverem misturando responsabilidades ou levando mais de 3 segundos para entender.
- Se um componente tiver JSX poluido, condicionais empilhadas, handlers inline complexos, props demais ou regra visual espalhada, extraia subcomponentes, utils ou hooks menores.
- Se um `useEffect`, `useMemo` ou `useCallback` estiver mascarando bagunca, simplifique a modelagem antes de memoizar.
- Prefira composicao a condicionais gigantes. Se uma condicao muda muito a UI, crie outro componente.
- Centralize repeticoes reais: cards, headers, estados `loading/empty/error/success`, tabelas, linhas, badges, formatadores, cores, status e arrays de configuracao.
- Todo texto de UI deve passar por i18n desde o inicio, em todos os projetos derivados. Nao hardcode labels, CTAs, placeholders, aria-labels, empty/error/loading states, metadata textual ou textos de toast em paginas/componentes; coloque em dicionarios tipados e passe por props/hook/provider.
- Mantenha `src/i18n` como base padrao para linguagens, dicionarios e tipos. Ao criar nova tela/componente, atualize primeiro o contrato de i18n e depois consuma as chaves na UI.
- Nao deixe fetch dentro de componente visual quando isso puder morar em hook ou service.
- Pages e layouts devem ser finos. Respeite Server vs Client Components e nao transforme tudo em client sem necessidade.
- Mantenha a hierarquia visual do template: `AppHeader` -> `main` -> `PageSection` -> cards/listas/formularios.
- Navbar padrao:
  mantenha um unico array/factory de itens (`href`, `label`, `mobileLabel` quando precisar, `icon` lucide) em `src/lib` ou arquivo dedicado `nav-items`;
  labels devem vir de i18n/dicionario, nao hardcoded no componente;
  use a mesma fonte para desktop e mobile para evitar rotas divergentes;
  `AppHeader` controla brand, sessao/auth, idioma/status e composicao da nav, mas nao deve conter regra de negocio;
  se o header crescer, separe em `BrandLink`, `DesktopNav`, `MobileBottomNav` e `HeaderActions`;
  desktop nav fica no topo com `Link`, `aria-current`, estado ativo por `pathname`, texto curto e uppercase;
  mobile deve ser bottom nav fixa, `z-50`, `safe-area-inset-bottom`, icone acima do label, label truncado e grid baseado na quantidade de itens;
  use `framer-motion` apenas para entrada/indicador ativo, mantendo `layoutId` unico por projeto;
  auth deve mostrar login quando deslogado e nome/avatar/logout quando logado, sem duplicar `signIn/signOut` fora dos componentes de auth;
  preserve tokens Dracula (`dracula-bg`, `dracula-card`, `dracula-cyan`, `dracula-purple`, `dracula-comment`) e nao crie estilos paralelos de navbar.
- Preserve o tema Dracula. Use tokens e superficies de `app/globals.css`; nao invente paleta paralela.
- Prisma, Auth.js e clients compartilhados sao singleton/config central. Nao recrie client, adapter ou auth config em pagina, hook ou route handler.
- Remova codigo morto, imports inuteis, helpers abandonados e assets padrao da Vercel. Evite abstracao teatral, micro-abstracao e camada extra sem ganho real.
- Preserve comportamento atual. Nao mude regra de negocio sem necessidade.
- Fluxo esperado em toda refatoracao:
  revisar arquitetura;
  achar arquivos inchados e responsabilidades misturadas;
  refatorar incrementalmente;
  padronizar limites entre pagina, componente, hook, util e service;
  validar com lint, typecheck e build/testes.
<!-- END:nextjs-agent-rules -->

# Financial Safety Rules

- Never update `users.balance` directly from game engines or routes.
- All balance changes must go through the central finance/ledger functions.
- Every BET/WIN/DEPOSIT/WITHDRAWAL/REFUND must have an idempotent `referenceId`.
- Never mark withdrawals as COMPLETED without real provider confirmation.
- Divipay withdrawals are disabled until a real provider payout implementation exists.
- Divipay withdrawals are disabled. Do not enable or implement local-only completion for Divipay withdrawals. A withdrawal may only become COMPLETED after a real provider payout confirmation, signed webhook, or verified provider status lookup.
- Do not implement local-only withdrawal completion for any gateway.
- Webhook handlers must be idempotent and must verify signature/replay when provider supports it.
- State games must persist start idempotency in the database, not only Redis.
- Redis may cache active game state, but database constraints must prevent financial rerolls.
- Cashout must be idempotent and must not pay twice.
- Dice/stateless games must persist result before payout.
- Test bypasses must never work in production.
- Do not log gateway secrets, API keys, webhook secrets or credentials.
- Do not return raw gateway credentials from admin APIs.
- Gateway credentials are currently stored as plaintext JSON at rest; do not expand that pattern. Encrypt with application/KMS keys before adding new sensitive fields.

# Game Engine Rules

- SSEGameEngine only for global/live games.
- StateGameEngine for individual stateful games.
- StatelessEngine for instant games.
- Frontend never decides result, multiplier or payout.
- Backend must be source of truth.
- Idempotency and concurrency tests are required for new games.

# Development Server Rules

- You can start next dev, but if you are through a error of port,
you can presume the server is already running at that port.
- Do not remove Next.js dev-server lock files to force a server start.

# Configurable UI Rules

- When creating or changing any reusable UI component, page text, modal, alert, navigation item, logo/brand surface, or visible user-facing label, update the admin configuration model in `config/admin/` and the matching provider/API/UI under `src/lib/config`, `app/api/admin/settings`, and `src/components/admin/settings`.
- New visible text must be represented in the language settings so Portuguese and English can be edited from `/admin/settings/language`; do not leave new user-facing copy as an untracked hardcoded-only string.
- New reusable visual components must be represented in the appearance settings so classes, removals, page scope, preview, modal/alert behavior, and theme impact can be edited from the admin panel.
- New brand/logo usage must read from the brand/business configuration or expose a clear fallback; do not create another hardcoded logo path or brand mark without adding it to the admin configuration.
- Configuration changes must follow the existing flow: edit in memory in the admin UI, save the JSON draft, and only apply runtime behavior through "Atualização geral".

# Required Checks Before Merge

- typecheck
- lint
- relevant API tests
- financial/idempotency tests when touching games/finance
- no direct balance mutation
- no unguarded webhook bypass
- no secrets in logs/responses
