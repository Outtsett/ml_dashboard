/**
 * TerminalTabs — Multi-tab terminal manager (like Windows Terminal).
 *
 * Each tab is a separate PowerShell session backed by its own PTY on the server.
 * Sessions survive browser refreshes: reopening the page restores existing tabs.
 *
 * REST API:
 *   GET    /api/terminal/sessions       — list sessions
 *   POST   /api/terminal/sessions       — create session
 *   DELETE /api/terminal/sessions/:id   — kill session
 *   PATCH  /api/terminal/sessions/:id   — rename session
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, TerminalSquare, Flame } from "lucide-react";
import { EmbeddedTerminal } from "./EmbeddedTerminal";
import { TrainingLogTab } from "./TrainingLogTab";
import { useTrainingContext } from "@/contexts/TrainingContext";

// ── Types ────────────────────────────────────────────────────────────────────

interface TerminalSession {
  id: string;
  title: string;
}

interface TerminalTabsProps {
  /** If false, all terminals are hidden but sessions stay alive */
  visible?: boolean;
  /** Always show the training log tab (even when not actively training) */
  showTrainingTab?: boolean;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function fetchSessions(): Promise<TerminalSession[]> {
  const res = await fetch("/api/terminal/sessions");
  if (!res.ok) return [];
  return res.json();
}

async function createSessionOnServer(): Promise<TerminalSession | null> {
  const res = await fetch("/api/terminal/sessions", { method: "POST" });
  if (!res.ok) return null;
  return res.json();
}

async function deleteSessionOnServer(id: string): Promise<void> {
  await fetch(`/api/terminal/sessions/${id}`, { method: "DELETE" });
}

async function renameSessionOnServer(id: string, title: string): Promise<void> {
  await fetch(`/api/terminal/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function TerminalTabs({ visible = true, showTrainingTab }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<TerminalSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const training = useTrainingContext();
  const hasTrainingTab = !!showTrainingTab;

  // Auto-switch to training tab when training starts (only if tab is shown)
  useEffect(() => {
    if (showTrainingTab && training.isTraining) {
      setActiveTabId("__training__");
    }
  }, [showTrainingTab, training.isTraining]);

  // ── Init: load existing sessions or create the first one ───────────────────

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const existing = await fetchSessions();
      if (existing.length > 0) {
        setTabs(existing);
        setActiveTabId(existing[0]!.id);
      } else {
        const first = await createSessionOnServer();
        if (first) {
          setTabs([first]);
          setActiveTabId(first.id);
        }
      }
    })();
  }, []);

  // ── Tab actions ────────────────────────────────────────────────────────────

  const addTab = useCallback(async () => {
    const session = await createSessionOnServer();
    if (session) {
      setTabs((prev) => [...prev, session]);
      setActiveTabId(session.id);
    }
  }, []);

  const closeTab = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteSessionOnServer(id);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        // If we closed the active tab, switch to the last one — or create a new one
        if (id === activeTabId) {
          if (next.length > 0) {
            setActiveTabId(next[next.length - 1]!.id);
          } else {
            // No tabs left — create a fresh one
            createSessionOnServer().then((s) => {
              if (s) {
                setTabs([s]);
                setActiveTabId(s.id);
              }
            });
          }
        }
        return next;
      });
    },
    [activeTabId],
  );

  const startRename = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setEditingTabId(id);
    // Focus will happen in the next useEffect tick
  }, []);

  const commitRename = useCallback(
    (id: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (trimmed) {
        renameSessionOnServer(id, trimmed);
        setTabs((prev) =>
          prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
        );
      }
      setEditingTabId(null);
    },
    [],
  );

  // Auto-focus the rename input
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0a0a]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/[0.06] shrink-0 bg-[#0e0e0e] overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={(e) => startRename(tab.id, e)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono shrink-0 cursor-pointer border-none transition-colors duration-150
                ${isActive
                  ? "bg-[#0a0a0a] text-emerald-400 border-t-2 border-t-emerald-500/60 shadow-[inset_0_1px_8px_rgba(16,185,129,0.06)]"
                  : "bg-transparent text-muted-foreground/60 border-t-2 border-t-transparent hover:text-muted-foreground hover:bg-white/[0.03]"
                }`}
            >
              <TerminalSquare className="w-3 h-3" />

              {editingTabId === tab.id ? (
                <input
                  ref={editInputRef}
                  defaultValue={tab.title}
                  className="bg-transparent border-none border-b border-b-emerald-500/50 outline-none text-[11px] font-mono w-24 text-white"
                  onBlur={(e) => commitRename(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id, (e.target as HTMLInputElement).value);
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                />
              ) : (
                <span className="truncate max-w-[100px]">{tab.title}</span>
              )}

              {/* Close button */}
              <span
                onClick={(e) => closeTab(tab.id, e)}
                className={`ml-0.5 p-0.5 cursor-pointer rounded-sm transition-colors duration-100
                  ${isActive
                    ? "text-emerald-400/50 hover:text-emerald-300 hover:bg-emerald-500/10"
                    : "text-white/20 hover:text-white/50 hover:bg-white/[0.06]"
                  }`}
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          );
        })}

        {/* Training log tab (fixed, not closeable) */}
        {hasTrainingTab && (
          <button
            onClick={() => setActiveTabId("__training__")}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono shrink-0 cursor-pointer border-none transition-colors duration-150
              ${activeTabId === "__training__"
                ? "bg-[#0a0a0a] text-amber-400 border-t-2 border-t-amber-500/60 shadow-[inset_0_1px_8px_rgba(245,158,11,0.06)]"
                : "bg-transparent text-muted-foreground/60 border-t-2 border-t-transparent hover:text-muted-foreground hover:bg-white/[0.03]"
              }`}
          >
            <Flame className="w-3 h-3" />
            <span>Training</span>
            {training.isTraining && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
            )}
          </button>
        )}

        {/* Add tab button */}
        <button
          onClick={addTab}
          className="flex items-center justify-center px-2.5 py-2 cursor-pointer border-none bg-transparent text-muted-foreground/40 hover:text-emerald-400/70 hover:bg-white/[0.04] transition-colors duration-150 rounded-sm mx-0.5"
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Session counter badge */}
        <div className="ml-auto px-2.5 py-1 text-[9px] text-muted-foreground/30 font-mono flex items-center">
          <span className="bg-white/[0.04] rounded-full px-2 py-0.5 border border-white/[0.06]">{tabs.length}/10</span>
        </div>
      </div>

      {/* Terminals — direct flex children, hidden ones have display:none */}
      {tabs.map((tab) => (
        <EmbeddedTerminal
          key={tab.id}
          sessionId={tab.id}
          visible={tab.id === activeTabId}
        />
      ))}

      {/* Training log terminal (SSE-driven, read-only) */}
      {hasTrainingTab && (
        <TrainingLogTab visible={activeTabId === "__training__"} />
      )}
    </div>
  );
}
