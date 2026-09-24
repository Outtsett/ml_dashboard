/**
 * LabelsStage — Stage 3 of the ML Studio pipeline.
 *
 * P4: live preview against `POST /api/labels/preview`. Returns full-range
 * class distribution + balance ratio (for stratification health) plus a
 * sample window of rows for visual sanity-check. Result feeds
 * MLStudioContext.labelPreview which gates the Train stage.
 *
 * The 4 strategies (next_close_direction / triple_barrier / range_bucket /
 * structural) map 1:1 to LABEL_SQL_GENERATORS keys on the server. Param
 * shapes match the server-side *Params interfaces directly — no translation
 * layer.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag, RefreshCw, AlertTriangle, Info } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMLStudio, type LabelStrategy } from "../MLStudioContext";
import { slug } from "../glossary/derived";

interface StrategyDef {
  id: LabelStrategy;
  label: string;
  description: string;
  defaults: Record<string, number | string | boolean>;
}

const STRATEGIES: StrategyDef[] = [
  {
    id: "next_close_direction",
    label: "Next-close direction",
    description: "Binary up/down on the next bar close. Cheapest target — high autocorrelation, watch for leakage.",
    defaults: { horizon: 1 },
  },
  {
    id: "triple_barrier",
    label: "Triple barrier",
    description: "López de Prado triple-barrier method — first hit of profit / stop / time barriers.",
    defaults: {
      takeProfitPct: 1.0,
      stopLossPct: 0.5,
      maxHoldingPeriod: 20,
      minReturn: 0.1,
      volatilityAdjust: false,
      volatilityWindow: 20,
    },
  },
  {
    id: "range_bucket",
    label: "Range bucket (K-class)",
    description: "Quantize next-N-bar range into K buckets. Headline metric: within-K-pt accuracy.",
    defaults: { horizon: 16, nBuckets: 21, bucketWidthPts: 2 },
  },
  {
    id: "structural",
    label: "Structural (HH/HL/LH/LL)",
    description: "Bar-level swing classification from rolling high/low. Useful for swing models.",
    defaults: { pivotLookback: 5 },
  },
];

interface LabelPreviewResponse {
  success: boolean;
  preview?: Array<Record<string, unknown>>;
  count?: number;
  distribution?: Record<string, number>;
  totalLabeledSamples?: number;
  classBalanceRatio?: number;
  error?: string;
  generatorType?: string;
}

const TF_TO_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

export function LabelsStage() {
  const { state, dispatch } = useMLStudio();
  const ready = state.featurePipelineId != null;

  const strategyDef = useMemo(
    () => STRATEGIES.find((s) => s.id === state.labelStrategy) ?? STRATEGIES[0]!,
    [state.labelStrategy],
  );

  // Use defaults if labelParams is empty (e.g. on first visit)
  const effectiveParams = useMemo(
    () => (Object.keys(state.labelParams).length > 0 ? state.labelParams : strategyDef.defaults),
    [state.labelParams, strategyDef.defaults],
  );

  const timeframeMinutes = TF_TO_MINUTES[state.timeframe] ?? 1;
  const startTimestamp = state.dateRange?.start ? new Date(state.dateRange.start).getTime() : undefined;
  const endTimestamp = state.dateRange?.end ? new Date(state.dateRange.end).getTime() : undefined;

  const previewQuery = useQuery<LabelPreviewResponse>({
    queryKey: [
      "/api/labels/preview",
      state.symbol,
      state.timeframe,
      state.labelStrategy,
      effectiveParams,
      startTimestamp ?? "__full__",
      endTimestamp ?? "__full__",
    ],
    queryFn: async () => {
      const res = await fetch("/api/labels/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generatorType: state.labelStrategy,
          symbol: state.symbol,
          params: effectiveParams,
          limit: 500,
          timeframeMinutes,
          startTimestamp,
          endTimestamp,
        }),
      });
      if (!res.ok) {
        throw new Error(`Preview failed: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
    enabled: ready,
    staleTime: 30_000,
    retry: 1,
  });

  const data = previewQuery.data;

  // Persist the previewed strategy as a label set: the rows land in the lake
  // and Stage 4 trains on exactly them. Without this, what was previewed and
  // what was trained were two computations that only happened to agree.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/labels/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${state.labelStrategy}-${state.symbol}-${state.timeframe}-${new Date().toISOString().slice(0, 16)}`,
          generatorType: state.labelStrategy,
          symbol: state.symbol,
          params: effectiveParams,
          timeframeMinutes,
          startTimestamp,
          endTimestamp,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error ?? `Save failed: ${res.status}`);
      }
      return body as { labelSetId: number; parquetPath: string; sampleCount: number };
    },
    onSuccess: (saved) => {
      dispatch({
        type: "setLabelSet",
        labelSet: {
          id: saved.labelSetId,
          parquetPath: saved.parquetPath,
          sampleCount: saved.sampleCount,
          strategy: state.labelStrategy,
          timeframe: state.timeframe,
        },
      });
      toast.success(`Label set #${saved.labelSetId} saved — ${saved.sampleCount.toLocaleString()} rows in the lake`);
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  // Sync server preview into MLStudioContext so the Train-stage gate opens
  useEffect(() => {
    if (data?.success && data.distribution && typeof data.classBalanceRatio === "number") {
      dispatch({
        type: "setLabelPreview",
        preview: {
          distribution: data.distribution,
          classBalanceRatio: data.classBalanceRatio,
        },
      });
    }
  }, [data, dispatch]);

  const distEntries = useMemo(() => {
    if (!data?.distribution) return [];
    return Object.entries(data.distribution)
      .map(([k, v]) => ({ key: k, count: v }))
      .sort((a, b) => {
        const na = Number(a.key);
        const nb = Number(b.key);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.key.localeCompare(b.key);
      });
  }, [data?.distribution]);

  const maxCount = useMemo(
    () => (distEntries.length > 0 ? Math.max(...distEntries.map((e) => e.count)) : 0),
    [distEntries],
  );

  const balanceWarn =
    typeof data?.classBalanceRatio === "number" &&
    data.classBalanceRatio < 0.1 &&
    data.classBalanceRatio > 0;

  const previewRows = (data?.preview ?? []).slice(0, 20);
  const previewColumns = useMemo(() => {
    if (previewRows.length === 0) return [] as string[];
    const first = previewRows[0]!;
    return Object.keys(first).filter(
      (k) => k !== "symbol" && first[k] !== undefined,
    );
  }, [previewRows]);

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" /> Stage 3 — Labels
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Pick the labeling strategy. Each strategy reshapes downstream training — wrong target,
            wrong model. The preview below shows the full-range class distribution so you can
            catch class collapse before burning a training run.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => previewQuery.refetch()}
            disabled={!ready || previewQuery.isFetching}
            className="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Re-run preview (bypasses 30s client cache)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${previewQuery.isFetching ? "animate-spin" : ""}`} />
            {previewQuery.isFetching ? "Previewing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!ready || !data?.success || saveMutation.isPending}
            className="h-9 px-3 rounded-lg border border-primary/40 bg-primary/15 hover:bg-primary/25 text-xs flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            title="Write these labels to the lake as a label set; Stage 4 trains on them"
            data-testid="button-save-label-set"
          >
            <Tag className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "Saving…" : "Save label set"}
          </button>
        </div>
      </header>

      {state.labelSet && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="uppercase tracking-widest text-muted-foreground">Saved set</span>
          <span className="font-mono text-foreground">#{state.labelSet.id}</span>
          <span className="font-mono">{state.labelSet.strategy} · {state.labelSet.timeframe} · {state.labelSet.sampleCount.toLocaleString()} rows</span>
          <span className="font-mono text-muted-foreground/70 truncate max-w-full">{state.labelSet.parquetPath}</span>
          <span className="text-muted-foreground">Stage 4 trains on these rows.</span>
        </div>
      )}

      {!ready && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          Pick a feature pipeline in Stage 2 first.
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {STRATEGIES.map((s) => {
          const active = state.labelStrategy === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                dispatch({ type: "setLabelStrategy", strategy: s.id, params: s.defaults })
              }
              className={[
                "text-left p-4 rounded-xl border transition-all",
                active
                  ? "bg-primary/10 border-primary/40 shadow-[0_0_0_1px_rgba(99,102,241,0.15)]"
                  : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/15",
              ].join(" ")}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground">{s.label}</span>
                <span className="flex items-center gap-1">
                  <code className="text-[10px] font-mono text-muted-foreground/70">{s.id}</code>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`${s.label} in the glossary`}
                    className="text-muted-foreground/50 hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`/glossary#label-${slug(s.id)}`, "_blank");
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.stopPropagation();
                      e.preventDefault();
                      window.open(`/glossary#label-${slug(s.id)}`, "_blank");
                    }}
                  >
                    <Info className="h-3 w-3" aria-hidden="true" />
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
            </button>
          );
        })}
      </section>

      {ready && previewQuery.isError && (
        <div className="rounded-xl border border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.05)] px-4 py-3 text-sm text-[hsl(var(--data-neg))] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Preview failed: {(previewQuery.error as Error)?.message ?? "unknown error"}
        </div>
      )}

      {ready && data?.success === false && data.error && (
        <div className="rounded-xl border border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.05)] px-4 py-3 text-sm text-[hsl(var(--data-neg))] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {data.error}
        </div>
      )}

      {ready && data?.success && distEntries.length > 0 && (
        <section className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-4">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div className="flex items-baseline gap-3 text-foreground/90">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Class distribution</span>
              <span className="font-mono text-base">
                {(data.totalLabeledSamples ?? 0).toLocaleString()} samples
              </span>
              <span className="text-[11px] text-muted-foreground/70">across {distEntries.length} {distEntries.length === 1 ? "class" : "classes"}</span>
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="uppercase tracking-widest text-muted-foreground">Balance ratio</span>
              <span
                className={`font-mono ${
                  balanceWarn ? "text-[hsl(var(--data-neg))]" : (data.classBalanceRatio ?? 0) >= 0.4 ? "text-[hsl(var(--data-pos))]" : "text-amber-300"
                }`}
              >
                {((data.classBalanceRatio ?? 0)).toFixed(3)}
              </span>
              {balanceWarn && (
                <span className="text-[hsl(var(--data-neg)/0.8)]">— rare-event imbalance, consider focal loss / SMOTE</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {distEntries.map((e) => {
              const pct = data.totalLabeledSamples
                ? (e.count / data.totalLabeledSamples) * 100
                : 0;
              const widthPct = maxCount > 0 ? (e.count / maxCount) * 100 : 0;
              return (
                <div key={e.key} className="flex items-center gap-3 text-xs">
                  <code className="font-mono text-foreground/80 w-12 text-right">{e.key}</code>
                  <div className="flex-1 h-5 rounded bg-white/[0.04] overflow-hidden relative">
                    <div
                      className="h-full bg-primary/40 border-r border-primary/60"
                      style={{ width: `${widthPct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-end pr-2 text-foreground/80 font-mono">
                      {e.count.toLocaleString()}
                      <span className="text-muted-foreground/60 ml-1.5">({pct.toFixed(1)}%)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {ready && previewRows.length > 0 && (
        <section className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Sample rows ({previewRows.length} of {data?.count ?? 0} returned)
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs font-mono w-full">
              <thead>
                <tr className="text-left text-muted-foreground/70 border-b border-white/5">
                  {previewColumns.map((col) => (
                    <th key={col} className="py-1.5 pr-4 font-normal">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-white/5 last:border-b-0 text-foreground/80">
                    {previewColumns.map((col) => {
                      const val = row[col];
                      let display: string;
                      if (col === "timestamp" && typeof val === "number") {
                        display = new Date(val).toISOString().replace("T", " ").slice(0, 19);
                      } else if (typeof val === "number") {
                        display = Number.isInteger(val) ? String(val) : val.toFixed(4);
                      } else {
                        display = val == null ? "" : String(val);
                      }
                      return (
                        <td key={col} className="py-1 pr-4 whitespace-nowrap">{display}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
