/**
 * ChatTab — LLM chat interface for the bottom panel.
 *
 * Streams responses from local Ollama instance.
 * Context-aware: passes current symbol, model, and training state to the LLM.
 */

import { useRef, useEffect } from 'react';
import { Bot, Trash2, ChevronDown, WifiOff } from 'lucide-react';
import { useChat } from '@/contexts/ChatContext';
import { ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatTab() {
  const {
    messages,
    isStreaming,
    error,
    selectedModel,
    availableModels,
    ollamaHealthy,
    sendMessage,
    stopStreaming,
    clearHistory,
    setModel,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is near bottom
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom || isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] bg-black/10 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-medium text-foreground/70">Ollama Chat</span>

          {/* Ollama status indicator */}
          <div className={`w-1.5 h-1.5 rounded-full ${ollamaHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />

          {/* Model selector */}
          {availableModels.length > 0 && (
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => setModel(e.target.value)}
                disabled={isStreaming}
                className="appearance-none bg-white/[0.05] border border-white/[0.08] rounded px-2 py-0.5 pr-5 text-[10px] font-mono text-muted-foreground cursor-pointer hover:bg-white/[0.08] focus:outline-none disabled:opacity-50 transition-colors"
              >
                {availableModels.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.parameter_size})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-2.5 h-2.5 absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              disabled={isStreaming}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.05] disabled:opacity-30 transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-3">
            {!ollamaHealthy ? (
              <>
                <WifiOff className="w-8 h-8" />
                <div className="text-center">
                  <p className="text-sm font-medium">Ollama not connected</p>
                  <p className="text-xs mt-1">Run <code className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] font-mono">ollama serve</code> to start</p>
                </div>
              </>
            ) : (
              <>
                <Bot className="w-8 h-8" />
                <div className="text-center">
                  <p className="text-sm font-medium">Local LLM Assistant</p>
                  <p className="text-xs mt-1">Ask about markets, models, features, or strategies</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="py-2">
            {messages.map(msg => (
              <ChatMessageComponent key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-500/10 border-t border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={!ollamaHealthy}
      />
    </div>
  );
}
