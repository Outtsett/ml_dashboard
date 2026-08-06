/**
 * FeaturesStage — Stage 2 of the ML Studio pipeline.
 *
 * P4: live feature-pipeline preview against `POST /api/training/features/preview`.
 * Shows per-feature stats, mean / max absolute correlation, redundant-pair
 * table, and a compact correlation heatmap. Result dispatches into
 * MLStudioContext.featurePreview which gates the Labels stage.
 *
 * The Python spawn (numba JIT cold-start ~10-15s + compute) is fired once
 * per (symbol, timeframe, pipelineId, sampleBars) tuple and cached for 5
 * minutes client-side; the user explicitly triggers via "Run preview" since
 * a multi-second compute is too expensive for an auto-on-change query.
 */

import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layers, Play, AlertTriangle, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useMLStudio } from "../MLStudioContext";

interface FeaturePipelineDef {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

interface FeaturesSection {
  pipelines?: Record<string, FeaturePipelineDef>;
  categories?: Record<string, { name: string; description: string }>;
  features?: Array<{ name: string; category: string }>;
}

interface ClientConfig {
  models?: Record<string, unknown>;
  features?: FeaturesSection;
  timeframes?: Record<string, number>;
}

interface FeatureStat {
  name: string;
  mean: number | null;
  std: number | null;
  skew: number | null;
  kurt: number | null;
  finiteRatio: number;
  p1: number | null;
  p99: number | null;
}

interface FeaturesPreviewResponse {
  success: boolean;
  symbol?: string;
  timeframe?: string;
  pipelineId?: string;
  rawBars?: number;
  sampleSize?: number;
  finiteRows?: number;
  featureCount?: number;
  featureNames?: string[];
  stats?: FeatureStat[];
  meanAbsCorr?: number;
  maxAbsCorr?: number;
  correlationMatrix?: number[][];
  redundantPairs?: Array<{ a: string; b: string; corr: number }>;
  redundancyThreshold?: number;
  timings?: { loadSec: number; computeSec: number; totalSec: number };
  error?: string;
}

const DEFAULT_SAMPLE_BARS = 50_000;

export function FeaturesStage() {
  const { state, dispatch } = useMLStudio();

  const { data: config } = useQuery<ClientConfig>({
    queryKey: ["/api/training/config"],
    queryFn: async () => {
      const res = await fetch("/api/training/config");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60_000,
  });

  const pipelines = useMemo(
    () =>
      Object.entries(config?.features?.pipelines ?? {}).map(([id, def]) => ({
        id,
        name: (def as FeaturePipelineDef).name ?? id,
        description: (def as FeaturePipelineDef).description as string | undefined,
      })),
    [config?.features?.pipelines],
  );
  const featureCount = config?.features?.features?.length ?? 0;
  const categoryCount = Object.keys(config?.features?.categories ?? {}).length;

  const ready = state.dataPreview != null;
  const pipelineId = state.featurePipelineId;
  const [sampleBars, setSampleBars] = useState<number>(DEFAULT_SAMPLE_BARS);
  const [lastResult, setLastResult] = useState<FeaturesPreviewResponse | null>(null);

  const previewMutation = useMutation<FeaturesPreviewResponse, Error, void>({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Select a pipeline first.");
      const res = await fetch("/api/training/features/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: state.symbol,
          timeframe: state.timeframe,
          pipelineId,
          sampleBars,
          ...(state.dateRange?.start && state.dateRange?.end
            ? { start: state.dateRange.start, end: state.dateRange.end }
            : {}),
        }),
      });
      const payload = (await res.json()) as FeaturesPreviewResponse;
      if (!payload.success) {
        throw new Error(payload.error ?? `Preview failed (HTTP ${res.status}).`);
      }
      return payload;
    },
    onSuccess: (data) => {
      setLastResult(data);
      if (
        typeof data.featureCount === "number" &&
        typeof data.meanAbsCorr === "number" &&
        typeof data.maxAbsCorr === "number"
      ) {
        dispatch({
          type: "setFeaturePreview",
          preview: {
            featureCount: data.featureCount,
            meanAbsCorr: data.meanAbsCorr,
            maxAbsCorr: data.maxAbsCorr,
          },
        });
      }
    },
  });

  // Reset stale preview when pipeline or symbol/tf changes — UI shouldn't
  // show stats for a different pipeline than what's selected.
  useEffect(() => {
    setLastResult(null);
  }, [pipelineId, state.symbol, state.timeframe]);

  const meanAbsTone = (() => {
    const v = lastResult?.meanAbsCorr;
    if (typeof v !== "number") return "text-muted-foreground";
    if (v < 0.3) return "text-emerald-300";
    if (v < 0.6) return "text-amber-300";
    return "text-red-300";
  })();

  const maxAbsTone = (() => {
    const v = lastResult?.maxAbsCorr;
    if (typeof v !== "number") return "text-muted-foreground";
    if (v < 0.7) return "text-emerald-300";
    if (v < 0.9) return "text-amber-300";
    return "text-red-300";
  })();

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Stage 2 — Features
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Pick the feature pipeline that will be applied to the data, then run a preview to
            audit per-feature distributions and pairwise correlations. Mean / max absolute
            correlation flag redundancy before training.
          </p>
        </div>
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={!ready || !pipelineId || previewMutation.isPending}
          className="h-9 px-3 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-xs flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Spawns a Python pipeline run on a sample window (numba JIT cold start ~10-15s)"
        >
          {previewMutation.isPending ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Computing…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Run preview
            </>
          )}
        </button>
      </header>

      {!ready && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          Run a data preview in Stage 1 first — feature stats depend on the bar count.
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Feature pipeline</label>
          <Select
            value={state.featurePipelineId ?? ""}
            onValueChange={(id) => dispatch({ type: "setFeaturePipeline", pipelineId: id })}
          >
            <SelectTrigger className="h-10 rounded-xl glass border-white/10">
              <SelectValue placeholder={pipelines.length === 0 ? "No pipelines registered" : "Select a pipeline"} />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state.featurePipelineId && (
            <p className="text-[11px] text-muted-foreground/70">
              Selected: <span className="font-mono text-foreground/80">{state.featurePipelineId}</span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Sample bars</label>
            <input
              type="number"
              min={500}
              max={500_000}
              step={500}
              value={sampleBars}
              onChange={(e) => setSampleBars(Math.max(500, Math.min(500_000, Number(e.target.value) || DEFAULT_SAMPLE_BARS)))}
              className="h-8 w-28 rounded-lg bg-white/[0.04] border border-white/10 px-2 text-xs font-mono"
            />
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 text-xs text-muted-foreground space-y-2">
          <div className="flex items-baseline gap-3 text-foreground/90">
            <span className="font-mono text-lg">{featureCount}</span>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">features registered</span>
            <span className="font-mono text-lg ml-3">{categoryCount}</span>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">categories</span>
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            Hit <span className="text-foreground/80">Run preview</span> to compute per-feature
            stats + correlation matrix on a {sampleBars.toLocaleString()}-bar sample. Pure
            numpy + numba; first run pays JIT cold-start cost.
          </div>
        </div>
      </section>

      {previewMutation.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {(previewMutation.error as Error)?.message ?? "Preview failed."}
        </div>
      )}

      {lastResult && lastResult.success && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatTile label="Features" value={(lastResult.featureCount ?? 0).toLocaleString()} />
            <StatTile
              label="Sample bars"
              value={(lastResult.sampleSize ?? 0).toLocaleString()}
              hint={
                lastResult.finiteRows != null
                  ? `${lastResult.finiteRows.toLocaleString()} finite rows`
                  : undefined
              }
            />
            <StatTile
              label="Mean |corr|"
              value={(lastResult.meanAbsCorr ?? 0).toFixed(3)}
              tone={meanAbsTone}
            />
            <StatTile
              label="Max |corr|"
              value={(lastResult.maxAbsCorr ?? 0).toFixed(3)}
              tone={maxAbsTone}
            />
            <StatTile
              label="Compute"
              value={lastResult.timings ? `${lastResult.timings.totalSec.toFixed(1)}s` : "—"}
              hint={
                lastResult.timings
                  ? `${lastResult.timings.loadSec.toFixed(1)}s load + ${lastResult.timings.computeSec.toFixed(1)}s features`
                  : undefined
              }
            />
          </section>

          {(lastResult.redundantPairs?.length ?? 0) > 0 && (
            <RedundantPairsTable
              pairs={lastResult.redundantPairs ?? []}
              threshold={lastResult.redundancyThreshold ?? 0.95}
            />
          )}

          {lastResult.correlationMatrix && lastResult.featureNames && (
            <CorrelationHeatmap
              names={lastResult.featureNames}
              matrix={lastResult.correlationMatrix}
            />
          )}

          {(lastResult.stats?.length ?? 0) > 0 && (
            <FeatureStatsTable stats={lastResult.stats ?? []} />
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg ${tone ?? "text-foreground/90"}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</div>}
    </div>
  );
}

function RedundantPairsTable({
  pairs,
  threshold,
}: {
  pairs: Array<{ a: string; b: string; corr: number }>;
  threshold: number;
}) {
  return (
    <section className="rounded-xl bg-red-500/[0.04] border border-red-500/20 p-4 space-y-2">
      <div className="flex items-baseline gap-3">
        <AlertTriangle className="h-4 w-4 text-red-300 self-center" />
        <span className="text-sm font-medium text-red-200">
          {pairs.length} redundant {pairs.length === 1 ? "pair" : "pairs"}
        </span>
        <span className="text-[11px] text-muted-foreground/80">
          |corr| ≥ {threshold.toFixed(2)} — consider dropping one of each pair
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs font-mono w-full">
          <thead>
            <tr className="text-left text-muted-foreground/70 border-b border-white/5">
              <th className="py-1.5 pr-4 font-normal">Feature A</th>
              <th className="py-1.5 pr-4 font-normal">Feature B</th>
              <th className="py-1.5 pr-4 font-normal text-right">|corr|</th>
              <th className="py-1.5 pr-4 font-normal">corr</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, idx) => (
              <tr key={`${p.a}_${p.b}_${idx}`} className="border-b border-white/5 last:border-b-0 text-foreground/80">
                <td className="py-1 pr-4 whitespace-nowrap">{p.a}</td>
                <td className="py-1 pr-4 whitespace-nowrap">{p.b}</td>
                <td className="py-1 pr-4 whitespace-nowrap text-right">{Math.abs(p.corr).toFixed(4)}</td>
                <td className={`py-1 pr-4 whitespace-nowrap ${p.corr < 0 ? "text-rose-300" : "text-sky-300"}`}>
                  {p.corr.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CorrelationHeatmap({
  names,
  matrix,
}: {
  names: string[];
  matrix: number[][];
}) {
  const n = names.length;
  // Cell colored by sign × magnitude. Blue = positive, red = negative,
  // alpha tracks |corr|. Diagonal pinned to 1.0.
  const cellColor = (v: number): string => {
    const a = Math.min(1, Math.abs(v));
    if (v >= 0) return `rgba(56, 189, 248, ${0.05 + 0.95 * a})`; // sky-400
    return `rgba(244, 63, 94, ${0.05 + 0.95 * a})`; // rose-500
  };

  return (
    <section className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Correlation heatmap</span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(244, 63, 94, 1)" }} />
          <span>−1.0</span>
          <span className="inline-block w-3 h-3 rounded bg-white/10" />
          <span>0</span>
          <span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(56, 189, 248, 1)" }} />
          <span>+1.0</span>
        </div>
      </div>
      <div className="overflow-auto max-h-[480px]">
        <div className="inline-block">
          <div className="flex">
            <div style={{ width: 100 }} />
            {names.map((nm) => (
              <div
                key={`top-${nm}`}
                className="text-[9px] text-muted-foreground/70 font-mono whitespace-nowrap"
                style={{
                  width: 14,
                  height: 70,
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  textAlign: "left",
                  paddingBottom: 4,
                }}
              >
                {nm}
              </div>
            ))}
          </div>
          {matrix.map((row, i) => (
            <div key={`row-${names[i]}`} className="flex items-center">
              <div
                className="text-[10px] text-muted-foreground/80 font-mono pr-2 text-right"
                style={{ width: 100 }}
                title={names[i]}
              >
                {names[i]}
              </div>
              {row.map((v, j) => (
                <div
                  key={`${i}-${j}`}
                  title={`${names[i]} × ${names[j]} = ${v.toFixed(3)}`}
                  style={{
                    width: 14,
                    height: 14,
                    background: i === j ? "rgba(56, 189, 248, 1)" : cellColor(v),
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                />
              ))}
            </div>
          ))}
          {/* Last row needs n labels */}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground/60">
        Hover cells for exact correlation. Diagonal pinned to +1.0. Tail bins (|r| ≥ 0.95) are
        listed above; investigate them before training to prevent multicollinearity-driven
        weight instability.
      </p>
    </section>
  );
}

function FeatureStatsTable({ stats }: { stats: FeatureStat[] }) {
  return (
    <section className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-2">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        Per-feature stats
      </div>
      <div className="overflow-auto max-h-[360px]">
        <table className="text-xs font-mono w-full">
          <thead className="sticky top-0 bg-[#0a0a0a]/90 backdrop-blur">
            <tr className="text-left text-muted-foreground/70 border-b border-white/5">
              <th className="py-1.5 pr-4 font-normal">name</th>
              <th className="py-1.5 pr-4 font-normal text-right">mean</th>
              <th className="py-1.5 pr-4 font-normal text-right">std</th>
              <th className="py-1.5 pr-4 font-normal text-right">skew</th>
              <th className="py-1.5 pr-4 font-normal text-right">excess kurt</th>
              <th className="py-1.5 pr-4 font-normal text-right">p1</th>
              <th className="py-1.5 pr-4 font-normal text-right">p99</th>
              <th className="py-1.5 pr-4 font-normal text-right">finite</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const finite = s.finiteRatio < 0.95 ? "text-amber-300" : "text-foreground/80";
              const fmt = (v: number | null, d = 4) =>
                v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);
              return (
                <tr key={s.name} className="border-b border-white/5 last:border-b-0 text-foreground/80">
                  <td className="py-1 pr-4 whitespace-nowrap">{s.name}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.mean)}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.std)}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.skew, 3)}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.kurt, 2)}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.p1)}</td>
                  <td className="py-1 pr-4 text-right">{fmt(s.p99)}</td>
                  <td className={`py-1 pr-4 text-right ${finite}`}>
                    {(s.finiteRatio * 100).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
