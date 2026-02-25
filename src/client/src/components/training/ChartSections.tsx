/**
 * ChartSections — Regime discovery, convergence, active states, WF stability,
 * OOS monitor, and regime duration charts.
 *
 * Section 3: Discovered Regimes + LL Convergence + Active States (3-column)
 * Section 4: Walk-Forward Stability + OOS Monitor + Regime Durations (3-column)
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, ComposedChart, Area,
} from "recharts";
import { TrendingUp, Zap, Shield, Target, BarChart3, Layers } from "lucide-react";
import RegimeDiscoveryViz from "@/components/training/RegimeDiscoveryViz";
import type { TrainingState } from "./types";
import { getRegimeColor, getOosVerdict, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "./types";

/* ─── Section 3: Regime Discovery + Convergence ── */

export function DiscoverySection({ state }: { state: TrainingState }) {
  const { isTraining, diagnostics, convergencePoints, nBarsForLL, llPerBar, metrics } = state;
  const nRegimes = metrics.regimes;
  const finalLL = metrics.ll;
  const finalActiveStates = metrics.activeStates;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Regime Discovery Visualization */}
      <Card className="glass rounded-2xl gradient-border overflow-hidden">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="Each block represents a regime the model discovered. Size = how often it appears. The model groups bars with similar candlestick shape, volatility, and momentum into the same regime. Transitions between blocks show how the market flows from one mood to another.">
            <Layers className="h-3 w-3 text-orange-400" /> Discovered Regimes
            <span className="text-[10px] opacity-50 ml-auto font-normal">market personalities</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 h-[380px]">
          <RegimeDiscoveryViz
            regimeStats={diagnostics?.regime_stats || []}
            transitions={diagnostics?.transitions}
            nRegimes={nRegimes}
            isTraining={isTraining}
          />
        </CardContent>
      </Card>

      {/* Log-Likelihood Convergence Chart */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="Log-likelihood per bar over Gibbs iterations. Think of it as: how well does the model grade each candle? The curve climbing = model is learning better regime assignments. Flattening = it's done learning.">
            <TrendingUp className="h-3 w-3 text-violet-400" /> LL Convergence
            <span className="text-[10px] opacity-50 font-normal">per-bar model fit</span>
            {finalLL !== 0 && (
              <span className="ml-auto flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] rounded-full border-violet-500/30 text-violet-400 bg-violet-500/10">
                  {llPerBar.toFixed(2)}/bar
                </Badge>
                <span className="text-[9px] text-muted-foreground/40 font-mono">{finalLL.toLocaleString(undefined, { maximumFractionDigits: 0 })} total</span>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[240px] p-2">
          {convergencePoints.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} label={{ value: 'Gibbs Iteration', position: 'bottom', fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis {...CHART_AXIS} tickFormatter={(v: number) => nBarsForLL > 1 ? (v / nBarsForLL).toFixed(1) : v.toLocaleString()} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [nBarsForLL > 1 ? `${(v / nBarsForLL).toFixed(3)} per bar (${v.toLocaleString()} total)` : v.toLocaleString(), 'Log-Likelihood']} />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                <Area type="monotone" dataKey="log_likelihood" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="Log-Likelihood (per bar)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Train a model to see convergence
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active States over Gibbs iterations */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="How many regimes the model is actually using at each Gibbs iteration. The model starts with a large pool and prunes unused states. A flat line = regime count stabilized early. Decreasing = the model is merging redundant states. Fluctuating = needs more burn-in iterations to settle.">
            <Zap className="h-3 w-3 text-amber-400" /> Active States
            {finalActiveStates > 0 && (
              <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-amber-500/30 text-amber-400 bg-amber-500/10">
                {finalActiveStates} final
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[240px] p-2">
          {convergencePoints.length > 0 && convergencePoints.some(p => p.n_active_states !== undefined) ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="stepAfter" dataKey="n_active_states" stroke="hsl(45, 90%, 55%)" strokeWidth={2} dot={false} name="Active States" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Train a model to see regime discovery
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


/* ─── Section 4: WF Stability + OOS Monitor + Regime Durations ── */

export function AnalyticsSection({ state }: { state: TrainingState }) {
  const { oos, wfWindResults, diagnostics, metrics } = state;
  const stabilityScore = metrics.stability;
  const oosSimilarity = metrics.oos;
  const profileCorrelation = metrics.profileCorr;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Walk-Forward Stability */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="Tests if the model works across different time periods. Data is split into 5 sequential windows. Green bars = confidence the model assigns to each bar's regime (higher = more decisive). Yellow bars = how often the model switches between regimes (should be similar across windows). Consistent bars across W1-W5 = model generalizes well.">
            <Shield className="h-3 w-3 text-emerald-400" /> Walk-Forward Stability
            {stabilityScore > 0 && (
              <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                {(stabilityScore * 100).toFixed(0)}%
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] p-2">
          {wfWindResults.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wfWindResults.map((w, i) => ({
                window: `W${i + 1}`,
                confidence: w.avg_confidence ? Number((w.avg_confidence * 100).toFixed(1)) : 0,
                switchRate: w.switch_rate ? Number((w.switch_rate * 100).toFixed(1)) : 0,
                failed: w.failed,
              }))}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="window" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                <Bar dataKey="confidence" fill="hsl(160, 60%, 45%)" radius={[2, 2, 0, 0]} name="Confidence %" />
                <Bar dataKey="switchRate" fill="hsl(45, 90%, 55%)" radius={[2, 2, 0, 0]} name="Switch Rate %" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Train to see walk-forward results
            </div>
          )}
        </CardContent>
      </Card>

      {/* OOS Monitor */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="Checks if the model overfits to training data. Distribution Match = do regimes appear equally often in train vs test? Profile Correlation = do regime fingerprints (return, vol, wick shape) look the same in unseen data? Switch Ratio = does the model change regimes at the same pace in test data? All 3 near 1.0 = no overfitting.">
            <Target className="h-3 w-3 text-cyan-400" /> Out-of-Sample Monitor
          </CardTitle>
          {oos && (
            <Badge variant="outline" className={`text-[10px] rounded-full ${
              oosSimilarity >= 0.8 ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' :
              oosSimilarity >= 0.6 ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
              'border-rose-500/50 text-rose-400 bg-rose-500/10'
            }`}>
              {oosSimilarity >= 0.8 ? 'STABLE' : oosSimilarity >= 0.6 ? 'CAUTION' : 'DIVERGED'}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-3">
          {oos ? (
            <div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="cursor-help" title="How similarly the regimes are distributed between training and test data. 96% means nearly identical proportions — the model doesn't favor certain regimes depending on which data it sees.">
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Distribution Match</div>
                  <div className={`text-xl font-bold font-mono ${
                    oosSimilarity >= 0.8 ? 'text-emerald-400' : oosSimilarity >= 0.6 ? 'text-amber-400' : 'text-rose-400'
                  }`}>
                    {(oosSimilarity * 100).toFixed(0)}%
                  </div>
                  <Progress value={oosSimilarity * 100} className={`h-1 mt-1 ${
                    oosSimilarity >= 0.8 ? '[&>div]:bg-emerald-500' : oosSimilarity >= 0.6 ? '[&>div]:bg-amber-500' : '[&>div]:bg-rose-500'
                  }`} />
                </div>
                <div className="cursor-help" title="How similar each regime's feature fingerprint (return, volatility, wick shape, etc.) is between training and test data. 0.99 means the model's idea of each regime is nearly identical in both sets — it learned real patterns, not noise.">
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Profile Correlation</div>
                  <div className="text-xl font-bold font-mono text-foreground">
                    {profileCorrelation.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-1">avg across regimes</div>
                </div>
                <div className="cursor-help" title="How often the model switches regimes in test data compared to training data. 1.0× = identical switching behavior. >1.3× = model is more indecisive on new data (concerning). <0.7× = model is too sticky on new data. Between 0.8-1.2× is healthy.">
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Switch Ratio</div>
                  <div className={`text-xl font-bold font-mono ${
                    oos.switch_rate_ratio >= 0.7 && oos.switch_rate_ratio <= 1.3 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {oos.switch_rate_ratio.toFixed(2)}×
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-1">test / train</div>
                </div>
              </div>

              {/* Train vs Test distribution comparison */}
              {oos.train_distribution && oos.test_distribution && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">
                    Regime Distribution: Train vs Test
                  </div>
                  <div className="flex gap-1 items-end h-12">
                    {oos.train_distribution.map((trainPct: number, idx: number) => {
                      const testPct = oos.test_distribution[idx] || 0;
                      const c = getRegimeColor(idx);
                      return (
                        <div key={idx} className="flex flex-col items-center gap-0.5 flex-1" title={`R${idx}: train ${(trainPct * 100).toFixed(1)}% / test ${(testPct * 100).toFixed(1)}%`}>
                          <div className="flex gap-px w-full items-end" style={{ height: 48 }}>
                            <div className="flex-1 rounded-t" style={{ height: `${Math.min(trainPct * 100 * 1.5, 48)}px`, backgroundColor: c.fill, opacity: 0.5 }} />
                            <div className="flex-1 rounded-t" style={{ height: `${Math.min(testPct * 100 * 1.5, 48)}px`, backgroundColor: c.fill }} />
                          </div>
                          <span className="text-[7px] text-muted-foreground/50">R{idx}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-3 mt-1 justify-center">
                    <span className="text-[8px] text-muted-foreground/40">■ faded = train</span>
                    <span className="text-[8px] text-muted-foreground/40">■ solid = test</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs">
              Train a model to see OOS assessment
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regime Duration Chart */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
            title="How long the market stays in each regime before switching. Tall bars = sticky regimes (the market stays in that mood for many consecutive bars). Short bars = transient regimes (brief impulse moves that resolve quickly). Compare avg vs max to see if there are occasional extended stays.">
            <BarChart3 className="h-3 w-3 text-rose-400" /> Regime Durations
            <span className="text-[10px] opacity-50 ml-auto font-normal">avg bars per regime visit</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] p-2">
          {diagnostics?.regime_stats && diagnostics.regime_stats.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={diagnostics.regime_stats.map(r => ({
                regime: r.nickname || r.label || `R${r.regime_id}`,
                avg: Number(r.avg_duration.toFixed(1)),
                max: r.max_duration,
              }))}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="regime" {...CHART_AXIS} fontSize={8} angle={-15} />
                <YAxis {...CHART_AXIS} label={{ value: 'bars', angle: -90, position: 'insideLeft', fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                <Bar dataKey="avg" fill="hsl(350, 70%, 60%)" radius={[2, 2, 0, 0]} name="Avg Duration" />
                <Bar dataKey="max" fill="hsla(350, 70%, 60%, 0.3)" radius={[2, 2, 0, 0]} name="Max Duration" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Train to see regime durations
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
