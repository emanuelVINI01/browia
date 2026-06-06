import type { InteractionAction, ToolRegistry } from "../types";
import { parseJsonArray, parseJsonObject, requireNumber, requireParam, resolveTabId } from "../utils";

export const domActionTools: ToolRegistry = {
  interact_element: interactElement,
  press_key: pressKey,
  scroll_page: scrollPage,
  alter_element_dom: alterElementDom,
};

export async function interactElement(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const vortexId = requireNumber(params, "vortexId");
  const action = requireParam(params, "action") as InteractionAction;
  const value = params.value ?? "";

  if (!["click", "type", "clear", "hover"].includes(action)) {
    throw new Error(`Unsupported interact_element action: ${action}`);
  }

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (targetVortexId: number, targetAction: InteractionAction, targetValue: string) => {
      const element = document.querySelector<HTMLElement>(
        `[data-vortex-id="${String(targetVortexId)}"]`,
      );

      if (!element) {
        return { ok: false, error: `Element ${targetVortexId} not found.` };
      }

      const dispatch = (event: Event) => {
        element.dispatchEvent(event);
      };

      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      element.focus?.();

      if (targetAction === "hover") {
        dispatch(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));
        dispatch(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
        dispatch(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));

        return { ok: true, vortexId: targetVortexId, action: targetAction };
      }

      if (targetAction === "click") {
        dispatch(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        dispatch(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        dispatch(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        dispatch(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.click();

        return { ok: true, vortexId: targetVortexId, action: targetAction };
      }

      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        if (targetAction === "clear") {
          element.value = "";
        }

        if (targetAction === "type") {
          element.value = targetValue;
        }

        dispatch(new InputEvent("input", { bubbles: true, cancelable: true, data: targetValue }));
        dispatch(new Event("change", { bubbles: true, cancelable: true }));

        return { ok: true, vortexId: targetVortexId, action: targetAction };
      }

      if (element.isContentEditable) {
        element.textContent = targetAction === "clear" ? "" : targetValue;
        dispatch(new InputEvent("input", { bubbles: true, cancelable: true, data: targetValue }));

        return { ok: true, vortexId: targetVortexId, action: targetAction };
      }

      return {
        ok: false,
        error: `Action ${targetAction} requires an editable element.`,
        vortexId: targetVortexId,
      };
    },
    args: [vortexId, action, value],
  });

  return result[0]?.result;
}

async function pressKey(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const key = requireParam(params, "key");
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      keyValue: string,
      codeValue: string | undefined,
      ctrlKey: boolean,
      altKey: boolean,
      shiftKey: boolean,
      metaKey: boolean,
    ) => {
      const target = document.activeElement ?? document.body;
      const eventInit: KeyboardEventInit = {
        key: keyValue,
        code: codeValue,
        bubbles: true,
        cancelable: true,
        ctrlKey,
        altKey,
        shiftKey,
        metaKey,
      };

      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));

      return { ok: true, key: keyValue, code: codeValue };
    },
    args: [
      key,
      params.code,
      params.ctrlKey === "true",
      params.altKey === "true",
      params.shiftKey === "true",
      params.metaKey === "true",
    ],
  });

  return result[0]?.result;
}

async function scrollPage(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const x = Number(params.x ?? "0");
  const y = Number(params.y ?? "0");
  const behavior = params.behavior === "smooth" ? "smooth" : "instant";
  const mode = params.mode ?? "relative";
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      scrollXValue: number,
      scrollYValue: number,
      scrollMode: string,
      scrollBehavior: ScrollBehavior,
    ) => {
      if (scrollMode === "absolute") {
        window.scrollTo({ left: scrollXValue, top: scrollYValue, behavior: scrollBehavior });
      } else {
        window.scrollBy({ left: scrollXValue, top: scrollYValue, behavior: scrollBehavior });
      }

      return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
    },
    args: [x, y, mode, behavior],
  });

  return result[0]?.result;
}

export async function alterElementDom(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const vortexId = requireNumber(params, "vortexId");
  const attributes = parseJsonObject(params.attributes, "attributes");
  const style = parseJsonObject(params.style, "style");
  const properties = parseJsonObject(params.properties, "properties");
  const removeAttributes = parseJsonArray(params.removeAttributes, "removeAttributes");
  const textContent = params.textContent;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      targetVortexId: number,
      attrs: Record<string, unknown>,
      stylePatch: Record<string, unknown>,
      propertyPatch: Record<string, unknown>,
      attrsToRemove: string[],
      newTextContent: string | undefined,
    ) => {
      const element = document.querySelector<HTMLElement>(
        `[data-vortex-id="${String(targetVortexId)}"]`,
      );

      if (!element) {
        return { ok: false, error: `Element ${targetVortexId} not found.` };
      }

      for (const attributeName of attrsToRemove) {
        element.removeAttribute(attributeName);
      }

      for (const [name, value] of Object.entries(attrs)) {
        if (value === false || value === null) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, String(value));
        }
      }

      for (const [name, value] of Object.entries(stylePatch)) {
        element.style.setProperty(name, String(value));
      }

      for (const [name, value] of Object.entries(propertyPatch)) {
        (element as unknown as Record<string, unknown>)[name] = value;
      }

      if (typeof newTextContent === "string") {
        element.textContent = newTextContent;
      }

      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

      return {
        ok: true,
        vortexId: targetVortexId,
        attributesApplied: Object.keys(attrs),
        styleApplied: Object.keys(stylePatch),
        propertiesApplied: Object.keys(propertyPatch),
        attributesRemoved: attrsToRemove,
      };
    },
    args: [vortexId, attributes, style, properties, removeAttributes, textContent],
  });

  return result[0]?.result;
}
