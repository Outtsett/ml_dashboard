/**
 * Labels — the catalog of label sets and where each one stands.
 *
 * Think of it as: the shipping office for labels. Every set the dashboard has
 * been asked for is a row; the strip beside it is how far it has got
 * (specified → generated → validated → landed → cataloged → consumed), the
 * validation report is what the inspector measured, and the suite button is
 * the standing order that labels the lake's data for the instruments Tyler
 * trades. A landed set can be drawn on the Market chart with one click.
 */
import { useMemo, useState } from "react";
import { ReadByNotebooks } from "@/marimo/ReadByNotebooks";
import { Tags, Play, RefreshCw, Eye, Archive, RotateCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import { useQuery } from "@tanstack/react-query";
import { LABEL_LIFECYCLE_STAGES, type LabelLifecycleStage, type LabelSetLifecycle, type LabelValidationReport, type EightNumberSummary } from "@shared/labels/contract";
import { LabelLifecycleStrip, LabelLifecyclePanel, STAGE_TEXT } from "./LabelLifecycleStrip";
import { useLabelActions, useLabelLifecycle, useLabelSets, useLabelSuite, parseValidation, type LabelSetRecord } from "./useLabelLifecycle";
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR, MARKER_NEUTRAL_COLOR } from "@/market/components/chartConfig";

/** Ask the Market chart to overlay a landed set (`useLabelOverlay` listens). */
export const LABEL_OVERLAY_EVENT = "label-overlay:select";

function requestOverlay(labelSetId: number) {
  window.dispatchEvent(new CustomEvent(LABEL_OVERLAY_EVENT, { detail: { generatorType: `set:${labelSetId}` } }));
}

function timeframeText(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatNumber(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value.toFixed(digits);
}

function DistributionBar({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution)
    .map(([key, count]) => ({ value: Number(key), key, count }))
    .sort((a, b) => a.value - b.value);
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  if (total === 0) return <span className="text-[10px] text-muted-foreground">no rows</span>;
  const signed = entries.every((e) => Number.isFinite(e.value) && e.value >= -2 && e.value <= 2);
  return (
    <div className="flex flex-col gap-0.5 min-w-[140px]">
      <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-white/5">
        {entries.map((e, i) => {
          // Okabe-Ito: orange up, blue down, grey flat; a wider vocabulary
          // walks the cividis ramp so order survives without hue.
          const color = signed
            ? e.value > 0 ? CANDLE_UP_COLOR : e.value < 0 ? CANDLE_DOWN_COLOR : MARKER_NEUTRAL_COLOR
            : `hsl(${220 - (i / Math.max(1, entries.length - 1)) * 170} 60% ${35 + (i / Math.max(1, entries.length - 1)) * 40}%)`;
          return <span key={e.key} title={`${e.key}: ${e.count.toLocaleString()}`} style={{ width: `${(e.count / total) * 100}%`, background: color }} />;
        })}
      </div>
      <div className="flex gap-2 text-[10px] font-mono text-muted-foreground flex-wrap">
        {entries.slice(0, 6).map((e) => (
          <span key={e.key}>{signed ? (e.value > 0 ? "▲" : e.value < 0 ? "▼" : "●") : "▪"} {e.key}: {((e.count / total) * 100).toFixed(1)}%</span>
        ))}
        {entries.length > 6 && <span>+{entries.length - 6} classes</span>}
      </div>
    </div>
  );
}

function EightNumbers({ title, summary, unit }: { title: string; summary: EightNumberSummary; unit: string }) {
  const rows: Array<[string, number | null]> = [
    ["mean", summary.mean], ["median", summary.median], ["standard deviation", summary.standardDeviation],
    ["skewness", summary.skewness], ["kurtosis (excess)", summary.kurtosis],
    ["25th percentile", summary.percentile25], ["75th percentile", summary.percentile75],
    ["minimum", summary.minimum], ["maximum", summary.maximum],
  ];
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
      <div className="text-[11px] font-medium mb-1">{title} <span className="text-muted-foreground font-normal">({unit}, n = {summary.count.toLocaleString()})</span></div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] font-mono">
        {rows.map(([name, value]) => (
          <div key={name} className="flex justify-between gap-2"><span className="text-muted-foreground">{name}</span><span>{formatNumber(value)}</span></div>
        ))}
      </div>
    </div>
  );
}

function ValidationReport({ report }: { report: LabelValidationReport }) {
  const gateName: Record<string, string> = {
    resolutionMonotone: "Resolution after event",
    noDuplicateEvents: "One row per event bar",
    coverage: "Coverage of the bars",
    classBalance: "Class balance",
    purgeCoversHorizon: "Purge covers the horizon",
    noLookahead: "No lookahead (truncation test)",
    usableShare: "Usable rows",
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {Object.entries(report.gates).map(([key, gate]) => (
          <div key={key} className="flex items-start gap-2 text-[11px] rounded border border-white/5 px-2 py-1">
            {gate.passed ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: CANDLE_UP_COLOR }} /> : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: CANDLE_DOWN_COLOR }} />}
            <div className="min-w-0">
              <div className="font-medium">{gateName[key] ?? key} <span className="font-mono text-muted-foreground">{gate.passed ? "pass" : "FAIL"}</span></div>
              <div className="text-muted-foreground leading-tight">{gate.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <EightNumbers title="Realized return" summary={report.realizedReturnPoints} unit="points" />
        <EightNumbers title="Realized return" summary={report.realizedReturnVolatilityUnits} unit="volatility units" />
        <EightNumbers title="Sample uniqueness weight" summary={report.sampleUniquenessWeight} unit="fraction" />
      </div>
      <div className="text-[10px] font-mono text-muted-foreground">
        usable reasons: {Object.entries(report.usableReasonCounts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(" · ")}
        {report.coverageFraction !== null && ` · coverage ${(report.coverageFraction * 100).toFixed(1)}%`}
      </div>
    </div>
  );
}

const ALL_STAGES: Array<LabelLifecycleStage | "all"> = ["all", ...LABEL_LIFECYCLE_STAGES];

export default function LabelsPage() {
  const [stageFilter, setStageFilter] = useState<LabelLifecycleStage | "all">("all");
  const [symbolFilter, setSymbolFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const { activeEntity } = useEntityStore();
  
  // Fetch trained models so we can cross-reference label sets used by the active model
  const { data: models } = useQuery<any[]>({
    queryKey: ["/api/training/models"],
    staleTime: 30_000,
  });

  const activeModelLabelSetIds = useMemo(() => {
    if (activeEntity?.type !== "model" || !models) return new Set<number>();
    const m = models.find(x => x.id === activeEntity.id);
    if (!m) return new Set<number>();
    const ids = new Set<number>();
    const conf = m.training_config;
    if (conf) {
      if (typeof conf.label_set_id === "number") ids.add(conf.label_set_id);
      if (typeof conf.labelSetId === "number") ids.add(conf.labelSetId);
      if (conf.dataset && typeof conf.dataset.label_set_id === "number") ids.add(conf.dataset.label_set_id);
    }
    return ids;
  }, [activeEntity, models]);

  const suite = useLabelSuite(true);
  const live = Boolean(suite.data?.state.running);
  const lifecycle = useLabelLifecycle(live);
  const sets = useLabelSets(live);
  const actions = useLabelActions();

  const rows = useMemo(() => {
    const byId = lifecycle.data?.lifecycle ?? {};
    const all = (sets.data ?? []).map((set) => ({ set, life: byId[set.id] ?? null }));
    return all
      .filter(({ life }) => stageFilter === "all" || life?.stage === stageFilter)
      .filter(({ set }) => symbolFilter === "all" || set.symbol === symbolFilter)
      .filter(({ set }) => {
        if (activeEntity?.type === "model" && activeModelLabelSetIds.size > 0) {
          return activeModelLabelSetIds.has(set.id);
        }
        return true;
      })
      .sort((a, b) => (b.set.updatedAt > a.set.updatedAt ? 1 : -1));
  }, [sets.data, lifecycle.data, stageFilter, symbolFilter, activeEntity, activeModelLabelSetIds]);

  const symbols = useMemo(() => Array.from(new Set((sets.data ?? []).map((s) => s.symbol))).sort(), [sets.data]);
  const stageCounts = useMemo(() => {
    const counts: Partial<Record<LabelLifecycleStage, number>> = {};
    for (const life of Object.values(lifecycle.data?.lifecycle ?? {})) counts[life.stage] = (counts[life.stage] ?? 0) + 1;
    return counts;
  }, [lifecycle.data]);

  const suiteState = suite.data?.state;

  return (
    <PageShell
      title="Labels"
      subtitle="Every label set, its lifecycle, its validation report, and the suite that labels the lake"
      icon={Tags}
    >
      {activeEntity && (
        <div className="bg-primary/20 border-b border-primary/30 px-4 py-2 text-sm text-primary flex items-center gap-2">
          <span className="font-semibold">Active Context:</span>
          <span>{activeEntity.name}</span>
        </div>
      )}
      <div className="p-4 space-y-4">
        {/* Suite */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Canonical suite</div>
            <div className="text-xs text-muted-foreground">
              {suite.data ? `${suite.data.entries.length} recipes: MNQ at 1, 5 and 15 minutes (10 generators each), ES and NQ at 5 minutes.` : "Loading…"}
              {suiteState?.running && ` Running ${suiteState.completed}/${suiteState.total}: ${suiteState.current ?? ""}`}
              {!suiteState?.running && suiteState?.finishedAt && ` Last run finished ${new Date(suiteState.finishedAt).toLocaleString()} (${suiteState.completed} sets).`}
            </div>
            <ReadByNotebooks tables={["derived_labels"]} prefix="Every landed set, in" />
          </div>
          <button
            type="button"
            onClick={() => actions.runSuite.mutate({})}
            disabled={live || actions.runSuite.isPending}
            className="h-8 px-3 rounded-lg border border-primary/40 bg-primary/15 hover:bg-primary/25 text-xs flex items-center gap-2 disabled:opacity-40"
            data-testid="button-run-label-suite"
          >
            {live ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {live ? "Running" : "Run the suite"}
          </button>
          <button
            type="button"
            onClick={() => actions.invalidate()}
            className="h-8 px-2 rounded-lg border border-white/10 hover:bg-white/[0.06] text-xs flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </section>

        {/* Stage summary */}
        <section className="flex flex-wrap gap-1.5">
          {ALL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setStageFilter(stage)}
              className={`h-7 px-2 rounded-md border text-[11px] font-mono ${stageFilter === stage ? "border-primary/50 bg-primary/15" : "border-white/10 hover:bg-white/[0.05]"}`}
            >
              {stage === "all" ? "all" : STAGE_TEXT[stage].toLowerCase()} {stage === "all" ? Object.keys(lifecycle.data?.lifecycle ?? {}).length : stageCounts[stage] ?? 0}
            </button>
          ))}
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="h-7 rounded-md border border-white/10 bg-black/30 px-2 text-[11px] font-mono"
          >
            <option value="all">every symbol</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </section>

        {/* Catalog */}
        <section className="rounded-xl border border-white/10 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Set</th>
                <th className="text-left px-3 py-2">Lifecycle</th>
                <th className="text-left px-3 py-2">Distribution</th>
                <th className="text-right px-3 py-2">Rows</th>
                <th className="text-right px-3 py-2">Horizon</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {sets.isLoading ? "Loading…" : "No label sets match. Run the suite or save one from ML Studio's Labels stage."}
                </td></tr>
              )}
              {rows.map(({ set, life }) => (
                <LabelRow
                  key={set.id}
                  set={set}
                  life={life}
                  open={openId === set.id}
                  onToggle={() => setOpenId(openId === set.id ? null : set.id)}
                  onOverlay={() => requestOverlay(set.id)}
                  onRegenerate={() => actions.regenerate.mutate(set.id)}
                  onRetire={() => actions.retire.mutate({ labelSetId: set.id })}
                />
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </PageShell>
  );
}

function LabelRow({
  set, life, open, onToggle, onOverlay, onRegenerate, onRetire,
}: {
  set: LabelSetRecord;
  life: LabelSetLifecycle | null;
  open: boolean;
  onToggle: () => void;
  onOverlay: () => void;
  onRegenerate: () => void;
  onRetire: () => void;
}) {
  const report = parseValidation(set.validation);
  let distribution: Record<string, number> = {};
  try {
    distribution = set.labelDistribution ? JSON.parse(set.labelDistribution) : {};
  } catch {
    distribution = {};
  }
  const landed = Boolean(set.parquetPath) && life?.reached.includes("landed");
  return (
    <>
      <tr className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={onToggle} data-testid={`label-row-${set.id}`}>
        <td className="px-3 py-2 align-top">
          <div className="font-medium">{set.name}</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            #{set.id} · {set.generatorType} · {set.symbol} {timeframeText(set.timeframeMinutes)}{set.recipe ? ` · ${set.recipe}` : ""}
          </div>
          {set.errorMessage && <div className="text-[10px] mt-0.5" style={{ color: CANDLE_DOWN_COLOR }}>{set.errorMessage}</div>}
        </td>
        <td className="px-3 py-2 align-top">
          {life ? <LabelLifecycleStrip lifecycle={life} /> : <span className="text-[10px] text-muted-foreground">{set.stage}</span>}
        </td>
        <td className="px-3 py-2 align-top"><DistributionBar distribution={distribution} /></td>
        <td className="px-3 py-2 align-top text-right font-mono">{set.sampleCount.toLocaleString()}</td>
        <td className="px-3 py-2 align-top text-right font-mono">{set.maxHorizonBars ?? "—"}</td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={onOverlay} disabled={!landed} title="Draw this set on the Market chart" className="h-7 w-7 rounded border border-white/10 hover:bg-white/[0.06] disabled:opacity-30 flex items-center justify-center"><Eye className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onRegenerate} title="Regenerate in place (same recipe)" className="h-7 w-7 rounded border border-white/10 hover:bg-white/[0.06] flex items-center justify-center"><RotateCw className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onRetire} disabled={Boolean(set.retiredAt)} title="Retire (the parquet stays in the lake)" className="h-7 w-7 rounded border border-white/10 hover:bg-white/[0.06] disabled:opacity-30 flex items-center justify-center"><Archive className="h-3.5 w-3.5" /></button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-white/5 bg-black/20">
          <td colSpan={6} className="px-3 py-3 space-y-3">
            {life && <LabelLifecyclePanel lifecycle={life} />}
            {set.parquetPath && <div className="text-[10px] font-mono text-muted-foreground break-all">{set.parquetPath}</div>}
            <div className="text-[10px] font-mono text-muted-foreground break-all">parameters {set.config}</div>
            {report ? <ValidationReport report={report} /> : <div className="text-xs text-muted-foreground">No validation report yet.</div>}
          </td>
        </tr>
      )}
    </>
  );
}
