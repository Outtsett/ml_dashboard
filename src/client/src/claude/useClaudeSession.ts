/**
 * One Claude Code conversation in the panel: its history, the live event
 * stream, and the actions Tyler can take — send, answer a permission request,
 * interrupt, change mode or model. Events are reduced into a transcript the
 * panel renders.
 *
 * Every (re)connect loads the history first and only then opens the stream
 * after the last event it held. A reconnect cannot just resume from the last
 * `seq` it saw: when the host restarts, the session is rebuilt with its
 * counter back at 0, and every new event (a permission request included)
 * would sit below that stale mark and be dropped.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClaudeAssistantBlock,
  ClaudePanelEvent,
  ClaudePermissionDecision,
  ClaudePermissionMode,
  ClaudePermissionSuggestion,
  ClaudeSessionStatus,
  ClaudeSessionSummary,
  DashboardContext,
} from "@shared/claude/types";

export type TranscriptItem =
  | { kind: "user"; key: string; text: string; context?: DashboardContext }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | {
      kind: "permission";
      key: string;
      requestId: string;
      toolName: string;
      input: unknown;
      title?: string;
      description?: string;
      decisionReason?: string;
      canAlways: boolean;
      suggestions?: ClaudePermissionSuggestion[];
      resolved?: "allow" | "deny" | "always";
    }
  | { kind: "result"; key: string; costUsd: number; durationMs: number; numTurns: number; isError: boolean; subtype: string }
  | { kind: "error"; key: string; message: string };

export interface SessionView {
  items: TranscriptItem[];
  draftText: string;
  draftThinking: string;
  status: ClaudeSessionStatus;
  statusDetail?: string;
  sessionId: string | null;
  model?: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  lastSeq: number;
  navigations: Extract<ClaudePanelEvent, { type: "navigate" }>[];
}

export const EMPTY_VIEW: SessionView = {
  items: [],
  draftText: "",
  draftThinking: "",
  status: "idle",
  sessionId: null,
  tools: [],
  mcpServers: [],
  lastSeq: 0,
  navigations: [],
};

function blockItems(messageId: string, blocks: ClaudeAssistantBlock[]): TranscriptItem[] {
  return blocks.map((block, index) =>
    block.type === "tool_use"
      ? { kind: "tool", key: `${messageId}:${index}`, id: block.id, name: block.name, input: block.input }
      : { kind: block.type, key: `${messageId}:${index}`, text: block.text },
  );
}

/** Pure: fold one event into the view. Exported for tests. */
export function reduce(view: SessionView, event: ClaudePanelEvent): SessionView {
  if (event.seq <= view.lastSeq) return view;
  const next: SessionView = { ...view, lastSeq: event.seq };
  switch (event.type) {
    case "init":
      return { ...next, sessionId: event.sessionId, model: event.model, tools: event.tools, mcpServers: event.mcpServers };
    case "status":
      return { ...next, status: event.status, statusDetail: event.detail };
    case "user":
      return { ...next, items: [...view.items, { kind: "user", key: `u${event.seq}`, text: event.text, context: event.context }] };
    case "text_delta":
      return { ...next, draftText: view.draftText + event.text };
    case "thinking_delta":
      return { ...next, draftThinking: view.draftThinking + event.text };
    case "assistant":
      return { ...next, draftText: "", draftThinking: "", items: [...view.items, ...blockItems(event.messageId, event.blocks)] };
    case "tool_result":
      return {
        ...next,
        items: view.items.map((item) =>
          item.kind === "tool" && item.id === event.toolUseId ? { ...item, result: event.content, isError: event.isError } : item,
        ),
      };
    case "permission_request":
      return {
        ...next,
        items: [
          ...view.items,
          {
            kind: "permission",
            key: `p${event.requestId}`,
            requestId: event.requestId,
            toolName: event.toolName,
            input: event.input,
            title: event.title,
            description: event.description,
            decisionReason: event.decisionReason,
            canAlways: event.canAlways,
            suggestions: event.suggestions,
          },
        ],
      };
    case "permission_resolved":
      return {
        ...next,
        items: view.items.map((item) => (item.kind === "permission" && item.requestId === event.requestId ? { ...item, resolved: event.decision } : item)),
      };
    case "result":
      return {
        ...next,
        draftText: "",
        draftThinking: "",
        items: [
          ...view.items,
          { kind: "result", key: `r${event.seq}`, costUsd: event.costUsd, durationMs: event.durationMs, numTurns: event.numTurns, isError: event.isError, subtype: event.subtype },
        ],
      };
    case "navigate":
      return { ...next, navigations: [...view.navigations, event] };
    case "error":
      return { ...next, items: [...view.items, { kind: "error", key: `e${event.seq}`, message: event.message }] };
    default:
      return next;
  }
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; detail?: string };
  if (!response.ok) throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  return data;
}

export function useClaudeSessions(enabled: boolean) {
  return useQuery({
    queryKey: ["/api/claude/sessions"],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/claude/sessions", { signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { sessions: ClaudeSessionSummary[] }).sessions;
    },
    refetchInterval: enabled ? 15_000 : false,
  });
}

export async function createSession(): Promise<ClaudeSessionSummary> {
  return post<ClaudeSessionSummary>("/api/claude/sessions");
}

export function useClaudeSession(key: string | null) {
  const [view, setView] = useState<SessionView>(EMPTY_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const queryClient = useQueryClient();

  useEffect(() => {
    setView(EMPTY_VIEW);
    setError(null);
    if (!key) return;
    let cancelled = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      source = new EventSource(`/api/claude/sessions/${encodeURIComponent(key)}/stream?after=${viewRef.current.lastSeq}`);
      source.onopen = () => setConnected(true);
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = setTimeout(load, 2000);
      };
      const handler = (message: MessageEvent) => {
        try {
          const event = JSON.parse(message.data) as ClaudePanelEvent;
          setView((prev) => reduce(prev, event));
          if (event.type === "init" || event.type === "result") void queryClient.invalidateQueries({ queryKey: ["/api/claude/sessions"] });
        } catch (parseError) {
          console.warn("[claude] bad event", parseError);
        }
      };
      for (const type of [
        "init", "status", "user", "text_delta", "thinking_delta", "assistant", "tool_result",
        "permission_request", "permission_resolved", "result", "navigate", "error",
      ]) source.addEventListener(type, handler as EventListener);
    };

    const load = () => fetch(`/api/claude/sessions/${encodeURIComponent(key)}/history`)
      .then(async (response) => {
        if (!response.ok) throw Object.assign(new Error(`history: HTTP ${response.status}`), { status: response.status });
        const body = (await response.json()) as {
          transcript: ClaudePanelEvent[];
          events: ClaudePanelEvent[];
          session: ClaudeSessionSummary;
        };
        if (cancelled) return;
        // The on-disk transcript has its own numbering; fold it first, then
        // the host's live events by their real `seq`, and resume the stream
        // after the last of those so nothing renders twice.
        let restored = EMPTY_VIEW;
        for (const event of body.transcript) restored = reduce(restored, event);
        restored = { ...restored, lastSeq: 0 };
        for (const event of body.events) restored = reduce(restored, event);
        const next = { ...restored, status: body.session.status, sessionId: body.session.sessionId ?? restored.sessionId };
        viewRef.current = next;
        setView(next);
        setError(null);
        open();
      })
      .catch((historyError: Error & { status?: number }) => {
        if (cancelled) return;
        setError(historyError.message);
        // The host may be restarting: keep trying, unless it says the
        // conversation does not exist.
        if (historyError.status !== 404) retry = setTimeout(load, 5000);
      });
    void load();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [key, queryClient]);

  const base = key ? `/api/claude/sessions/${encodeURIComponent(key)}` : null;
  return {
    view,
    error,
    connected,
    send: (text: string, context?: DashboardContext) => (base ? post(`${base}/messages`, { text, context }) : Promise.reject(new Error("no session"))),
    answer: (requestId: string, decision: ClaudePermissionDecision) => (base ? post(`${base}/permissions/${requestId}`, decision) : Promise.resolve()),
    interrupt: () => (base ? post(`${base}/interrupt`) : Promise.resolve()),
    settings: (next: { permissionMode?: ClaudePermissionMode; model?: string }) => (base ? post(`${base}/settings`, next) : Promise.resolve()),
  };
}
