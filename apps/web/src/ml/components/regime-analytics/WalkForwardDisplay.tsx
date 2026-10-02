/**
 * WalkForwardDisplay — Walk-forward stability results with stacked regime bars.
 */

import { Badge } from "@/shared/ui/badge";
import { getRegimeColor } from "./types";
import type { WalkForwardResult } from "./types";

export function WalkForwardDisplay({ wf }: { wf: WalkForwardResult }) {
  if (!wf || wf.n_windows === 0) return null;

  const stabilityColor = wf.stability_score >= 0.8 ? "#E69F00" : wf.stability_score >= 0.6 ? "#f59e0b" : "#0072B2";

  return (
    <div className="space-y-1.5">
      {/* Summary badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full"
          style={{ borderColor: stabilityColor, color: stabilityColor }}>
          Stability: {(wf.stability_score * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
          Confidence: {(wf.avg_oos_confidence * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
          Switch Rate: {(wf.avg_switch_rate * 100).toFixed(1)}%
        </Badge>
      </div>

      {/* Per-window regime distributions as stacked bars */}
      {wf.window_results.filter(w => !w.failed && w.regime_distribution).map(w => (
        <div key={w.window} className="space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-muted-foreground/50 font-mono w-6">W{w.window}</span>
            <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
              {w.regime_distribution!.map((pct, ri) => (
                <div key={ri}
                  style={{
                    width: `${pct * 100}%`,
                    backgroundColor: getRegimeColor(ri).hex,
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
            <span className="text-[7px] font-mono text-muted-foreground/50 w-8 text-right">
              {w.avg_confidence ? `${(w.avg_confidence * 100).toFixed(0)}%` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
