/**
 * ChatMessage — renders a single chat message with role-based styling.
 *
 * Assistant messages support basic markdown: code blocks, inline code, bold, lists.
 */

import { memo } from 'react';
import { User, Bot } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@/shared/contexts/ChatContext';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** Minimal markdown renderer for assistant responses. */
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // Close code block
        nodes.push(
          <pre key={key++} className="bg-black/40 border border-white/10 rounded-md p-3 my-2 overflow-x-auto text-[12px] font-mono leading-relaxed">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        // Open code block
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Empty line → spacer
    if (!line.trim()) {
      nodes.push(<div key={key++} className="h-2" />);
      continue;
    }

    // Inline formatting
    const formatted = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-[11px] font-mono">$1</code>')
      .replace(/^[-*]\s+/, '<span class="text-primary mr-1">-</span>');

    nodes.push(
      <p
        key={key++}
        className="leading-relaxed"
        dangerouslySetInnerHTML={{ __html: formatted }}
      />
    );
  }

  // Unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    nodes.push(
      <pre key={key++} className="bg-black/40 border border-white/10 rounded-md p-3 my-2 overflow-x-auto text-[12px] font-mono leading-relaxed">
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  return nodes;
}

export const ChatMessageComponent = memo(function ChatMessageComponent({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 px-3 py-2 ${isUser ? '' : 'bg-white/[0.02]'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
        isUser
          ? 'bg-primary/15 border border-primary/25'
          : 'bg-[hsl(var(--data-pos)/0.15)] border border-[hsl(var(--data-pos)/0.25)]'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-primary" />
          : <Bot className="w-3.5 h-3.5 text-[hsl(var(--data-pos))]" />
        }
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-sm text-foreground/90">
        {isUser ? (
          <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="space-y-1">
            {message.content ? (
              renderMarkdown(message.content)
            ) : message.streaming ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <span className="w-1.5 h-1.5 bg-[hsl(var(--data-pos))] rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-[hsl(var(--data-pos))] rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-[hsl(var(--data-pos))] rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
              </span>
            ) : null}
            {message.streaming && message.content && (
              <span className="inline-block w-1.5 h-4 bg-[hsl(var(--data-pos)/0.6)] animate-pulse ml-0.5" />
            )}
          </div>
        )}
      </div>
    </div>
  );
});
