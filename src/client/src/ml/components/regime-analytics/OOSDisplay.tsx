/**
 * OOSDisplay — Out-of-sample assessment with distribution comparison.
 */

import { getRegimeColor } from "./types";
import type { OOSResult } from "./types";

export function OOSDisplay({ oos, n_regimes: _n_regimes }: { oos: OOSResult; n_regimes: number }) {
  return (
    <div className="space-y-1.5">
      {/* Distribution comparison: train vs test side by side */}
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-muted-foreground/50 w-8">Train</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
            {oos.train_distribution.map((pct, ri) => (
              <div key={ri}
                style={{ width: `${pct * 100}%`, backgroundColor: getRegimeColor(ri).hex, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-muted-foreground/50 w-8">Test</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
            {oos.test_distribution.map((pct, ri) => (
              <div key={ri}
                style={{ width: `${pct * 100}%`, backgroundColor: getRegimeColor(ri).hex, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Metric badges */}
      <div className="grid grid-cols-2 gap-1">
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Dist. Similarity</span>
          <span className={`text-[10px] font-mono font-medium ${
            oos.distribution_similarity >= 0.8 ? "text-emerald-400" : oos.distribution_similarity >= 0.6 ? "text-amber-400" : "text-rose-400"
          }`}>
            {(oos.distribution_similarity * 100).toFixed(0)}%
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Profile Corr.</span>
          <span className={`text-[10px] font-mono font-medium ${
            oos.avg_profile_correlation >= 0.8 ? "text-emerald-400" : oos.avg_profile_correlation >= 0.5 ? "text-amber-400" : "text-rose-400"
          }`}>
            {oos.avg_profile_correlation.toFixed(3)}
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Test Confidence</span>
          <span className="text-[10px] font-mono font-medium text-foreground/80">
            {(oos.avg_test_confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Switch Ratio</span>
          <span className={`text-[10px] font-mono font-medium ${
            Math.abs(oos.switch_rate_ratio - 1) < 0.3 ? "text-emerald-400" : "text-amber-400"
          }`}>
            {oos.switch_rate_ratio.toFixed(2)}x
          </span>
        </div>
      </div>
    </div>
  );
}
