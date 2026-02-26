/**
 * ModelHistoryTable — List of previously trained models.
 * Click to select, trash to delete.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Layers, Trash2 } from "lucide-react";
import type { TrainingState } from "./types";
import { getQualityColor } from "./types";

export default function ModelHistoryTable({ state }: { state: TrainingState }) {
  const { models, selectedModel, setSelectedModel, deleteModel } = state;

  return (
    <Card className="glass rounded-2xl gradient-border">
      <CardHeader className="border-b border-white/5 py-2 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
          title="All previously trained models. Each row shows the symbol, timeframe, number of regimes discovered, quality score, bars processed, and training time. Click a row to load that model's diagnostics. Delete old models to keep the list clean.">
          <Layers className="h-3 w-3 text-primary" /> Model History
          <span className="text-[10px] opacity-50 ml-auto font-normal">{models.length} models</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {models.length > 0 ? (
          <div className="overflow-auto max-h-[280px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Symbol</th>
                  <th className="text-right py-2 px-3 font-medium">TF</th>
                  <th className="text-right py-2 px-3 font-medium">Regimes</th>
                  <th className="text-right py-2 px-3 font-medium">Quality</th>
                  <th className="text-right py-2 px-3 font-medium">Bars</th>
                  <th className="text-right py-2 px-3 font-medium">Time</th>
                  <th className="text-right py-2 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {models
                  .sort((a, b) => new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime())
                  .map((model) => {
                    const isSelected = model.id === selectedModel;
                    return (
                      <tr
                        key={model.id}
                        className={`border-b border-white/5 cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10' : 'hover:bg-white/5'
                        }`}
                        onClick={() => setSelectedModel(model.id)}
                      >
                        <td className="py-2 px-3">
                          <span className="font-mono text-foreground">{model.symbol}</span>
                        </td>
                        <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                          {model.timeframe}
                        </td>
                        <td className="text-right py-2 px-3 font-mono text-orange-400 font-bold">
                          {model.n_regimes}
                        </td>
                        <td className="text-right py-2 px-3">
                          {model.quality_score !== undefined ? (
                            <span className={`font-mono font-bold ${getQualityColor(model.quality_score)}`}>
                              {model.quality_score.toFixed(0)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </td>
                        <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                          {model.n_bars_total ? `${(model.n_bars_total / 1000).toFixed(0)}K` : `${(model.n_bars / 1000).toFixed(0)}K`}
                        </td>
                        <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                          {model.training_time_sec.toFixed(0)}s
                        </td>
                        <td className="text-right py-2 px-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-rose-400"
                            onClick={(e) => { e.stopPropagation(); deleteModel(model.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs">No trained models yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
