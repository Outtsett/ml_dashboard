/**
 * TransitionMatrix — Heatmap showing regime-to-regime transition probabilities.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function TransitionMatrix({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (!matrix || matrix.length === 0) return null;

  const n = matrix.length;
  const cellSize = Math.min(28, Math.floor(200 / n));

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex gap-1">
        {/* Row labels */}
        <div className="flex flex-col" style={{ paddingTop: cellSize + 2 }}>
          {labels.map((l, i) => (
            <div key={i} className="flex items-center justify-end pr-1"
              style={{ height: cellSize, minWidth: 16 }}>
              <span className="text-[7px] text-muted-foreground truncate max-w-[50px]" title={l}>
                {i}
              </span>
            </div>
          ))}
        </div>

        <div>
          {/* Column labels */}
          <div className="flex" style={{ height: cellSize }}>
            {labels.map((l, j) => (
              <div key={j} className="flex items-end justify-center"
                style={{ width: cellSize }}>
                <span className="text-[7px] text-muted-foreground">{j}</span>
              </div>
            ))}
          </div>

          {/* Matrix cells */}
          {matrix.map((row, i) => (
            <div key={i} className="flex">
              {row.map((val, j) => {
                const opacity = Math.max(0.05, val);
                const isSelf = i === j;
                return (
                  <Tooltip key={j}>
                    <TooltipTrigger asChild>
                      <div
                        className="border border-white/5 rounded-sm cursor-default"
                        style={{
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: isSelf
                            ? `rgba(16, 185, 129, ${opacity})`
                            : `rgba(6, 182, 212, ${opacity})`,
                        }}
                      >
                        {val > 0.15 && (
                          <span className="text-[7px] font-mono text-white/70 flex items-center justify-center h-full">
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
    </TooltipProvider>
  );
}
