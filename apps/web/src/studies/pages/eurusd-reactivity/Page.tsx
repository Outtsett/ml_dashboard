/**
 * EURUSD, what reactivity costs. The overview (daily causal z-score of log
 * range) is the selector; brushing it re-asks the lake for the detail candles
 * and the brushed-against-rest distribution over every one-minute bar. Every
 * control is in the URL; every cost shown was measured on the server.
 */

import {
  ColumnGrid, ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState,
  SwitchControl, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  DEFAULT_BRUSH_DAYS, DEFAULT_PAIR, DEFAULT_TARGET_BARS, DEFAULT_Z_WINDOW, causalRollingZScore,
  type BrushBody, type ColumnsBody, type DailyRow, type OverviewBody, type StageTiming,
} from "@shared/studies/eurusd-reactivity";
import { DetailChart } from "./DetailChart";
import { DensityChart, DistributionTable, MomentFormulas } from "./Distribution";
import { MinuteColumns } from "./MinuteColumns";
import { MinutePager } from "./MinutePager";
import { OverviewBrush } from "./OverviewBrush";

const SLUG = "eurusd-reactivity";
const PAIR = DEFAULT_PAIR;
const DENSITY_BINS = 40;

/** One UTC day with its causal z-score, and where it sits in the unfiltered rows. */
interface FrameRow extends DailyRow {
  range_zscore: number;
  rowIndex: number;
}

function day(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildFrame(rows: readonly DailyRow[], windowLength: number): FrameRow[] {
  const z = causalRollingZScore(rows.map((row) => row.log_range), windowLength);
  const frame: FrameRow[] = [];
  rows.forEach((row, rowIndex) => {
    const value = z[rowIndex];
    if (value !== null && value !== undefined) frame.push({ ...row, range_zscore: value, rowIndex });
  });
  return frame;
}

/** Index of the first frame row on or after `from` and of the last on or before `to`; the last `defaultDays` rows when nothing is picked. */
function selection(frame: readonly FrameRow[], from: number, to: number): [number, number] {
  if (frame.length === 0) return [0, 0];
  if (from > 0 && to > 0) {
    let start = frame.findIndex((row) => row.date >= from);
    if (start < 0) start = Math.max(0, frame.length - DEFAULT_BRUSH_DAYS);
    let end = frame.length - 1;
    while (end > start && (frame[end] as FrameRow).date > to) end -= 1;
    return [start, Math.max(start, end)];
  }
  return [Math.max(0, frame.length - DEFAULT_BRUSH_DAYS), frame.length - 1];
}

function TimingsTable({ rows }: { rows: ReadonlyArray<StageTiming & { runs: string }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-0.5 font-normal">stage</th>
            <th className="py-0.5 text-right font-normal">cost</th>
            <th className="py-0.5 pl-3 font-normal">runs</th>
            <th className="py-0.5 pl-3 font-normal">detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stage} className="border-t border-neutral-900 align-top">
              <td className="py-0.5 text-neutral-200">{row.stage}</td>
              <td className="py-0.5 text-right font-mono tnum text-neutral-100">{fmtInt(row.milliseconds)} ms</td>
              <td className="py-0.5 pl-3 text-neutral-400">{row.runs}</td>
              <td className="py-0.5 pl-3 text-neutral-400">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    zWindow: DEFAULT_Z_WINDOW,
    targetBars: DEFAULT_TARGET_BARS,
    brushFrom: 0,
    brushTo: 0,
    probeBack: 0,
    logPrice: true,
    showVolume: false,
    bins: 40,
  });

  const overview = useStudyQuery<OverviewBody>(SLUG, { part: "overview", pair: PAIR });
  const rows = overview.data?.data.rows ?? [];
  const frame = buildFrame(rows, controls.zWindow);
  const [startIndex, endIndex] = selection(frame, controls.brushFrom, controls.brushTo);
  const from = frame[startIndex]?.date;
  const to = frame[endIndex]?.date;

  const detail = useStudyQuery<BrushBody>(
    SLUG,
    { part: "brush", pair: PAIR, from, to, target: controls.targetBars, bins: DENSITY_BINS },
    { enabled: from !== undefined && to !== undefined },
  );
  const columns = useStudyQuery<ColumnsBody>(SLUG, { part: "columns", pair: PAIR, bins: controls.bins }, { enabled: detail.data !== undefined });

  const detailBody = detail.data?.data;
  const brushed = detailBody?.summaries.find((summary) => summary.group === "brushed");
  const rest = detailBody?.summaries.find((summary) => summary.group === "rest of history");

  const probeMaximum = Math.max(0, frame.length - 1);
  const probeIndex = Math.max(0, probeMaximum - Math.min(controls.probeBack, probeMaximum));
  const probeRow = frame[probeIndex];
  const windowValues = probeRow ? rows.slice(probeRow.rowIndex - controls.zWindow + 1, probeRow.rowIndex + 1).map((row) => row.log_range) : [];
  const windowMean = windowValues.length > 0 ? windowValues.reduce((total, value) => total + value, 0) / windowValues.length : null;
  const windowDeviation = windowValues.length > 1 && windowMean !== null
    ? Math.sqrt(windowValues.reduce((total, value) => total + (value - windowMean) ** 2, 0) / (windowValues.length - 1))
    : null;

  const lastRow = rows[rows.length - 1];
  const partialLastDay = lastRow !== undefined && rows.length > 2 && lastRow.minute_count < 0.6 * median(rows.map((row) => row.minute_count));

  const commit = (start: number, end: number) => {
    const first = frame[start]?.date;
    const last = frame[end]?.date;
    if (first === undefined || last === undefined) return;
    set("brushFrom", first);
    set("brushTo", last);
  };
  const preset = (days: number | "all") => {
    if (frame.length === 0) return;
    const start = days === "all" ? 0 : Math.max(0, frame.length - days);
    commit(start, frame.length - 1);
  };

  const overviewTimings = overview.data?.data.timings ?? [];
  const timingRows: Array<StageTiming & { runs: string }> = [
    ...overviewTimings.map((timing) => ({ ...timing, runs: "once per page load" })),
    ...(detailBody?.timings ?? []).map((timing) => ({ ...timing, runs: "every brush" })),
    ...(columns.data?.data.timings ?? []).map((timing) => ({ ...timing, runs: "on load and on re-bin" })),
  ];
  const interactionMilliseconds = (detailBody?.timings ?? []).reduce((total, timing) => total + timing.milliseconds, 0);
  const overviewKilobytes = overview.data?.data.overviewKilobytes ?? 0;
  const rawMegabytes = overview.data?.data.rawMegabytesEstimate ?? 0;

  const dailyColumns = frame.map((row) => ({
    absolute_open_price: row.open,
    absolute_high_price: row.high,
    absolute_low_price: row.low,
    absolute_close_price: row.close,
    minute_count: row.minute_count,
    log_range: row.log_range,
    log_range_causal_zscore: row.range_zscore,
    log_return_basis_points: row.log_return_basis_points,
  }));

  return (
    <div className="space-y-3">
      <StudyState isLoading={overview.isLoading} error={overview.error}>
        <StudyNotes notes={[...(overview.data?.notes ?? []), ...(detail.data?.notes ?? []), ...(columns.data?.notes ?? [])].filter((note, index, all) => all.indexOf(note) === index)} />

        {rows.length === 0 ? (
          <Empty>No one-minute {PAIR} bars are served: the lake view <span className="font-mono">bars</span> is not defined. Start the lake catalog, then reload.</Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="One-minute bars" value={fmtInt(overview.data?.data.minuteCount)} hint={`${PAIR} bars in market.bars, every one read on each brush`} />
              <Stat label="Days with a range" value={fmtInt(rows.length)} hint="UTC days whose high is above their low" />
              <Stat label="History" value={`${day(overview.data?.data.firstMinute ?? 0)} to ${day(overview.data?.data.lastMinute ?? 0)}`} hint="First and last one-minute bar, UTC" />
              <Stat label="Brushed" value={from !== undefined && to !== undefined ? `${day(from)} to ${day(to)}` : "—"} tone={OKABE.orange} hint="First and last UTC day inside the brush; the last day is included whole" />
              <Stat label="Interaction cost" value={interactionMilliseconds > 0 ? `${fmtInt(interactionMilliseconds)} ms` : "—"} hint="Server time to answer the last brush: slice plus describe plus density" />
            </div>

            <ControlBar onReset={reset}>
              <SliderControl label="Z-score window" value={controls.zWindow} min={10} max={250} onChange={(value) => set("zWindow", value)} format={(value) => `${value} days`} hint="Trailing days behind each z-score; the first window-minus-one days have none (causal, min periods equal to the window)" />
              <SliderControl label="Candles aimed for" value={controls.targetBars} min={50} max={600} step={10} onChange={(value) => set("targetBars", value)} hint="The detail panel picks the timeframe whose candle count over the brush is nearest this" />
              <SwitchControl label="Log price axis" checked={controls.logPrice} onChange={(checked) => set("logPrice", checked)} />
              <SwitchControl label="Volume pane" checked={controls.showVolume} onChange={(checked) => set("showVolume", checked)} />
              <span className="self-center text-[11px] text-neutral-500">pair {PAIR}</span>
            </ControlBar>

            <Section
              title="Overview: the selector"
              question="The daily log range as a causal z-score. Drag the handles or the band under the line; the picture below answers when you let go."
              aside={
                <SegmentControl
                  label="Brush the last"
                  value={String(endIndex - startIndex + 1)}
                  options={[{ value: "30", label: "30d" }, { value: String(DEFAULT_BRUSH_DAYS), label: "90d" }, { value: "250", label: "250d" }, { value: "500", label: "500d" }, { value: String(frame.length), label: "all" }]}
                  onChange={(value) => preset(Number(value) >= frame.length ? "all" : Number(value))}
                  hint="Trading days counted back from the latest day"
                />
              }
            >
              <OverviewBrush
                points={frame}
                startIndex={startIndex}
                endIndex={endIndex}
                onCommit={commit}
                probeIndex={probeIndex}
                windowLength={controls.zWindow}
              />
              <Finding>
                {fmtInt(frame.length)} days carry a z-score ({fmtInt(rows.length - frame.length)} days at the start have fewer than {controls.zWindow} behind them). Days are UTC calendar days, the lake stores forex in true UTC; the brush spans {fmtInt(endIndex - startIndex + 1)} of them.
                {partialLastDay && lastRow && ` The last day, ${day(lastRow.date)}, holds only ${fmtInt(lastRow.minute_count)} minutes, so its range is a part-day range and its z-score reads low.`}
              </Finding>
              <FormulaCard
                tex={"z_t=\\frac{\\ell_t-\\bar{\\ell}_t}{s_t},\\quad \\bar{\\ell}_t=\\frac{1}{w}\\sum_{k=t-w+1}^{t}\\ell_k,\\quad s_t^{2}=\\frac{1}{w-1}\\sum_{k=t-w+1}^{t}\\left(\\ell_k-\\bar{\\ell}_t\\right)^{2},\\quad \\ell_t=\\ln(H_t-L_t)"}
                caption={probeRow ? `Day ${day(probeRow.date)}: the shaded window is the ${controls.zWindow} days ending there; nothing after ${day(probeRow.date)} is read.` : undefined}
                symbols={[
                  { tex: "t", name: "the day being scored (UTC)", value: probeRow ? day(probeRow.date) : "—" },
                  { tex: "w", name: "window length, trailing days", value: String(controls.zWindow) },
                  { tex: "H_t,\\;L_t", name: "the day's highest high and lowest low, price", value: probeRow ? `${fmt(probeRow.high, 5)}, ${fmt(probeRow.low, 5)}` : "—" },
                  { tex: "\\ell_t", name: "log of the day's range, ln(price)", value: fmt(probeRow?.log_range, 4) },
                  { tex: "\\bar{\\ell}_t", name: "mean log range over the window", value: fmt(windowMean, 4) },
                  { tex: "s_t", name: "sample standard deviation over the window, n − 1", value: fmt(windowDeviation, 4) },
                  { tex: "z_t", name: "causal z-score of the day's log range", value: fmt(probeRow?.range_zscore, 3) },
                ]}
              />
              <SliderControl label="Probe: days before the latest" value={Math.min(controls.probeBack, probeMaximum)} min={0} max={probeMaximum} onChange={(value) => set("probeBack", value)} format={(value) => `${value}`} hint="Move the day whose window is shaded and whose terms the formula shows" />
            </Section>

            <Section
              title="Detail: the brushed span"
              question={detailBody ? `${fmtInt(detailBody.minuteBarCount)} one-minute bars inside the brush, drawn as ${fmtInt(detailBody.candles.length)} ${detailBody.timeframe} candles.` : "Reading the brushed span…"}
            >
              {detailBody && detailBody.candles.length > 0 ? (
                <DetailChart candles={detailBody.candles} logScale={controls.logPrice} showVolume={controls.showVolume} timeframe={detailBody.timeframe} />
              ) : (
                <Empty>{detail.isLoading ? "Reading the brushed span…" : "No bars inside the brush."}</Empty>
              )}
              <Finding>
                The brush covers {detailBody ? fmtInt(detailBody.spanMinutes) : "—"} minutes; {detailBody?.timeframe ?? "—"} is the timeframe whose candle count is nearest {controls.targetBars}.
                Orange candles closed above their open, blue below; the pane under the price is each bar's log return in basis points (▲ up, ▼ down).
              </Finding>
            </Section>

            <Section
              title="One-minute log return (basis points), brushed span against the rest"
              question="Recomputed over every one-minute bar on each brush, not over the window: the nine statistics plus the tails."
            >
              <StudyState isLoading={detail.isLoading} error={detail.error}>
                {detailBody && detailBody.summaries.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 xl:grid-cols-2">
                      <DistributionTable summaries={detailBody.summaries} />
                      <DensityChart density={detailBody.density} range={detailBody.densityRange} />
                    </div>
                    {brushed && rest && brushed.standard_deviation !== null && rest.standard_deviation !== null && (
                      <Finding>
                        Inside the brush the standard deviation of a one-minute return is {fmt(brushed.standard_deviation, 3)} bp against {fmt(rest.standard_deviation, 3)} bp for the rest of history
                        ({fmt(brushed.standard_deviation / rest.standard_deviation, 2)} times). Excess kurtosis is {fmt(brushed.excess_kurtosis, 1)} against {fmt(rest.excess_kurtosis, 1)}: both far above a normal distribution's 0, so the tails carry the variance in either group.
                        The largest return inside the brush is {fmt(Math.max(Math.abs(brushed.minimum ?? 0), Math.abs(brushed.maximum ?? 0)), 1)} bp against {fmt(Math.max(Math.abs(rest.minimum ?? 0), Math.abs(rest.maximum ?? 0)), 1)} bp elsewhere.
                      </Finding>
                    )}
                    <MomentFormulas summary={brushed} />
                  </div>
                ) : (
                  <Empty>No distribution: the brush holds no return.</Empty>
                )}
              </StudyState>
            </Section>

            <Section title="Measured on this request" question="Real server times for each stage, in place of the notebook's timing table. A repeated identical request is served from a five-minute cache and keeps the time of the request that computed it.">
              <TimingsTable rows={timingRows} />
              <div className="mt-2 grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Overview payload" value={`${fmt(overviewKilobytes, 0)} KB`} hint="Date and log range of every day, JSON" />
                <Stat label="Un-aggregated, estimated" value={`${fmt(rawMegabytes, 0)} MB`} hint="Bytes per JSON row of one thousand minute rows, times every row" />
                <Stat label="Times larger" value={overviewKilobytes > 0 ? `${fmtInt((rawMegabytes * 1024) / overviewKilobytes)}×` : "—"} hint="Why the minutes are aggregated in the lake before they reach the browser" />
                <Stat label="Brush, server only" value={interactionMilliseconds > 0 ? `${fmtInt(interactionMilliseconds)} ms` : "—"} hint="Slice and resample plus describe plus density" />
              </div>
              <Finding>
                {(() => {
                  const describe = detailBody?.timings.find((timing) => timing.stage.startsWith("nine-statistic"))?.milliseconds;
                  const slice = detailBody?.timings.find((timing) => timing.stage.startsWith("brush to filter"))?.milliseconds;
                  if (describe === undefined || slice === undefined || interactionMilliseconds === 0) return "Timings appear once the brush has been answered.";
                  return `The describe over every bar took ${fmtInt(describe)} ms and the slice ${fmtInt(slice)} ms: ${fmt((describe / interactionMilliseconds) * 100, 0)}% of a brush is the full-history statistics, which does not depend on how wide the brush is.`;
                })()}
              </Finding>
            </Section>

            <Section title="Every column of every frame">
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-[11px] text-neutral-400">Daily frame ({fmtInt(frame.length)} days, computed in the browser from the overview).</p>
                  <ColumnGrid rows={dailyColumns} title="Daily frame" />
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-neutral-400">One-minute frame ({fmtInt(overview.data?.data.minuteCount)} rows, computed in the lake).</p>
                  <StudyState isLoading={columns.isLoading} error={columns.error}>
                    <MinuteColumns
                      profiles={columns.data?.data.columns ?? []}
                      bins={controls.bins}
                      onBins={(value) => set("bins", value)}
                      rows={rows}
                      first={overview.data?.data.firstMinute ?? null}
                      last={overview.data?.data.lastMinute ?? null}
                      pending={columns.isFetching}
                    />
                  </StudyState>
                </div>
              </div>
            </Section>

            <Section title="The full one-minute frame, paged server-side" question="Only the visible page is ever serialised to the browser.">
              <MinutePager pair={PAIR} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
