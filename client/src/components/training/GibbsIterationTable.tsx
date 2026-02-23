/**
 * GibbsIterationTable — Live per-iteration metric table during Gibbs sampling.
 *
 * Think of it as: a real-time scoreboard that updates every iteration,
 * showing exactly what the sampler is doing — how many regimes, how well
 * they fit the data, how stable the assignments are, and whether it's converging.
 *
 * Columns:
 *   Iter  | Regimes | Fit/bar | LL | Δ | Entropy | Switch | SelfTr | MaxReg% | Dwell
 */

import { useRef, useEffect } from "react";
import type { ConvergencePoint } from "./types";

interface GibbsIterationTableProps {
  points: ConvergencePoint[];
  totalIterations: number;
  nBars: number;
  burnIn: number;
}

// Color helper — returns Tailwind-ish text color class for a metric value
function deltaColor(d: number): string {
  if (d < 1) return "text-emerald-400";
  if (d < 100) return "text-amber-400";
  if (d < 1000) return "text-orange-400";
  return "text-muted-foreground";
}

function entropyColor(h: number, nRegimes: number): string {
  // Max entropy = log2(nRegimes). Closer to max = evenly spread (good)
  const maxH = Math.log2(Math.max(nRegimes, 2));
  const ratio = h / maxH;
  if (ratio > 0.8) return "text-emerald-400";
  if (ratio > 0.5) return "text-amber-400";
  return "text-orange-400";
}

function switchColor(sw: number): string {
  // 0.01-0.10 = stable regimes, 0.10-0.30 = moderate, 0.30+ = chaotic
  if (sw < 0.05) return "text-cyan-400";
  if (sw < 0.15) return "text-emerald-400";
  if (sw < 0.30) return "text-amber-400";
  return "text-orange-400";
}

function selfTransColor(st: number): string {
  if (st > 0.90) return "text-emerald-400";
  if (st > 0.70) return "text-amber-400";
  return "text-orange-400";
}

function maxRegColor(pct: number): string {
  // 30-60% = well balanced, 60-80% = somewhat dominated, 80%+ = single regime dominates
  if (pct < 40) return "text-emerald-400";
  if (pct < 60) return "text-amber-400";
  if (pct < 80) return "text-orange-400";
  return "text-rose-400";
}

function dwellColor(d: number): string {
  if (d >= 5 && d <= 50) return "text-emerald-400";
  if (d >= 3 && d <= 100) return "text-amber-400";
  return "text-orange-400";
}

export default function GibbsIterationTable({ points, totalIterations, nBars, burnIn }: GibbsIterationTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [points.length]);

  if (points.length === 0) return null;

  const COLUMNS = [
    { key: "iter", label: "Iter", width: "w-[52px]", align: "text-right" as const, title: "Gibbs iteration number" },
    { key: "regimes", label: "Regimes", width: "w-[58px]", align: "text-center" as const, title: "Active regime count — how many distinct market moods the sampler is using" },
    { key: "fit", label: "Fit/bar", width: "w-[66px]", align: "text-right" as const, title: "Log-likelihood per bar — how well the model explains each candle. Higher (closer to 0) = better" },
    { key: "ll", label: "LL", width: "w-[90px]", align: "text-right" as const, title: "Total log-likelihood — sum across all bars" },
    { key: "delta", label: "Δ", width: "w-[68px]", align: "text-right" as const, title: "Change in log-likelihood from previous iteration. Smaller = converging" },
    { key: "entropy", label: "Entropy", width: "w-[58px]", align: "text-right" as const, title: "Shannon entropy of regime distribution. Higher = more evenly spread across regimes" },
    { key: "switch", label: "Switch", width: "w-[54px]", align: "text-right" as const, title: "Switch rate — fraction of bars where the regime changes. Lower = more stable assignments" },
    { key: "selfTr", label: "SelfTr", width: "w-[50px]", align: "text-right" as const, title: "Average self-transition probability — how 'sticky' each regime is. Higher = regimes persist longer" },
    { key: "maxReg", label: "MaxReg%", width: "w-[60px]", align: "text-right" as const, title: "Percentage of bars in the dominant regime. Lower = better balance across regimes" },
    { key: "dwell", label: "Dwell", width: "w-[50px]", align: "text-right" as const, title: "Average dwell time in bars — how long the model stays in one regime before switching" },
  ];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-0 bg-[#161b22] border-b border-[#30363d] px-1 py-1 sticky top-0 z-10">
        {COLUMNS.map(col => (
          <div
            key={col.key}
            className={`${col.width} ${col.align} text-[9px] text-[#484f58] uppercase tracking-wider font-semibold px-1 shrink-0 cursor-help`}
            title={col.title}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* Scrollable rows */}
      <div ref={scrollRef} className="overflow-auto flex-1" style={{ maxHeight: '280px' }}>
        {points.map((pt, idx) => {
          const isBurnIn = pt.iter <= burnIn;
          const nRegimes = pt.n_active_states ?? 0;
          const llPerBar = nBars > 0 ? pt.log_likelihood / nBars : pt.log_likelihood;
          const d = pt.delta ?? 0;
          const ent = pt.entropy ?? 0;
          const sw = pt.switch_rate ?? 0;
          const st = pt.self_transition ?? 0;
          const mr = pt.max_regime_pct ?? 0;
          const dw = pt.avg_dwell ?? 0;

          return (
            <div
              key={pt.iter}
              className={`flex items-center gap-0 px-1 py-[1px] font-mono text-[11px] leading-tight border-b border-[#1c2128] transition-colors
                ${isBurnIn ? 'opacity-50' : ''}
                ${idx === points.length - 1 ? 'bg-[#1c2128]' : 'hover:bg-[#161b22]'}
              `}
            >
              {/* Iter */}
              <div className={`${COLUMNS[0].width} ${COLUMNS[0].align} px-1 shrink-0 text-[#8b949e]`}>
                <span className="text-[#484f58]">{pt.iter}</span>
                <span className="text-[#30363d]">/{totalIterations}</span>
              </div>

              {/* Regimes */}
              <div className={`${COLUMNS[1].width} ${COLUMNS[1].align} px-1 shrink-0`}>
                <span className="text-orange-400 font-bold">{nRegimes}</span>
              </div>

              {/* Fit/bar */}
              <div className={`${COLUMNS[2].width} ${COLUMNS[2].align} px-1 shrink-0 text-violet-400`}>
                {llPerBar.toFixed(2)}
              </div>

              {/* LL */}
              <div className={`${COLUMNS[3].width} ${COLUMNS[3].align} px-1 shrink-0 text-violet-400/70`}>
                {pt.log_likelihood.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>

              {/* Delta */}
              <div className={`${COLUMNS[4].width} ${COLUMNS[4].align} px-1 shrink-0 ${deltaColor(d)}`}>
                {d < 10 ? d.toFixed(2) : d < 1000 ? d.toFixed(1) : d.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>

              {/* Entropy */}
              <div className={`${COLUMNS[5].width} ${COLUMNS[5].align} px-1 shrink-0 ${entropyColor(ent, nRegimes)}`}>
                {ent > 0 ? ent.toFixed(2) : '--'}
              </div>

              {/* Switch rate */}
              <div className={`${COLUMNS[6].width} ${COLUMNS[6].align} px-1 shrink-0 ${switchColor(sw)}`}>
                {sw > 0 ? sw.toFixed(3) : '--'}
              </div>

              {/* Self-transition */}
              <div className={`${COLUMNS[7].width} ${COLUMNS[7].align} px-1 shrink-0 ${selfTransColor(st)}`}>
                {st > 0 ? st.toFixed(2) : '--'}
              </div>

              {/* Max regime % */}
              <div className={`${COLUMNS[8].width} ${COLUMNS[8].align} px-1 shrink-0 ${maxRegColor(mr)}`}>
                {mr > 0 ? `${mr.toFixed(1)}%` : '--'}
              </div>

              {/* Avg dwell */}
              <div className={`${COLUMNS[9].width} ${COLUMNS[9].align} px-1 shrink-0 ${dwellColor(dw)}`}>
                {dw > 0 ? dw.toFixed(1) : '--'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
