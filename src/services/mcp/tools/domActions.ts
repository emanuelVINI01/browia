/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InteractionAction, ToolRegistry } from "../types";
import { parseJsonArray, parseJsonObject, requireNumber, requireParam, resolveTabId } from "../utils";
import { resolveElement } from "./domRead";

export const domActionTools: ToolRegistry = {
  interact_element: interactElement,
  press_key: pressKey,
  scroll_page: scrollPage,
  alter_element_dom: alterElementDom,
};

export function parseKeyCombo(combo: string): { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean } {
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  
  let ctrlKey = false;
  let altKey = false;
  let shiftKey = false;
  let metaKey = false;

  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i].toLowerCase();
    if (mod === "ctrl" || mod === "control") ctrlKey = true;
    if (mod === "alt") altKey = true;
    if (mod === "shift") shiftKey = true;
    if (mod === "meta" || mod === "cmd" || mod === "win") metaKey = true;
  }

  let code = key;
  if (key.toLowerCase() === "enter") code = "Enter";
  if (key.toLowerCase() === "escape" || key.toLowerCase() === "esc") code = "Escape";
  if (key.toLowerCase() === "space") code = "Space";
  if (key.toLowerCase() === "tab") code = "Tab";
  if (key.toLowerCase() === "backspace") code = "Backspace";
  
  if (key.length === 1 && key.match(/[a-z]/i)) {
    code = `Key${key.toUpperCase()}`;
  }

  return {
    key: key === "Enter" ? "Enter" : key === "Escape" ? "Escape" : key,
    code,
    ctrlKey,
    altKey,
    shiftKey,
    metaKey
  };
}

export async function interactElement(params: Record<string, any>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const action = requireParam(params, "action") as InteractionAction;
  const value = params.value ?? "";

  if (!["click", "type", "clear", "hover"].includes(action)) {
    throw new Error(`Unsupported interact_element action: ${action}`);
  }

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";
  const domain = new URL(url).hostname.replace("www.", "");

  // Schema validation/conversion (Parte 11)
  let vortexIdNum: number | undefined = undefined;
  if (typeof params.vortexId === "number") {
    vortexIdNum = params.vortexId;
  } else if (params.vortexId !== undefined && params.vortexId !== "") {
    if (/^\d+$/.test(String(params.vortexId))) {
      vortexIdNum = Number(params.vortexId);
    } else {
      const vStr = String(params.vortexId).trim();
      if (vStr.startsWith("#") || vStr.startsWith(".") || vStr.includes("[")) {
        params.selector = vStr;
      } else {
        params.id = vStr;
      }
      delete params.vortexId;
    }
  }

  // Fallback para chatgpt.com composer (Parte 4)
  if (vortexIdNum === undefined && domain.includes("chatgpt.com") && action === "type") {
    const composerLocators = [
      { selector: "#prompt-textarea" },
      { id: "prompt-textarea" },
      { ariaLabel: "Converse com o ChatGPT" },
      { ariaContains: "ChatGPT", role: "textbox" },
      { selector: "[contenteditable='true']" }
    ];

    for (const loc of composerLocators) {
      const res = (await resolveElement({
        tabId: String(tabId),
        ...loc,
        visibleOnly: "true",
        interactiveOnly: "true"
      } as any)) as any;

      if (res && res.success && res.element?.vortexId) {
        vortexIdNum = res.element.vortexId;
        break;
      }
    }
  }

  // Resolve locator if needed
  if (vortexIdNum === undefined && (params.selector || params.id || params.ariaLabel || params.ariaContains || params.textContains || params.role)) {
    const resolveResult = (await resolveElement({
      tabId: String(tabId),
      selector: params.selector ?? "",
      id: params.id ?? "",
      ariaLabel: params.ariaLabel ?? "",
      ariaContains: params.ariaContains ?? "",
      textContains: params.textContains ?? "",
      role: params.role ?? "",
      visibleOnly: "true",
      interactiveOnly: "true",
    })) as any;

    if (resolveResult?.success && resolveResult?.element?.vortexId !== undefined) {
      vortexIdNum = resolveResult.element.vortexId;
    } else {
      const isMultiple = resolveResult?.candidates && resolveResult.candidates.length > 1;
      const suggestedArgs = params.id ? { id: params.id } : params.selector ? { selector: params.selector } : { textContains: params.ariaLabel || params.ariaContains || params.textContains || "" };

      return {
        success: false,
        recoverable: true,
        reason: isMultiple ? "multiple_candidates_found" : "element_not_found",
        error: resolveResult?.reason || "Could not resolve element for interaction.",
        candidates: (resolveResult?.candidates || []).slice(0, 5).map((c: any) => ({
          vortexId: c.vortexId,
          tag: c.tag,
          id: c.id,
          ariaLabel: c.ariaLabel,
          text: c.text ? c.text.substring(0, 60) : undefined,
          role: c.role,
        })),
        suggestedNextTool: isMultiple ? "resolve_element" : "query_elements",
        suggestedArgs: isMultiple ? suggestedArgs : { query: params.id || params.selector || params.ariaLabel || params.textContains || "input" }
      };
    }
  }

  if (vortexIdNum === undefined) {
    return {
      success: false,
      recoverable: true,
      reason: "missing_vortex_id_and_locators",
      error: "Parameter vortexId must be a number or a valid locator (selector, id, ariaLabel, etc.) must be provided.",
      suggestedNextTool: "query_elements",
      suggestedArgs: { query: "input button" }
    };
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
    args: [vortexIdNum, action, value],
  });

  return result[0]?.result;
}

async function pressKey(params: Record<string, string>): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  const key = requireParam(params, "key");
  
  const parsed = parseKeyCombo(key);
  const argsObj = {
    key: parsed.key,
    code: parsed.code,
    ctrlKey: parsed.ctrlKey,
    altKey: parsed.altKey,
    shiftKey: parsed.shiftKey,
    metaKey: parsed.metaKey,
  };

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (eventData) => {
      const target = document.activeElement ?? document.body;
      const eventInit: KeyboardEventInit = {
        key: eventData.key,
        code: eventData.code,
        bubbles: true,
        cancelable: true,
        ctrlKey: eventData.ctrlKey,
        altKey: eventData.altKey,
        shiftKey: eventData.shiftKey,
        metaKey: eventData.metaKey,
      };

      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));

      return { ok: true, key: eventData.key, code: eventData.code };
    },
    args: [argsObj],
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
