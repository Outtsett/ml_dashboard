/**
 * Claude Code inside the dashboard — a drawer on every page (top-bar button,
 * Ctrl+Shift+K). Each conversation is a real Claude Code session in this
 * repository, run by the Claude host sidecar with Tyler's own settings, hooks
 * and CLAUDE.md files; every tool call is shown and approved here. Sessions
 * started in the terminal appear in the picker and can be continued.
 *
 * Every message carries the page it was sent from (route, symbol, timeframe),
 * and Claude can move this page with its `open_dashboard_page` tool.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bot, Loader2, Plus, Send, Square, X } from "lucide-react";
import type { ClaudePermissionMode, DashboardContext } from "@shared/claude/types";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { minutesToApiKey, TIMEFRAME_OPTIONS } from "@/market/lib/timeframes";
import { ClaudeTranscript } from "./ClaudeTranscript";
import { useClaudePanel } from "./panelStore";
import { createSession, useClaudeSession, useClaudeSessions } from "./useClaudeSession";

const MODES: { value: ClaudePermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Ask", hint: "Ask before each tool call Claude Code would ask about" },
  { value: "acceptEdits", label: "Accept edits", hint: "File edits go through; everything else still asks" },
  { value: "plan", label: "Plan", hint: "Read-only: Claude plans, then asks to proceed" },
  { value: "auto", label: "Auto", hint: "Claude Code's auto mode" },
];

const MODELS = [
  { value: "", label: "Default model" },
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const STATUS_TONE: Record<string, string> = {
  idle: "text-neutral-400",
  starting: "text-[#56B4E9]",
  running: "text-[#56B4E9]",
  waiting: "text-[#E69F00]",
  error: "text-[#D55E00]",
};

export function ClaudePanel() {
  const { open, width, activeKey, toggle, setOpen, setWidth, setActiveKey } = useClaudePanel();
  const [location, navigate] = useLocation();
  const { symbol, timeframeMinutes, setSymbol, setTimeframeMinutes } = useSymbolContext();
  const sessions = useClaudeSessions(open);
  const session = useClaudeSession(open ? activeKey : null);
  const [draft, setDraft] = useState("");
  const [attachContext, setAttachContext] = useState(true);
  const [mode, setMode] = useState<ClaudePermissionMode>("default");
  const [model, setModel] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const handled = useRef(0);

  // Ctrl+Shift+K opens and closes the panel from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Claude's open_dashboard_page: move this page.
  useEffect(() => {
    const pending = session.view.navigations.slice(handled.current);
    handled.current = session.view.navigations.length;
    for (const target of pending) {
      if (target.symbol) setSymbol(target.symbol.toUpperCase());
      if (target.timeframe) {
        const option = TIMEFRAME_OPTIONS.find((t) => t.apiKey === target.timeframe || t.label === target.timeframe);
        if (option) setTimeframeMinutes(option.minutes);
      }
      navigate(target.route);
    }
  }, [session.view.navigations, navigate, setSymbol, setTimeframeMinutes]);

  useEffect(() => {
    handled.current = 0;
  }, [activeKey]);

  // A new conversation's key changes from new-<uuid> to its session id once
  // Claude Code answers; follow it so a reload reopens the same conversation.
  useEffect(() => {
    if (session.view.sessionId && activeKey?.startsWith("new-")) setActiveKey(session.view.sessionId);
  }, [session.view.sessionId, activeKey, setActiveKey]);

  if (!open) return null;

  const context: DashboardContext = {
    route: location,
    symbol,
    timeframe: minutesToApiKey(timeframeMinutes),
    ...(typeof window !== "undefined" && window.location.search ? { selection: window.location.search } : {}),
  };
  const busy = session.view.status === "running" || session.view.status === "starting" || session.view.status === "waiting";

  const startNew = async () => {
    const created = await createSession();
    setActiveKey(created.key);
    void sessions.refetch();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      let key = activeKey;
      if (!key) {
        key = (await createSession()).key;
        setActiveKey(key);
      }
      // Mode and model go to THIS key directly: a conversation created a line
      // above is not the hook's key until the next render, and a pick made
      // before it existed would otherwise be dropped.
      await fetch(`/api/claude/sessions/${encodeURIComponent(key)}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionMode: mode, model }),
      });
      await fetch(`/api/claude/sessions/${encodeURIComponent(key)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: attachContext ? context : undefined }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}`);
      });
      setDraft("");
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const onMove = (move: PointerEvent) => setWidth(window.innerWidth - move.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside
      className="fixed right-0 top-0 z-50 flex h-full flex-col border-l border-neutral-800 bg-neutral-950/97 shadow-2xl backdrop-blur"
      style={{ width }}
      aria-label="Claude Code"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onPointerDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-[#56B4E9]/30"
      />
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <Bot className="h-4 w-4 text-[#E69F00]" />
        <span className="text-sm font-semibold text-neutral-100">Claude Code</span>
        <span className={`text-[11px] ${STATUS_TONE[session.view.status] ?? ""}`}>
          {session.view.status}
          {session.view.status === "waiting" && session.view.statusDetail ? ` · ${session.view.statusDetail}` : ""}
        </span>
        <button type="button" onClick={() => void startNew()} className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100" title="New conversation">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100" title="Close (Ctrl+Shift+K)">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-800 px-3 py-1.5 text-[11px]">
        <select
          value={(sessions.data ?? []).some((s) => s.key === activeKey) ? (activeKey ?? "") : ""}
          onChange={(e) => setActiveKey(e.target.value || null)}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-neutral-200"
          title="Conversations in this repository (terminal sessions too)"
        >
          <option value="">— pick a conversation —</option>
          {(sessions.data ?? []).map((s) => (
            <option key={s.key} value={s.key}>
              {s.active ? "● " : ""}
              {s.title.slice(0, 70)} · {new Date(s.lastModified).toLocaleString()}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => { const next = e.target.value as ClaudePermissionMode; setMode(next); void session.settings({ permissionMode: next }); }} className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-neutral-200" title={MODES.find((m) => m.value === mode)?.hint}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => { setModel(e.target.value); void session.settings({ model: e.target.value }); }} className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-neutral-200">
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sessions.error && <div className="text-xs text-[#D55E00]">Claude host: {(sessions.error as Error).message}</div>}
        {session.error && <div className="text-xs text-[#D55E00]">{session.error}</div>}
        {!activeKey ? (
          <div className="space-y-2 pt-6 text-center text-xs text-neutral-500">
            <p>Ask anything about this repository, the lake or the page you are on.</p>
            <p>Each message is sent with where you are ({location}, {symbol} {minutesToApiKey(timeframeMinutes)}).</p>
          </div>
        ) : (
          <ClaudeTranscript view={session.view} onAnswer={(requestId, decision) => void session.answer(requestId, decision)} />
        )}
      </div>

      <footer className="border-t border-neutral-800 px-3 py-2 space-y-1.5">
        <label className="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <input type="checkbox" checked={attachContext} onChange={(e) => setAttachContext(e.target.checked)} />
          send page context: {location} · {symbol} {minutesToApiKey(timeframeMinutes)}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="Message Claude Code (Enter to send, Shift+Enter for a new line)"
            className="min-h-[3.5rem] flex-1 resize-y rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-[#56B4E9]/60 focus:outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => void session.interrupt()} className="rounded border border-[#D55E00]/60 p-2 text-[#D55E00] hover:bg-[#D55E00]/10" title="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" disabled={sending || !draft.trim()} onClick={() => void send()} className="rounded border border-[#56B4E9]/60 p-2 text-[#56B4E9] hover:bg-[#56B4E9]/10 disabled:opacity-40" title="Send">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          )}
        </div>
        {sendError && <div className="text-[11px] text-[#D55E00]">{sendError}</div>}
        {session.view.model && (
          <div
            className="truncate text-[10px] font-mono text-neutral-600"
            title={session.view.mcpServers.map((s) => `${s.name}: ${s.status}`).join("\n")}
          >
            {session.view.model} · {session.view.tools.length} tools · {session.view.mcpServers.filter((s) => s.status === "connected").length}/
            {session.view.mcpServers.length} MCP servers connected
            {session.view.mcpServers.some((s) => s.name === "dashboard" && s.status === "connected") ? " · dashboard tools on" : ""}
          </div>
        )}
      </footer>
    </aside>
  );
}
