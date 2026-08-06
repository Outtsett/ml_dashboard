/**
 * TransitionMatrix — Heatmap showing regime-to-regime transition probabilities.
 *
 * Green diagonal = self-transition (regime persists).
 * Cyan off-diagonal = switches to another regime.
 * Hover any cell for exact probability.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";

export function TransitionMatrix({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (!matrix || matrix.length === 0) return null;

  const n = matrix.length;
  const cellSize = Math.max(32, Math.min(44, Math.floor(400 / n)));

  return (
    <TooltipProvider delayDuration={100}>
      <div className="overflow-x-auto">
        <div className="inline-flex gap-0">
          {/* Row labels column */}
          <div className="flex flex-col shrink-0" style={{ paddingTop: cellSize + 4 }}>
            {labels.map((l, i) => (
              <div key={i} className="flex items-center justify-end pr-2"
                style={{ height: cellSize }}>
                <span className="text-[9px] text-muted-foreground truncate max-w-[90px] text-right" title={l}>
                  {l.length > 14 ? l.slice(0, 13) + "\u2026" : l}
                </span>
              </div>
            ))}
          </div>

          <div>
            {/* Column labels row */}
            <div className="flex" style={{ height: cellSize }}>
              {labels.map((l, j) => (
                <div key={j} className="flex items-end justify-center pb-1"
                  style={{ width: cellSize }}>
                  <span className="text-[9px] text-muted-foreground" title={l}>
                    {j}
                  </span>
                </div>
              ))}
            </div>

            {/* Matrix cells */}
            {matrix.map((row, i) => (
              <div key={i} className="flex">
                {row.map((val, j) => {
                  const opacity = Math.max(0.04, val);
                  const isSelf = i === j;
                  return (
                    <Tooltip key={j}>
                      <TooltipTrigger asChild>
                        <div
                          className={`border border-white/5 rounded-sm cursor-default flex items-center justify-center ${isSelf ? "ring-1 ring-white/10" : ""}`}
                          style={{
                            width: cellSize,
                            height: cellSize,
                            backgroundColor: isSelf
                              ? `rgba(16, 185, 129, ${opacity})`
                              : `rgba(6, 182, 212, ${opacity})`,
                          }}
                        >
                          {val > 0.08 && (
                            <span className={`font-mono text-white/80 ${cellSize >= 38 ? "text-[10px]" : "text-[8px]"}`}>
                              {(val * 100).toFixed(0)}
                            </span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px]">
                        <span className="font-mono">{labels[i]} → {labels[j]}: {(val * 100).toFixed(1)}%</span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
