/**
 * TerminalTabs â€” Multi-tab terminal manager (like Windows Terminal).
 *
 * Each tab is a separate PowerShell session backed by its own PTY on the server.
 * Sessions survive browser refreshes: reopening the page restores existing tabs.
 *
 * REST API:
 *   GET    /api/terminal/sessions       â€” list sessions
 *   POST   /api/terminal/sessions       â€” create session
 *   DELETE /api/terminal/sessions/:id   â€” kill session
 *   PATCH  /api/terminal/sessions/:id   â€” rename session
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, TerminalSquare, Flame, ChevronDown, LayoutGrid, Maximize2, Monitor, Minimize2, Sparkles } from "lucide-react";
import { EmbeddedTerminal } from './EmbeddedTerminal';
import { motion, AnimatePresence } from 'framer-motion';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { TrainingLogTab } from "./TrainingLogTab";
import { useTrainingContext } from "@/training/lib/TrainingContext";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchSessions(): Promise<TerminalSession[]> {
  const res = await fetch("/api/terminal/sessions");
  if (!res.ok) return [];
  return res.json();
}

async function createSessionOnServer(shell?: string): Promise<TerminalSession | null> {
  const res = await fetch("/api/terminal/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shell }) });
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

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function TerminalTabs({ visible = true, showTrainingTab }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<TerminalSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [isGridLayout, setIsGridLayout] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const training = useTrainingContext();
  const hasTrainingTab = !!showTrainingTab;

  // Escape to exit Zen Mode
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isZenMode) setIsZenMode(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isZenMode]);


    // Auto-switch to training tab when training starts (only if tab is shown)
  useEffect(() => {
    if (showTrainingTab && training.isTraining) {
      setActiveTabId("__training__");
    }
  }, [showTrainingTab, training.isTraining]);

  // â”€â”€ Init: load existing sessions or create the first one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Tab actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const addTab = useCallback(async (shell?: string) => {
    const session = await createSessionOnServer(shell);
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
        // If we closed the active tab, switch to the last one â€” or create a new one
        if (id === activeTabId) {
          if (next.length > 0) {
            setActiveTabId(next[next.length - 1]!.id);
          } else {
            // No tabs left â€” create a fresh one
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

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (!visible) return null;

  return (
    <div className={`h-full w-full flex flex-col transition-all duration-500 ${isZenMode ? "fixed inset-0 z-50 p-0 m-0" : "relative"}`}>
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/[0.06] shrink-0 bg-black/20 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={(e) => startRename(tab.id, e)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono shrink-0 cursor-pointer border-none transition-colors duration-150
                ${isActive
                  ? "bg-[#0a0a0a] text-[hsl(var(--data-pos))] border-t-2 border-t-emerald-500/60 shadow-[inset_0_1px_8px_rgba(16,185,129,0.06)]"
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
                    ? "text-[hsl(var(--data-pos)/0.5)] hover:text-[color-mix(in_srgb,hsl(var(--data-pos))_80%,white)] hover:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)]"
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
              <span className="w-1.5 h-1.5 rounded-full bg-[color-mix(in_srgb,hsl(var(--data-pos))_88%,black)] animate-pulse shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
            )}
          </button>
        )}

                                {/* Zen Mode Toggle */}
        <button
          onClick={() => setIsZenMode(!isZenMode)}
          className={`flex items-center justify-center px-2.5 py-2 cursor-pointer border-none transition-all duration-300 rounded-sm mx-0.5 ${isZenMode ? "text-amber-400 bg-amber-500/10 scale-110" : "bg-transparent text-muted-foreground/40 hover:text-amber-400/70 hover:bg-white/[0.04]"}`}
          title={isZenMode ? "Exit Zen Mode (Esc)" : "Enter Zen Mode (Immersive)"}
        >
          {isZenMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
        </button>

        {/* Layout Toggle */}
        <button
          onClick={() => setIsGridLayout(!isGridLayout)}
          className={`flex items-center justify-center px-2.5 py-2 cursor-pointer border-none transition-all duration-300 rounded-sm mx-0.5 ${isGridLayout ? "text-[hsl(var(--data-pos))] bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)]" : "bg-transparent text-muted-foreground/40 hover:text-[hsl(var(--data-pos)/0.7)] hover:bg-white/[0.04]"}`}
          title={isGridLayout ? "Switch to Tab View" : "Switch to Grid View"}
        >
          {isGridLayout ? <Sparkles className="w-3.5 h-3.5 animate-pulse" /> : <LayoutGrid className="w-3.5 h-3.5" />}
        </button>
        {/* Add tab button with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-center px-2 py-2 cursor-pointer border-none bg-transparent text-muted-foreground/40 hover:text-[hsl(var(--data-pos)/0.7)] hover:bg-white/[0.04] transition-colors duration-150 rounded-sm mx-0.5"
              title="New terminal"
            >
              <Plus className="w-3.5 h-3.5" />
              <ChevronDown className="w-2.5 h-2.5 ml-0.5 opacity-30" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-[#1a1a1a] border-white/[0.08] text-white">
            <DropdownMenuItem onClick={() => addTab("powershell.exe")} className="text-[11px] font-mono hover:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] focus:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] cursor-pointer">
              <TerminalSquare className="w-3 h-3 mr-2 text-[hsl(var(--data-pos))]" />
              PowerShell
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addTab("cmd.exe")} className="text-[11px] font-mono hover:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] focus:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] cursor-pointer">
              <TerminalSquare className="w-3 h-3 mr-2 text-blue-400" />
              Command Prompt
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addTab("node")} className="text-[11px] font-mono hover:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] focus:bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] cursor-pointer">
              <TerminalSquare className="w-3 h-3 mr-2 text-yellow-400" />
              Node.js REPL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Session counter badge */}
        <div className="ml-auto px-2.5 py-1 text-[9px] text-muted-foreground/30 font-mono flex items-center">
          <span className="bg-white/[0.04] rounded-full px-2 py-0.5 border border-white/[0.06]">{tabs.length}/10</span>
        </div>
      </div>

                  {/* Terminals Container */}
      <div className={`flex-1 min-h-0 w-full overflow-hidden ${isGridLayout ? "p-3" : ""}`}>
        <motion.div 
          layout
          className={`h-full w-full ${isGridLayout ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" : "relative"}`}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isVisible = isGridLayout || isActive;
              if (!isVisible) return null;
              
              return (
                <motion.div 
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className={`relative flex flex-col min-h-0 transition-shadow duration-300 ${
                    isGridLayout 
                      ? "border border-white/[0.08] rounded-xl bg-black/60 backdrop-blur-xl overflow-hidden shadow-lg" 
                      : "absolute inset-0 z-10"
                  } ${isActive && isGridLayout ? "ring-2 ring-primary/40 shadow-[0_0_20px_rgba(var(--primary),0.15)]" : ""}`}
                >
                  {isGridLayout && (
                    <div className="flex items-center justify-between px-3 py-2 bg-white/[0.04] border-b border-white/[0.08] shrink-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[color-mix(in_srgb,hsl(var(--data-pos))_88%,black)] animate-pulse" : "bg-white/20"}`} />
                        <span className={`text-[10px] font-mono font-bold tracking-tight ${isActive ? "text-[hsl(var(--data-pos))]" : "text-muted-foreground/60"}`}>
                          {tab.title.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => { setActiveTabId(tab.id); setIsGridLayout(false); }}
                          className="p-1 hover:bg-white/[0.08] rounded transition-colors text-muted-foreground/40 hover:text-white"
                          title="Focus"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={(e) => closeTab(tab.id, e)}
                          className="p-1 hover:bg-[color-mix(in_srgb,hsl(var(--data-neg)/0.2)_88%,black)] rounded transition-colors text-muted-foreground/40 hover:text-[hsl(var(--data-neg))]"
                          title="Kill Session"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                  <EmbeddedTerminal
                    sessionId={tab.id}
                    visible={true}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Training log terminal (SSE-driven, read-only) */}
      {hasTrainingTab && (
        <TrainingLogTab visible={activeTabId === "__training__"} />
      )}
    </div>
  );
}




