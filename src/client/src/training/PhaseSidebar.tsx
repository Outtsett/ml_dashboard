import { cn } from "@/shared/utils/utils";
import { PHASES, type Phase, type PhaseStatus } from "@/training/lib/types";
import { Sparkles, Eye } from "lucide-react";
import { motion } from "framer-motion";

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
          "relative overflow-hidden w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
          activePhase === "overview"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
        )}
      >
        {activePhase === "overview" && (
          <motion.div
            layoutId="activePhase"
            className="absolute inset-0 bg-primary/10 border-l-2 border-primary"
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
          />
        )}
        <Eye className="h-4 w-4 shrink-0 relative" />
        <span className="text-xs font-medium relative">Overview</span>
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
              "relative overflow-hidden w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activePhase"
                className="absolute inset-0 bg-primary/10 border-l-2 border-primary"
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}
            <span
              className={cn(
                "text-xs font-mono font-bold w-5 text-center relative",
                PHASE_LETTER_COLORS[phase.id]
              )}
            >
              {phase.id}
            </span>
            <span className="text-xs font-medium truncate flex-1 relative">{phase.name}</span>
            <motion.div
              className={cn("w-1.5 h-1.5 rounded-full shrink-0 relative", STATUS_DOT[phaseStatuses[phase.id]])}
              {...(phaseStatuses[phase.id] === "completed" ? {
                initial: { scale: 0 },
                animate: { scale: [0, 1.5, 1] },
                transition: { duration: 0.4, ease: "easeOut" }
              } : {})}
            />
          </button>
        );
      })}

      <div className="mx-3 my-2 border-t border-border" />

      {/* HPO button */}
      <button
        onClick={() => onSelect("hpo")}
        className={cn(
          "relative overflow-hidden w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
          activePhase === "hpo"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
        )}
      >
        {activePhase === "hpo" && (
          <motion.div
            layoutId="activePhase"
            className="absolute inset-0 bg-primary/10 border-l-2 border-primary"
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
          />
        )}
        <Sparkles className="h-4 w-4 text-purple-400 shrink-0 relative" />
        <span className="text-xs font-medium relative">HPO Optimizer</span>
      </button>
    </aside>
  );
}
