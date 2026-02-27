/**
 * OverviewPanel — Summary of all regime model metrics at a glance.
 */

import { Flame } from "lucide-react";
import { Sparkline, QualityScoreRing } from "../MicroComponents";
import type { RegimeModel, Diagnostics, ConvergencePoint } from "../types";
import { getQualityLabel, getQualityVerdict,
  getRegimeVerdict, getStabilityVerdict, getOosVerdict, getFitVerdict,
} from "../types";

export function OverviewPanel({ diagnostics, model, llPerBar, convergencePoints }: {
  diagnostics: Diagnostics; model: RegimeModel; llPerBar: number; convergencePoints: ConvergencePoint[];
}) {
  const stability = diagnostics.walk_forward?.stability_score ?? 0;
  const oosSim = diagnostics.out_of_sample?.distribution_similarity ?? 0;
  const quality = diagnostics.quality_score ?? 0;
  const profileCorr = diagnostics.out_of_sample?.avg_profile_correlation ?? 0;
  const switchRatio = diagnostics.out_of_sample?.switch_rate_ratio ?? 0;
  const timeSec = diagnostics.training_time_sec ?? 0;
  const timeStr = timeSec >= 60 ? `${Math.floor(timeSec / 60)}m ${Math.round(timeSec % 60)}s` : `${timeSec.toFixed(0)}s`;

  const metrics = [
    { label: "Regimes",     value: `${diagnostics.n_regimes}`,                   color: "text-orange-400",  verdict: getRegimeVerdict(diagnostics.n_regimes) },
    { label: "Walk-Forward",value: stability > 0 ? `${(stability * 100).toFixed(0)}%` : "--", color: "text-emerald-400", verdict: getStabilityVerdict(stability) },
    { label: "Quality",     value: quality > 0 ? `${quality.toFixed(0)}/100` : "--", color: "text-amber-400", verdict: getQualityVerdict(quality) },
    { label: "OOS Match",   value: oosSim > 0 ? `${(oosSim * 100).toFixed(0)}%` : "--", color: "text-cyan-400", verdict: getOosVerdict(oosSim) },
    { label: "Model Fit",   value: llPerBar !== 0 ? `${llPerBar.toFixed(2)}/bar` : "--", color: "text-violet-400", verdict: getFitVerdict(llPerBar) },
  ];

  return (
    <div className="space-y-4">
      {/* Model info bar */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground/60 flex-wrap">
        <span className="font-mono text-foreground/80">{model.symbol} @ {model.timeframe}</span>
        <span>{diagnostics.n_bars_total?.toLocaleString()} bars</span>
        <span>{diagnostics.n_features} features</span>
        <span>{diagnostics.training_config?.gibbs_iter} iterations</span>
        <span className="flex items-center gap-1"><Flame className="h-3 w-3" />{timeStr}</span>
        <span className="text-[9px]">{diagnostics.date_range?.start} {'\u2192'} {diagnostics.date_range?.end}</span>
      </div>

      {/* Quality ring + metrics grid */}
      <div className="flex items-start gap-6">
        {/* Quality ring */}
        <div className="flex flex-col items-center shrink-0">
          {quality > 0 ? (
            <>
              <QualityScoreRing score={quality} size={96} />
              <span className={`text-[10px] font-medium mt-2 px-2.5 py-1 rounded-full ${
                quality >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                quality >= 60 ? 'bg-amber-500/15 text-amber-400' :
                'bg-orange-500/15 text-orange-400'
              }`}>
                {getQualityLabel(quality)}
              </span>
            </>
          ) : (
            <div className="w-24 h-24 rounded-full border-2 border-white/5 flex items-center justify-center">
              <span className="text-3xl font-bold font-mono text-muted-foreground/20">{'\u2014'}</span>
            </div>
          )}
        </div>

        {/* Metric cards in a row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 flex-1">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white/5 rounded-xl p-3 border border-white/8">
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">{m.label}</div>
              <div className={`text-xl font-bold font-mono ${m.color}`}>{m.value}</div>
              <p className={`text-[10px] mt-1 ${m.verdict.color}`}>{m.verdict.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mini convergence sparkline */}
      {convergencePoints.length > 2 && (
        <div className="bg-white/5 rounded-xl p-3 border border-white/8">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Trend</div>
          <Sparkline data={convergencePoints.map(p => p.log_likelihood)} className="h-8" />
        </div>
      )}

      {/* Profile correlation + switch ratio */}
      {diagnostics.out_of_sample && (
        <div className="flex gap-3">
          <div className="bg-white/5 rounded-xl p-3 border border-white/8 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Profile Correlation</div>
            <div className="text-lg font-bold font-mono text-foreground">{profileCorr.toFixed(2)}</div>
            <div className="text-[9px] text-muted-foreground/50">avg across regimes</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/8 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Switch Ratio</div>
            <div className={`text-lg font-bold font-mono ${
              switchRatio >= 0.7 && switchRatio <= 1.3 ? 'text-emerald-400' : 'text-amber-400'
            }`}>{switchRatio.toFixed(2)}{'\u00D7'}</div>
            <div className="text-[9px] text-muted-foreground/50">test / train</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/8 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Training Time</div>
            <div className="text-lg font-bold font-mono text-foreground">{timeStr}</div>
            <div className="text-[9px] text-muted-foreground/50">{diagnostics.n_bars_total?.toLocaleString()} bars</div>
          </div>
        </div>
      )}
    </div>
  );
}
