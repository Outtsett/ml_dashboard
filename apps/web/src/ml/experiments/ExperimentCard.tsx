/**
 * ExperimentCard — one experiment as a scannable tile.
 *
 * Rank, model, headline cost-adjusted Sharpe, and a per-fold Sharpe sparkline.
 * The sparkline is the point: a headline of 2.1 built from folds of 3.9, 0.2,
 * and 2.2 is a different result from a flat 2.1, and the number alone cannot
 * tell you which you have.
 *
 * Hyperparameters expand on hover rather than being always-visible — a grid of
 * cards is for comparing headline numbers, and twelve hyperparameters per card
 * would bury them.
 */

import { useMemo } from "react";
import { AlertTriangle, Star } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import type { RankedExperiment } from "./ranking";

/** Sparkline over the fold series, scaled to its own range. */
function foldSparkline(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A dead-flat series has no range to scale by; draw it down the middle
  // rather than dividing by zero and producing NaN path commands.
  const span = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export interface ExperimentCardProps {
  entry: RankedExperiment;
  selected?: boolean;
  onToggle?: (id: string) => void;
}

export function ExperimentCard({ entry, selected = false, onToggle }: ExperimentCardProps) {
  const { experiment, rank, score, curve, isFragile, fragility } = entry;

  const path = useMemo(() => foldSparkline(curve, 120, 28), [curve]);
  const zeroY = useMemo(() => {
    if (curve.length < 2) return null;
    const min = Math.min(...curve);
    const max = Math.max(...curve);
    if (min > 0 || max < 0) return null; // zero is off-scale; no line to draw
    const span = max - min || 1;
    return 28 - ((0 - min) / span) * 28;
  }, [curve]);

  const hyperparams = Object.entries(experiment.hyperparameters);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onToggle?.(experiment.id)}
          aria-pressed={selected}
          className={`flex flex-col gap-2 p-3 rounded-lg text-left w-full transition motion-quick ${
            selected ? "stage-active" : "surface-interactive"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="metric-value tnum text-[10px] text-muted-foreground shrink-0">
                #{rank}
              </span>
              <span className="text-xs font-medium text-foreground truncate">
                {experiment.catalogId}
              </span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {experiment.summary?.isStarred && (
                <Star className="h-3 w-3 text-[hsl(var(--data-warn))]" aria-label="Starred" />
              )}
              {isFragile && (
                <AlertTriangle
                  className="h-3 w-3 text-[hsl(var(--data-warn))]"
                  aria-label="Fold-dependent result"
                />
              )}
            </span>
          </div>

          <div className="flex items-end justify-between gap-3">
            <span className="flex flex-col leading-tight">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                Sharpe, after costs
              </span>
              <span className="metric-value tnum text-lg text-foreground">
                {score.toFixed(2)}
              </span>
            </span>

            {path && (
              <svg width={120} height={28} aria-hidden="true" className="shrink-0">
                {zeroY !== null && (
                  <line
                    x1={0}
                    x2={120}
                    y1={zeroY}
                    y2={zeroY}
                    stroke="hsl(var(--data-neutral))"
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                )}
                <path
                  d={path}
                  fill="none"
                  stroke={isFragile ? DATA_COLORS.warn : DATA_COLORS.pos}
                  strokeWidth={1.5}
                />
              </svg>
            )}
          </div>

          <div className="flex items-center gap-3 text-[10px] font-mono tnum text-muted-foreground">
            <span>{curve.length} folds</span>
            {fragility !== null && <span>±{(fragility * 100).toFixed(0)}%</span>}
            {experiment.summary?.profitFactor != null && (
              <span>PF {experiment.summary.profitFactor.toFixed(2)}</span>
            )}
          </div>
        </button>
      </TooltipTrigger>

      <TooltipContent side="right" className="max-w-72">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">{experiment.catalogId}</span>
          {isFragile && (
            <span className="text-[10px] text-[hsl(var(--data-warn))]">
              Fold-dependent: dispersion is {((fragility ?? 0) * 100).toFixed(0)}% of the
              mean, so this headline rests on a minority of folds.
            </span>
          )}
          {hyperparams.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
              {hyperparams.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground truncate">{key}</dt>
                  <dd className="tnum text-foreground truncate">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              No hyperparameters recorded.
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
