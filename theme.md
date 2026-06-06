# Guia de Especificação e Replicação do Tema Visual

Este documento detalha o **Design System** premium do projeto, baseado em uma paleta escura com detalhes dourados (estilo Dracula/Gold), efeito de glassmorfismo e micro-interações animadas de alta fidelidade. O objetivo é permitir a replicação exata desta identidade visual em qualquer outra aplicação web, em diferentes contextos de negócios, mantendo a fidelidade estética e seguindo a diretriz de **Zero Inline Styles** (estilos em linha nulos ou mínimos na UI).

---

## 1. Diretriz: Arquitetura de "Zero Inline Styles"

A arquitetura do tema foi desenvolvida para manter uma separação rígida entre a lógica de apresentação e a estrutura dos componentes. Em vez de injetar estilos de forma arbitrária no JSX (`style={{ backgroundColor: '#D6A84F' }}`), o sistema utiliza **CSS Custom Properties (Variáveis CSS)** injetadas no escopo global e consumidas de maneira estática via classes do Tailwind ou CSS global.

### Como funciona:
1. **Renderização do Servidor (SSR)**: Para evitar o efeito FOUC (*Flash of Unstyled Content*), o Next.js calcula o tema inicial do usuário no servidor e injeta o objeto contendo as variáveis CSS diretamente no elemento `<html>` durante o SSR:
   ```tsx
   <html style={initialThemeStyle}>
   ```
2. **Atualização Dinâmica no Cliente**: O componente client-side `ThemeRuntime` faz uma requisição para a API de aparência do site e, caso existam atualizações ou customizações de cores, atualiza as variáveis CSS no elemento raiz do documento:
   ```typescript
   const root = document.documentElement;
   for (const [key, value] of Object.entries(themeCssVariables(page))) {
     root.style.setProperty(key, value);
   }
   ```
3. **Consumo Semântico**: Os componentes apenas consomem classes estáticas pré-configuradas no CSS global (como `.theme-card` ou `.btn-bet`) ou utilizam classes dinâmicas do Tailwind referenciando as variáveis (como `bg-[var(--theme-surface)]` ou `border-[var(--theme-primary)]/10`).

---

## 2. Paleta de Cores (Tema Padrão Gold)

O tema principal consiste em cores escuras quentes, acentuadas por ouro metálico, verde esmeralda e vermelho terracota.

### Cores Base (Hex & RGB)

| Token Semântico | Variável CSS | Cor Hex | Equivalente RGB | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| **Background** | `--theme-bg` | `#080705` | `8, 7, 5` | Fundo principal da aplicação (preto-obsidiana quente) |
| **Surface 1** | `--theme-surface` | `#14100A` | `20, 16, 10` | Superfície primária (cards principais, painéis) |
| **Surface 2** | `--theme-surface-2` | `#20170C` | `32, 23, 12` | Superfície secundária (inputs, subcards, botões de ação) |
| **Surface 3** | `--bg-surface-3` | `#0F0B06` | `15, 11, 6` | Superfície profunda de contraste interno |
| **Primary (Gold)** | `--theme-primary` | `#D6A84F` | `214, 168, 79` | Cor principal da marca e de destaque primário |
| **Primary Light** | `--theme-primary-light`| `#FFF0B8` | `255, 240, 184`| Destaque dourado claro brilhante (usado em gradientes e hover) |
| **Primary Dark** | `--theme-primary-dark` | `#8A5A20` | `138, 90, 32` | Dourado escurecido/bronze (sombras 3D e estados ativos) |
| **Accent (Success)** | `--theme-accent` | `#1EE28A` | `30, 226, 138` | Verde neon (ações positivas, confirmações, botões de sucesso) |
| **Danger** | `--theme-danger` | `#D74E35` | `215, 78, 53` | Vermelho terracota (erros, cancelamentos, status de perda) |
| **Warning** | `--theme-warning` | `#F2C86B` | `242, 200, 107`| Amarelo âmbar brilhante (alertas, status pendentes) |
| **Text** | `--theme-text` | `#FFF3D1` | `255, 243, 209`| Texto principal (creme altamente legível sobre fundo escuro) |
| **Muted Text** | `--theme-muted` | `#BFA66D` | `191, 166, 109`| Texto secundário de baixo contraste |
| **Border Subtle** | `--theme-border` | `rgba(214,168,79,0.16)`| - | Borda de contenção muito sutil |
| **Border Strong** | `--theme-border-strong`| `rgba(214,168,79,0.35)`| - | Borda de separação ativa |

---

## 3. Integração com Tailwind CSS v4

O projeto utiliza o **Tailwind CSS v4.0** com o compilador `@tailwindcss/postcss`. No arquivo `globals.css`, as cores dinâmicas e tipografias são mapeadas na diretiva `@theme inline` para estender o Tailwind sem a necessidade de um arquivo `tailwind.config.js` externo:

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--theme-bg);
  --color-foreground: var(--theme-text);
  --color-primary: var(--theme-primary);
  --color-primary-hover: var(--theme-primary-dark);
  --color-surface: var(--theme-surface);
  --color-surface-2: var(--theme-surface-2);
  --color-border: var(--theme-border);
  --color-muted: var(--theme-muted);
  --font-sans: var(--font-inter);
  --font-display: var(--font-sora);
}
```

Isso permite usar as classes utilitárias nativas do Tailwind ligadas diretamente às propriedades customizadas do CSS dinâmico (por exemplo, `bg-primary`, `text-muted`, `font-display`).

---

## 4. Tipografia & Layout Base

Para replicar exatamente a legibilidade e a hierarquia visual do tema:

### 1. Fontes Necessárias (Google Fonts)
O tema utiliza duas fontes principais:
*   **Inter**: Utilizada para textos corridos, números tabulares e metadados.
*   **Sora**: Utilizada para títulos, cabeçalhos e textos de CTA/Botões importantes.

```html
<!-- Importação recomendada via HTML head -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Sora:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
```

### 2. Estilos do Body e Fundo Global
O fundo do aplicativo combina gradientes dinâmicos de luz sobre a cor base para criar profundidade e um visual premium em ambientes escuros:

```css
body {
  background:
    linear-gradient(180deg, var(--theme-primary-soft), transparent 22rem),
    radial-gradient(circle at 80% -10%, var(--theme-primary-glow), transparent 32rem),
    radial-gradient(circle at 12% 18%, var(--theme-accent-glow), transparent 26rem),
    var(--theme-bg);
  color: var(--theme-text);
  font-family: var(--font-inter), system-ui, sans-serif;
  min-height: 100%;
}
```

---

## 5. Classes Utilitárias Semânticas (Componentes Reutilizáveis)

As classes a seguir encapsulam os padrões visuais e efeitos do tema em `globals.css` para evitar duplicação no JSX.

### 1. Superfícies (Cards e Painéis)
```css
/* Card padrão */
.theme-card {
  background: color-mix(in srgb, var(--theme-surface-2) 82%, transparent);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius); /* Padrão: 14px */
  color: var(--theme-text);
}

/* Superfície dinâmica com efeito Glow e Sombra profunda */
.theme-surface {
  background: color-mix(in srgb, var(--theme-surface) 88%, transparent);
  border-color: var(--theme-border);
  border-radius: var(--theme-radius);
  box-shadow: var(--theme-shadow);
  /* Sombra Padrão (Glow): 0 0 28px rgba(214,168,79,0.25), 0 18px 60px rgba(0,0,0,0.34) */
}

/* Glassmorfismo Primário (Efeito Vidro Translúcido) */
.glass-surface {
  background: rgba(var(--theme-surface-rgb), 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(var(--theme-primary-rgb), 0.14);
}

/* Glassmorfismo Secundário */
.glass-surface-2 {
  background: color-mix(in srgb, var(--theme-surface-2) 78%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(var(--theme-warning-rgb), 0.14);
}
```

### 2. Botões (Sensação Premium 3D)
Os botões utilizam gradientes lineares inclinados em 135 graus e uma sombra sólida na parte inferior para conferir um aspecto tátil tridimensional ao clicar:

```css
/* Botão Principal/Chamada Importante (Dourado) */
.theme-primary-button {
  border-radius: var(--theme-control-radius); /* Padrão: 12px */
  background: linear-gradient(135deg, var(--theme-primary-light), var(--theme-primary) 58%, var(--theme-primary-dark));
  color: var(--theme-on-primary); /* Padrão: #130D05 */
  box-shadow: 0 4px 0 var(--theme-primary-dark), 0 0 20px var(--theme-primary-glow);
  font-weight: 800;
  transition: all 0.15s ease;
}

.theme-primary-button:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.theme-primary-button:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 var(--theme-primary-dark);
}

/* Botão Secundário (Borda Dourada Suave com Fundo Sutil) */
.theme-secondary-button {
  border-radius: var(--theme-control-radius);
  border: 1px solid var(--theme-border-strong);
  background: var(--theme-primary-soft);
  color: var(--theme-text);
  font-weight: 600;
}

/* Botão de Sucesso / Confirmação Rápida (Verde Neon 3D) */
.btn-success-gradient {
  background: linear-gradient(135deg, color-mix(in srgb, var(--theme-accent) 62%, black) 0%, var(--theme-accent) 100%);
  box-shadow: 0 4px 0 color-mix(in srgb, var(--theme-accent) 36%, black), 0 0 24px rgba(var(--theme-accent-rgb), 0.34);
  color: var(--theme-on-accent); /* Padrão: #001A0E */
  font-weight: 900;
  border-radius: 14px;
  transition: all 0.12s ease;
}

.btn-success-gradient:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.btn-success-gradient:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--theme-accent) 36%, black);
}
```

### 3. Formulários (Inputs com Efeito Neon)
```css
/* Input base */
.input-neon {
  background: var(--bg-surface-2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--theme-control-radius);
  color: var(--theme-text);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.input-neon:focus-within {
  border-color: rgba(var(--theme-primary-rgb), 0.6);
  box-shadow: 0 0 0 3px rgba(var(--theme-primary-rgb), 0.12);
}
```

---

## 6. Biblioteca de Micro-interações e Animações

Micro-interações fluidas são essenciais para que o tema pareça "vivo" e Premium. As animações principais são controladas via CSS nativo em `globals.css`:

```css
/* Entrada suave vinda de baixo */
@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.fade-in-up {
  opacity: 0;
  animation: fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Efeito Hover com Escala Sutil */
.hover-scale {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.hover-scale:hover {
  transform: scale(1.02);
  filter: brightness(1.05);
}

/* Pulso de luz Neon (Dourado) */
@keyframes neon-pulse {
  0%, 100% {
    box-shadow: 0 0 8px 0 var(--clr-primary-glow);
  }
  50% {
    box-shadow: 0 0 24px 8px var(--clr-primary-glow), 0 0 48px 16px rgba(var(--theme-primary-rgb), 0.2);
  }
}
.neon-pulse {
  animation: neon-pulse 2s ease-in-out infinite;
}

/* Pulso de luz Neon Verde (Sucesso) */
@keyframes green-pulse {
  0%, 100% {
    box-shadow: 0 4px 0 color-mix(in srgb, var(--theme-accent) 45%, black), 0 0 0 0 rgba(var(--theme-accent-rgb), 0);
  }
  50% {
    box-shadow: 0 4px 0 color-mix(in srgb, var(--theme-accent) 45%, black), 0 0 24px 8px rgba(var(--theme-accent-rgb), 0.5), 0 0 48px 16px rgba(var(--theme-accent-rgb), 0.2);
  }
}
.green-pulse {
  animation: green-pulse 1.2s ease-in-out infinite;
}

/* Ponto Indicador Pulsante (Status Ao Vivo) */
@keyframes pulse-live {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.8);
  }
}
.pulse-live {
  animation: pulse-live 1.5s ease-in-out infinite;
}

/* Efeito Shimmer Sweep (Varredura de Brilho para Skeleton Loading) */
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}
```

---

## 7. Passos para Implantação do Tema em Outros Projetos

Para clonar a estética e comportamento idênticos deste tema em outro projeto, siga o passo-a-passo abaixo:

1.  **Carregue as Fontes**: Importe `Inter` e `Sora` do Google Fonts no cabeçalho ou integre-as utilizando os mecanismos do seu framework (por ex., `next/font`).
2.  **Declare as Variáveis de Raiz (`:root`)**: Copie os blocos de variáveis do `:root` definidos na Seção 2 acima para o seu arquivo principal de estilos CSS.
3.  **Habilite o mapeamento do Tailwind**: Insira a diretiva `@theme inline` dentro do seu CSS principal caso esteja no Tailwind CSS v4, ou mapeie as chaves correspondentes no `tailwind.config.js` caso esteja usando a versão 3 do Tailwind.
4.  **Integre as Classes Utilitárias**: Cole os utilitários semânticos (superfícies, botões 3D, inputs, animações) do capítulo 5 e 6 no seu arquivo CSS global.
5.  **Configure o Efeito de Ambientação no Layout Principal**: Utilize um container fixo no fundo com gradiente de ambientação sutil dourado para imitar o efeito luminoso suave:
    ```html
    <div class="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div class="absolute inset-0 bg-[linear-gradient(135deg,var(--theme-primary-soft),transparent_32%,rgba(255,255,255,0.035)_72%,transparent)]"></div>
      <div class="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--theme-primary-soft)] to-transparent"></div>
    </div>
    ```
