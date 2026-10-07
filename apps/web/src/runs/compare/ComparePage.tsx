/**
 * The Analytics tab (`/analytics`): the many-runs complement of the run page.
 * Pick runs on the left (by model, symbol, timeframe); the same numbers and
 * panels the run page shows for one run are laid side by side for several,
 * from the same `RunView`, so nothing here is a second definition of anything.
 *
 *   readouts   every headline metric, one row per run, the best in each column marked
 *   verdicts   how many critical / warning findings each run carries, by when it ran
 *   overlays   validation loss by step, net profit by session day, calibration — every run on one axis
 *   per run    the panels its family owns (loss surface for a neural fit), one card per run
 *
 * Comparisons are saved on disk through `/api/runs/comparisons`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "wouter";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import type { RunListItem, RunView } from "@shared/runs/types";
import { TILE_SPECS } from "@shared/runs/view";
import { COIN_FLIP_LOG_LOSS } from "@shared/runs/verdicts";
import { useRunList, useRunnableModels } from "@/runs/api";
import { formatStarted, formatValue, shortModelType, STATUS_STYLE } from "@/runs/format";
import { analyticsFamilyOf, FAMILY_LABELS, FAMILY_PANELS } from "@/runs/analytics/families";
import { Chip, LossSurfacePanel } from "@/runs/learning";
import { useComparisons, useDeleteComparison, useRunViews, useSaveComparison } from "@/runs/compare/api";

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

// ─── picker ─────────────────────────────────────────────────────────────────

function Picker({ runs, chosen, onToggle }: { runs: RunListItem[]; chosen: string[]; onToggle: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = needle === "" ? runs : runs.filter((run) => `${run.name} ${run.modelType} ${run.symbol} ${run.timeframe} ${run.status}`.toLowerCase().includes(needle));
  const groups = new Map<string, RunListItem[]>();
  for (const run of shown) {
    const key = `${shortModelType(run.modelType)} · ${run.symbol ?? "?"} ${run.timeframe ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/40" data-testid="compare-picker">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="font-mono text-[11px] font-bold uppercase text-foreground">Runs</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter" className="h-6 w-full rounded border border-border bg-transparent px-2 font-mono text-[12px] outline-none" />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{chosen.length}/{MAX_RUNS}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {[...groups.entries()].map(([key, members]) => (
          <div key={key} className="border-b border-border/70">
            <div className="bg-foreground/[0.04] px-2 py-1 font-mono text-[11px] font-bold text-foreground">{key}</div>
            {members.map((run) => {
              const on = chosen.includes(run.id);
              const full = !on && chosen.length >= MAX_RUNS;
              const status = STATUS_STYLE[run.status];
              return (
                <label key={run.id} className={`flex cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-1 ${on ? "bg-foreground/10" : "hover:bg-foreground/5"} ${full ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => onToggle(run.id)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate font-mono text-[12px] font-semibold text-foreground">{run.name}</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: status.color }}>{status.glyph}</span>
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">v{run.version} · {formatStarted(run.startedAt)}{run.sharpeRatio === null ? "" : ` · Sharpe ${run.sharpeRatio.toFixed(2)}`}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
        {shown.length === 0 && <div className="p-3 font-mono text-[11px] text-muted-foreground">No runs. Launch one in AI Studio.</div>}
      </div>
    </aside>
  );
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
  const specs = TILE_SPECS.filter((spec) => views.some((view) => view.metrics[spec.name] != null));
  const bestOf = (name: string, better: "higher" | "lower" | "none") => {
    if (better === "none") return null;
    const values = views.map((view) => view.metrics[name]).filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length < 2) return null;
    return better === "higher" ? Math.max(...values) : Math.min(...values);
  };
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card/60" data-testid="readout-table">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-1.5">Run</th>
            {specs.map((spec) => (
              <th key={spec.name} className="px-2 py-1.5 text-right" title={spec.baseline ? `beats: ${spec.baseline.label}` : undefined}>{spec.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {views.map((view, index) => (
            <tr key={view.id} className="border-b border-border/50">
              <td className="px-2 py-1.5">
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: RUN_COLORS[index % RUN_COLORS.length] }} />
                <span className="font-semibold text-foreground">{view.name}</span>
                <span className="text-muted-foreground"> · {view.setup?.modelLabel ?? shortModelType(view.modelType)}{view.version ? ` v${view.version}` : ""}</span>
              </td>
              {specs.map((spec) => {
                const value = view.metrics[spec.name] ?? null;
                const best = bestOf(spec.name, spec.better);
                const isBest = best !== null && value === best;
                return (
                  <td key={spec.name} className={`px-2 py-1.5 text-right tabular-nums ${isBest ? "font-bold text-[#E69F00]" : "text-foreground"}`}>
                    {formatValue(value, spec.unit)}{isBest ? " ★" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-[10px] text-muted-foreground">★ the best of the chosen runs in that column (higher or lower as the metric wants). The run page judges each against its baseline; this table only ranks.</div>
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

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runs = useRunList();
  const models = useRunnableModels();
  const chosen = (searchParams.get("runs") ?? "").split(",").filter((id) => id.length > 0).slice(0, MAX_RUNS);
  function setChosen(ids: string[]) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (ids.length === 0) next.delete("runs");
      else next.set("runs", ids.join(","));
      return next;
    }, { replace: true });
  }
  // with nothing chosen, the two newest runs are compared
  useEffect(() => {
    if (chosen.length === 0 && runs.data && runs.data.length > 0 && searchParams.get("runs") === null) setChosen(runs.data.slice(0, 2).map((run) => run.id));
    // only on first load of the list

  }, [runs.data]);

  const results = useRunViews(chosen);
  const views = results.map((result) => result.data).filter((view): view is RunView => view !== undefined);
  const kindOf = (view: RunView) => models.data?.find((entry) => entry.key === view.modelType.replace(/\+walk_forward_cycle$/, ""))?.kind ?? null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-background" data-testid="compare-page">
      <Picker runs={runs.data ?? []} chosen={chosen} onToggle={(id) => setChosen(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id])} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border bg-card/40 px-3 py-2">
          <h1 className="font-mono text-[15px] font-bold text-foreground">Analytics <span className="font-normal text-muted-foreground">· {views.length} run{views.length === 1 ? "" : "s"} side by side</span></h1>
          <div className="text-[11px] text-muted-foreground">The run page reads one run; this reads several from the same numbers. Pick up to {MAX_RUNS} on the left, or open a saved comparison.</div>
        </header>
        <Saved chosen={chosen} onOpen={setChosen} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-3">
            {views.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{runs.isLoading ? "Loading runs." : "Pick runs on the left."}</div>
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
                    <RunCard key={view.id} view={view} color={RUN_COLORS[index % RUN_COLORS.length]!} kind={kindOf(view)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
