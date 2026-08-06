import React from "react";
import {
  Brain,
  Dna,
  Dice5,
  Gauge,
  Orbit,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Label } from "@/shared/ui/label";
import type { OptimizerType } from "@shared/hpoTypes";
import { cn } from "@/shared/utils/utils";
import { fieldLabel } from "./OptimizerConfigFields";

export interface OptimizerMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

export const OPTIMIZER_META: Record<OptimizerType, OptimizerMeta> = {
  optuna: {
    label: "Optuna",
    description: "Tree-structured Parzen Estimator with pruning",
    icon: Brain,
    color: "text-violet-400",
  },
  bayesian: {
    label: "Bayesian",
    description: "Gaussian Process surrogate model",
    icon: Gauge,
    color: "text-sky-400",
  },
  pso: {
    label: "PSO",
    description: "Particle swarm optimization",
    icon: Orbit,
    color: "text-amber-400",
  },
  montecarlo: {
    label: "Monte Carlo",
    description: "Random/quasi-random sampling",
    icon: Dice5,
    color: "text-emerald-400",
  },
  evolutionary: {
    label: "Evolutionary",
    description: "Genetic & evolution strategies",
    icon: Dna,
    color: "text-rose-400",
  },
  bohb: {
    label: "BOHB",
    description: "Bayesian optimization + early stopping",
    icon: Sparkles,
    color: "text-orange-400",
  },
};

interface OptimizerSelectorProps {
  optimizerType: OptimizerType;
  onOptimizerTypeChange: (type: OptimizerType) => void;
  disabled?: boolean;
}

export function OptimizerSelector({
  optimizerType,
  onOptimizerTypeChange,
  disabled,
}: OptimizerSelectorProps) {
  return (
    <div className="space-y-1">
      <Label className={fieldLabel}>Optimizer Engine</Label>
      <Select
        value={optimizerType}
        onValueChange={(v) => onOptimizerTypeChange(v as OptimizerType)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 rounded-lg bg-white/5 border-white/10 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10">
          {(Object.entries(OPTIMIZER_META) as [OptimizerType, OptimizerMeta][]).map(
            ([key, m]) => {
              const Icon = m.icon;
              return (
                <SelectItem key={key} value={key} className="text-xs py-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", m.color)} />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{m.label}</span>
                      <span className="text-[9px] text-muted-foreground/50">
                        {m.description}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            },
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
