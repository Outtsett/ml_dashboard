/**
 * Chart companion: what the bars on the Market chart are doing. Follows the
 * chart (its symbol, timeframe, visible range and clicked bar), reads exactly
 * those bars plus warm-up bars before them, and describes them: the eight
 * numbers of seven columns, a line and a histogram per column with a
 * brush, a causal return z-score with the unusual moves marked, the clicked
 * bar's rank, and optional drawings pushed back onto the chart.
 *
 * The bars come from the study handler (server); every statistic is computed
 * here from packages/shared/src/studies/chart-companion.ts, so the sliders answer at
 * once and the causal rule has one definition.
 */

import { useState } from "react";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import {
  COMPANION_COLUMNS, COMPANION_TIMEFRAMES, WARMUP_BARS_DEFAULT, barTimeText, buildFrame, buildOverlays, columnValues, describeValues,
  resolveSelectedIndex, sixSignificant, type ChartCompanionBody, type CompanionTimeframe,
} from "@shared/studies/chart-companion";
import {
  ColumnGrid, ControlBar, Finding, FormulaCard, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { ColumnPanels, type Brush } from "./ColumnPanels";
import { DrawingSection, useChartDrawing } from "./Drawing";
import { SelectedBarSection } from "./SelectedBar";
import { UnusualMoves } from "./UnusualMoves";
import { requestOf, useFollowedChart, useSettled, type ChartRequest } from "./useFollowedChart";

const GRID_ROW_LIMIT = 20_000;

const TIMEFRAME_OF_MINUTES: Record<number, CompanionTimeframe> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w" };

const STATISTIC_ROWS = [
  ["count", "count"],
  ["mean", "mean"],
  ["median", "median"],
  ["standardDeviation", "standard deviation"],
  ["skewness", "skewness"],
  ["kurtosis", "kurtosis (excess)"],
  ["percentile25", "25th percentile"],
  ["percentile75", "75th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
] as const;

function isSupportedTimeframe(value: string): value is CompanionTimeframe {
  return (COMPANION_TIMEFRAMES as readonly string[]).includes(value);
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300" title={title}>
      {children}
    </span>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    source: "chart",
    symbol: "",
    timeframe: "",
    visibleBars: 500,
    window: 50,
    threshold: 2,
    bins: 30,
    logCounts: false,
    drawMarkers: true,
    drawLevels: true,
    drawZones: true,
    drawSelected: true,
    draw: false,
  });
  const selection = useSymbolContext();
  const [brush, setBrush] = useState<Brush | null>(null);
  const [pick, setPick] = useState<{ ms: number; base: number | null } | null>(null);
  const [step, setStep] = useState(1);

  const following = controls.source === "chart";
  const followed = useFollowedChart(following);
  const chartRequest = requestOf(followed.context);
  const settled = JSON.parse(useSettled(JSON.stringify(chartRequest), 400)) as ChartRequest | null;

  const typedSymbol = (controls.symbol || selection.symbol).trim().toUpperCase();
  // A symbol being typed and a slider being dragged each wait until they hold still before a request goes out.
  const latestSymbol = useSettled(typedSymbol, 500);
  const latestBars = useSettled(controls.visibleBars, 300);
  const latestTimeframe = controls.timeframe || TIMEFRAME_OF_MINUTES[selection.timeframeMinutes] || "5m";
  const chartTimeframeUnsupported = following && settled !== null && !isSupportedTimeframe(settled.timeframe);

  const params = following
    ? settled && isSupportedTimeframe(settled.timeframe)
      ? { symbol: settled.symbol, timeframe: settled.timeframe, assetClass: settled.assetClass, startMs: settled.startMs, endMs: settled.endMs, lastBarMs: settled.lastBarMs, warmupBars: WARMUP_BARS_DEFAULT }
      : null
    : { symbol: latestSymbol, timeframe: latestTimeframe, visibleBars: latestBars, warmupBars: WARMUP_BARS_DEFAULT };
  const query = useStudyQuery<ChartCompanionBody>("chart-companion", params ?? {}, { enabled: params !== null && latestSymbol.length > 0 });
  const body = query.data?.data ?? null;
  const notes = query.data?.notes ?? [];

  const frame = body && body.visibleCount > 0 ? buildFrame(body, controls.window) : null;
  const clock = body?.clock ?? "UTC";

  const chartSelected = following ? (followed.context?.selectedMs ?? null) : null;
  const selectedMs = pick && pick.base === chartSelected ? pick.ms : chartSelected;
  const selectedIndex = frame ? resolveSelectedIndex(frame.bars.timestamps, selectedMs) : null;
  let focusIndex = selectedIndex;
  if (frame && focusIndex === null) {
    for (let index = frame.bars.timestamps.length - 1; index >= 0; index -= 1) {
      if (!Number.isNaN(frame.scored.returnZscore[index] as number)) {
        focusIndex = index;
        break;
      }
    }
  }

  const overlays = frame ? buildOverlays(frame, controls.threshold, selectedIndex, { markers: controls.drawMarkers, levels: controls.drawLevels, zones: controls.drawZones, selectedLine: controls.drawSelected }) : [];
  const drawingMessage = useChartDrawing({ draw: controls.draw, overlays, symbol: body?.symbol ?? "", timeframe: body?.timeframe ?? "" });

  const summaries = frame ? COMPANION_COLUMNS.map((column) => ({ column, summary: describeValues(columnValues(frame, column.key)) })) : [];

  // The scored frame as rows, for the every-column grid (an even stride past GRID_ROW_LIMIT rows, said in its title).
  let gridRows: Array<Record<string, number | null>> = [];
  let stride = 1;
  if (frame) {
    const count = frame.bars.timestamps.length;
    stride = Math.max(1, Math.ceil(count / GRID_ROW_LIMIT));
    const known = (value: number) => (Number.isNaN(value) ? null : value);
    gridRows = [];
    for (let index = 0; index < count; index += stride) {
      gridRows.push({
        open: frame.bars.open[index] as number,
        high: frame.bars.high[index] as number,
        low: frame.bars.low[index] as number,
        close: frame.bars.close[index] as number,
        volume: frame.bars.volume[index] as number,
        log_return: known(frame.scored.logReturn[index] as number),
        true_range_points: known(frame.scored.trueRangePoints[index] as number),
        return_trailing_mean: known(frame.scored.returnTrailingMean[index] as number),
        return_trailing_standard_deviation: known(frame.scored.returnTrailingStandardDeviation[index] as number),
        return_zscore: known(frame.scored.returnZscore[index] as number),
        return_percentile_in_window: known(frame.scored.returnPercentileInWindow[index] as number),
        trailing_true_range_points: known(frame.scored.trailingTrueRangePoints[index] as number),
        trailing_true_range_percentile: known(frame.scored.trailingTrueRangePercentile[index] as number),
      });
    }
  }

  // Values for the two definitions (log return, true range) at the focus bar.
  let definition: { r: number; close: number; previousClose: number | null; high: number; low: number; trueRange: number } | null = null;
  if (frame && body && focusIndex !== null) {
    const absolute = body.warmupCount + focusIndex;
    definition = {
      r: frame.scored.logReturn[focusIndex] as number,
      close: frame.bars.close[focusIndex] as number,
      previousClose: absolute > 0 ? (body.bars.close[absolute - 1] as number) : null,
      high: frame.bars.high[focusIndex] as number,
      low: frame.bars.low[focusIndex] as number,
      trueRange: frame.scored.trueRangePoints[focusIndex] as number,
    };
  }
  const returnKurtosis = summaries.find((entry) => entry.column.key === "logReturn")?.summary.kurtosis ?? null;
  const focusLabel = focusIndex === null || !frame ? "" : `${barTimeText(frame.bars.timestamps[focusIndex] as number)} (${clock})`;

  return (
    <div className="min-w-0 space-y-4">
      <ControlBar onReset={() => { reset(); setBrush(null); setPick(null); setStep(1); }}>
        <SegmentControl
          label="Bars from"
          value={controls.source}
          options={[{ value: "chart", label: "the Market chart" }, { value: "latest", label: "the newest bars" }]}
          onChange={(value) => { set("source", value); setPick(null); setBrush(null); }}
          hint="Follow what the Market chart shows, or read the newest bars of a symbol yourself"
        />
        {!following && (
          <>
            <label className="flex w-28 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Symbol</span>
              <input
                value={controls.symbol || selection.symbol}
                onChange={(event) => set("symbol", event.target.value.toUpperCase())}
                className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 font-mono text-xs text-neutral-200"
                spellCheck={false}
              />
            </label>
            <SegmentControl label="Timeframe" value={latestTimeframe} options={COMPANION_TIMEFRAMES.map((value) => ({ value, label: value }))} onChange={(value) => set("timeframe", value)} />
            <SliderControl label="Bars read" value={controls.visibleBars} min={50} max={20_000} step={50} onChange={(value) => set("visibleBars", value)} format={fmtInt} />
          </>
        )}
        <SliderControl label="Trailing window (bars)" value={controls.window} min={10} max={200} step={5} onChange={(value) => { set("window", value); setStep(1); }} hint="How many earlier bars each bar is compared with" />
        <SliderControl label="Unusual-move threshold (|z|)" value={controls.threshold} min={1} max={4} step={0.1} onChange={(value) => set("threshold", Math.round(value * 10) / 10)} format={(value) => value.toFixed(1)} hint="How many standard deviations from the window's average counts as unusual" />
        <SliderControl label="Histogram bins" value={controls.bins} min={10} max={80} step={5} onChange={(value) => set("bins", value)} />
        <SwitchControl label="Log-scale histogram counts" checked={controls.logCounts} onChange={(value) => set("logCounts", value)} />
      </ControlBar>
      <ControlBar>
        <SwitchControl label="Arrows on unusual moves" checked={controls.drawMarkers} onChange={(value) => set("drawMarkers", value)} />
        <SwitchControl label="Visible high, low and volume-weighted average price" checked={controls.drawLevels} onChange={(value) => set("drawLevels", value)} />
        <SwitchControl label="High-volatility shading" checked={controls.drawZones} onChange={(value) => set("drawZones", value)} />
        <SwitchControl label="Vertical line at the selected bar" checked={controls.drawSelected} onChange={(value) => set("drawSelected", value)} />
        <SwitchControl label="Draw on the chart" checked={controls.draw} onChange={(value) => set("draw", value)} hint="Put the choices on the left onto the Market chart; off clears them" />
      </ControlBar>

      <Finding>
        A second trader looking over your shoulder at the same screen: whatever symbol, timeframe and stretch of time the chart shows, this page reads exactly those bars and describes them: how far each bar moved, how wide it was, how much traded, and which bars were
        unusual compared with the bars just before them. Everything is causal: each bar is compared only with bars before it, the first bars of a window carry no score (shown blank, never zero) until enough history exists, and {WARMUP_BARS_DEFAULT} extra bars are read
        before the visible range so the first visible bar is already scored. Session gaps are not left out here (a weekend return is scored like any other), which differs from the Analytics page.
      </Finding>

      <StudyNotes notes={notes} />
      {following && followed.context === null && (
        <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-300">
          <p>The chart has not published yet. Open the Market chart (the dashboard&apos;s home page) and this study starts following it; nothing below can be computed until the chart says which bars it shows.</p>
          <button type="button" onClick={() => set("source", "latest")} className="rounded border border-neutral-600 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800">
            Read the newest bars of {latestSymbol} instead
          </button>
        </div>
      )}
      {following && followed.context !== null && chartRequest === null && (
        <p className="text-xs text-neutral-400">The chart for {followed.context.symbol} {followed.context.timeframe} has not loaded its bars yet.</p>
      )}
      {chartTimeframeUnsupported && settled && (
        <p className="text-xs text-neutral-300">
          The chart shows {settled.symbol} at {settled.timeframe}, a timeframe this study cannot read ({COMPANION_TIMEFRAMES.join(", ")} are the lake&apos;s bar views). Pick one of those on the chart, or read the newest bars at one of them.
        </p>
      )}

      <StudyState isLoading={query.isLoading && params !== null} error={query.error}>
        {body && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip title="where the bars come from">{following ? (followed.origin === "chart" ? "following the chart" : "following the chart (last published)") : "newest bars"}</Chip>
            <Chip>{body.symbol} {body.timeframe}</Chip>
            <Chip title="bars inside the visible range">{fmtInt(body.visibleCount)} visible bars</Chip>
            <Chip title="bars read before the visible range so the statistics start full">{fmtInt(body.warmupCount)} warm-up bars</Chip>
            {body.firstVisibleMs !== null && body.lastVisibleMs !== null && <Chip>{barTimeText(body.firstVisibleMs)} to {barTimeText(body.lastVisibleMs)} {clock}</Chip>}
            {body.adjustment === "ratio" && <Chip title="history restated so each contract roll has no step, as the chart draws it">ratio-adjusted roll history</Chip>}
            {selectedMs !== null && <Chip>selected {barTimeText(selectedMs)}</Chip>}
          </div>
        )}

        {body && !frame && <p className="text-xs text-neutral-400">No bars were read for this request{notes.length > 0 ? "; see the note above" : ""}.</p>}

        {frame && body && (
          <div className="space-y-4">
            <Section title="The visible bars in numbers" question="Every column of the visible bars, eight ways.">
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[11px] font-mono tnum">
                    <thead>
                      <tr className="text-neutral-500">
                        <th className="py-0.5 text-left font-normal">statistic</th>
                        {summaries.map(({ column }) => (
                          <th key={column.key} className="py-0.5 text-right font-normal" title={column.title}>{column.heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {STATISTIC_ROWS.map(([key, label]) => (
                        <tr key={key} className="border-t border-neutral-900">
                          <td className="py-0.5 text-neutral-400">{label}</td>
                          {summaries.map(({ column, summary }) => (
                            <td key={column.key} className="py-0.5 text-right text-neutral-200">{key === "count" ? fmtInt(summary.count) : sixSignificant(summary[key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Finding>
                  Mean and standard deviation describe the middle and the spread; skewness says whether the long tail points up (positive) or down (negative); kurtosis (excess, 0 for a bell curve) says how much more often extreme bars happen than a bell curve would
                  predict; the percentiles, minimum and maximum show where the bulk and the single most extreme bar sit. The log return is the bar&apos;s move as a fraction of the previous close (0.001 is one tenth of one percent); the true range is how far the bar reached,
                  including any gap from the previous close, in price points. Times are {clock}.
                  {returnKurtosis !== null && ` The log return's excess kurtosis here is ${fmt(returnKurtosis, 2)}${returnKurtosis > 0 ? ", so extreme bars are more common than a bell curve predicts" : ""}.`}
                </Finding>
                {definition && (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <FormulaCard
                      tex={String.raw`r_i=\ln\frac{c_i}{c_{i-1}}`}
                      caption={`Values for ${selectedIndex !== null ? "the selected bar" : "the newest scored bar"}, ${focusLabel}.`}
                      symbols={[
                        { tex: "r_i", name: "log return of bar i: its move as a fraction of the previous close", value: Number.isFinite(definition.r) ? sixSignificant(definition.r) : "—" },
                        { tex: "c_i", name: "close price of bar i", value: sixSignificant(definition.close) },
                        { tex: "c_{i-1}", name: "close price of the bar before it", value: sixSignificant(definition.previousClose) },
                        { tex: String.raw`\ln`, name: "natural logarithm", value: "base e" },
                      ]}
                    />
                    <FormulaCard
                      tex={String.raw`T_i=\max\left(h_i-l_i,\;\left|h_i-c_{i-1}\right|,\;\left|l_i-c_{i-1}\right|\right)`}
                      caption="True range: how far the bar reached, including any gap from the previous close."
                      symbols={[
                        { tex: "T_i", name: "true range of bar i, in price points", value: Number.isFinite(definition.trueRange) ? sixSignificant(definition.trueRange) : "—" },
                        { tex: "h_i", name: "high price of bar i", value: sixSignificant(definition.high) },
                        { tex: "l_i", name: "low price of bar i", value: sixSignificant(definition.low) },
                        { tex: "c_{i-1}", name: "close price of the bar before it", value: sixSignificant(definition.previousClose) },
                      ]}
                    />
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Every column, seen"
              question="One panel per column: the line is the value bar by bar, the histogram below is how often each value occurred."
              aside={
                brush ? (
                  <button type="button" onClick={() => setBrush(null)} className="rounded border border-neutral-600 px-2 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-800">
                    Clear brush ({barTimeText(brush.from)} to {barTimeText(brush.to)})
                  </button>
                ) : undefined
              }
            >
              <div className="space-y-2">
                <Finding>
                  Drag across any line to brush a stretch of time: every histogram then shows that stretch in yellow over the whole visible range in sky blue, so you can see whether (say) the widest bars all came from one burst. Re-bin with the slider; switch the counts to a log scale
                  to see the rare values in the tails. Click without dragging to clear the brush.
                </Finding>
                <ColumnPanels frame={frame} bins={controls.bins} logCounts={controls.logCounts} brush={brush} onBrush={setBrush} selectedStamp={selectedIndex === null ? null : (frame.bars.timestamps[selectedIndex] as number)} clock={clock} />
                <ColumnGrid
                  rows={gridRows}
                  title={`Every numeric column of the scored bars (${fmtInt(gridRows.length)} rows${stride > 1 ? `, every ${stride}th bar` : ""})`}
                />
              </div>
            </Section>

            <UnusualMoves
              frame={frame}
              threshold={controls.threshold}
              window={controls.window}
              clock={clock}
              focusIndex={focusIndex}
              selected={selectedIndex !== null}
              onPick={(stamp) => setPick({ ms: stamp, base: chartSelected })}
              k={step}
              onK={setStep}
            />

            <SelectedBarSection frame={frame} selectedMs={selectedMs} index={selectedIndex} window={controls.window} clock={clock} k={step} onK={setStep} />

            <DrawingSection overlays={overlays} message={drawingMessage} draw={controls.draw} />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="visible bars" value={fmtInt(body.visibleCount)} />
              <Stat label="warm-up bars" value={fmtInt(body.warmupCount)} hint={`${fmtInt(body.warmupRequested)} requested; ${2 * controls.window + 2} are needed for this window`} />
              <Stat label="trailing window" value={`${controls.window} bars`} />
              <Stat label="threshold" value={`|z| ≥ ${controls.threshold.toFixed(1)}`} />
            </div>
          </div>
        )}
      </StudyState>
    </div>
  );
}
