/**
 * OOSPanel — Out-of-sample: distribution match, profile correlation, switch ratio.
 */

import { Progress } from "@/components/ui/progress";
import type { Diagnostics } from "../types";
import { getRegimeColor, getOosVerdict } from "../types";

export function OOSPanel({ diagnostics, oos, oosSimilarity, profileCorrelation }: {
  diagnostics: Diagnostics; oos: any; oosSimilarity: number; profileCorrelation: number;
}) {
  if (!oos) {
    return <div className="h-[300px] flex items-center justify-center text-muted-foreground text-xs">No out-of-sample data</div>;
  }

  return (
    <div className="space-y-4">
      {/* Three big metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Distribution Match</div>
          <div className={`text-4xl font-bold font-mono ${
            oosSimilarity >= 0.8 ? "text-emerald-400" : oosSimilarity >= 0.6 ? "text-amber-400" : "text-rose-400"
          }`}>
            {(oosSimilarity * 100).toFixed(0)}%
          </div>
          <Progress value={oosSimilarity * 100} className={`h-1.5 mt-3 ${
            oosSimilarity >= 0.8 ? "[&>div]:bg-emerald-500" : oosSimilarity >= 0.6 ? "[&>div]:bg-amber-500" : "[&>div]:bg-rose-500"
          }`} />
          <p className={`text-[10px] mt-2 ${getOosVerdict(oosSimilarity).color}`}>{getOosVerdict(oosSimilarity).text}</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Profile Correlation</div>
          <div className="text-4xl font-bold font-mono text-foreground">{profileCorrelation.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground/50 mt-3">avg across regimes</div>
          <p className="text-[10px] mt-2 text-muted-foreground/50">
            {profileCorrelation >= 0.9 ? "Nearly identical regime fingerprints" :
             profileCorrelation >= 0.7 ? "Good pattern consistency" : "Regime profiles differ in test data"}
          </p>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Switch Ratio</div>
          <div className={`text-4xl font-bold font-mono ${
            oos.switch_rate_ratio >= 0.7 && oos.switch_rate_ratio <= 1.3 ? "text-emerald-400" : "text-amber-400"
          }`}>
            {oos.switch_rate_ratio.toFixed(2)}×
          </div>
          <div className="text-[9px] text-muted-foreground/50 mt-3">test / train</div>
          <p className="text-[10px] mt-2 text-muted-foreground/50">
            {oos.switch_rate_ratio >= 0.8 && oos.switch_rate_ratio <= 1.2 ? "Healthy switching behavior" :
             oos.switch_rate_ratio > 1.3 ? "More indecisive on new data" : "Stickier on new data"}
          </p>
        </div>
      </div>

      {/* Train vs Test distribution */}
      {oos.train_distribution && oos.test_distribution && (
        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-3">Regime Distribution: Train vs Test</div>
          <div className="flex gap-2 items-end h-20">
            {oos.train_distribution.map((trainPct: number, idx: number) => {
              const testPct = oos.test_distribution[idx] || 0;
              const c = getRegimeColor(idx);
              return (
                <div key={idx} className="flex flex-col items-center gap-1 flex-1" title={`R${idx}: train ${(trainPct * 100).toFixed(1)}% / test ${(testPct * 100).toFixed(1)}%`}>
                  <div className="flex gap-1 w-full items-end" style={{ height: 64 }}>
                    <div className="flex-1 rounded-t" style={{ height: `${Math.min(trainPct * 100 * 2, 64)}px`, backgroundColor: c?.fill, opacity: 0.4 }} />
                    <div className="flex-1 rounded-t" style={{ height: `${Math.min(testPct * 100 * 2, 64)}px`, backgroundColor: c?.fill }} />
                  </div>
                  <span className="text-[8px] text-muted-foreground/50">R{idx}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2 justify-center">
            <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1"><span className="w-3 h-2 bg-orange-400/40 rounded-sm inline-block" /> Train</span>
            <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1"><span className="w-3 h-2 bg-orange-400 rounded-sm inline-block" /> Test</span>
          </div>
        </div>
      )}

      {/* Per-regime profile correlation */}
      {oos.profile_consistency && (
        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-3">Per-Regime Profile Correlation</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {oos.profile_consistency.map((pc: any) => {
              const c = getRegimeColor(pc.regime);
              return (
                <div key={pc.regime} className="flex items-center gap-2 bg-black/20 rounded-lg p-2">
                  <div className={`w-2 h-2 rounded-full ${c?.bg} shrink-0`} />
                  <span className="text-[10px] text-muted-foreground">R{pc.regime}</span>
                  <span className={`text-[11px] font-mono font-bold ml-auto ${
                    pc.insufficient_data ? "text-muted-foreground/30" :
                    (pc.correlation ?? 0) >= 0.9 ? "text-emerald-400" :
                    (pc.correlation ?? 0) >= 0.7 ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {pc.insufficient_data ? "N/A" : (pc.correlation ?? 0).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
