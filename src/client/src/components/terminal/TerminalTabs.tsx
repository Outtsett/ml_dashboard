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
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, background: '#111', overflowX: 'auto' }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={(e) => startRename(tab.id, e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                borderRight: '1px solid rgba(255,255,255,0.05)',
                flexShrink: 0,
                cursor: 'pointer',
                border: 'none',
                background: isActive ? '#0a0a0a' : 'transparent',
                color: isActive ? '#34d399' : '#888',
                borderBottom: isActive ? '2px solid rgba(16,185,129,0.5)' : '2px solid transparent',
              }}
            >
              <TerminalSquare style={{ width: 12, height: 12 }} />

              {editingTabId === tab.id ? (
                <input
                  ref={editInputRef}
                  defaultValue={tab.title}
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(16,185,129,0.5)', outline: 'none', fontSize: '11px', fontFamily: 'monospace', width: '96px', color: '#fff' }}
                  onBlur={(e) => commitRename(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id, (e.target as HTMLInputElement).value);
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                />
              ) : (
                <span>{tab.title}</span>
              )}

              {/* Close button */}
              <span
                onClick={(e) => closeTab(tab.id, e)}
                style={{
                  marginLeft: '4px',
                  padding: '2px',
                  cursor: 'pointer',
                  color: isActive ? 'rgba(52,211,153,0.6)' : 'rgba(255,255,255,0.3)',
                  borderRadius: '3px',
                }}
              >
                <X style={{ width: 12, height: 12 }} />
              </span>
            </button>
          );
        })}

        {/* Training log tab (fixed, not closeable) */}
        {hasTrainingTab && (
          <button
            onClick={() => setActiveTabId("__training__")}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 12px', fontSize: '11px', fontFamily: 'monospace',
              borderRight: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
              cursor: 'pointer', border: 'none',
              background: activeTabId === "__training__" ? '#0a0a0a' : 'transparent',
              color: activeTabId === "__training__" ? '#f59e0b' : '#888',
              borderBottom: activeTabId === "__training__" ? '2px solid rgba(245,158,11,0.5)' : '2px solid transparent',
            }}
          >
            <Flame style={{ width: 12, height: 12 }} />
            <span>Training</span>
            {training.isTraining && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            )}
          </button>
        )}

        {/* Add tab button */}
        <button
          onClick={addTab}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 10px', cursor: 'pointer', border: 'none', background: 'transparent', color: '#888' }}
          title="New terminal"
        >
          <Plus style={{ width: 14, height: 14 }} />
        </button>

        <div style={{ marginLeft: 'auto', padding: '0 8px', fontSize: '9px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          {tabs.length}/10
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
