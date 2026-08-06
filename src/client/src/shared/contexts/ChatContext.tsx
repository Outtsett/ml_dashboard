/**
 * ChatContext — manages LLM chat state and streaming.
 *
 * Uses fetch + ReadableStream to consume SSE tokens from /api/chat/completions.
 * Provides messages, streaming state, model selection, and send/clear actions.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useSymbolContext } from './SymbolContext';
import { useActiveModelContext } from './ActiveModelContext';

// ── Types ──────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface OllamaModelInfo {
  name: string;
  parameter_size: string;
  quantization_level: string;
  family: string;
}

export interface ChatContextType {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  selectedModel: string;
  availableModels: OllamaModelInfo[];
  ollamaHealthy: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearHistory: () => void;
  setModel: (model: string) => void;
}

// ── Context ────────────────────────────────────────────────

const ChatContext = createContext<ChatContextType | null>(null);

// ── Provider ───────────────────────────────────────────────

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { symbol, assetType, timeframeMinutes } = useSymbolContext();
  const { activeModelName, isTraining } = useActiveModelContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<OllamaModelInfo[]>([]);
  const [ollamaHealthy, setOllamaHealthy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Fetch available models on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/chat/models');
        if (res.ok) {
          const data = await res.json();
          setAvailableModels(data.models);
          setSelectedModel(data.default || data.models[0]?.name || '');
          setOllamaHealthy(true);
        } else {
          setOllamaHealthy(false);
        }
      } catch {
        setOllamaHealthy(false);
      }
    })();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Build messages payload (all conversation history)
      const allMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages,
          model: selectedModel,
          context: {
            symbol,
            assetType,
            timeframeMinutes,
            activeModel: activeModelName,
            isTraining,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

      // Consume SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventName) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventName === 'token' && data.content) {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant' && last.streaming) {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + data.content,
                    };
                  }
                  return updated;
                });
              } else if (eventName === 'done') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, streaming: false };
                  }
                  return updated;
                });
              } else if (eventName === 'error') {
                setError(data.error || 'Unknown error');
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant' && last.streaming) {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content || 'Error: ' + (data.error || 'Unknown error'),
                      streaming: false,
                    };
                  }
                  return updated;
                });
              }
            } catch {
              // Skip malformed JSON
            }
            eventName = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errorMsg = (err as Error).message || 'Failed to send message';
        setError(errorMsg);
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content: last.content || 'Error: ' + errorMsg,
              streaming: false,
            };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, selectedModel, symbol, assetType, timeframeMinutes, activeModelName, isTraining]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        updated[updated.length - 1] = { ...last, streaming: false };
      }
      return updated;
    });
    setIsStreaming(false);
  }, []);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const setModel = useCallback((model: string) => {
    setSelectedModel(model);
  }, []);

  const value = useMemo(() => ({
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
  }), [messages, isStreaming, error, selectedModel, availableModels, ollamaHealthy, sendMessage, stopStreaming, clearHistory, setModel]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────

export function useChat(): ChatContextType {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
