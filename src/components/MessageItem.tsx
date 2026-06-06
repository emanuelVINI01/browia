import type { Message } from "../services/storageService";
import { motion } from "framer-motion";
import { useI18n } from "../i18n";

interface MessageItemProps {
  message: Message;
}

export function MessageItem({ message }: MessageItemProps) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const textContent = cleanVisibleContent(message.content);

  if (!textContent) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`flex w-full flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
    >
      <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--theme-muted)]">
        {isUser ? t.message_role_user : t.message_role_agent}
      </span>

      <div
        className={`max-w-[85%] rounded-xl border px-4 py-3 text-sm leading-relaxed transition-all break-words overflow-hidden ${
          isUser
            ? "rounded-tr-none border-[rgba(214,168,79,0.3)] bg-[rgba(214,168,79,0.08)] text-[var(--theme-text)] shadow-[0_4px_16px_rgba(214,168,79,0.05)]"
            : "theme-card rounded-tl-none"
        }`}
      >
        {renderMessageContent(textContent)}
      </div>

      <span className={`px-1 text-[9px] text-[var(--theme-muted)] ${isUser ? "mr-1" : "ml-1"}`}>
        {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    </motion.div>
  );
}

function cleanVisibleContent(content: string): string {
  return content
    .replace(/<tool_call\b[^>]*\/>/gi, "")
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_response\b[^>]*>[\s\S]*?<\/tool_response>/gi, "")
    .replace(/<execution_plan\b[^>]*>[\s\S]*?<\/execution_plan>/gi, "")
    .trim();
}

function renderMessageContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const match = /^```(\w*)\n?([\s\S]*?)```$/.exec(part);
      const language = match ? match[1] : "";
      const code = match ? match[2] : part.slice(3, -3);

      return (
        <div key={index} className="my-2 max-w-full overflow-hidden">
          {language && (
            <span className="block text-[9px] font-bold text-[var(--theme-muted)] uppercase tracking-wider mb-1">
              {language}
            </span>
          )}
          <pre className="text-xs font-mono bg-black/40 p-3 rounded-lg border border-[rgba(214,168,79,0.1)] overflow-x-auto whitespace-pre max-w-full">
            <code>{code.trim()}</code>
          </pre>
        </div>
      );
    }

    const trimmed = part.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return (
          <div key={index} className="my-2 max-w-full overflow-hidden">
            <pre className="text-xs font-mono bg-black/40 p-3 rounded-lg border border-[rgba(214,168,79,0.1)] overflow-x-auto whitespace-pre max-w-full">
              <code>{JSON.stringify(parsed, null, 2)}</code>
            </pre>
          </div>
        );
      } catch {
        // Fallback to text
      }
    }

    if (!part.trim()) return null;

    return <div key={index}>{renderFormattedText(part)}</div>;
  });
}

function parseInline(text: string): React.ReactNode {
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 mx-0.5 rounded bg-black/40 border border-[rgba(214,168,79,0.15)] font-mono text-xs text-[var(--theme-primary-light)]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (
          (part.startsWith("**") && part.endsWith("**")) ||
          (part.startsWith("__") && part.endsWith("__"))
        ) {
          return (
            <strong key={i} className="font-extrabold text-[var(--theme-primary-light)]">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (
          (part.startsWith("*") && part.endsWith("*")) ||
          (part.startsWith("_") && part.endsWith("_"))
        ) {
          return (
            <em key={i} className="italic text-[rgba(255,255,255,0.9)]">
              {part.slice(1, -1)}
            </em>
          );
        }
        if (part.startsWith("[") && part.includes("](")) {
          const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
          if (match) {
            const label = match[1];
            const url = match[2];
            const href = url.startsWith("http") ? url : `https://${url}`;
            return (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--theme-primary)] hover:underline font-medium break-all"
              >
                {label}
              </a>
            );
          }
        }
        return part;
      })}
    </>
  );
}

function renderFormattedText(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];
  let currentListType: "ul" | "ol" | null = null;

  const flushList = (key: string | number) => {
    if (currentListItems.length > 0) {
      if (currentListType === "ul") {
        elements.push(
          <ul key={`list-${key}`} className="list-disc pl-5 my-2 flex flex-col gap-1 text-sm">
            {currentListItems}
          </ul>
        );
      } else if (currentListType === "ol") {
        elements.push(
          <ol key={`list-${key}`} className="list-decimal pl-5 my-2 flex flex-col gap-1 text-sm">
            {currentListItems}
          </ol>
        );
      }
      currentListItems = [];
      currentListType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    const h3Match = /^###\s+(.*)$/.exec(trimmedLine);
    const h2Match = /^##\s+(.*)$/.exec(trimmedLine);
    const h1Match = /^#\s+(.*)$/.exec(trimmedLine);

    const ulMatch = /^[*-]\s+(.*)$/.exec(trimmedLine);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmedLine);

    if (h3Match) {
      flushList(i);
      elements.push(
        <h4 key={`h3-${i}`} className="text-sm font-bold text-[var(--theme-primary-light)] mt-3 mb-1">
          {parseInline(h3Match[1])}
        </h4>
      );
    } else if (h2Match) {
      flushList(i);
      elements.push(
        <h3 key={`h2-${i}`} className="text-base font-bold text-[var(--theme-primary-light)] mt-4 mb-1.5">
          {parseInline(h2Match[1])}
        </h3>
      );
    } else if (h1Match) {
      flushList(i);
      elements.push(
        <h2 key={`h1-${i}`} className="text-lg font-extrabold text-[var(--theme-primary-light)] mt-5 mb-2">
          {parseInline(h1Match[1])}
        </h2>
      );
    } else if (ulMatch) {
      if (currentListType !== "ul") {
        flushList(i);
        currentListType = "ul";
      }
      currentListItems.push(
        <li key={`li-${i}`} className="leading-relaxed">
          {parseInline(ulMatch[1])}
        </li>
      );
    } else if (olMatch) {
      if (currentListType !== "ol") {
        flushList(i);
        currentListType = "ol";
      }
      currentListItems.push(
        <li key={`li-${i}`} className="leading-relaxed">
          {parseInline(olMatch[1])}
        </li>
      );
    } else {
      flushList(i);
      if (trimmedLine) {
        elements.push(
          <p key={`p-${i}`} className="my-1.5 leading-relaxed break-words [word-break:break-word] overflow-wrap-break-word">
            {parseInline(line)}
          </p>
        );
      } else {
        elements.push(<div key={`spacer-${i}`} className="h-1" />);
      }
    }
  }

  flushList(lines.length);
  return elements;
}
