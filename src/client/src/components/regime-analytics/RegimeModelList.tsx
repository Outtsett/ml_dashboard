/**
 * RegimeModelList — Trained model cards with quality scores.
 *
 * Think of it as: a shelf of trained "market mood detectors" — each card shows
 * what symbol/timeframe it was trained on, how many mood-states it found, and
 * a quality ring showing how reliable it is.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import type { RegimeModel } from "./types";
import { QualityScoreRing } from "./mini-charts";

interface RegimeModelListProps {
  models: RegimeModel[];
  selectedModel: string | null;
  onSelectModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
}

export function RegimeModelList({ models, selectedModel, onSelectModel, onDeleteModel }: RegimeModelListProps) {
  if (models.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
        Trained Models ({models.length})
      </p>
      {models.map(m => (
        <div
          key={m.id}
          className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
            selectedModel === m.id
              ? "bg-orange-500/15 border border-orange-500/25"
              : "bg-white/5 border border-transparent hover:bg-white/8"
          }`}
          onClick={() => onSelectModel(m.id)}
        >
          {/* Quality score mini ring */}
          {m.quality_score != null && (
            <QualityScoreRing score={m.quality_score} />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-medium text-foreground">{m.symbol}</span>
              <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full">{m.timeframe}</Badge>
              <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-orange-500/30 text-orange-400">
                {m.n_regimes} regimes
              </Badge>
            </div>
            <p className="text-[8px] text-muted-foreground/60 font-mono">
              {(m.n_bars_total || m.n_bars || 0).toLocaleString()} bars
              {m.n_bars_train_val ? ` (${m.n_bars_train_val.toLocaleString()} train)` : ""}
              {" · "}{m.training_time_sec.toFixed(0)}s
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-rose-400"
            onClick={(e) => { e.stopPropagation(); onDeleteModel(m.id); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
