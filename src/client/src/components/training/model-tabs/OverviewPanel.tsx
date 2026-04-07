/**
 * OverviewPanel â€” Chart-first diagnostics overview in a responsive grid.
 *
 * Each cell renders based on which diagnostics keys exist (model-agnostic).
 * Any model that outputs regime_stats gets the distribution chart,
 * any with walk_forward gets the heatmap, etc. No model names referenced.
 */

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { Flame } from "lucide-react";
import { Sparkline, QualityScoreRing } from "../MicroComponents";
import type { RegimeModel, Diagnostics, ConvergencePoint } from "../types";
import {
  getQualityLabel, getQualityVerdict, getRegimeColor,
  getLLConvergenceVerdict, getFitVerdict, getStabilityVerdict,
} from "../types";

// â”€â”€ Feature category mapping (for SHAP chart) â”€â”€

function getFeatureCategory(name: string): { label: string; fill: string } {
  if (name.startsWith('return_'))           return { label: 'Returns',    fill: '#3b82f6' };
  if (name.startsWith('volatility_') || name.startsWith('parkinson_'))
                                            return { label: 'Volatility', fill: '#f97316' };
  if (name.startsWith('volume_'))           return { label: 'Volume',     fill: '#10b981' };
  if (['bar_range', 'body_ratio', 'upper_shadow', 'lower_shadow'].includes(name))
                                            return { label: 'Structure',  fill: '#8b5cf6' };
  if (name.startsWith('roc_'))              return { label: 'Momentum',   fill: '#06b6d4' };
  if (name.startsWith('ma_dist_'))          return { label: 'MA Dist',    fill: '#f59e0b' };
  if (name.startsWith('swing_') || name.startsWith('prev_swing_') || name === 'retracement_ratio')
                                            return { label: 'microstructure',      fill: '#f43f5e' };
  return { label: 'Other', fill: '#64748b' };
}

// â”€â”€ Cell wrapper â”€â”€

function ChartCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white/3 rounded-xl p-3 border border-white/6 flex flex-col min-h-0 ${className}`}>
      {children}
    </div>
  );
}

function CellHeader({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2 shrink-0">{children}</div>;
}

// â”€â”€ Quality Ring Cell â”€â”€

function QualityCell({ quality }: { quality: number }) {
  const verdict = getQualityVerdict(quality);
  return (
    <ChartCell>
      <CellHeader>Quality Score</CellHeader>
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        {quality > 0 ? (
          <>
            <QualityScoreRing score={quality} size={80} />
            <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${
              quality >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
              quality >= 60 ? 'bg-amber-500/15 text-amber-400' :
              'bg-orange-500/15 text-orange-400'
            }`}>
              {getQualityLabel(quality)}
            </span>
            <p className={`text-[10px] text-center leading-relaxed ${verdict.color}`}>{verdict.text}</p>
          </>
        ) : (
          <div className="w-20 h-20 rounded-full border-2 border-white/5 flex items-center justify-center">
            <span className="text-2xl font-bold font-mono text-muted-foreground/20">{'\u2014'}</span>
          </div>
        )}
      </div>
    </ChartCell>
  );
}

// â”€â”€ Regime Distribution Cell â”€â”€

function RegimeDistributionCell({ regimeStats }: { regimeStats: Diagnostics['regime_stats'] }) {
  if (!regimeStats?.length) return null;

  return (
    <ChartCell>
      <CellHeader>Regime Distribution</CellHeader>
      {/* Stacked horizontal bar */}
      <div className="flex h-4 rounded-full overflow-hidden mb-3">
        {regimeStats.map((rs, i) => (
          <div
            key={rs.regime_id}
            style={{ width: `${rs.pct * 100}%`, backgroundColor: getRegimeColor(i).fill }}
            className="h-full transition-all"
            title={`${rs.label}: ${(rs.pct * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      {/* Per-regime rows */}
      <div className="space-y-1.5 flex-1 overflow-y-auto">
        {regimeStats.map((rs, i) => {
          const color = getRegimeColor(i);
          return (
            <div key={rs.regime_id} className="flex items-center gap-2 text-[10px]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color.fill }} />
              <span className="text-foreground/80 font-medium truncate flex-1">{rs.label}</span>
              <span className="font-mono text-muted-foreground/60">{(rs.pct * 100).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </ChartCell>
  );
}

// â”€â”€ Walk-Forward Heatmap Cell â”€â”€

function WalkForwardCell({ walkForward }: { walkForward: NonNullable<Diagnostics['walk_forward']> }) {
  const windows = walkForward.window_results;
  const stability = walkForward.stability_score;
  const verdict = getStabilityVerdict(stability);

  return (
    <ChartCell>
      <CellHeader>Walk-Forward</CellHeader>
      <div className="flex gap-1.5 mb-3">
        {windows.map((w) => {
          const conf = w.avg_confidence ?? 0;
          const bg = w.failed ? 'bg-rose-500/30' : conf >= 0.8 ? 'bg-emerald-500/30' : conf >= 0.6 ? 'bg-amber-500/30' : 'bg-rose-500/20';
          const text = w.failed ? 'text-rose-400' : conf >= 0.8 ? 'text-emerald-400' : conf >= 0.6 ? 'text-amber-400' : 'text-rose-400';
          return (
            <div key={w.window} className={`flex-1 ${bg} rounded-lg p-2 text-center`}>
              <div className="text-[8px] text-muted-foreground/50 mb-0.5">W{w.window}</div>
              <div className={`text-sm font-bold font-mono ${text}`}>
                {w.failed ? '\u2717' : `${(conf * 100).toFixed(0)}%`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-auto">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-muted-foreground/50">Stability</span>
          <span className="font-mono text-foreground/80">{(stability * 100).toFixed(0)}%</span>
        </div>
        <p className={`text-[10px] leading-relaxed ${verdict.color}`}>{verdict.text}</p>
      </div>
    </ChartCell>
  );
}

// â”€â”€ LL Convergence Sparkline Cell â”€â”€

function ConvergenceCell({ convergencePoints, llPerBar }: { convergencePoints: ConvergencePoint[]; llPerBar: number }) {
  const verdict = convergencePoints.length > 1
    ? getLLConvergenceVerdict(convergencePoints)
    : getFitVerdict(llPerBar);

  return (
    <ChartCell>
      <CellHeader>Convergence</CellHeader>
      <div className="flex-1 flex flex-col justify-center">
        {convergencePoints.length > 2 && (
          <Sparkline data={convergencePoints.map(p => p.log_likelihood)} className="h-12 mb-2" />
        )}
        {llPerBar !== 0 && (
          <div className="text-center mb-1">
            <span className="text-xl font-bold font-mono text-violet-400">{llPerBar.toFixed(2)}</span>
            <span className="text-[9px] text-muted-foreground/50 ml-1">LL/bar</span>
          </div>
        )}
      </div>
      <p className={`text-[10px] leading-relaxed mt-auto ${verdict.color}`}>{verdict.text}</p>
    </ChartCell>
  );
}

// â”€â”€ OOS Distribution Comparison Cell â”€â”€

function OOSComparisonCell({ oos }: { oos: NonNullable<Diagnostics['out_of_sample']> }) {
  const data = useMemo(() => {
    const maxLen = Math.max(oos.train_distribution.length, oos.test_distribution.length);
    return Array.from({ length: maxLen }, (_, i) => ({
      regime: `R${i}`,
      train: (oos.train_distribution[i] ?? 0) * 100,
      test: (oos.test_distribution[i] ?? 0) * 100,
    }));
  }, [oos.train_distribution, oos.test_distribution]);

  const similarity = oos.distribution_similarity;

  return (
    <ChartCell>
      <div className="flex items-center justify-between shrink-0">
        <CellHeader>OOS Distribution</CellHeader>
        <span className={`text-[10px] font-mono font-bold ${
          similarity >= 0.85 ? 'text-emerald-400' : similarity >= 0.7 ? 'text-amber-400' : 'text-rose-400'
        }`}>
          {(similarity * 100).toFixed(0)}% match
        </span>
      </div>
      <div className="flex-1 min-h-0" style={{ minHeight: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={1}>
            <XAxis dataKey="regime" tick={{ fontSize: 9, fill: '#6e7681' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }}
              formatter={(value: number) => [`${value.toFixed(1)}%`]}
            />
            <Bar dataKey="train" fill="#3b82f6" opacity={0.6} radius={[2, 2, 0, 0]} name="Train" />
            <Bar dataKey="test" fill="#10b981" opacity={0.8} radius={[2, 2, 0, 0]} name="Test" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-3 text-[9px] text-muted-foreground/50 mt-1 shrink-0">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/60" /> Train</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/80" /> Test</span>
      </div>
    </ChartCell>
  );
}

// â”€â”€ Top SHAP Features Cell â”€â”€

function ShapFeaturesCell({ diagnostics }: { diagnostics: Diagnostics }) {
  const topFeatures = useMemo(() => {
    const shapSummary = diagnostics.shap_summary;
    if (!shapSummary?.length || !diagnostics.feature_names?.length) return [];

    const importanceMap = new Map<string, number>();
    for (const regime of shapSummary) {
      for (const feat of regime.top_features) {
        importanceMap.set(feat.feature, (importanceMap.get(feat.feature) ?? 0) + feat.mean_abs_shap);
      }
    }
    const nRegimes = shapSummary.length;
    return diagnostics.feature_names
      .map(name => ({
        name,
        importance: (importanceMap.get(name) ?? 0) / nRegimes,
        ...getFeatureCategory(name),
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8);
  }, [diagnostics.shap_summary, diagnostics.feature_names]);

  if (topFeatures.length === 0) return null;

  return (
    <ChartCell>
      <CellHeader>Top Features (SHAP)</CellHeader>
      <div className="flex-1 min-h-0" style={{ minHeight: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topFeatures} layout="vertical" margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 8, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={90}
            />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }}
              formatter={(value: number) => [value.toFixed(2), 'mean |SHAP|']}
            />
            <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
              {topFeatures.map((f, i) => (
                <Cell key={i} fill={f.fill} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCell>
  );
}

// â”€â”€ Model Info Bar â”€â”€

function ModelInfoBar({ diagnostics, model }: { diagnostics: Diagnostics; model: RegimeModel }) {
  const timeSec = diagnostics.training_time_sec ?? 0;
  const timeStr = timeSec >= 60 ? `${Math.floor(timeSec / 60)}m ${Math.round(timeSec % 60)}s` : `${timeSec.toFixed(0)}s`;
  const iterCount = diagnostics.convergence_summary?.n_iterations;

  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground/60 flex-wrap shrink-0 mb-3">
      <span className="font-mono text-foreground/80">{model.symbol} @ {model.timeframe}</span>
      {diagnostics.n_bars_total != null && <span>{diagnostics.n_bars_total.toLocaleString()} bars</span>}
      <span>{diagnostics.n_features} features</span>
      {iterCount != null && <span>{iterCount} iterations</span>}
      <span className="flex items-center gap-1"><Flame className="h-3 w-3" />{timeStr}</span>
      {diagnostics.date_range && (
        <span className="text-[9px]">{diagnostics.date_range.start} {'\u2192'} {diagnostics.date_range.end}</span>
      )}
    </div>
  );
}

// â”€â”€ Main OverviewPanel â”€â”€

export function OverviewPanel({ diagnostics, model, llPerBar, convergencePoints }: {
  diagnostics: Diagnostics; model: RegimeModel; llPerBar: number; convergencePoints: ConvergencePoint[];
}) {
  const quality = diagnostics.quality_score ?? 0;

  // Diagnostics-driven cell visibility â€” each cell checks its own keys
  const hasRegimeStats = diagnostics.regime_stats?.length > 0;
  const hasWalkForward = !!diagnostics.walk_forward?.window_results?.length;
  const hasConvergence = convergencePoints.length > 1 || llPerBar !== 0;
  const hasOOS = !!diagnostics.out_of_sample;
  const hasShap = !!diagnostics.shap_summary?.length && !!diagnostics.feature_names?.length;

  // Collect visible cells for adaptive grid
  const cells: { key: string; node: React.ReactNode }[] = [];

  // Quality always shows (every model has a quality score or shows placeholder)
  cells.push({ key: 'quality', node: <QualityCell quality={quality} /> });

  if (hasRegimeStats) {
    cells.push({ key: 'regimes', node: <RegimeDistributionCell regimeStats={diagnostics.regime_stats} /> });
  }

  if (hasWalkForward) {
    cells.push({ key: 'walkforward', node: <WalkForwardCell walkForward={diagnostics.walk_forward!} /> });
  }

  if (hasConvergence) {
    cells.push({ key: 'convergence', node: <ConvergenceCell convergencePoints={convergencePoints} llPerBar={llPerBar} /> });
  }

  if (hasOOS) {
    cells.push({ key: 'oos', node: <OOSComparisonCell oos={diagnostics.out_of_sample!} /> });
  }

  if (hasShap) {
    cells.push({ key: 'shap', node: <ShapFeaturesCell diagnostics={diagnostics} /> });
  }

  // Adaptive column count: 1â†’1, 2â†’2, 3â†’3, 4+â†’3
  const colClass = cells.length <= 1 ? 'grid-cols-1'
    : cells.length === 2 ? 'grid-cols-2'
    : 'grid-cols-3';

  return (
    <div className="flex flex-col min-h-0">
      <ModelInfoBar diagnostics={diagnostics} model={model} />
      <div className={`grid ${colClass} gap-3 flex-1 min-h-0`}>
        {cells.map(cell => (
          <div key={cell.key} className="min-h-[160px]">
            {cell.node}
          </div>
        ))}
      </div>
    </div>
  );
}

