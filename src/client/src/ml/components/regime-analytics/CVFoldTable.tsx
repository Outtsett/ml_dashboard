/**
 * CVFoldTable — Cross-validation fold results table for RegimeAnalytics.
 */

import type { CVResult } from "./types";

export function CVFoldTable({ cv }: { cv: CVResult }) {
  if (!cv || cv.all_failed) return <p className="text-[8px] text-[hsl(var(--data-neg))]">All CV folds failed</p>;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-4 gap-1 text-[7px] text-muted-foreground/50 font-mono px-1">
        <span>Fold</span>
        <span>Train LL/s</span>
        <span>Val LL/s</span>
        <span>Bars</span>
      </div>
      {cv.fold_results.map(f => (
        <div key={f.fold}
          className={`grid grid-cols-4 gap-1 text-[8px] font-mono px-1 py-0.5 rounded ${
            f.failed ? "text-[hsl(var(--data-neg)/0.5)]" : "text-foreground/80"
          }`}
        >
          <span>F{f.fold}</span>
          <span>{f.failed ? "--" : f.train_ll_per_sample?.toFixed(3)}</span>
          <span className={!f.failed && f.val_ll_per_sample != null ? (
            f.val_ll_per_sample > (f.train_ll_per_sample ?? 0) * 0.95 ? "text-[hsl(var(--data-pos))]" : "text-amber-400"
          ) : ""}>
            {f.failed ? "--" : f.val_ll_per_sample?.toFixed(3)}
          </span>
          <span className="text-muted-foreground/60">
            {f.failed ? "--" : `${(f.train_size / 1000).toFixed(1)}k/${(f.val_size / 1000).toFixed(1)}k`}
          </span>
        </div>
      ))}
      {cv.gap != null && (
        <div className="flex items-center justify-between px-1 pt-1 border-t border-white/5">
          <span className="text-[8px] text-muted-foreground">Overfit Gap</span>
          <span className={`text-[9px] font-mono font-medium ${
            Math.abs(cv.gap) < 0.1 ? "text-[hsl(var(--data-pos))]" : Math.abs(cv.gap) < 0.5 ? "text-amber-400" : "text-[hsl(var(--data-neg))]"
          }`}>
            {cv.gap.toFixed(4)}
          </span>
        </div>
      )}
    </div>
  );
}
