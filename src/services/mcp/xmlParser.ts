import type { ToolCall } from "./types";

export function parseXmlCommands(aiOutput: string): ToolCall[] {
  const matches: Array<{ index: number; call: ToolCall }> = [];
  const selfClosingToolRegex = /<tool_call\b([^>]*)\/>/gi;
  const toolBlockRegex = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>/gi;
  const consumedRanges: Array<[number, number]> = [];
  let toolMatch: RegExpExecArray | null;

  while ((toolMatch = toolBlockRegex.exec(aiOutput)) !== null) {
    consumedRanges.push([toolMatch.index, toolMatch.index + toolMatch[0].length]);
    const name = extractAttribute(toolMatch[1], "name");

    if (!name) {
      continue;
    }

    const params: Record<string, string> = {};
    const paramRegex = /<param\b([^>]*)>([\s\S]*?)<\/param>/gi;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(toolMatch[2])) !== null) {
      const paramName = extractAttribute(paramMatch[1], "name");

      if (paramName) {
        params[paramName] = decodeXmlText(unwrapCdata(paramMatch[2]).trim());
      }
    }

    matches.push({ index: toolMatch.index, call: { name, params } });
  }

  while ((toolMatch = selfClosingToolRegex.exec(aiOutput)) !== null) {
    const start = toolMatch.index;
    const end = start + toolMatch[0].length;
    const isInsidePairedBlock = consumedRanges.some(
      ([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd,
    );

    if (isInsidePairedBlock) {
      continue;
    }

    const name = extractAttribute(toolMatch[1], "name");

    if (name) {
      matches.push({ index: start, call: { name, params: {} } });
    }
  }

  return matches.sort((a, b) => a.index - b.index).map((match) => match.call);
}

function extractAttribute(source: string, name: string): string | null {
  const quotedPattern = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, "i");
  const quotedMatch = quotedPattern.exec(source);

  if (quotedMatch) {
    return decodeXmlText(quotedMatch[2]);
  }

  const unquotedPattern = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i");
  const unquotedMatch = unquotedPattern.exec(source);

  return unquotedMatch ? decodeXmlText(unquotedMatch[1]) : null;
}

function unwrapCdata(value: string): string {
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value.trim());

  return match ? match[1] : value;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
