/**
 * ModelTabs — Each trained model gets its own tab with metric sub-tabs.
 *
 * Layout:
 *   ┌─ MNQ_30m ─┬─ ES_30m ─┬─ NQ_1H ─┐   ← model tabs (one per trained model)
 *   │ Overview │ Regimes │ Convergence │ WF │ OOS │ Fit │  ← metric sub-tabs
 *   │ [content for selected sub-tab]                      │
 *   └────────────────────────────────────────────────────────┘
 *
 * Each sub-tab shows the deep-dive for that metric, using the model's
 * own diagnostics data (fetched per-model via React Query).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, ComposedChart, Area,
} from "recharts";
import {
  Layers, TrendingUp, Zap, Shield, Target, BarChart3, Flame,
  Trash2, ChevronRight, Activity,
} from "lucide-react";
import RegimeDiscoveryViz from "@/components/training/RegimeDiscoveryViz";
import { Sparkline, QualityScoreRing, FitGauge } from "./MicroComponents";
import type { RegimeModel, Diagnostics, ConvergencePoint } from "./types";
import {
  getRegimeColor, getQualityColor, getQualityLabel, getQualityVerdict,
  getRegimeVerdict, getStabilityVerdict, getOosVerdict, getFitVerdict, getFitLevel,
  VOL_COLORS, CANDLE_LABELS, CHART_GRID, CHART_AXIS, CHART_TOOLTIP,
} from "./types";
import { QUERY_KEYS } from "@/lib/types";

// ─── Sub-tab definitions ─────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "overview",    label: "Overview",     icon: Activity },
  { id: "regimes",     label: "Regimes",      icon: Layers },
  { id: "convergence", label: "Convergence",  icon: TrendingUp },
  { id: "walkforward", label: "Walk-Forward", icon: Shield },
  { id: "oos",         label: "OOS",          icon: Target },
  { id: "fit",         label: "Model Fit",    icon: BarChart3 },
] as const;

type SubTabId = typeof SUB_TABS[number]["id"];

// ─── Per-model diagnostics hook ──────────────────────────────────────────────

function useModelDiagnostics(modelId: string) {
  const { data: diagnostics } = useQuery({
    queryKey: QUERY_KEYS.regimeDiagnostics(modelId),
    queryFn: async () => {
      const res = await fetch(`/api/regime/diagnostics/${modelId}`);
      if (!res.ok) throw new Error("Failed to load diagnostics");
      return res.json() as Promise<Diagnostics>;
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const { data: convergenceData } = useQuery({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(modelId), "convergence"],
    queryFn: async () => {
      const res = await fetch(`/api/regime/convergence/${modelId}`);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, ConvergencePoint[]>>;
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  return { diagnostics, convergenceData };
}

// ─── Main ModelTabs Component ────────────────────────────────────────────────

interface ModelTabsProps {
  models: RegimeModel[];
  selectedModel: string | null;
  setSelectedModel: (id: string | null) => void;
  deleteModel: (id: string) => void;
}

export default function ModelTabs({ models, selectedModel, setSelectedModel, deleteModel }: ModelTabsProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>("overview");

  if (models.length === 0) {
    return (
      <Card className="glass rounded-2xl gradient-border">
        <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
          <Layers className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No Trained Models</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Train a model to see its metrics here</p>
        </div>
      </Card>
    );
  }

  const sortedModels = [...models].sort((a, b) =>
    new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
  );

  const activeModelId = selectedModel || sortedModels[0]?.id || "";

  return (
    <Card className="glass rounded-2xl gradient-border overflow-hidden">
      {/* ── Model Tabs (top row) ── */}
      <Tabs value={activeModelId} onValueChange={(id) => setSelectedModel(id)}>
        <div className="border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center px-2 overflow-x-auto scrollbar-none">
            <TabsList className="bg-transparent h-auto p-0 gap-0">
              {sortedModels.map((model) => {
                const isActive = model.id === activeModelId;
                const qColor = getQualityColor(model.quality_score ?? 0);
                return (
                  <TabsTrigger
                    key={model.id}
                    value={model.id}
                    className={`
                      relative rounded-none border-b-2 px-4 py-2.5 text-xs font-medium
                      transition-all data-[state=active]:shadow-none
                      ${isActive
                        ? "border-primary text-foreground bg-white/[0.04]"
                        : "border-transparent text-muted-foreground hover:text-foreground/70 hover:bg-white/[0.02]"
                      }
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{model.symbol}</span>
                      <span className="text-[10px] text-muted-foreground/60">{model.timeframe}</span>
                      <span className={`text-[10px] font-bold font-mono ${qColor}`}>
                        {model.quality_score !== undefined ? model.quality_score.toFixed(0) : "--"}
                      </span>
                      <span className="text-[9px] text-orange-400/70 font-mono">{model.n_regimes}R</span>
                    </div>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </div>

        {/* ── Per-model content ── */}
        {sortedModels.map((model) => (
          <TabsContent key={model.id} value={model.id} className="mt-0">
            <ModelPanel
              model={model}
              activeSubTab={activeSubTab}
              setActiveSubTab={setActiveSubTab}
              deleteModel={deleteModel}
            />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

// ─── ModelPanel: sub-tabs for one model ──────────────────────────────────────

function ModelPanel({
  model, activeSubTab, setActiveSubTab, deleteModel,
}: {
  model: RegimeModel;
  activeSubTab: SubTabId;
  setActiveSubTab: (tab: SubTabId) => void;
  deleteModel: (id: string) => void;
}) {
  const { diagnostics, convergenceData } = useModelDiagnostics(model.id);

  const convergencePoints: ConvergencePoint[] = convergenceData?.gibbs || [];
  const nBarsForLL = diagnostics?.n_bars_total || 1;
  const ll = diagnostics?.convergence_summary?.final_log_likelihood ?? 0;
  const llPerBar = ll !== 0 ? ll / nBarsForLL : 0;
  const wfWindResults = diagnostics?.walk_forward?.window_results || [];
  const oos = diagnostics?.out_of_sample;
  const stability = diagnostics?.walk_forward?.stability_score ?? 0;
  const oosSimilarity = oos?.distribution_similarity ?? 0;
  const profileCorrelation = oos?.avg_profile_correlation ?? 0;
  const quality = diagnostics?.quality_score ?? 0;

  return (
    <div>
      {/* ── Sub-tab bar ── */}
      <div className="border-b border-white/5 px-3 flex items-center gap-1 overflow-x-auto scrollbar-none">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          // Show badge values on sub-tab triggers
          let badge: string | null = null;
          if (tab.id === "regimes" && diagnostics) badge = `${diagnostics.n_regimes}`;
          if (tab.id === "walkforward" && stability > 0) badge = `${(stability * 100).toFixed(0)}%`;
          if (tab.id === "oos" && oosSimilarity > 0) badge = `${(oosSimilarity * 100).toFixed(0)}%`;
          if (tab.id === "fit" && llPerBar !== 0) badge = llPerBar.toFixed(1);
          if (tab.id === "overview" && quality > 0) badge = quality.toFixed(0);

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2
                transition-all whitespace-nowrap
                ${isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                }
              `}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
              {badge && (
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                  isActive ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/50"
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Delete button on far right */}
        <div className="ml-auto pl-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground/40 hover:text-rose-400"
            onClick={() => deleteModel(model.id)}
            title="Delete this model"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Sub-tab content ── */}
      <div className="p-4">
        {!diagnostics ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-xs animate-pulse">
            Loading diagnostics...
          </div>
        ) : (
          <>
            {activeSubTab === "overview" && <OverviewPanel diagnostics={diagnostics} model={model} llPerBar={llPerBar} convergencePoints={convergencePoints} />}
{activeSubTab === "regimes" && <RegimesPanel diagnostics={diagnostics} />}
            {activeSubTab === "convergence" && <ConvergencePanel diagnostics={diagnostics} convergencePoints={convergencePoints} nBarsForLL={nBarsForLL} llPerBar={llPerBar} />}
            {activeSubTab === "walkforward" && <WalkForwardPanel diagnostics={diagnostics} wfWindResults={wfWindResults} stability={stability} />}
            {activeSubTab === "oos" && <OOSPanel diagnostics={diagnostics} oos={oos} oosSimilarity={oosSimilarity} profileCorrelation={profileCorrelation} />}
            {activeSubTab === "fit" && <FitPanel diagnostics={diagnostics} convergencePoints={convergencePoints} nBarsForLL={nBarsForLL} llPerBar={llPerBar} ll={ll} />}
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SUB-TAB PANELS
// ─────────────────────────────────────────────────────────────────────────────

// ─── Overview: summary of all metrics at a glance ────────────────────────────

function OverviewPanel({ diagnostics, model, llPerBar, convergencePoints }: {
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
        <span className="text-[9px]">{diagnostics.date_range?.start} → {diagnostics.date_range?.end}</span>
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
              <span className="text-3xl font-bold font-mono text-muted-foreground/20">--</span>
            </div>
          )}
        </div>

        {/* Metric cards in a row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 flex-1">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">{m.label}</div>
              <div className={`text-xl font-bold font-mono ${m.color}`}>{m.value}</div>
              <p className={`text-[10px] mt-1 ${m.verdict.color}`}>{m.verdict.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mini convergence sparkline */}
      {convergencePoints.length > 2 && (
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Trend</div>
          <Sparkline data={convergencePoints.map(p => p.log_likelihood)} className="h-8" />
        </div>
      )}

      {/* Profile correlation + switch ratio */}
      {diagnostics.out_of_sample && (
        <div className="flex gap-3">
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Profile Correlation</div>
            <div className="text-lg font-bold font-mono text-foreground">{profileCorr.toFixed(2)}</div>
            <div className="text-[9px] text-muted-foreground/50">avg across regimes</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Switch Ratio</div>
            <div className={`text-lg font-bold font-mono ${
              switchRatio >= 0.7 && switchRatio <= 1.3 ? 'text-emerald-400' : 'text-amber-400'
            }`}>{switchRatio.toFixed(2)}×</div>
            <div className="text-[9px] text-muted-foreground/50">test / train</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Training Time</div>
            <div className="text-lg font-bold font-mono text-foreground">{timeStr}</div>
            <div className="text-[9px] text-muted-foreground/50">{diagnostics.n_bars_total?.toLocaleString()} bars</div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Regimes: discovery viz + stats table ────────────────────────────────────

function RegimesPanel({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <div className="space-y-4">
      {/* Discovery Visualization */}
      <div className="h-[380px] border border-white/5 rounded-xl overflow-hidden">
        <RegimeDiscoveryViz
          regimeStats={diagnostics.regime_stats || []}
          transitions={diagnostics.transitions}
          nRegimes={diagnostics.n_regimes}
          isTraining={false}
        />
      </div>

      {/* Stats Table */}
      {diagnostics.regime_stats && diagnostics.regime_stats.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Regime</th>
                <th className="text-right py-2 px-3 font-medium">Bars</th>
                <th className="text-right py-2 px-3 font-medium">%</th>
                <th className="text-right py-2 px-3 font-medium">Return/Bar</th>
                <th className="text-center py-2 px-3 font-medium">Vol</th>
                <th className="text-center py-2 px-3 font-medium">Candle</th>
                <th className="text-right py-2 px-3 font-medium">Avg / Max</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.regime_stats.map((regime) => {
                const c = getRegimeColor(regime.regime_id);
                const returnPct = regime.avg_return_pct ?? 0;
                const volState = regime.volatility_state || "normal";
                const candle = regime.bar_character || "normal";
                return (
                  <tr key={regime.regime_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                        <span className="font-medium text-foreground truncate max-w-[150px]" title={regime.nickname || regime.label}>
                          {regime.nickname || regime.label?.replace(/_/g, " ") || `Regime ${regime.regime_id}`}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-muted-foreground">{regime.count.toLocaleString()}</td>
                    <td className={`text-right py-2 px-3 font-mono font-bold ${c.text}`}>{regime.pct.toFixed(1)}%</td>
                    <td className={`text-right py-2 px-3 font-mono ${returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(3)}%
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${VOL_COLORS[volState] || VOL_COLORS.normal}`}>
                        {volState.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className="text-[9px] text-muted-foreground">{CANDLE_LABELS[candle] || candle}</span>
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                      {regime.avg_duration.toFixed(1)} <span className="opacity-40">/</span> {regime.max_duration}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Regime Durations Chart */}
      {diagnostics.regime_stats && diagnostics.regime_stats.length > 0 && (
        <div className="h-[200px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Duration Distribution (bars per regime visit)</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={diagnostics.regime_stats.map(r => ({
              regime: r.nickname || r.label || `R${r.regime_id}`,
              avg: Number(r.avg_duration.toFixed(1)),
              max: r.max_duration,
            }))}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="regime" {...CHART_AXIS} fontSize={8} angle={-15} />
              <YAxis {...CHART_AXIS} label={{ value: "bars", angle: -90, position: "insideLeft", fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: "9px" }} />
              <Bar dataKey="avg" fill="hsl(350, 70%, 60%)" radius={[2, 2, 0, 0]} name="Avg Duration" />
              <Bar dataKey="max" fill="hsla(350, 70%, 60%, 0.3)" radius={[2, 2, 0, 0]} name="Max Duration" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}


// ─── Convergence: LL chart + active states chart ─────────────────────────────

function ConvergencePanel({ diagnostics, convergencePoints, nBarsForLL, llPerBar }: {
  diagnostics: Diagnostics; convergencePoints: ConvergencePoint[]; nBarsForLL: number; llPerBar: number;
}) {
  const finalLL = diagnostics.convergence_summary?.final_log_likelihood ?? 0;
  const finalStates = diagnostics.convergence_summary?.final_active_states ?? 0;
  const nIter = diagnostics.convergence_summary?.n_iterations ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Final LL/bar</div>
          <div className="text-xl font-bold font-mono text-violet-400">{llPerBar.toFixed(2)}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Total LL</div>
          <div className="text-xl font-bold font-mono text-violet-400/70">{finalLL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Final States</div>
          <div className="text-xl font-bold font-mono text-amber-400">{finalStates}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Iterations</div>
          <div className="text-xl font-bold font-mono text-foreground/70">{nIter}</div>
        </div>
      </div>

      {/* LL Convergence Chart */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Log-Likelihood per Bar over Gibbs Iterations</div>
        <div className="h-[260px]">
          {convergencePoints.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} label={{ value: "Gibbs Iteration", position: "bottom", fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis {...CHART_AXIS} tickFormatter={(v: number) => nBarsForLL > 1 ? (v / nBarsForLL).toFixed(1) : v.toLocaleString()} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [nBarsForLL > 1 ? `${(v / nBarsForLL).toFixed(3)} per bar` : v.toLocaleString(), "Log-Likelihood"]} />
                <Area type="monotone" dataKey="log_likelihood" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="LL (per bar)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">No convergence data</div>
          )}
        </div>
      </div>

      {/* Active States Chart */}
      {convergencePoints.some(p => p.n_active_states !== undefined) && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Active States over Gibbs Iterations</div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="stepAfter" dataKey="n_active_states" stroke="hsl(45, 90%, 55%)" strokeWidth={2} dot={false} name="Active States" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Entropy + Switch Rate + Self-Transition (new per-iter metrics) */}
      {convergencePoints.some(p => p.entropy !== undefined && p.entropy > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Entropy */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Entropy (regime balance)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Higher = more evenly spread</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toFixed(3), "Entropy"]} />
                  <Line type="monotone" dataKey="entropy" stroke="hsl(174, 72%, 56%)" strokeWidth={1.5} dot={false} name="Entropy" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Switch Rate */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Switch Rate
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Fraction of bars where regime changes</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toFixed(4), "Switch Rate"]} />
                  <Line type="monotone" dataKey="switch_rate" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} name="Switch Rate" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Self-Transition */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Self-Transition (stickiness)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Higher = stickier regimes</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} domain={[0, 1]} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Self-Transition"]} />
                  <Line type="monotone" dataKey="self_transition" stroke="hsl(142, 76%, 36%)" strokeWidth={1.5} dot={false} name="Self-Transition" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Avg Dwell */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Avg Dwell Time (bars per regime)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">How long the model stays in one mood</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [`${v.toFixed(1)} bars`, "Avg Dwell"]} />
                  <Line type="monotone" dataKey="avg_dwell" stroke="hsl(280, 65%, 60%)" strokeWidth={1.5} dot={false} name="Avg Dwell" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Walk-Forward: stability chart + window breakdown ────────────────────────

function WalkForwardPanel({ diagnostics, wfWindResults, stability }: {
  diagnostics: Diagnostics; wfWindResults: any[]; stability: number;
}) {
  return (
    <div className="space-y-4">
      {/* Stability summary */}
      <div className="flex gap-3">
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Stability Score</div>
          <div className="text-3xl font-bold font-mono text-emerald-400">{stability > 0 ? `${(stability * 100).toFixed(0)}%` : "--"}</div>
          <p className={`text-[10px] mt-1 ${getStabilityVerdict(stability).color}`}>{getStabilityVerdict(stability).text}</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Windows</div>
          <div className="text-3xl font-bold font-mono text-foreground/70">{diagnostics.walk_forward?.n_windows ?? 0}</div>
          <div className="text-[9px] text-muted-foreground/50 mt-1">sequential time periods</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Avg Confidence</div>
          <div className="text-3xl font-bold font-mono text-foreground/70">
            {diagnostics.walk_forward?.avg_oos_confidence
              ? `${(diagnostics.walk_forward.avg_oos_confidence * 100).toFixed(0)}%`
              : "--"}
          </div>
          <div className="text-[9px] text-muted-foreground/50 mt-1">average across windows</div>
        </div>
      </div>

      {/* Bar chart */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Confidence & Switch Rate per Window</div>
        <div className="h-[260px]">
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
                <Legend wrapperStyle={{ fontSize: "9px" }} />
                <Bar dataKey="confidence" fill="hsl(160, 60%, 45%)" radius={[2, 2, 0, 0]} name="Confidence %" />
                <Bar dataKey="switchRate" fill="hsl(45, 90%, 55%)" radius={[2, 2, 0, 0]} name="Switch Rate %" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">No walk-forward data</div>
          )}
        </div>
      </div>

      {/* Window details table */}
      {wfWindResults.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Window Details</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Window</th>
                <th className="text-right py-2 px-3 font-medium">Train</th>
                <th className="text-right py-2 px-3 font-medium">Test</th>
                <th className="text-right py-2 px-3 font-medium">Confidence</th>
                <th className="text-right py-2 px-3 font-medium">Switch Rate</th>
                <th className="text-center py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {wfWindResults.map((w, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-3 font-mono text-foreground">W{i + 1}</td>
                  <td className="text-right py-2 px-3 font-mono text-muted-foreground">{w.train_size?.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 font-mono text-muted-foreground">{w.test_size?.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 font-mono text-emerald-400">
                    {w.avg_confidence ? `${(w.avg_confidence * 100).toFixed(1)}%` : "--"}
                  </td>
                  <td className="text-right py-2 px-3 font-mono text-amber-400">
                    {w.switch_rate ? `${(w.switch_rate * 100).toFixed(1)}%` : "--"}
                  </td>
                  <td className="text-center py-2 px-3">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      w.failed ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"
                    }`}>
                      {w.failed ? "FAIL" : "PASS"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── OOS: distribution match, profile correlation, switch ratio ──────────────

function OOSPanel({ diagnostics, oos, oosSimilarity, profileCorrelation }: {
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
                    <div className="flex-1 rounded-t" style={{ height: `${Math.min(trainPct * 100 * 2, 64)}px`, backgroundColor: c.fill, opacity: 0.4 }} />
                    <div className="flex-1 rounded-t" style={{ height: `${Math.min(testPct * 100 * 2, 64)}px`, backgroundColor: c.fill }} />
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
                  <div className={`w-2 h-2 rounded-full ${c.bg} shrink-0`} />
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


// ─── Model Fit: deep dive into LL, fit gauge, convergence quality ────────────

function FitPanel({ diagnostics, convergencePoints, nBarsForLL, llPerBar, ll }: {
  diagnostics: Diagnostics; convergencePoints: ConvergencePoint[]; nBarsForLL: number; llPerBar: number; ll: number;
}) {
  const fitLevel = getFitLevel(llPerBar);
  const fitVerdict = getFitVerdict(llPerBar);

  // Calculate convergence quality metrics
  const lastN = convergencePoints.slice(-10);
  const avgDelta = lastN.length > 1
    ? lastN.reduce((sum, p, i) => i === 0 ? sum : sum + Math.abs((p.log_likelihood - lastN[i-1].log_likelihood)), 0) / (lastN.length - 1)
    : 0;
  const converged = avgDelta < Math.abs(ll * 0.001); // <0.1% change

  return (
    <div className="space-y-4">
      {/* Big LL/bar display */}
      <div className="flex gap-4 items-start">
        <div className="bg-white/[0.02] rounded-xl p-5 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Log-Likelihood per Bar</div>
          <div className="text-5xl font-bold font-mono text-violet-400">{llPerBar.toFixed(2)}</div>
          <p className={`text-[11px] mt-2 ${fitVerdict.color}`}>{fitVerdict.text}</p>
          <FitGauge level={fitLevel} />
          <div className="mt-3 text-[10px] text-muted-foreground/50">
            <span className="font-mono text-violet-400/60">{ll.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> total across {nBarsForLL.toLocaleString()} bars
          </div>
        </div>
        <div className="flex flex-col gap-3 w-48">
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Convergence</div>
            <div className={`text-lg font-bold font-mono ${converged ? "text-emerald-400" : "text-amber-400"}`}>
              {converged ? "Converged" : "Not yet"}
            </div>
            <div className="text-[9px] text-muted-foreground/50">avg Δ = {avgDelta.toFixed(0)} (last 10)</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Iterations</div>
            <div className="text-lg font-bold font-mono text-foreground/70">{diagnostics.convergence_summary?.n_iterations ?? 0}</div>
            <div className="text-[9px] text-muted-foreground/50">burn-in: {diagnostics.training_config?.burn_in ?? 0}</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Features</div>
            <div className="text-lg font-bold font-mono text-foreground/70">{diagnostics.n_features}</div>
            <div className="text-[9px] text-muted-foreground/50 truncate" title={diagnostics.feature_names?.join(", ")}>
              {diagnostics.feature_names?.slice(0, 3).join(", ")}...
            </div>
          </div>
        </div>
      </div>

      {/* Full convergence chart */}
      {convergencePoints.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Trajectory</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} tickFormatter={(v: number) => nBarsForLL > 1 ? (v / nBarsForLL).toFixed(1) : v.toLocaleString()} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [nBarsForLL > 1 ? `${(v / nBarsForLL).toFixed(3)} per bar` : v.toLocaleString(), "Log-Likelihood"]} />
                <Area type="monotone" dataKey="log_likelihood" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="LL" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Delta chart — how quickly convergence improved */}
      {convergencePoints.length > 2 && convergencePoints.some(p => p.delta !== undefined) && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Speed (Δ per iteration)</div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergencePoints.filter(p => p.delta !== undefined)}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="delta" stroke="hsl(160, 60%, 50%)" strokeWidth={1.5} dot={false} name="Delta (LL change)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
