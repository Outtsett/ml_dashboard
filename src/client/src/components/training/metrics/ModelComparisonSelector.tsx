/**
 * ModelComparisonSelector — Toggle trained models on/off for side-by-side metric comparison.
 *
 * Think of it as: a bank of light switches. Each model gets a switch.
 * Flip one on → its metrics appear. Flip another → compare side by side.
 *
 * SRP: Selection state only. No metric rendering.
 */

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Layers, Clock } from "lucide-react";
import type { RegimeModel } from "@/components/training/types";
import { getQualityColor } from "@/components/training/types";

interface ModelComparisonSelectorProps {
  models: RegimeModel[];
  /** Set of currently toggled-on model IDs */
  selectedIds: Set<string>;
  /** Toggle a model on/off */
  onToggle: (id: string) => void;
  /** Max models that can be selected at once */
  maxSelections?: number;
}

export default function ModelComparisonSelector({
  models, selectedIds, onToggle, maxSelections = 4,
}: ModelComparisonSelectorProps) {
  const sorted = [...models].sort((a, b) =>
    new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
  );

  const atLimit = selectedIds.size >= maxSelections;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
          Compare Models
        </span>
        <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 border-white/10 text-muted-foreground/40">
          {selectedIds.size}/{maxSelections}
        </Badge>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground/40 text-xs">
          <Layers className="h-6 w-6 mx-auto mb-2 opacity-20" />
          No trained models to compare
        </div>
      ) : (
        <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
          {sorted.map((model) => {
            const isOn = selectedIds.has(model.id);
            const disabled = !isOn && atLimit;
            const qScore = model.quality_score ?? 0;
            const qColor = getQualityColor(qScore);
            const date = new Date(model.trained_at);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

            return (
              <button
                key={model.id}
                onClick={() => !disabled && onToggle(model.id)}
                disabled={disabled}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg
                  transition-all text-left
                  ${isOn
                    ? 'bg-primary/10 border border-primary/20'
                    : disabled
                      ? 'bg-white/1 border border-white/5 opacity-40 cursor-not-allowed'
                      : 'bg-white/2 border border-white/5 hover:bg-white/4 hover:border-white/10'
                  }
                `}
              >
                <Switch
                  checked={isOn}
                  onCheckedChange={() => !disabled && onToggle(model.id)}
                  disabled={disabled}
                  className="data-[state=checked]:bg-primary scale-75"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium truncate">
                      {model.symbol}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{model.timeframe}</span>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 font-mono font-bold border-0 ${qColor}`}>
                      {qScore > 0 ? qScore.toFixed(0) : '--'}
                    </Badge>
                    <span className="text-[9px] text-orange-400/60 font-mono">{model.n_regimes}R</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="h-2.5 w-2.5 text-muted-foreground/30" />
                    <span className="text-[9px] text-muted-foreground/40 font-mono">{dateStr}</span>
                    <span className="text-[9px] text-muted-foreground/30">{model.modelType}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
