import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { SlidersHorizontal, Sparkles, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrainingMode = "manual" | "hpo";

export interface TrainingModeSelectorProps {
  mode: TrainingMode;
  onModeChange: (mode: TrainingMode) => void;
  disabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------

interface ModeConfig {
  key: TrainingMode;
  icon: LucideIcon;
  label: string;
  badge: string;
  description: string;
  note?: string;
}

const MODES: ModeConfig[] = [
  {
    key: "manual",
    icon: SlidersHorizontal,
    label: "Manual",
    badge: "Single Run",
    description:
      "Configure each hyperparameter manually and run a single training session",
  },
  {
    key: "hpo",
    icon: Sparkles,
    label: "HPO Sweep",
    badge: "Optimization",
    description:
      "Define search spaces and let an optimizer find the best hyperparameters",
    note: "6 optimizers available",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrainingModeSelector({
  mode,
  onModeChange,
  disabled = false,
  className,
}: TrainingModeSelectorProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-3 gap-3",
        className,
      )}
    >
      {MODES.map((m) => {
        const selected = mode === m.key;
        const Icon = m.icon;

        return (
          <button
            key={m.key}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(m.key)}
            className={cn(
              "relative rounded-lg bg-white/5 border p-4 text-left transition-all duration-200",
              "hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              selected
                ? "border-primary shadow-[0_0_12px_-4px] shadow-primary/25"
                : "border-white/10",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            {/* Header row: icon + label … badge */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span
                  className={cn(
                    "font-semibold text-sm leading-none transition-colors",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {m.label}
                </span>
              </div>

              <Badge
                variant={selected ? "default" : "secondary"}
                className="text-[10px] px-1.5 py-0 shrink-0"
              >
                {m.badge}
              </Badge>
            </div>

            {/* Description */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {m.description}
            </p>

            {/* Optional note */}
            {m.note && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                      <Info className="h-3 w-3" />
                      {m.note}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {m.note}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </button>
        );
      })}
    </div>
  );
}
