/**
 * The Versions view of the run page: the open run's line (same model, same
 * symbol and timeframe) side by side, from the same `RunView` the run page
 * reads, so nothing here is a second definition of anything.
 *
 *   readouts   every headline metric, one row per run, the best in each column marked
 *   verdicts   how many critical / warning findings each run carries, by when it ran
 *   overlays   validation loss by step, net profit by session day, calibration — every run on one axis
 *   per run    the panels its family owns (loss surface for a neural fit), one card per run
 *
 * Comparisons are saved on disk through `/api/runs/comparisons`.
 */
import { useState, type ReactNode } from "react";
import { useSearchParams } from "wouter";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import type { RunListItem, RunView } from "@shared/runs/types";
import { TILE_SPECS } from "@shared/runs/view";
import { CYCLE_METRIC_NAMES, type CycleMetricName } from "@shared/cycle/schema";
import { FAMILY_LABELS as METRIC_FAMILY_LABELS, SPECS, type Family } from "@/runs/foldGrid";
import { COIN_FLIP_LOG_LOSS } from "@shared/runs/verdicts";
import { useRunnableModels } from "@/runs/api";
import { shortModelType, STATUS_STYLE } from "@/runs/format";
import { analyticsFamilyOf, FAMILY_LABELS, FAMILY_PANELS } from "@/runs/analytics/families";
import { Chip, LossSurfacePanel } from "@/runs/learning";
import { useComparisons, useDeleteComparison, useRunViews, useSaveComparison } from "@/runs/compare/api";
import { howComputed } from "@/runs/howComputed";

const MAX_RUNS = 6;
/** One colour per chosen run, Okabe-Ito. */
const RUN_COLORS = ["#E69F00", "#56B4E9", "#CC79A7", "#009E73", "#0072B2", "#D55E00"];
const AXIS = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const GRID = "hsl(var(--border))";
const TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11, fontFamily: "ui-monospace, monospace" } as const;

function Frame({ title, caption, children, controls }: { title: string; caption: string; children: ReactNode; controls?: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">{title}</div>
          <div className="text-[11px] leading-snug text-muted-foreground">{caption}</div>
        </div>
        {controls && <div className="flex flex-wrap items-center gap-1">{controls}</div>}
      </div>
      <div className="mt-2 h-60">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{children}</div>;
}

// ─── saved comparisons ──────────────────────────────────────────────────────

function Saved({ chosen, onOpen }: { chosen: string[]; onOpen: (ids: string[]) => void }) {
  const comparisons = useComparisons();
  const save = useSaveComparison();
  const remove = useDeleteComparison();
  const [name, setName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card/40 px-3 py-1.5" data-testid="saved-comparisons">
      <span className="font-mono text-[11px] font-bold uppercase text-foreground">Saved</span>
      {(comparisons.data ?? []).map((entry) => (
        <span key={entry.id} className="flex items-center gap-1 rounded border border-border font-mono text-[11px]">
          <button type="button" onClick={() => onOpen(entry.runIds)} className="cursor-pointer px-2 py-0.5 text-foreground hover:bg-foreground/10" title={`${entry.runIds.length} runs`}>
            {entry.name}
          </button>
          <button type="button" onClick={() => remove.mutate(entry.id)} className="cursor-pointer px-1.5 text-muted-foreground hover:text-foreground" aria-label={`Delete ${entry.name}`}>×</button>
        </span>
      ))}
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={chosen.length === 0 ? "Pick runs to save a comparison" : "Name this comparison"}
        disabled={chosen.length === 0}
        className="ml-auto h-6 w-56 rounded border border-border bg-transparent px-2 font-mono text-[11px] outline-none disabled:opacity-50"
      />
      <button
        type="button"
        disabled={chosen.length === 0 || name.trim() === "" || save.isPending}
        onClick={() => {
          save.mutate({ name: name.trim(), runIds: chosen });
          setName("");
        }}
        className="cursor-pointer rounded bg-[#E69F00] px-2 py-0.5 font-mono text-[11px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}

// ─── readouts: one row per run ──────────────────────────────────────────────

function ReadoutTable({ views }: { views: RunView[] }) {
  // every scoreboard metric is a column, grouped by family; a version shows its final
  // number, or its latest fold's while it is still running, or "—"
  const [family, setFamily] = useState<Family | "all">("all");
  const valueOf = (view: RunView, name: CycleMetricName): { value: number | null; provisional: boolean } => {
    const final = view.metrics[name];
    if (final !== null && final !== undefined && Number.isFinite(final)) return { value: final, provisional: false };
    for (let index = view.folds.length - 1; index >= 0; index -= 1) {
      const fold = view.folds[index]!.metrics[name];
      if (fold !== null && fold !== undefined && Number.isFinite(fold)) return { value: fold, provisional: true };
    }
    return { value: null, provisional: false };
  };
  const names = CYCLE_METRIC_NAMES.filter((name) => family === "all" || SPECS[name].family === family);
  const better = (name: CycleMetricName): "higher" | "lower" | "none" => TILE_SPECS.find((spec) => spec.name === name)?.better ?? (/loss|error|drawdown|cost/.test(name) ? "lower" : "higher");
  const bestOf = (name: CycleMetricName) => {
    const direction = better(name);
    if (direction === "none") return null;
    const values = views.map((view) => valueOf(view, name).value).filter((value): value is number => value !== null);
    if (values.length < 2) return null;
    return direction === "higher" ? Math.max(...values) : Math.min(...values);
  };
  const families = (["trading", "prediction", "price"] as Family[]);
  return (
    <div className="rounded-md border border-border bg-card/60" data-testid="readout-table">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-1 text-[11px] font-semibold text-foreground">Every metric, one row per version</span>
        <span className="mr-2 text-[10px] text-muted-foreground">{CYCLE_METRIC_NAMES.length} metrics; a running version shows its latest fold's number in italics until the run ends. Hover a heading for exactly how the engine computes it.</span>
        <Chip active={family === "all"} onClick={() => setFamily("all")}>All</Chip>
        {families.map((entry) => (
          <Chip key={entry} active={family === entry} onClick={() => setFamily(entry)}>{METRIC_FAMILY_LABELS[entry]}</Chip>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 bg-card px-2 py-1.5">Version</th>
              {names.map((name) => (
                <th key={name} className="cursor-help whitespace-nowrap px-2 py-1.5 text-right" title={howComputed(name, SPECS[name].label) + "\n\n" + SPECS[name].meaning}>{SPECS[name].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {views.map((view, index) => (
              <tr key={view.id} className="border-b border-border/50">
                <td className="sticky left-0 whitespace-nowrap bg-card px-2 py-1.5">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: RUN_COLORS[index % RUN_COLORS.length] }} />
                  <span className="font-semibold text-foreground">{view.version ? `v${view.version}` : view.name}</span>
                  <span className="text-muted-foreground"> · {view.name} · {STATUS_STYLE[view.status].label}{view.status === "running" ? ` · ${view.folds.length} fold${view.folds.length === 1 ? "" : "s"} so far` : ""}</span>
                </td>
                {names.map((name) => {
                  const { value, provisional } = valueOf(view, name);
                  const best = bestOf(name);
                  const isBest = best !== null && value === best;
                  return (
                    <td key={name} className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${isBest ? "font-bold text-[#E69F00]" : "text-foreground"} ${provisional ? "italic" : ""}`} title={provisional ? "the latest finished fold's number; the run is not over" : undefined}>
                      {value === null ? "—" : SPECS[name].format(value)}{isBest ? " ★" : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-2 py-1 text-[10px] text-muted-foreground">★ the best of the chosen versions in that column (higher or lower as the metric wants). The run page judges each against its baseline; this table only ranks.</div>
    </div>
  );
}

// ─── verdict counts by run date ─────────────────────────────────────────────

function VerdictScatter({ views }: { views: RunView[] }) {
  const rows = views.map((view, index) => ({
    at: view.startedAt,
    critical: view.verdicts.filter((verdict) => verdict.severity === "critical").length,
    warning: view.verdicts.filter((verdict) => verdict.severity === "warning").length,
    name: view.name,
    color: RUN_COLORS[index % RUN_COLORS.length],
  }));
  return (
    <Frame title="Findings per run, by when it ran" caption="Each dot is one run placed at its start time; height is how many critical findings it carries (a hollow ring is its warnings). Down and to the right is progress.">
      {rows.length === 0 ? (
        <Empty>Pick runs on the left.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} tickFormatter={(value: number) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
            <YAxis type="number" tick={AXIS} width={32} allowDecimals={false} />
            <ZAxis range={[60, 60]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number, name: string) => [value, name]} labelFormatter={() => ""} />
            {rows.map((row) => (
              <Scatter key={`${row.name}-c`} name={`${row.name} critical`} data={[{ at: row.at, value: row.critical }]} dataKey="value" fill={row.color} isAnimationActive={false} />
            ))}
            {rows.map((row) => (
              <Scatter key={`${row.name}-w`} name={`${row.name} warnings`} data={[{ at: row.at, value: row.warning }]} dataKey="value" fill="none" stroke={row.color} strokeWidth={2} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}

// ─── overlays ───────────────────────────────────────────────────────────────

function LossOverlay({ views }: { views: RunView[] }) {
  const [fold, setFold] = useState(0);
  const bySteps = new Map<number, Record<string, number | null>>();
  for (const [index, view] of views.entries()) {
    for (const point of view.epochs) {
      if (point.modelRole !== "direction" || point.foldIndex !== fold) continue;
      const row = bySteps.get(point.step) ?? { step: point.step };
      row[`run_${index}`] = point.validationLoss;
      bySteps.set(point.step, row);
    }
  }
  const rows = [...bySteps.values()].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const foldCount = Math.max(0, ...views.map((view) => view.setup?.foldCount ?? 0));
  return (
    <Frame
      title="Validation loss by step, every run on one axis"
      caption="The direction model's validation log loss as each run's fit progressed, one colour per run; the grey line is a coin flip. Lower, sooner, is better."
      controls={Array.from({ length: foldCount }, (_, index) => (
        <Chip key={index} active={fold === index} onClick={() => setFold(index)}>Fold {index + 1}</Chip>
      ))}
    >
      {rows.length === 0 ? (
        <Empty>No training steps for this fold in the chosen runs.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} />
            <YAxis tick={AXIS} width={48} domain={["auto", "auto"]} tickFormatter={(value: number) => value.toFixed(3)} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(step) => `step ${step}`} formatter={(value: number) => value.toFixed(4)} />
            <ReferenceLine y={COIN_FLIP_LOG_LOSS} stroke="#808A99" strokeDasharray="6 3" />
            {views.map((view, index) => (
              <Line key={view.id} dataKey={`run_${index}`} name={view.name} stroke={RUN_COLORS[index % RUN_COLORS.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}

function EquityOverlay({ views }: { views: RunView[] }) {
  const byDay = new Map<string, Record<string, number | string | null>>();
  for (const [index, view] of views.entries()) {
    for (const row of view.daily) {
      const entry = byDay.get(row.sessionDay) ?? { day: row.sessionDay };
      entry[`run_${index}`] = row.cumulativeNetProfitUsd;
      byDay.set(row.sessionDay, entry);
    }
  }
  const rows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return (
    <Frame title="Running net profit by session day, every run on one axis" caption="Each run's cumulative net profit in USD after costs over its test windows, one colour per run. Above the zero line it is ahead; the runs only share days where their windows overlap.">
      {rows.length === 0 ? (
        <Empty>Daily results land when a run's first fold finishes.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="day" tick={AXIS} minTickGap={40} />
            <YAxis tick={AXIS} width={56} tickFormatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
            <ReferenceLine y={0} stroke="#808A99" />
            {views.map((view, index) => (
              <Line key={view.id} dataKey={`run_${index}`} name={view.name} stroke={RUN_COLORS[index % RUN_COLORS.length]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}

function CalibrationOverlay({ views }: { views: RunView[] }) {
  const rows: Record<string, number>[] = [];
  for (const [index, view] of views.entries()) {
    for (const bin of view.calibration) {
      if (bin.scoredBarCount === 0 || bin.meanProbabilityUp === null || bin.observedUpFraction === null) continue;
      rows.push({ predicted: bin.meanProbabilityUp, [`run_${index}`]: bin.observedUpFraction });
    }
  }
  rows.sort((a, b) => (a.predicted ?? 0) - (b.predicted ?? 0));
  return (
    <Frame title="Calibration, every run on one axis" caption="For each probability bucket, what the model said (x) against how often the bar went up (y); the grey diagonal is honesty. A flat line means the probability says nothing.">
      {rows.length === 0 ? (
        <Empty>Calibration lands when a run's first fold finishes.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="predicted" type="number" domain={[0, 1]} tick={AXIS} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
            <YAxis type="number" domain={[0, 1]} tick={AXIS} width={40} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => `${(value * 100).toFixed(1)}%`} labelFormatter={(value: number) => `predicted ${(value * 100).toFixed(1)}%`} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#808A99" strokeDasharray="6 3" />
            {views.map((view, index) => (
              <Line key={view.id} dataKey={`run_${index}`} name={view.name} stroke={RUN_COLORS[index % RUN_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Frame>
  );
}

// ─── per-run family cards ───────────────────────────────────────────────────

function RunCard({ view, color, kind }: { view: RunView; color: string; kind: string | null }) {
  const modelKey = view.modelType.replace(/\+walk_forward_cycle$/, "");
  const family = analyticsFamilyOf(kind, modelKey);
  const panels = FAMILY_PANELS[family];
  const critical = view.verdicts.filter((verdict) => verdict.severity === "critical").length;
  return (
    <div className="space-y-2 rounded-md border border-border bg-card/40 p-2" style={{ borderTopColor: color, borderTopWidth: 3 }} data-testid="run-card">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[12px] font-bold text-foreground">{view.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{view.setup?.modelLabel ?? shortModelType(view.modelType)}{view.version ? ` v${view.version}` : ""} · {FAMILY_LABELS[family].toLowerCase()}</span>
        <span className="ml-auto font-mono text-[10px]" style={{ color: STATUS_STYLE[view.status].color }}>{STATUS_STYLE[view.status].glyph} {STATUS_STYLE[view.status].label}</span>
      </div>
      <div className="text-[11px] text-foreground/90">{view.setup?.purpose ?? view.id}</div>
      <div className="font-mono text-[10px] text-muted-foreground">{critical} critical · {view.verdicts.filter((verdict) => verdict.severity === "warning").length} warnings · {view.setup ? `${view.setup.foldCount} folds · ${view.setup.barCount.toLocaleString("en-US")} bars` : ""}</div>
      {panels.includes("loss_surface") && <LossSurfacePanel surfaces={view.lossSurfaces} modelLabel={view.setup?.modelLabel ?? null} />}
      <a href={`/training?run=${encodeURIComponent(view.id)}`} className="inline-block font-mono text-[11px] text-[#56B4E9] underline-offset-2 hover:underline">Open in AI Studio →</a>
    </div>
  );
}

// ─── page ───────────────────────────────────────────────────────────────────

/**
 * The Versions view of the run page: this run's line — every run of the same
 * model on the same symbol and timeframe — side by side. Runs of different
 * models are never compared here: they answer different questions.
 */
export function VersionsView({ run, runs }: { run: RunView; runs: RunListItem[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const models = useRunnableModels();
  const line = runs.filter((entry) => entry.modelType === run.modelType && entry.symbol === (run.setup?.symbol ?? entry.symbol) && entry.timeframe === (run.setup?.timeframe ?? entry.timeframe));
  const lineIds = new Set(line.map((entry) => entry.id));
  const fromUrl = (searchParams.get("versions") ?? "").split(",").filter((id) => lineIds.has(id));
  // by default the newest versions of the line, the open run always among them
  const chosen = (fromUrl.length > 0 ? fromUrl : [run.id, ...line.map((entry) => entry.id).filter((id) => id !== run.id)].slice(0, MAX_RUNS)).slice(0, MAX_RUNS);
  function setChosen(ids: string[]) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (ids.length === 0) next.delete("versions");
      else next.set("versions", ids.join(","));
      return next;
    }, { replace: true });
  }
  const results = useRunViews(chosen);
  const views = results.map((result) => result.data).filter((view): view is RunView => view !== undefined);
  const kind = models.data?.find((entry) => entry.key === run.modelType.replace(/\+walk_forward_cycle$/, ""))?.kind ?? null;
  const label = run.setup?.modelLabel ?? shortModelType(run.modelType);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="versions-view">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card/40 px-3 py-1.5">
        <span className="font-mono text-[11px] font-bold uppercase text-foreground">{run.id === "" ? "Versions of one model on one series" : `Versions of ${label} on ${run.setup?.symbol ?? "?"} ${run.setup?.timeframe ?? ""}`}</span>
        <span className="text-[11px] text-muted-foreground">· {line.length} run{line.length === 1 ? "" : "s"} of this model on this series so far; pick up to {MAX_RUNS} to see them side by side. Every time this model runs again on the same symbol and timeframe it becomes the next version (v1, v2, …); this view shows whether a later version did better than an earlier one. Different models are never compared here, because they answer different questions.</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {line.map((entry) => {
            const on = chosen.includes(entry.id);
            const full = !on && chosen.length >= MAX_RUNS;
            return (
              <Chip key={entry.id} active={on} onClick={() => !full && setChosen(on ? chosen.filter((id) => id !== entry.id) : [...chosen, entry.id])}>
                v{entry.version} {entry.name}
              </Chip>
            );
          })}
        </div>
      </div>
      <Saved chosen={chosen} onOpen={(ids) => setChosen(ids.filter((id) => lineIds.has(id)))} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-3">
          {run.id === "" ? (
            // the view's shape with nothing in it: every panel in its place, each saying what fills it
            <>
              <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground" data-testid="versions-placeholder">
                <div className="text-[12px] font-semibold text-foreground">Every metric, one row per version</div>
                The readout table: one row per chosen version, every scoreboard metric as a column, the best version in each column starred. Hover a heading for how the engine computes it. Only versions of the same model on the same series are shown together; no model is compared against another.
              </div>
              <div className="grid gap-2 xl:grid-cols-2">
                {[
                  ["Findings by run date", "One point per version at the time it ran: how many critical and warning findings it earned. A line that falls over time is a model getting better."],
                  ["Validation loss, every version on one axis", "Each version's validation loss by training step for the chosen fold, one colour per version."],
                  ["Net profit, every version on one axis", "Each version's running net profit by session day across its test windows, one colour per version."],
                  ["Calibration, every version on one axis", "Each version's observed up-fraction against its predicted probability; the diagonal is honest."],
                ].map(([title, caption]) => (
                  <div key={title} className="flex min-h-[220px] flex-col rounded-md border border-border bg-card/60 p-3">
                    <div className="text-[12px] font-semibold text-foreground">{title}</div>
                    <div className="text-[11px] leading-snug text-muted-foreground">{caption}</div>
                    <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">Lands with the first run.</div>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">
                <div className="text-[12px] font-semibold text-foreground">One card per version</div>
                Its purpose line, its family's panels in miniature, and its findings; saved comparisons keep a set of versions by name.
              </div>
            </>
          ) : views.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Reading the versions.</div>
          ) : (
            <>
              <ReadoutTable views={views} />
              <div className="grid gap-2 xl:grid-cols-2">
                <VerdictScatter views={views} />
                <LossOverlay views={views} />
                <EquityOverlay views={views} />
                <CalibrationOverlay views={views} />
              </div>
              <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                {views.map((view, index) => (
                  <RunCard key={view.id} view={view} color={RUN_COLORS[index % RUN_COLORS.length]!} kind={kind} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
