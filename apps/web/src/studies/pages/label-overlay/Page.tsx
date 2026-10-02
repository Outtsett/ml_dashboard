/**
 * Labels on the candles: what every target marks. The window's bars and
 * labels come from `GET /api/studies/label-overlay?section=window`, the
 * whole-dataset numbers (class balance, alignment, column profiles) from
 * `?section=dataset`; every control is in the URL.
 *
 * Futures timestamps in the lake are Pacific wall clock stored as UTC, so the
 * clock on every axis is Pacific wall time, not UTC as the notebook labelled it.
 */

import { useEffect, useState } from "react";
import {
  ControlBar, Finding, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  ColumnGrid, fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  EMPTY_DATASET, barrierBoxes, classShares, majorityBaseline, pointsTravelled, regimeRuns,
  DEFAULT_BARRIER_EVERY, DEFAULT_BARS_PER_WINDOW, directionColumn, type DatasetBody, type LabelOverlayBody, type WindowBody, type WindowMode, type WindowRow,
} from "@shared/studies/label-overlay";
import { clockLabel, type Viewport } from "./chart";
import { MasterChart, MasterLegend } from "./MasterChart";
import { DeltaPanel, DirectionLegend, DirectionStrip, ForwardLegend, ForwardPanel, VolatilityPanel, type ForwardToggles } from "./TargetPanels";
import { AlignmentSection } from "./Alignment";
import { ClassBalanceGrid, ColumnProfileGrid, HorizonBaselines } from "./Columns";

const WINDOW_OPTIONS: Array<{ value: WindowMode; label: string }> = [
  { value: "busiest", label: "busiest" },
  { value: "median", label: "median activity" },
  { value: "latest", label: "latest" },
  { value: "date", label: "from a date" },
];

function windowOf(body: LabelOverlayBody | undefined): WindowBody | null {
  return body && body.section === "window" ? body.window : null;
}

function datasetOf(body: LabelOverlayBody | undefined): DatasetBody {
  return body && body.section === "dataset" ? body.dataset : EMPTY_DATASET;
}

function span(rows: readonly WindowRow[]): string {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return first && last ? `${clockLabel(first.timestamp)} to ${clockLabel(last.timestamp)}` : "no window";
}

function WindowComparison({ busiest, median }: { busiest: WindowBody | null; median: WindowBody | null }) {
  const columns = [
    { name: "busiest window", body: busiest },
    { name: "median-activity window", body: median },
  ];
  const cells = columns.map(({ body }) => {
    const rows = body?.rows ?? [];
    return { rows, swing: classShares(rows.map((row) => row.next_swing_pivot_direction)), barrier: classShares(rows.map((row) => row.triple_barrier_outcome)) };
  });
  const lines: Array<[string, (index: number) => string]> = [
    ["first bar (Pacific wall clock)", (i) => (cells[i]?.rows[0] ? clockLabel(cells[i]?.rows[0]?.timestamp as number) : "none")],
    ["points travelled (highest high minus lowest low)", (i) => fmt(pointsTravelled(cells[i]?.rows ?? []), 1)],
    ["swing: next pivot high / low / timeout", (i) => `${fmt(cells[i]?.swing.positive, 2)} / ${fmt(cells[i]?.swing.negative, 2)} / ${fmt(cells[i]?.swing.zero, 2)}`],
    ["barrier: take-profit / stop-loss / vertical", (i) => `${fmt(cells[i]?.barrier.positive, 2)} / ${fmt(cells[i]?.barrier.negative, 2)} / ${fmt(cells[i]?.barrier.zero, 2)}`],
  ];
  return (
    <table className="w-full text-[11px] font-mono tnum">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 font-normal">share of the window's bars</th>
          {columns.map((column) => (
            <th key={column.name} className="py-0.5 text-right font-normal">{column.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map(([label, cell]) => (
          <tr key={label} className="border-t border-neutral-900">
            <td className="py-0.5 font-sans text-neutral-400">{label}</td>
            {columns.map((column, index) => (
              <td key={column.name} className="py-0.5 text-right text-neutral-200">{cell(index)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Readout({ row, index }: { row: WindowRow | undefined; index: number | null }) {
  if (!row || index === null) {
    return <p className="h-8 text-[11px] text-neutral-500">Hover a bar to read its exact values. Wheel to zoom, drag to pan, double-click to reset.</p>;
  }
  const word = (value: number | null, words: Record<string, string>): string => (value === null ? "no label" : (words[String(value)] ?? String(value)));
  return (
    <p className="min-h-8 font-mono text-[11px] tnum text-neutral-300">
      bar {index} (row {fmtInt(row.row_number)}) {clockLabel(row.timestamp)} · open {fmt(row.open, 2)} high {fmt(row.high, 2)} low {fmt(row.low, 2)} close {fmt(row.close, 2)} volume {fmtInt(row.volume)} ·{" "}
      regime {word(row.volatility_regime, { "0": "low", "1": "middle", "2": "high" })} · swing {word(row.next_swing_pivot_direction, { "1": "high ahead", "-1": "low ahead", "0": "timeout" })} · barrier{" "}
      {word(row.triple_barrier_outcome, { "1": "take-profit", "-1": "stop-loss", "0": "vertical" })}
      {row.triple_barrier_exit_row_number !== null && row.triple_barrier_exit_row_number >= 0 ? ` exits at row ${fmtInt(row.triple_barrier_exit_row_number)}` : ""} · next close change {fmt(row.close_change_points_after_1_bars, 2)} points
    </p>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    window: "busiest",
    date: "",
    bars: DEFAULT_BARS_PER_WINDOW,
    barrierEvery: DEFAULT_BARRIER_EVERY,
    regime: true,
    swing: true,
    barriers: true,
    forward15: true,
    forward60: true,
    forward240: true,
    forward1440: true,
  });
  const mode = controls.window as WindowMode;
  // The bars slider moves freely; the queries follow 350 ms after it stops.
  const [draftBars, setDraftBars] = useState<number>(controls.bars);
  useEffect(() => {
    if (draftBars === controls.bars) return undefined;
    const timer = setTimeout(() => set("bars", draftBars), 350);
    return () => clearTimeout(timer);
  }, [draftBars, controls.bars, set]);

  const dataset = useStudyQuery<LabelOverlayBody>("label-overlay", { section: "dataset" });
  const busiest = useStudyQuery<LabelOverlayBody>("label-overlay", { section: "window", window: "busiest", bars: controls.bars });
  const median = useStudyQuery<LabelOverlayBody>("label-overlay", { section: "window", window: "median", bars: controls.bars });
  const wantsCustom = mode === "latest" || (mode === "date" && controls.date !== "");
  const custom = useStudyQuery<LabelOverlayBody>("label-overlay", { section: "window", window: mode, date: mode === "date" ? controls.date : "", bars: controls.bars }, { enabled: wantsCustom });

  const chosen = mode === "busiest" ? busiest : mode === "median" ? median : custom;
  const windowBody = windowOf(chosen.data?.data);
  const data = datasetOf(dataset.data?.data);
  const rows = windowBody?.rows ?? [];
  const firstRow = rows[0];

  const [zoom, setZoom] = useState<(Viewport & { key: string }) | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const windowKey = `${windowBody?.window?.startRow ?? "none"}:${rows.length}`;
  const viewport: Viewport = zoom && zoom.key === windowKey ? { from: zoom.from, to: zoom.to } : { from: 0, to: Math.max(1, rows.length) };
  const onViewport = (next: Viewport | null) => setZoom(next ? { ...next, key: windowKey } : null);
  const shared = { rows, viewport, onViewport, hoverIndex: hover, onHover: setHover };

  const boxes = barrierBoxes(rows, controls.barrierEvery);
  const runs = regimeRuns(rows.map((row) => row.volatility_regime));
  const forwardShown: ForwardToggles = { 15: controls.forward15, 60: controls.forward60, 240: controls.forward240, 1440: controls.forward1440 };
  // The notebook's exit rule subtracted w.index[0] (0 after reset_index), clamped to the last bar.
  const oldExit = (box: { index: number }): number => Math.min(rows[box.index]?.triple_barrier_exit_row_number ?? 0, rows.length - 1);
  const misplaced = boxes.filter((box) => box.exitResolved && oldExit(box) !== box.exitIndex).length;

  const barrierBalance = data.classBalance.find((column) => column.stored === "tbl_label");
  const swingBalance = data.classBalance.find((column) => column.stored === "swing_label");
  const share = (column: typeof barrierBalance, value: number): number | null => {
    if (!column) return null;
    const total = column.counts.reduce((sum, entry) => sum + entry.count, 0);
    const found = column.counts.find((entry) => entry.value === value);
    return total > 0 && found ? found.count / total : null;
  };
  const baselines = [1, 1440].map((horizon) => majorityBaseline(data.classBalance.find((column) => column.name === directionColumn(horizon))?.counts ?? []));
  const notes = [...(dataset.data?.notes ?? []), ...(chosen.data?.notes ?? [])];
  const zeroRangeInWindow = rows.filter((row) => row.zero_range_bar === 1).length;

  return (
    <div className="space-y-3">
      <StudyNotes notes={[...new Set(notes)]} />
      <ControlBar
        onReset={() => {
          reset();
          setDraftBars(DEFAULT_BARS_PER_WINDOW);
        }}
      >
        <SegmentControl<WindowMode> label="Window" value={mode} options={WINDOW_OPTIONS} onChange={(next) => set("window", next)} hint="busiest and median activity are chosen by the rolling sum of bar ranges over the whole dataset" />
        {mode === "date" && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">First day</span>
            <input type="date" value={controls.date} min="2019-05-05" max="2025-12-24" onChange={(event) => set("date", event.target.value)} className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
          </label>
        )}
        <SliderControl label="Bars in the window" value={draftBars} min={60} max={2000} step={20} onChange={setDraftBars} hint="The notebook used 240, four hours of one-minute bars" />
        <SliderControl label="Barrier box every" value={controls.barrierEvery} min={1} max={60} onChange={(v) => set("barrierEvery", v)} format={(v) => `${v} bars`} hint="One triple-barrier box per this many bars; all of them is unreadable" />
        <SwitchControl label="Regime shading" checked={controls.regime} onChange={(v) => set("regime", v)} />
        <SwitchControl label="Swing pivots" checked={controls.swing} onChange={(v) => set("swing", v)} />
        <SwitchControl label="Barrier boxes" checked={controls.barriers} onChange={(v) => set("barriers", v)} />
      </ControlBar>

      <StudyState isLoading={dataset.isLoading} error={dataset.error}>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          <Stat label="Label rows" value={fmtInt(data.datasetRows)} hint="mnq_labels_1m: 48 label columns next to every bar" />
          <Stat label="Joined to bars" value={fmtInt(data.joinedRows)} hint={`Inner join on timestamp with mnq_ohlcv_1m (${fmtInt(data.barRows)} bars, ${fmtInt(data.barRows - data.joinedRows)} of them after the labels end)`} tone={data.joinedRows > 0 && data.joinedRows === data.datasetRows ? OKABE.sky : undefined} />
          <Stat label="Window" value={span(rows)} hint="Futures stamps are Pacific wall clock stored as UTC" />
          <Stat label="Points travelled" value={fmt(pointsTravelled(rows), 1)} hint="Highest high minus lowest low in the window" />
          <Stat label="Rolling range sum" value={fmt(windowBody?.window?.rollingRangePoints, 0)} hint="Sum of the window's bar ranges: what busiest and median activity are chosen on" />
        </div>
      </StudyState>

      <Section title="The master chart" question="Candles with every marker-style label drawn on the bar it belongs to, at the bar it belongs to, not at the pivot it points at.">
        <StudyState isLoading={false} error={chosen.error}>
          {mode === "date" && controls.date === "" ? (
            <p className="py-4 text-center text-xs text-neutral-400">Pick a first day to draw the window that starts there.</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">{chosen.isLoading ? "Reading the lake…" : "No window: the label dataset is not landed."}</p>
          ) : (
            <div className="space-y-2">
              <Readout row={hover === null ? undefined : rows[hover]} index={hover} />
              <MasterChart rows={rows} boxes={boxes} runs={runs} show={{ regime: controls.regime, swing: controls.swing, barriers: controls.barriers }} viewport={viewport} onViewport={onViewport} hoverIndex={hover} onHover={setHover} />
              <MasterLegend />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => onViewport(null)} className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800">Reset zoom</button>
                <span className="font-mono text-[11px] tnum text-neutral-500">showing bars {Math.floor(viewport.from)} to {Math.ceil(viewport.to) - 1} of {rows.length}; {boxes.length} barrier boxes drawn; clock is Pacific wall time</span>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="space-y-2">
                  <Finding>
                    A barrier box whose right edge is reached without touching either horizontal edge is the vertical-barrier class. At the dataset's five-bar vertical barrier that class holds{" "}
                    {fmtPercent(share(barrierBalance, 0), 1)} of all rows, take-profit {fmtPercent(share(barrierBalance, 1), 1)} and stop-loss {fmtPercent(share(barrierBalance, -1), 1)}; at sixty bars it held 0.38 percent, which is how the third class went dead unnoticed. The swing head's timeout class holds{" "}
                    {fmtPercent(share(swingBalance, 0), 1)}.
                  </Finding>
                  <Finding>
                    The drawn band is 1.5 times the trailing 14-bar mean range, a display proxy for the dataset's 1.5 ATR barrier, so judge the exit by where the X sits relative to the box, not by the box's exact height.
                    {firstRow && firstRow.row_number > 0 && boxes.length > 0 ? ` The exit column is an absolute row number, so each exit here is placed at its row minus this window's first row (${fmtInt(firstRow.row_number)}). The notebook subtracted 0 instead and would have put ${misplaced} of these ${boxes.length} exits on the window's last bar.` : ""}
                  </Finding>
                </div>
                <WindowComparison busiest={windowOf(busiest.data?.data)} median={windowOf(median.data?.data)} />
              </div>
            </div>
          )}
        </StudyState>
      </Section>

      {rows.length > 0 && (
        <>
          <Section title="Direction labels as a strip" question="One row per horizon, one cell per bar: how far ahead does the label look, and how much does the answer change when it looks further.">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-2">
                <DirectionStrip {...shared} />
                <DirectionLegend />
              </div>
              <div className="min-w-0 space-y-2">
                <HorizonBaselines columns={data.classBalance} />
                <Finding>
                  Grade a direction model against the majority-class rate of its own training slice, not 0.50. Over the whole dataset the majority class is {baselines[0]?.majority === "down" ? "DOWN" : "UP"} at one bar ahead ({fmtPercent(baselines[0]?.majorityRate, 2)}) and {baselines[1]?.majority === "up" ? "UP" : "DOWN"} at 1440 bars ahead ({fmtPercent(baselines[1]?.majorityRate, 2)}), so the bar to clear changes side with the horizon.
                </Finding>
              </div>
            </div>
          </Section>

          <Section title="The continuous targets under the same bars" question="Three panels on the master chart's x axis: the volatility target against the series it is taken from, the next-bar close change with its range class, and the forward log returns.">
            <div className="space-y-3">
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-neutral-200">Volatility target: log range now against the target one bar ahead</h4>
                <VolatilityPanel {...shared} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-300">
                  <span>grey solid: log bar range of bar t</span>
                  <span style={{ color: OKABE.orange }}>dotted: the target, log range of bar t+1</span>
                  <span style={{ color: OKABE.vermillion }}>X: zero-range bar, masked, no label ({zeroRangeInWindow} in this window)</span>
                </div>
                <Finding>Read this panel first: the dotted target must lead the solid series by exactly one bar. Any other lag means the horizon in the dataset disagrees with its column name.</Finding>
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-neutral-200">Next-bar close change and its 21-bucket range class</h4>
                <DeltaPanel {...shared} />
                <p className="text-[11px] text-neutral-300"><span style={{ color: OKABE.orange }}>▲ orange bars: next close at or above this close</span> · <span style={{ color: OKABE.blue }}>▼ blue bars: below</span> · <span style={{ color: OKABE.sky }}>step line (right axis): range bucket of the next bar, 10 is the centre</span></p>
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <h4 className="text-xs font-medium text-neutral-200">Forward log return by horizon</h4>
                  <SwitchControl label="15" checked={controls.forward15} onChange={(v) => set("forward15", v)} />
                  <SwitchControl label="60" checked={controls.forward60} onChange={(v) => set("forward60", v)} />
                  <SwitchControl label="240" checked={controls.forward240} onChange={(v) => set("forward240", v)} />
                  <SwitchControl label="1440" checked={controls.forward1440} onChange={(v) => set("forward1440", v)} />
                </div>
                <ForwardPanel {...shared} shown={forwardShown} />
                <ForwardLegend />
              </div>
            </div>
          </Section>
        </>
      )}

      <Section title="The alignment check, done arithmetically" question="Each stored label recomputed from the joined bars over every row, with a shifted column as the negative control. A chart can hide a one-bar shift; these counts cannot.">
        <StudyState isLoading={dataset.isLoading} error={dataset.error}>
          {data.alignmentChecks.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">The label dataset is not landed.</p>
          ) : (
            <div className="space-y-3">
              <AlignmentSection dataset={data} rows={rows} />
              {data.exitBarAudit && (
                <Finding>
                  The barrier exit column is an absolute row number: across {fmtInt(data.exitBarAudit.resolvedRows)} resolved barriers the exit lies {data.exitBarAudit.minimumBarsToExit} to {data.exitBarAudit.maximumBarsToExit} bars after its entry and {fmtInt(data.exitBarAudit.exitNotAfterEntry)} exits sit at or before their entry. {fmtInt(data.exitBarAudit.unresolvedRows)} rows at the end of the dataset are unresolved (-1).
                </Finding>
              )}
            </div>
          )}
        </StudyState>
      </Section>

      <Section title="Every label column" question="Each column of mnq_labels_1m as its own graphic, over all rows: the class columns as counts and shares, the continuous columns as histograms with their eight numbers.">
        <StudyState isLoading={dataset.isLoading} error={dataset.error}>
          {data.profiles.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">The label dataset is not landed.</p>
          ) : (
            <div className="space-y-4">
              <ClassBalanceGrid columns={data.classBalance} />
              <ColumnProfileGrid profiles={data.profiles} />
            </div>
          )}
        </StudyState>
      </Section>

      {rows.length > 0 && (
        <Section title="Every column of this window" question="The same labels over only the bars on screen, each with its own histogram and eight numbers: what the chart above is actually showing.">
          <ColumnGrid rows={rows} exclude={["row_number", "timestamp"]} title="Columns in this window" />
        </Section>
      )}
    </div>
  );
}
