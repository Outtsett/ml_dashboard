/**
 * LabelsStage — Stage 3 of the ML Studio pipeline.
 *
 * Pick a label generator (any of the dashboard's generators, declared in
 * `@shared/mlTaxonomy`), preview it live against `POST /api/labels/preview`
 * (full-range class distribution, balance ratio, a sample window of rows), and
 * save it as a label set: the rows are generated, validated and landed in the
 * lake under the label contract, and Stage 4 trains on exactly those rows. The
 * lifecycle strip beside the saved set says how far it has got — a set that
 * failed validation never lands, and the failing gate is shown here.
 *
 * The four kernel strategies (`next_close_direction`, `triple_barrier`,
 * `range_bucket`, `structural`) can also be generated inside the trainer; every
 * other generator trains from its landed set, so for those the save is required.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tag, RefreshCw, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { LABEL_GENERATORS } from "@shared/mlTaxonomy";
import type { LabelSetLifecycle } from "@shared/labels/contract";
import { useMLStudio, KERNEL_LABEL_STRATEGIES, type LabelStrategy } from "../MLStudioContext";
import { slug } from "../glossary/derived";
import { LabelLifecycleStrip } from "@/labels/LabelLifecycleStrip";

interface StrategyDef {
  id: LabelStrategy;
  label: string;
  description: string;
  category: string;
  kernel: boolean;
  defaults: Record<string, number | string | boolean>;
}

/**
 * Every generator with a per-bar label, in the order the taxonomy declares
 * them: the kernel strategies first (they train without a landed set), then the
 * rest. Contrastive generators produce pairs, not labels, and the per-pattern
 * TA-Lib ids are the chart's own; both stay out of this picker.
 */
const STRATEGIES: StrategyDef[] = Object.entries(LABEL_GENERATORS)
  .filter(([id, g]) => !id.startsWith("talib_") && g.category !== "contrastive")
  .map(([id, g]) => ({
    id,
    label: g.name,
    description: g.description,
    category: g.category,
    kernel: KERNEL_LABEL_STRATEGIES.includes(id),
    defaults: Object.fromEntries(
      (g.params as ReadonlyArray<{ id: string; default?: unknown }>)
        .filter((p) => p.default !== undefined && (typeof p.default === "number" || typeof p.default === "string" || typeof p.default === "boolean"))
        .map((p) => [p.id, p.default as number | string | boolean]),
    ),
  }))
  .sort((a, b) => Number(b.kernel) - Number(a.kernel));

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

interface LabelSetRow {
  id: number;
  stage: string;
  status: string;
  sampleCount: number;
  parquetPath: string | null;
  errorMessage: string | null;
  recipe: string | null;
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

const TERMINAL_STAGES = new Set(["landed", "cataloged", "consumed"]);

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

  // Save = generate, validate, land. The request answers at once with the
  // ledger row; the set is polled until it lands (or fails a gate).
  const [pendingSetId, setPendingSetId] = useState<number | null>(null);
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
      return body as { labelSetId: number; recipe?: string; stage?: string; existing?: boolean; parquetPath?: string; sampleCount?: number };
    },
    onSuccess: (saved) => {
      setPendingSetId(saved.labelSetId);
      if (saved.existing) toast.success(`Label set #${saved.labelSetId} already exists for this recipe`);
      else toast.message(`Label set #${saved.labelSetId} queued: generating, validating, landing…`);
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  const setQuery = useQuery<LabelSetRow>({
    queryKey: ["/api/labels", pendingSetId],
    enabled: pendingSetId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/labels/${pendingSetId}`);
      if (!res.ok) throw new Error(`Label set ${pendingSetId}: ${res.status}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const row = query.state.data;
      if (!row) return 2_000;
      return TERMINAL_STAGES.has(row.stage) || row.status === "failed" || (row.status === "completed" && row.stage !== "specified") ? false : 2_000;
    },
  });

  const lifecycleQuery = useQuery<{ lifecycle: Record<number, LabelSetLifecycle> }>({
    queryKey: ["/api/labels/lifecycle", "studio", pendingSetId ?? state.labelSet?.id ?? 0, setQuery.data?.stage ?? ""],
    enabled: (pendingSetId ?? state.labelSet?.id) !== undefined && (pendingSetId ?? state.labelSet?.id) !== null,
    queryFn: async () => {
      const res = await fetch("/api/labels/lifecycle?probe=0");
      if (!res.ok) throw new Error(`lifecycle ${res.status}`);
      return res.json();
    },
    staleTime: 5_000,
  });

  // When the pending set lands, it becomes the pipeline's saved set.
  useEffect(() => {
    const row = setQuery.data;
    if (!row || pendingSetId === null) return;
    if (TERMINAL_STAGES.has(row.stage) && row.parquetPath) {
      dispatch({
        type: "setLabelSet",
        labelSet: {
          id: row.id,
          parquetPath: row.parquetPath,
          sampleCount: row.sampleCount,
          strategy: state.labelStrategy,
          timeframe: state.timeframe,
        },
      });
      toast.success(`Label set #${row.id} landed — ${row.sampleCount.toLocaleString()} rows in the lake`);
      setPendingSetId(null);
    } else if (row.status === "failed" || (row.status === "completed" && row.stage === "generated")) {
      toast.error(`Label set #${row.id}: ${row.errorMessage ?? "did not land"}`);
      setPendingSetId(null);
    }
  }, [setQuery.data, pendingSetId, dispatch, state.labelStrategy, state.timeframe]);

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

  const savedLifecycle = state.labelSet ? lifecycleQuery.data?.lifecycle[state.labelSet.id] ?? null : null;
  const pendingLifecycle = pendingSetId !== null ? lifecycleQuery.data?.lifecycle[pendingSetId] ?? null : null;
  const kernelStrategy = strategyDef.kernel;
  const [showAll, setShowAll] = useState(false);
  const visibleStrategies = showAll ? STRATEGIES : STRATEGIES.filter((s) => s.kernel || s.id === state.labelStrategy);

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
            catch class collapse before burning a training run. Saving lands the rows in the lake
            once they pass validation; a landed set is what Stage 4 trains on.
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
            disabled={!ready || !data?.success || saveMutation.isPending || pendingSetId !== null}
            className="h-9 px-3 rounded-lg border border-primary/40 bg-primary/15 hover:bg-primary/25 text-xs flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            title="Generate, validate and land these labels in the lake; Stage 4 trains on them"
            data-testid="button-save-label-set"
          >
            <Tag className="h-3.5 w-3.5" />
            {pendingSetId !== null ? "Landing…" : saveMutation.isPending ? "Saving…" : "Save label set"}
          </button>
        </div>
      </header>

      {pendingSetId !== null && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="uppercase tracking-widest text-muted-foreground">Landing set</span>
          <span className="font-mono text-foreground">#{pendingSetId}</span>
          {pendingLifecycle ? <LabelLifecycleStrip lifecycle={pendingLifecycle} /> : <span className="font-mono text-muted-foreground">{setQuery.data?.stage ?? "specified"}</span>}
        </div>
      )}

      {state.labelSet && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="uppercase tracking-widest text-muted-foreground">Saved set</span>
          <span className="font-mono text-foreground">#{state.labelSet.id}</span>
          <span className="font-mono">{state.labelSet.strategy} · {state.labelSet.timeframe} · {state.labelSet.sampleCount.toLocaleString()} rows</span>
          {savedLifecycle && <LabelLifecycleStrip lifecycle={savedLifecycle} />}
          <span className="font-mono text-muted-foreground/70 truncate max-w-full">{state.labelSet.parquetPath}</span>
          <span className="text-muted-foreground">Stage 4 trains on these rows with purge ≥ {savedLifecycle?.purgeBars ?? "the label horizon"} bars.</span>
        </div>
      )}

      {!ready && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          Pick a feature pipeline in Stage 2 first.
        </div>
      )}

      {!kernelStrategy && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span><code className="font-mono">{strategyDef.id}</code> has no in-trainer kernel: save the label set and Stage 4 trains from the landed rows.</span>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleStrategies.map((s) => {
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
                  {!s.kernel && <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 border border-white/10 rounded px-1">landed set</span>}
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
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
      >
        {showAll ? "Show the four in-trainer strategies only" : `Show every generator (${STRATEGIES.length})`}
      </button>

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
            {distEntries.slice(0, 24).map((e) => {
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
            {distEntries.length > 24 && (
              <div className="text-[10px] text-muted-foreground">{distEntries.length - 24} more values (a continuous label); the landed set carries its histogram.</div>
            )}
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
