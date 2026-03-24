import { cn } from "@/lib/utils";
import { PHASES, type Phase, type PhaseStatus } from "./types";
import { Sparkles, Eye } from "lucide-react";

interface PhaseSidebarProps {
  activePhase: Phase | "overview" | "hpo";
  phaseStatuses: Record<Phase, PhaseStatus>;
  onSelect: (phase: Phase | "overview" | "hpo") => void;
}

const PHASE_LETTER_COLORS: Record<Phase, string> = {
  A: "text-blue-400",
  B: "text-violet-400",
  C: "text-amber-400",
  D: "text-emerald-400",
  E: "text-rose-400",
};

const STATUS_DOT: Record<PhaseStatus, string> = {
  idle: "bg-neutral-500",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

export function PhaseSidebar({ activePhase, phaseStatuses, onSelect }: PhaseSidebarProps) {
  return (
    <aside className="w-56 shrink-0 h-full bg-card/50 border-r border-border flex flex-col py-2">
      {/* Overview button */}
      <button
        onClick={() => onSelect("overview")}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
          activePhase === "overview"
            ? "bg-primary/10 text-foreground border-l-2 border-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
        )}
      >
        <Eye className="h-4 w-4 shrink-0" />
        <span className="text-xs font-medium">Overview</span>
      </button>

      <div className="mx-3 my-2 border-t border-border" />

      {/* Phase buttons A–E */}
      {PHASES.map((phase) => {
        const isActive = activePhase === phase.id;
        return (
          <button
            key={phase.id}
            onClick={() => onSelect(phase.id)}
            title={phase.description}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
              isActive
                ? "bg-primary/10 text-foreground border-l-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
            )}
          >
            <span
              className={cn(
                "text-xs font-mono font-bold w-5 text-center",
                PHASE_LETTER_COLORS[phase.id]
              )}
            >
              {phase.id}
            </span>
            <span className="text-xs font-medium truncate flex-1">{phase.name}</span>
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                STATUS_DOT[phaseStatuses[phase.id]]
              )}
            />
          </button>
        );
      })}

      <div className="mx-3 my-2 border-t border-border" />

      {/* HPO button */}
      <button
        onClick={() => onSelect("hpo")}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
          activePhase === "hpo"
            ? "bg-primary/10 text-foreground border-l-2 border-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
        )}
      >
        <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
        <span className="text-xs font-medium">HPO Optimizer</span>
      </button>
    </aside>
  );
}
