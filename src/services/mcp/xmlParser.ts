import type { ToolCall } from "./types";

export function parseXmlCommands(aiOutput: string): ToolCall[] {
  const matches: ToolCall[] = [];
  const consumedRanges: Array<[number, number]> = [];
  
  // 1. First parse self-closing tags
  const selfClosingRegex = /<(tool_call|tool_calls|tool|function_call)\b([^>]*?)\/>/gi;
  let match: RegExpExecArray | null;
  
  while ((match = selfClosingRegex.exec(aiOutput)) !== null) {
    const start = match.index;
    const end = selfClosingRegex.lastIndex;
    consumedRanges.push([start, end]);
    
    const name = extractAttribute(match[2], "name");
    if (name) {
      matches.push({ name, params: {} });
    }
  }

  // 2. Parse paired/open tags (allows mismatched closures)
  const openTagRegex = /<(tool_call|tool_calls|tool|function_call)\b([^>]*?)>/gi;
  while ((match = openTagRegex.exec(aiOutput)) !== null) {
    const start = match.index;
    const openTagEnd = openTagRegex.lastIndex;
    
    const isInsideConsumed = consumedRanges.some(([rStart, rEnd]) => start >= rStart && start < rEnd);
    if (isInsideConsumed) continue;

    const attributesStr = match[2];
    const name = extractAttribute(attributesStr, "name");
    if (!name) continue;

    // Search for any of the valid closing tags
    const closeTagRegex = /<\/(tool_call|tool_calls|tool|function_call)>/gi;
    closeTagRegex.lastIndex = openTagEnd;
    const closeMatch = closeTagRegex.exec(aiOutput);
    
    let content: string;
    let end: number;
    if (closeMatch) {
      content = aiOutput.substring(openTagEnd, closeMatch.index);
      end = closeMatch.index + closeMatch[0].length;
    } else {
      // Fallback: take content until next open tag or end of string if closure is missing
      const nextOpenMatch = /<(tool_call|tool_calls|tool|function_call)\b/i.exec(aiOutput.substring(openTagEnd));
      if (nextOpenMatch) {
        content = aiOutput.substring(openTagEnd, openTagEnd + nextOpenMatch.index);
        end = openTagEnd + nextOpenMatch.index;
      } else {
        content = aiOutput.substring(openTagEnd);
        end = aiOutput.length;
      }
    }

    consumedRanges.push([start, end]);

    // Parse parameters
    const params: Record<string, string> = {};
    const paramRegex = /<param\b([^>]*)>([\s\S]*?)<\/param>/gi;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(content)) !== null) {
      const paramName = extractAttribute(paramMatch[1], "name");
      if (paramName) {
        params[paramName] = decodeXmlText(unwrapCdata(paramMatch[2]).trim());
      }
    }

    matches.push({ name, params });
  }

  return matches;
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
