/**
 * Direction labels on real candles. Replaced
 * Trading/quant/model/notebooks/direction_on_candles.py.
 *
 * Three queries to one handler: `overview` (table sizes, per-horizon up-rate
 * and forward-move distribution, ranked sessions), `window` (the joined bars
 * the controls pick) and `proof` (the full-table alignment proof). Every
 * control lives in the URL; nothing is recomputed on the server except the
 * window.
 */

import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, Histogram, OKABE, Section, SegmentControl, SliderControl, Stat,
  StudyNotes, StudyState, SummaryTable, SwitchControl, TOOLTIP, fmt, fmtInt, fmtTime, fmtUsd, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  DEFAULT_ARROW_HORIZONS, DIRECTION_HORIZONS, FORWARD_CHANGE_NAME, anchorIndices, buildArrows, directionLabelName, forwardChangeName,
  horizonWords, horizonsText, parseHorizons, runningUp, type DayRow, type OverviewBody, type ProofBody, type WindowBars, type WindowBody,
} from "@shared/studies/direction-labels-on-candles";
import { DirectionChart } from "./DirectionChart";
import { HorizonStrip } from "./HorizonStrip";
import { LabelPanels } from "./LabelPanels";

const SLUG = "direction-labels-on-candles";
const PASS_COLOR = OKABE.sky;
const FAIL_COLOR = OKABE.vermillion;

/** Pass or fail with a glyph and a word as well as a colour. */
function Verdict({ ok, pass, fail }: { ok: boolean; pass: string; fail: string }) {
  const color = ok ? PASS_COLOR : FAIL_COLOR;
  return (
    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ color, borderColor: color }}>
      <span aria-hidden="true">{ok ? "●" : "▲"}</span>
      {ok ? pass : fail}
    </span>
  );
}

function HorizonChips({ selected, onToggle }: { selected: readonly number[]; onToggle: (horizon: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Horizons drawn (bars)</span>
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {DIRECTION_HORIZONS.map((horizon) => {
          const on = selected.includes(horizon);
          return (
            <button
              key={horizon}
              type="button"
              aria-pressed={on}
              title={`${directionLabelName(horizon)}: ${horizonWords(horizon)}`}
              onClick={() => onToggle(horizon)}
              className={`px-2 py-1 font-mono text-[11px] ${on ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800"}`}
            >
              {on ? "✓ " : ""}
              {horizon}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SessionTable({ rows, current, minimumBars }: { rows: Array<{ kind: string; row: DayRow | null }>; current: string | null; minimumBars: number }) {
  return (
    <table className="w-full text-[11px] font-mono tnum">
      <thead>
        <tr className="text-neutral-500">
          <th className="py-0.5 text-left font-normal">session</th>
          <th className="py-0.5 text-left font-normal">day (wall clock)</th>
          <th className="py-0.5 text-right font-normal">bars</th>
          <th className="py-0.5 text-right font-normal">summed bar range (points)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ kind, row }) => (
          <tr key={kind} className="border-t border-neutral-900" style={row && row.day === current ? { background: "rgba(86,180,233,0.12)" } : undefined}>
            <td className="py-0.5 text-neutral-400">{kind}</td>
            <td className="py-0.5 text-neutral-200">
              {row ? row.day : "—"} {row && row.day === current ? <span className="text-[#56B4E9]">◀ drawn</span> : null}
            </td>
            <td className="py-0.5 text-right text-neutral-200">{row ? fmtInt(row.barCount) : "—"}</td>
            <td className="py-0.5 text-right text-neutral-200">{row ? fmt(row.summedRangePoints, 2) : "—"}</td>
          </tr>
        ))}
        <tr>
          <td colSpan={4} className="pt-1 text-[10px] text-neutral-500">
            Calm and median are chosen among sessions with at least {fmtInt(minimumBars)} bars, so a half-day holiday is not "calm".
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function windowRows(bars: WindowBars): Array<Record<string, unknown>> {
  return bars.close.map((_, i) => ({
    open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i], volume: bars.volume[i],
    [FORWARD_CHANGE_NAME]: bars.forwardChangePointsHorizon15[i],
  }));
}

/** Cumulative up-rate after each bar for one label column, thinned to about `points` samples for the chart. */
function runningCurve(labels: ReadonlyArray<0 | 1 | null>, points: number): Array<{ bars: number; upRate: number | null }> {
  const every = Math.max(1, Math.floor(labels.length / points));
  const out: Array<{ bars: number; upRate: number | null }> = [];
  let sum = 0;
  let labeled = 0;
  labels.forEach((label, i) => {
    if (label !== null) {
      sum += label;
      labeled += 1;
    }
    if ((i + 1) % every === 0 || i === labels.length - 1) out.push({ bars: i + 1, upRate: labeled > 0 ? sum / labeled : null });
  });
  return out;
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    preset: "busiest",
    date: "",
    bars: 2600,
    anchors: 5,
    horizons: horizonsText(DEFAULT_ARROW_HORIZONS),
    arrows: true,
    lanes: true,
    inspectAnchor: 1,
    inspectHorizon: 60,
    step: 600,
  });

  const overviewQuery = useStudyQuery<OverviewBody>(SLUG, { part: "overview" });
  const windowQuery = useStudyQuery<WindowBody>(SLUG, {
    part: "window", preset: controls.preset, date: controls.preset === "date" ? controls.date : undefined, bars: controls.bars,
  });
  const proofQuery = useStudyQuery<ProofBody>(SLUG, { part: "proof" });

  const overview = overviewQuery.data?.data;
  const win = windowQuery.data?.data;
  const proof = proofQuery.data?.data;
  const notes = [...new Set([...(overviewQuery.data?.notes ?? []), ...(windowQuery.data?.notes ?? []), ...(proofQuery.data?.notes ?? [])])];

  const bars = win?.bars;
  const barCount = win?.barCount ?? 0;
  const horizons = parseHorizons(controls.horizons);
  const longest = horizons.length > 0 ? Math.max(...horizons) : 0;
  const anchors = bars && barCount > 0 ? anchorIndices(barCount, longest, controls.anchors) : [];
  const usable = barCount - longest - 1;
  const arrows = bars ? buildArrows(bars, horizons, anchors) : [];
  const disagreeing = arrows.filter((arrow) => arrow.labelAgrees === false).length;

  const windowHint =
    bars && barCount > 0
      ? `${fmtTime((bars.timestampSeconds[0] as number) * 1000)} to ${fmtTime((bars.timestampSeconds[barCount - 1] as number) * 1000)} wall clock, price ${fmt(Math.min(...bars.low), 2)} to ${fmt(Math.max(...bars.high), 2)} points`
      : win?.day
        ? `starting ${win.day}`
        : undefined;

  const toggleHorizon = (horizon: number) => {
    const next = horizons.includes(horizon) ? horizons.filter((value) => value !== horizon) : [...horizons, horizon];
    set("horizons", horizonsText(next));
  };

  // The anchor and horizon the formula card reads its numbers from.
  const inspectAnchorIndex = anchors.length > 0 ? (anchors[Math.min(Math.max(controls.inspectAnchor, 1), anchors.length) - 1] ?? 0) : 0;
  const inspectHorizon = controls.inspectHorizon;
  const inspectTarget = inspectAnchorIndex + inspectHorizon;
  const closeNow = bars && barCount > 0 ? (bars.close[inspectAnchorIndex] ?? null) : null;
  const closeLater = bars && inspectTarget < barCount ? (bars.close[inspectTarget] ?? null) : null;
  const inspectLabel = bars?.directionLabels[String(inspectHorizon)]?.[inspectAnchorIndex] ?? null;
  const inspectChange = closeNow !== null && closeLater !== null ? closeLater - closeNow : null;
  const inspectIndicator = inspectChange === null ? null : inspectChange > 0 ? 1 : 0;

  // The up-rate sum, stepped one bar at a time.
  const stepLabels = bars?.directionLabels[String(inspectHorizon)] ?? [];
  const stepBars = Math.min(Math.max(1, controls.step), Math.max(1, barCount));
  const running = runningUp(stepLabels, stepBars);
  const fullWindow = runningUp(stepLabels, stepLabels.length);
  const tableUpRate = overview?.horizons.find((row) => row.horizon === inspectHorizon)?.upRate ?? null;
  const curve = runningCurve(stepLabels, 300);

  const sessionRows = overview
    ? [
        ...overview.busiest.map((row, i) => ({ kind: `busiest #${i + 1}`, row })),
        { kind: "calmest", row: overview.calmest },
        { kind: "median", row: overview.median },
      ]
    : [];

  const driftData = (overview?.horizons ?? []).map((row) => ({
    name: `${row.horizon}`,
    table: row.upRate,
    window: win?.upRates.find((rate) => rate.horizon === row.horizon)?.upRate ?? null,
  }));

  const costUsd = overview?.roundTripCostUsd ?? 0;
  const pointValue = overview?.pointValueUsd ?? 2;
  const economics = (overview?.horizons ?? []).map((row) => {
    const medianUsd = (row.medianAbsoluteMovePoints ?? 0) * pointValue;
    const clears = medianUsd > costUsd;
    return { name: `${row.horizon}`, medianUsd, clears, text: `${clears ? "▲" : "▼"} ${fmtUsd(medianUsd)}` };
  });
  const firstClearing = economics.find((row) => row.clears);

  const proofFifteen = proof?.horizons.find((row) => row.horizon === 15);
  const proofHorizon = proof?.horizons.find((row) => row.horizon === inspectHorizon);
  const allAligned = proof ? proof.horizons.length > 0 && proof.horizons.every((row) => row.mismatches === 0) : false;
  const controlsCanFail = proof ? proof.horizons.length > 0 && proof.horizons.every((row) => row.negativeControlMismatches > 0) : false;

  return (
    <div className="space-y-3">
      <StudyNotes notes={notes} />
      <StudyState isLoading={windowQuery.isLoading && !win} error={windowQuery.error}>
        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Bars joined to labels" value={fmtInt(overview?.joinedRows)} hint={`mnq_ohlcv_1m has ${fmtInt(overview?.ohlcvRows)} bars, mnq_labels_1m ${fmtInt(overview?.labelRows)} rows; the inner join drops the rest`} />
          <Stat label="Bars with no label (dropped)" value={fmtInt(overview?.droppedBars)} hint={`${overview?.firstDay ?? "—"} to ${overview?.lastDay ?? "—"} is the joined span, wall clock`} />
          <Stat label="Bars in this window" value={fmtInt(barCount)} hint={windowHint} />
          <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2" title="Most common gap between consecutive bars in the window">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Bar spacing</div>
            <div className="flex items-center gap-2 font-mono tnum text-base">
              {win?.modalSpacingSeconds === null || win?.modalSpacingSeconds === undefined ? "—" : `${fmtInt(win.modalSpacingSeconds)} seconds`}
              {win && win.modalSpacingSeconds !== null && <Verdict ok={win.modalSpacingSeconds === 60} pass="1-minute bars" fail="not 1-minute" />}
            </div>
          </div>
        </div>

        <Section title="A. The window" question="Which session to draw, how many bars, and which horizons. The notebook drew the busiest session since 2024, 2,600 bars, horizons 60, 240 and 1440.">
          <ControlBar onReset={reset}>
            <SegmentControl
              label="Session" value={controls.preset}
              options={[{ value: "busiest", label: "busiest" }, { value: "calmest", label: "calmest" }, { value: "median", label: "median" }, { value: "date", label: "date" }]}
              onChange={(value) => set("preset", value)}
              hint="Ranked by summed bar range since 2024-01-01"
            />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Start date (wall clock)</span>
              <input
                type="date"
                value={controls.date || win?.day || ""}
                min={overview?.firstDay ?? undefined}
                max={overview?.lastDay ?? undefined}
                onChange={(event) => {
                  set("date", event.target.value);
                  set("preset", "date");
                }}
                className="h-7 w-36 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
              />
            </label>
            <SliderControl label="Bars in window" value={controls.bars} min={240} max={6000} step={60} onChange={(value) => set("bars", value)} hint="One-minute bars from the session start; 1,380 make a full session" />
            <SliderControl label="Anchor bars" value={controls.anchors} min={1} max={12} onChange={(value) => set("anchors", value)} hint="Bars the arrow fan starts from" />
            <HorizonChips selected={horizons} onToggle={toggleHorizon} />
            <SwitchControl label="Arrows" checked={controls.arrows} onChange={(value) => set("arrows", value)} />
            <SwitchControl label="Marker lanes" checked={controls.lanes} onChange={(value) => set("lanes", value)} />
          </ControlBar>
          {overview && <SessionTable rows={sessionRows} current={win?.day ?? null} minimumBars={overview.eligibleMinimumBars} />}
          <Finding>
            Every bar here is one minute, and the page checks it rather than trusting the table name: the modal spacing above must read 60 seconds.
            <code className="mx-1 font-mono text-[11px]">{directionLabelName(60)}</code> is one hour ahead and <code className="mx-1 font-mono text-[11px]">{directionLabelName(1440)}</code> is one trading day ahead,
            both counted in 1-minute bars. Times are wall clock as the lake stamps them (futures stamps are Pacific wall clock stored as UTC), not UTC.
          </Finding>
        </Section>

        <Section
          title="B. The chart: candles, the label on each bar, and the segment each label is the sign of"
          question="A triangle under each bar is the stored label; from each anchor an arrow runs from close[t] to close[t+H]. The label is the sign of the arrow and nothing else."
        >
          {bars && barCount > 0 ? (
            <DirectionChart
              bars={bars} horizons={horizons} anchors={anchors} showArrows={controls.arrows} showLanes={controls.lanes} height={520}
              inspect={horizons.includes(inspectHorizon) ? { anchorIndex: inspectAnchorIndex, horizon: inspectHorizon } : null}
            />
          ) : (
            <Empty>No bars in this window. {notes.length === 0 ? "Pick another session or date." : ""}</Empty>
          )}
          {bars && barCount > 0 && (
            <>
              <Finding>
                {arrows.length} arrows drawn from {anchors.length} anchor bar{anchors.length === 1 ? "" : "s"}; {arrows.length - disagreeing} carry a stored label equal to the sign of their segment
                {disagreeing > 0 ? `, ${disagreeing} do not` : ""}.{" "}
                {usable < 1 ? `The window is too short for the longest horizon (${longest} bars): raise the bar count. ` : ""}
                The same anchor can be orange at one horizon and blue at another, which is the point: the horizon is a modelling decision, not a detail.
                The marker sits on bar t while the information that decides it sits at t+H, so a walk-forward purge has to cover H bars.
              </Finding>
              <ControlBar>
                <SliderControl label="Inspect anchor" value={Math.min(controls.inspectAnchor, Math.max(anchors.length, 1))} min={1} max={Math.max(anchors.length, 1)} onChange={(value) => set("inspectAnchor", value)} hint="Step through the anchors; its arrow is drawn thicker" />
                <SegmentControl label="Inspect horizon (bars)" value={controls.inspectHorizon} options={DIRECTION_HORIZONS.map((h) => ({ value: h as number, label: String(h) }))} onChange={(value) => set("inspectHorizon", value)} />
              </ControlBar>
              <FormulaCard
                tex={"y^{(H)}_t=\\mathbf{1}\\!\\left[\\,c_{t+H}>c_t\\,\\right],\\qquad \\Delta^{(H)}_t=c_{t+H}-c_t"}
                caption={
                  closeNow === null || closeLater === null
                    ? `Anchor ${Math.min(controls.inspectAnchor, Math.max(anchors.length, 1))} plus ${inspectHorizon} bars runs past the window, so its arrow is not drawn.`
                    : `At ${fmtTime((bars.timestampSeconds[inspectAnchorIndex] as number) * 1000)} wall clock the close is ${fmt(closeNow, 2)}; ${inspectHorizon} bars later it is ${fmt(closeLater, 2)}, a change of ${fmt(inspectChange, 2)} points, so the indicator is ${inspectIndicator} and the stored label is ${inspectLabel === null ? "missing" : inspectLabel}.`
                }
                symbols={[
                  { tex: "y^{(H)}_t", name: `direction label ${directionLabelName(inspectHorizon)} of bar t`, value: inspectLabel === null ? "—" : `${inspectLabel === 1 ? "▲" : "▼"} ${inspectLabel}` },
                  { tex: "H", name: "horizon: bars ahead, each bar one minute", value: `${inspectHorizon} (${horizonWords(inspectHorizon)})` },
                  { tex: "t", name: "the anchor bar the label sits on", value: `bar ${fmtInt(inspectAnchorIndex)} of ${fmtInt(barCount)}` },
                  { tex: "c_t", name: "close of bar t, points", value: fmt(closeNow, 2) },
                  { tex: "c_{t+H}", name: "close H bars later, points", value: fmt(closeLater, 2) },
                  { tex: "\\Delta^{(H)}_t", name: "forward price change over the horizon, points", value: fmt(inspectChange, 2) },
                  { tex: "\\mathbf{1}[\\cdot]", name: "indicator: 1 when the bracket is true, else 0", value: inspectIndicator === null ? "—" : String(inspectIndicator) },
                ]}
              />
            </>
          )}
        </Section>

        <Section title="C. The same bars, every horizon at once" question="One row per stored horizon. Reading down a column shows how the answer for a single bar changes as the label looks further ahead.">
          {bars && barCount > 0 ? <HorizonStrip bars={bars} height={480} /> : <Empty>No bars in this window.</Empty>}
          <Finding>
            The majority-class baseline drifts across the rows: the whole-table up-rate is{" "}
            {fmt(overview?.horizons.find((row) => row.horizon === 1)?.upRate, 4)} at horizon 1 and {fmt(overview?.horizons.find((row) => row.horizon === 1440)?.upRate, 4)} at horizon 1440, so always
            predicting the most common class scores above 0.5 and on opposite sides at the two ends. A direction model is graded against the majority class of its own training slice, never against 0.5.
          </Finding>
        </Section>

        <Section title="D. One panel per label column" question="The labels are binary, so each column gets its own count panel; the window's up-rate sits beside the whole table's.">
          {bars && barCount > 0 ? <LabelPanels bars={bars} table={overview?.horizons ?? []} /> : <Empty>No bars in this window.</Empty>}
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <h4 className="text-xs font-semibold text-neutral-200">Up-rate by horizon: whole table and this window</h4>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={driftData} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="name" {...AXIS} label={{ value: "horizon (bars)", position: "insideBottom", offset: -6, fill: "#a3a3a3", fontSize: 10 }} />
                  <YAxis domain={[0.4, 0.65]} {...AXIS} tickFormatter={(value: number) => value.toFixed(2)} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} />
                  <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "0.5", fill: OKABE.grey, fontSize: 10, position: "right" }} />
                  <Bar dataKey="table" name="whole table up-rate" fill={OKABE.sky} isAnimationActive={false}>
                    <LabelList dataKey="table" position="top" fontSize={9} fill="#d4d4d4" formatter={(value: number) => value.toFixed(3)} />
                  </Bar>
                  <Line dataKey="window" name="window up-rate" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 4, fill: OKABE.orange, stroke: OKABE.orange }} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-neutral-400">
                <span style={{ color: OKABE.sky }}>▮ whole-table up-rate</span> · <span style={{ color: OKABE.orange }}>● this window</span> · dashed line = 0.5
              </p>
            </div>

            <div className="min-w-0 space-y-2">
              <h4 className="text-xs font-semibold text-neutral-200">The up-rate is a sum: step it one bar at a time</h4>
              <ControlBar>
                <SliderControl label="Bars read, i" value={stepBars} min={1} max={Math.max(barCount, 1)} onChange={(value) => set("step", value)} />
                <SegmentControl label="Horizon (bars)" value={controls.inspectHorizon} options={DIRECTION_HORIZONS.map((h) => ({ value: h as number, label: String(h) }))} onChange={(value) => set("inspectHorizon", value)} />
              </ControlBar>
              <FormulaCard
                tex={"\\hat p_H(i)=\\frac{1}{n_i}\\sum_{t=1}^{i} y^{(H)}_t,\\qquad n_i=\\#\\{\\,t\\le i : y^{(H)}_t \\text{ is known}\\,\\}"}
                caption={`After ${fmtInt(stepBars)} bars ${fmtInt(running.sum)} of ${fmtInt(running.labeled)} labelled bars are up; the whole window ends at ${fmt(fullWindow.labeled > 0 ? fullWindow.sum / fullWindow.labeled : null, 4)}.`}
                symbols={[
                  { tex: "\\hat p_H(i)", name: "up-rate after the first i bars of the window", value: fmt(running.labeled > 0 ? running.sum / running.labeled : null, 4) },
                  { tex: "i", name: "bars read so far (the slider)", value: fmtInt(stepBars) },
                  { tex: "t", name: "bar index, 1 to i", value: `1 … ${fmtInt(stepBars)}` },
                  { tex: "y^{(H)}_t", name: `${directionLabelName(inspectHorizon)}, 1 when up`, value: `Σ = ${fmtInt(running.sum)}` },
                  { tex: "n_i", name: "labelled bars among the first i (the last H bars have no label)", value: fmtInt(running.labeled) },
                  { tex: "H", name: "horizon in bars", value: fmtInt(inspectHorizon) },
                  { tex: "\\hat p_H", name: "whole-table up-rate, the majority-class baseline", value: fmt(tableUpRate, 4) },
                ]}
              />
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={curve} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="bars" domain={[0, Math.max(barCount, 1)]} {...AXIS} />
                  <YAxis domain={[0, 1]} {...AXIS} tickFormatter={(value: number) => value.toFixed(1)} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} labelFormatter={(label) => `${label} bars read`} />
                  <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
                  {tableUpRate !== null && <ReferenceLine y={tableUpRate} stroke={OKABE.sky} strokeDasharray="2 2" label={{ value: "whole table", fill: OKABE.sky, fontSize: 9, position: "insideTopRight" }} />}
                  <ReferenceLine x={stepBars} stroke={OKABE.purple} />
                  <Line dataKey="upRate" name="running up-rate" stroke={OKABE.orange} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>

        <StudyState isLoading={overviewQuery.isLoading && !overview} error={overviewQuery.error}>
          <Section
            title="E. The forward move each label is the sign of, per horizon"
            question={`Whole table, ${fmtInt(overview?.joinedRows)} bars. close[t+H] minus close[t] in points, with the eight numbers and its histogram; tails beyond the 1st and 99th percentile fall in the edge bins.`}
          >
            {overview && overview.horizons.length > 0 ? (
              <>
                <SummaryTable columns={overview.horizons.map((row) => ({ name: `horizon ${row.horizon}`, summary: row.move, decimals: 3 }))} />
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                  {overview.horizons.map((row) => (
                    <div key={row.horizon} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                      <div className="truncate text-[11px] font-medium text-neutral-200" title={forwardChangeName(row.horizon)}>{forwardChangeName(row.horizon)}</div>
                      <Histogram bins={row.histogram} unit="points" height={110} markers={[{ x: 0, label: "0", color: OKABE.grey }]} />
                    </div>
                  ))}
                </div>
                <h4 className="pt-1 text-xs font-semibold text-neutral-200">Does the typical move clear the round trip?</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={economics} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="name" {...AXIS} label={{ value: "horizon (bars)", position: "insideBottom", offset: -6, fill: "#a3a3a3", fontSize: 10 }} />
                    <YAxis scale="log" domain={[0.1, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => `$${value}`} />
                    <Tooltip {...TOOLTIP} formatter={(value) => fmtUsd(Number(value))} />
                    <ReferenceLine y={costUsd} stroke={OKABE.vermillion} strokeDasharray="5 3" label={{ value: `round trip ${fmtUsd(costUsd)}`, fill: OKABE.vermillion, fontSize: 10, position: "insideTopLeft" }} />
                    <Bar dataKey="medianUsd" name="median absolute move, USD per contract" isAnimationActive={false}>
                      {economics.map((row) => (
                        <Cell key={row.name} fill={row.clears ? OKABE.orange : OKABE.blue} />
                      ))}
                      <LabelList dataKey="text" position="top" fontSize={9} fill="#d4d4d4" />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-neutral-400">
                  <span style={{ color: OKABE.orange }}>▲ median move clears the round trip</span> · <span style={{ color: OKABE.blue }}>▼ does not</span> · dashed line = one MNQ round trip from cost_model.json (the notebook quoted $2.8011; the model now says {fmtUsd(costUsd)}).
                </p>
                <Finding>
                  Pick the horizon from the cost model, not from the chart. A 1-minute round trip costs {fmtUsd(costUsd)} per contract
                  {firstClearing ? `, and the median absolute move first exceeds it at horizon ${firstClearing.name} (${fmtUsd(firstClearing.medianUsd)}); shorter horizons cannot amortise it on a typical bar` : ""}.
                </Finding>
              </>
            ) : (
              <Empty>The overview is not in the lake yet.</Empty>
            )}
          </Section>
        </StudyState>

        <StudyState isLoading={proofQuery.isLoading && !proof} error={proofQuery.error}>
          <Section
            title="F. Is what you just looked at actually correct?"
            question={`Every stored label re-derived from the joined closes over the whole table (${fmtInt(proof?.joinedRows)} bars), with a negative control so the check is known to be able to fail.`}
          >
            {proof && proof.horizons.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Verdict ok={allAligned} pass="every horizon: 0 mismatches" fail="a horizon has mismatches" />
                  <Verdict ok={controlsCanFail} pass="the negative control fails, as it must" fail="negative control passed: the check is vacuous" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono tnum">
                    <thead>
                      <tr className="text-neutral-500">
                        <th className="py-0.5 text-left font-normal">horizon (bars)</th>
                        <th className="py-0.5 text-right font-normal">bars compared</th>
                        <th className="py-0.5 text-right font-normal">mismatches</th>
                        <th className="py-0.5 text-left pl-2 font-normal">verdict</th>
                        <th className="py-0.5 text-right font-normal">forward change max abs error (points)</th>
                        <th className="py-0.5 text-right font-normal">negative control mismatches</th>
                        <th className="py-0.5 text-left pl-2 font-normal">control</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proof.horizons.map((row) => (
                        <tr key={row.horizon} className="border-t border-neutral-900">
                          <td className="py-0.5 text-neutral-200">
                            {row.horizon}
                            {row.horizon === 15 || row.horizon === 60 ? <span className="ml-1 text-[9px] text-neutral-500">notebook</span> : null}
                          </td>
                          <td className="py-0.5 text-right text-neutral-200">{fmtInt(row.compared)}</td>
                          <td className="py-0.5 text-right text-neutral-200">{fmtInt(row.mismatches)}</td>
                          <td className="py-0.5 pl-2"><Verdict ok={row.mismatches === 0} pass="OK" fail="WRONG" /></td>
                          <td className="py-0.5 text-right text-neutral-200">{row.deltaMaxAbsoluteErrorPoints === null ? "—" : row.deltaMaxAbsoluteErrorPoints.toFixed(6)}</td>
                          <td className="py-0.5 text-right text-neutral-200">{fmtInt(row.negativeControlMismatches)}</td>
                          <td className="py-0.5 pl-2"><Verdict ok={row.negativeControlMismatches > 0} pass="PASS, can fail" fail="FAIL, vacuous" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Finding>
                  Horizon 15 and 60 are the two the notebook checked: {fmtInt(proofFifteen?.compared)} and {fmtInt(proof.horizons.find((row) => row.horizon === 60)?.compared)} bars compared,
                  {" "}{fmtInt(proofFifteen?.mismatches)} and {fmtInt(proof.horizons.find((row) => row.horizon === 60)?.mismatches)} mismatches. Shifting the stored horizon-15 label by one bar breaks
                  {" "}{fmtInt(proofFifteen?.negativeControlMismatches)} of {fmtInt(proofFifteen?.negativeControlCompared)}, so a zero above means the labels are the truth and not that the check is blind.
                  The page extends the notebook's check to all seven horizons and to every forward-change column.
                </Finding>
                <FormulaCard
                  tex={"m_H=\\sum_{t}\\mathbf{1}\\!\\left[\\,y^{(H)}_t\\neq \\mathbf{1}\\!\\left[c_{t+H}>c_t\\right]\\,\\right]"}
                  caption={proofHorizon ? `Horizon ${inspectHorizon}: ${fmtInt(proofHorizon.mismatches)} mismatches in ${fmtInt(proofHorizon.compared)} comparisons. Step the horizon with the control in section B.` : undefined}
                  symbols={[
                    { tex: "m_H", name: "mismatches: bars whose stored label disagrees with the re-derived one", value: fmtInt(proofHorizon?.mismatches) },
                    { tex: "t", name: "bar in the joined table, both the label and c_{t+H} known", value: `${fmtInt(proofHorizon?.compared)} bars` },
                    { tex: "y^{(H)}_t", name: "stored direction label", value: directionLabelName(inspectHorizon) },
                    { tex: "c_{t+H}>c_t", name: "the close H bars later is above this close", value: "recomputed with lead(close, H)" },
                    { tex: "H", name: "horizon in bars", value: fmtInt(inspectHorizon) },
                    { tex: "m_H^{\\text{control}}", name: "the same count with the stored label shifted one bar", value: fmtInt(proofHorizon?.negativeControlMismatches) },
                  ]}
                />
              </>
            ) : (
              <Empty>The proof is not available until both views are in the lake.</Empty>
            )}
          </Section>
        </StudyState>

        <Section title="G. Every numeric column of the window" question="The joined frame the notebook pulled: the bars and the horizon-15 forward change. The binary label columns are the panels in section D.">
          {bars && barCount > 0 ? <ColumnGrid rows={windowRows(bars)} /> : <Empty>No bars in this window.</Empty>}
        </Section>

        <Finding>
          Direction is ▲ orange and ▼ blue throughout, never red against green; each is also a shape, a line style or a word.
          Legacy notes: the labels come from <code className="font-mono text-[11px]">mnq_labels_1m</code>, a snapshot with abbreviated column names and no ingest manifest; the landed, governed label sets are on the{" "}
          <a href="/labels" className="text-[#56B4E9] underline">label catalog</a>.
        </Finding>
      </StudyState>
    </div>
  );
}
