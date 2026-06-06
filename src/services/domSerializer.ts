export type DomSemanticAttributes = Record<string, string | boolean | number>;

export interface DomRectSnapshot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DomSemanticNode {
  vortexId: number;
  tag: string;
  text: string;
  visible: boolean;
  attributes: DomSemanticAttributes;
  rect: DomRectSnapshot;
  children: DomSemanticNode[];
}

export interface DomSemanticTree {
  url: string;
  title: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  root: DomSemanticNode | null;
}

export function serializeCurrentDom(): DomSemanticTree {
  const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"]);
  const stableAttributeNames = new Set([
    "id",
    "name",
    "type",
    "role",
    "href",
    "src",
    "alt",
    "title",
    "placeholder",
    "for",
    "value",
    "checked",
    "disabled",
    "readonly",
    "required",
    "selected",
    "contenteditable",
    "autocomplete",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "aria-expanded",
    "aria-selected",
    "aria-checked",
    "aria-controls",
    "data-e2e",
    "data-testid",
    "data-test",
    "data-cy",
    "testid",
  ]);

  let vortexCounter = 1;

  function cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function directTextOf(element: Element): string {
    const textParts: string[] = [];

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent) {
        const text = cleanText(child.textContent);

        if (text) {
          textParts.push(text);
        }
      }
    }

    return textParts.join(" ");
  }

  function roundedNumber(value: number): number {
    return Math.round(value * 100) / 100;
  }

  function rectOf(element: Element): DomRectSnapshot {
    const rect = element.getBoundingClientRect();

    return {
      x: roundedNumber(rect.x),
      y: roundedNumber(rect.y),
      w: roundedNumber(rect.width),
      h: roundedNumber(rect.height),
    };
  }

  function isVisible(element: Element, rect: DomRectSnapshot): boolean {
    const style = window.getComputedStyle(element);

    return (
      rect.w > 0 &&
      rect.h > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0
    );
  }

  function safeAttributeValue(attribute: Attr): string | boolean | number {
    const value = attribute.value;

    if (value === "") {
      return true;
    }

    if (attribute.name === "href" || attribute.name === "src") {
      try {
        return new URL(value, window.location.href).toString();
      } catch {
        return value;
      }
    }

    return value;
  }

  function attributesOf(element: Element): DomSemanticAttributes {
    const attributes: DomSemanticAttributes = {};

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();

      if (name === "class" || name === "style" || name === "data-vortex-id") {
        continue;
      }

      if (stableAttributeNames.has(name) || name.startsWith("data-")) {
        attributes[name] = safeAttributeValue(attribute);
      }
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      attributes.value = element.value;
    }

    if (element instanceof HTMLSelectElement) {
      attributes.value = element.value;
    }

    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      attributes.checked = element.checked;
    }

    return attributes;
  }

  function serializeElement(element: Element): DomSemanticNode | null {
    if (ignoredTags.has(element.tagName)) {
      return null;
    }

    const vortexId = vortexCounter++;
    element.setAttribute("data-vortex-id", String(vortexId));

    const rect = rectOf(element);
    const children: DomSemanticNode[] = [];

    for (const child of Array.from(element.children)) {
      const serializedChild = serializeElement(child);

      if (serializedChild) {
        children.push(serializedChild);
      }
    }

    return {
      vortexId,
      tag: element.tagName.toLowerCase(),
      text: directTextOf(element),
      visible: isVisible(element, rect),
      attributes: attributesOf(element),
      rect,
      children,
    };
  }

  return {
    url: window.location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    root: document.body ? serializeElement(document.body) : null,
  };
}
