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

    return (
      <p key={index} className="whitespace-pre-wrap break-words [word-break:break-word] overflow-wrap-break-word">
        {part}
      </p>
    );
  });
}
