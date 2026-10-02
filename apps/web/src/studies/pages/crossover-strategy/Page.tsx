/**
 * Crossover strategy. Every control on the strategy recomputes the live panels
 * (candles, equity, drawdown, trades, the frame's columns) on the server from
 * the lake's bars; the sweep, walk-forward, bootstrap and Deflated Sharpe Ratio
 * are the landed record of the analytics package's own run. Controls that only
 * change how something is drawn (toggles, the heatmap metric) never ask the server.
 */

import { useState } from "react";
import {
  ControlBar, Empty, Finding, FormulaCard, Histogram, Section, SegmentControl, SelectControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, fmtPercent, fmtTime, OKABE, toneOf, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { NOTEBOOK_SETTINGS, type CrossoverBody } from "@shared/studies/crossover-strategy";
import { CandlePanel } from "./CandlePanel";
import { ColumnPanels } from "./ColumnPanels";
import { CommitSlider, DateControl } from "./controls";
import { DrawdownChart, EpisodesTable, EquityChart, MonthsChart } from "./EquityPanels";
import { ClaimsTable, FoldsChart, RealityPanel, ReferenceTable, SWEEP_METRICS, SweepHeatmap, type SweepMetric } from "./SweepPanels";
import { TradeStepper } from "./TradeStepper";

const SERVER_KEYS = [
  "symbol", "timeframe", "series", "windowStart", "windowEnd", "fastKind", "slowKind", "fastPeriod", "slowPeriod", "mode", "costSource",
  "customCost", "trainFraction", "candleStart", "candleEnd", "macdFast", "macdSlow", "macdSignal", "rsiPeriod", "bins",
] as const;

const KIND_OPTIONS = [{ value: "ema", label: "EMA" }, { value: "sma", label: "SMA" }] as const;

function describeMonths(days: number): string {
  return `${fmt(days / 30.4375, 1)} months`;
}

function columnOf(body: CrossoverBody, name: string) {
  return body.columns.find((column) => column.name === name)?.summary ?? null;
}

async function showWindowOnChart(startSeconds: number, endSeconds: number): Promise<string> {
  try {
    const response = await fetch("/api/chart/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startMs: startSeconds * 1000, endMs: endSeconds * 1000 }),
    });
    return response.ok ? "Asked the Market chart to show this window (it must be open on the same symbol and timeframe)." : `The chart refused the view (${response.status}).`;
  } catch {
    return "The chart link is not reachable; open the Market page first.";
  }
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    symbol: NOTEBOOK_SETTINGS.symbol as string,
    timeframe: NOTEBOOK_SETTINGS.timeframe as string,
    series: "naive",
    windowStart: NOTEBOOK_SETTINGS.windowStart as string,
    windowEnd: NOTEBOOK_SETTINGS.windowEnd as string,
    fastKind: NOTEBOOK_SETTINGS.fastKind as string,
    slowKind: NOTEBOOK_SETTINGS.slowKind as string,
    fastPeriod: NOTEBOOK_SETTINGS.fastPeriod as number,
    slowPeriod: NOTEBOOK_SETTINGS.slowPeriod as number,
    mode: "long_short",
    costSource: "notebook",
    customCost: 0.7,
    trainFraction: NOTEBOOK_SETTINGS.trainFraction as number,
    candleStart: NOTEBOOK_SETTINGS.candleStart as string,
    candleEnd: NOTEBOOK_SETTINGS.candleEnd as string,
    macdFast: NOTEBOOK_SETTINGS.macdFast as number,
    macdSlow: NOTEBOOK_SETTINGS.macdSlow as number,
    macdSignal: NOTEBOOK_SETTINGS.macdSignal as number,
    rsiPeriod: NOTEBOOK_SETTINGS.rsiPeriod as number,
    bins: 30,
    showMacdMarkers: true,
    showCrossover: false,
    showGross: true,
    showBuyAndHold: true,
    sweepMetric: "out_of_sample_sharpe",
    sweepOrdering: "EMA/SMA",
  });
  const [chartMessage, setChartMessage] = useState("");

  const serverControls: Record<string, string | number> = {};
  for (const key of SERVER_KEYS) serverControls[key] = controls[key];
  const query = useStudyQuery<CrossoverBody>("crossover-strategy", serverControls);
  const body = query.data?.data ?? null;
  const summary = body?.summary ?? null;
  const parameters = body?.parameters ?? null;
  const landed = body?.landed ?? null;
  const fastLabel = `${controls.fastKind.toUpperCase()}(${controls.fastPeriod})`;
  const slowLabel = `${controls.slowKind.toUpperCase()}(${controls.slowPeriod})`;

  const landedRun = landed?.run ?? null;
  const sameAsLanded =
    parameters !== null && landedRun !== null &&
    parameters.symbol === landedRun.symbol && parameters.timeframe === landedRun.timeframe && parameters.windowStart === landedRun.window_start &&
    parameters.windowEnd === landedRun.window_end && parameters.series === "naive" && parameters.mode === landedRun.mode &&
    Math.abs(parameters.costPointsPerSide - landedRun.cost_points_per_side) < 1e-6 && Math.abs(parameters.trainFraction - landedRun.train_fraction) < 1e-9;
  const live = sameAsLanded ? { fastKind: controls.fastKind, slowKind: controls.slowKind, fastPeriod: controls.fastPeriod, slowPeriod: controls.slowPeriod } : null;

  const netReturn = body ? columnOf(body, "net_return") : null;
  const lastCandle = body?.candles ? body.candles.timestampSeconds.length - 1 : -1;
  const sweepRows = landed?.sweep ?? [];
  const notebookRow = sweepRows.find((row) => row.is_notebook_pair);
  const winnerRow = sweepRows.find((row) => row.is_in_sample_winner);
  const positiveOutOfSample = sweepRows.filter((row) => row.out_of_sample_sharpe > 0).length;
  const notebookReality = landed?.realityCheck.find((row) => row.candidate === "notebook_pair");

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <ControlBar onReset={reset}>
          <SelectControl label="Symbol" value={controls.symbol} onChange={(v) => set("symbol", v)} options={["MNQ", "MES", "NQ", "ES"].map((value) => ({ value, label: value }))} />
          <SegmentControl label="Timeframe" value={controls.timeframe} onChange={(v) => set("timeframe", v)} options={["1m", "5m", "15m", "30m"].map((value) => ({ value, label: value }))} />
          <SelectControl label="Price series" value={controls.series} onChange={(v) => set("series", v)} hint="The notebook read the bare-root symbol, a naive splice with the roll gaps left in; the ratio series back-adjusts every roll" options={[{ value: "naive", label: "bare-root splice (notebook)" }, { value: "ratio", label: "ratio back-adjusted" }]} />
          <DateControl label="Window start" value={controls.windowStart} onCommit={(v) => set("windowStart", v)} />
          <DateControl label="Window end" value={controls.windowEnd} onCommit={(v) => set("windowEnd", v)} hint="Bars up to and including 00:00 of this date" />
          <CommitSlider label="Selection share" value={controls.trainFraction} min={0.5} max={0.9} step={0.05} onCommit={(v) => set("trainFraction", v)} format={(v) => `${Math.round(v * 100)}% in-sample`} hint="Bars before this share of the window are in-sample, the rest out-of-sample (crossovers.crossover train_frac)" />
        </ControlBar>
        <ControlBar>
          <SelectControl label="Fast line" value={controls.fastKind} onChange={(v) => set("fastKind", v)} options={KIND_OPTIONS} />
          <CommitSlider label="Fast period" value={controls.fastPeriod} min={2} max={60} onCommit={(v) => set("fastPeriod", v)} />
          <SelectControl label="Slow line" value={controls.slowKind} onChange={(v) => set("slowKind", v)} options={KIND_OPTIONS} />
          <CommitSlider label="Slow period" value={controls.slowPeriod} min={3} max={400} onCommit={(v) => set("slowPeriod", v)} />
          <SelectControl label="Position" value={controls.mode} onChange={(v) => set("mode", v)} options={[{ value: "long_short", label: "always in (long / short)" }, { value: "long_only", label: "long or flat" }]} />
          <SelectControl
            label="Cost per side"
            value={controls.costSource}
            onChange={(v) => set("costSource", v)}
            options={[
              ...(body?.costPresets ?? []).map((preset) => ({ value: preset.source, label: `${preset.label}: ${fmt(preset.costPointsPerSide, 4)} pts` })),
              { value: "custom", label: "custom points" },
              { value: "none", label: "none (before cost)" },
            ]}
          />
          {controls.costSource === "custom" && <CommitSlider label="Custom cost" value={controls.customCost} min={0} max={3} step={0.005} onCommit={(v) => set("customCost", v)} format={(v) => `${fmt(v, 3)} pts`} />}
        </ControlBar>

        {!body || !body.available || !summary || !parameters ? (
          <Empty>
            No bars for {controls.symbol} {controls.timeframe} between {controls.windowStart} and {controls.windowEnd} in the lake. The notes above say which view is missing.
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat label="Final equity, start 1.00" value={fmt(summary.strategy.finalEquity, 4)} tone={toneOf(summary.strategy.totalReturn)} hint="Compounded net return over the whole window, in-sample and out-of-sample together" />
              <Stat label="Worst drawdown" value={fmtPercent(summary.strategy.maximumDrawdown, 2)} tone={OKABE.blue} hint={summary.strategy.worstDrawdownSeconds === null ? undefined : `lowest on ${fmtTime(summary.strategy.worstDrawdownSeconds * 1000)}`} />
              <Stat label="Out-of-sample Sharpe" value={fmt(summary.strategy.sharpeOutOfSample, 3)} tone={toneOf(summary.strategy.sharpeOutOfSample)} hint={`bars from ${fmtTime(summary.splitTimestampSeconds * 1000)} on`} />
              <Stat label="In-sample / full Sharpe" value={`${fmt(summary.strategy.sharpeInSample, 2)} / ${fmt(summary.strategy.sharpeFull, 2)}`} />
              <Stat label="Trades" value={fmtInt(body.trades?.count)} hint={`${fmtInt(summary.positionChangeCount)} position changes`} />
              <Stat label="Win rate / payoff" value={`${fmtPercent(body.trades?.winRate, 1)} / ${fmt(body.trades?.payoffRatio, 2)}:1`} hint="Share of trades that net a gain; average win over average loss" />
              <Stat label="Buy and hold equity" value={fmt(summary.buyAndHold.finalEquity, 4)} tone={toneOf(summary.buyAndHold.totalReturn)} hint="The same bars, long throughout, no cost" />
              <Stat label="Cost paid, sum of fractions" value={fmtPercent(summary.totalCostFraction, 1)} hint={`${fmt(parameters.costPointsPerSide, 4)} points on each side (${parameters.costSource})`} />
            </div>

            <Finding>
              The rule turned 1.00 into {fmt(summary.strategy.finalEquity, 4)} over {fmtInt(Math.round(summary.spanDays))} days ({fmtInt(summary.frameRowCount)} {parameters.timeframe} bars, {describeMonths(summary.spanDays)}) after
              cost; before cost it made {fmt(summary.grossFinalEquity, 4)}, so cost took {fmt(summary.grossFinalEquity - summary.strategy.finalEquity, 3)} of it across {fmtInt(summary.positionChangeCount)} position changes.
              Buy and hold on the same bars ended at {fmt(summary.buyAndHold.finalEquity, 4)} with a {fmtPercent(summary.buyAndHold.maximumDrawdown, 1)} worst drawdown; its out-of-sample Sharpe was {fmt(summary.buyAndHold.sharpeOutOfSample, 2)} against the rule's {fmt(summary.strategy.sharpeOutOfSample, 2)}.
              The curve is the whole window, so the first {Math.round(parameters.trainFraction * 100)}% is the stretch the pair could have been chosen on, not an untouched test
              {parameters.series === "naive" ? "; the bare-root series also carries each contract roll as a price move" : ""}.
            </Finding>

            <Section title="1. Price, MACD crossings and RSI" question="Where did MACD cross its own signal line in this window, and how does that compare with the crossover rule's flips?">
              <div className="space-y-3">
                <ControlBar>
                  <DateControl label="Window start" value={controls.candleStart} onCommit={(v) => set("candleStart", v)} />
                  <DateControl label="Window end" value={controls.candleEnd} onCommit={(v) => set("candleEnd", v)} hint="Through the end of this day" />
                  <CommitSlider label="MACD fast" value={controls.macdFast} min={2} max={40} onCommit={(v) => set("macdFast", v)} />
                  <CommitSlider label="MACD slow" value={controls.macdSlow} min={3} max={100} onCommit={(v) => set("macdSlow", v)} />
                  <CommitSlider label="MACD signal" value={controls.macdSignal} min={2} max={40} onCommit={(v) => set("macdSignal", v)} />
                  <CommitSlider label="RSI period" value={controls.rsiPeriod} min={2} max={50} onCommit={(v) => set("rsiPeriod", v)} />
                  <SwitchControl label="MACD crossing markers" checked={controls.showMacdMarkers} onChange={(v) => set("showMacdMarkers", v)} />
                  <SwitchControl label={`Overlay ${fastLabel} / ${slowLabel} and its flips`} checked={controls.showCrossover} onChange={(v) => set("showCrossover", v)} hint="The notebook drew candles only; this adds the crossover rule's own signal for comparison" />
                </ControlBar>
                {body.candles ? (
                  <>
                    <Finding>
                      In these {fmtInt(body.candles.requestedBarCount)} bars ({fmtTime(body.candles.timestampSeconds[0] === undefined ? null : body.candles.timestampSeconds[0] * 1000)} to {fmtTime((body.candles.timestampSeconds[lastCandle] ?? 0) * 1000)}) MACD({controls.macdFast},{controls.macdSlow},{controls.macdSignal}) crossed its signal line{" "}
                      {fmtInt(body.candles.macdLongIndices.length + body.candles.macdShortIndices.length)} times ({fmtInt(body.candles.macdLongIndices.length)} upward, {fmtInt(body.candles.macdShortIndices.length)} downward); the crossover rule {fastLabel} over {slowLabel} flipped{" "}
                      {fmtInt(body.candles.flipLongIndices.length + body.candles.flipShortIndices.length)} times. Each MACD crossing is a chance to pay the round trip again.
                      {body.candles.clipped && " Only the first 4,000 bars of the window are drawn."}
                    </Finding>
                    <CandlePanel candles={body.candles} showMacdMarkers={controls.showMacdMarkers} showCrossover={controls.showCrossover} fastLabel={fastLabel} slowLabel={slowLabel} />
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                      <button
                        type="button"
                        className="rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800"
                        onClick={async () => setChartMessage(await showWindowOnChart(body.candles?.timestampSeconds[0] ?? 0, (body.candles?.timestampSeconds[lastCandle] ?? 0) + 300))}
                      >
                        Show this window on the Market chart
                      </button>
                      {chartMessage && <span>{chartMessage}</span>}
                      {parameters.series === "ratio" && <span>The ratio series rescales earlier contracts, so its prices differ from quoted prices before the latest roll.</span>}
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      <FormulaCard
                        tex={"\\mathrm{MACD}_t=\\mathrm{EMA}_{a}(P)_t-\\mathrm{EMA}_{b}(P)_t,\\quad S_t=\\mathrm{EMA}_{k}(\\mathrm{MACD})_t,\\quad H_t=\\mathrm{MACD}_t-S_t"}
                        caption="Each EMA is y_t = α x_t + (1 − α) y_{t−1} with α = 2 / (n + 1), started on the first close."
                        symbols={[
                          { tex: "P_t", name: "close of bar t, points", value: fmt(body.candles.close[lastCandle], 2) },
                          { tex: "a", name: "fast span, bars", value: String(controls.macdFast) },
                          { tex: "b", name: "slow span, bars", value: String(controls.macdSlow) },
                          { tex: "k", name: "signal span, bars", value: String(controls.macdSignal) },
                          { tex: "\\mathrm{MACD}_t", name: "MACD line, points (last bar of the window)", value: fmt(body.candles.macd[lastCandle], 3) },
                          { tex: "S_t", name: "signal line, points", value: fmt(body.candles.macdSignal[lastCandle], 3) },
                          { tex: "H_t", name: "histogram, points", value: fmt(body.candles.macdHistogram[lastCandle], 3) },
                        ]}
                      />
                      <FormulaCard
                        tex={"\\mathrm{RSI}_t = 100-\\frac{100}{1+G_t/L_t},\\quad G_t=\\mathrm{EMA}_{1/n}\\big(\\max(\\Delta P,0)\\big),\\quad L_t=\\mathrm{EMA}_{1/n}\\big(\\max(-\\Delta P,0)\\big)"}
                        caption="Wilder smoothing: the average gain and loss use α = 1/n; the first value appears after n changes; a zero average loss leaves it unknown."
                        symbols={[
                          { tex: "n", name: "RSI period, bars", value: String(controls.rsiPeriod) },
                          { tex: "\\Delta P", name: "change of the close from the previous bar, points", value: fmt((body.candles.close[lastCandle] ?? 0) - (body.candles.close[lastCandle - 1] ?? 0), 2) },
                          { tex: "\\mathrm{RSI}_t", name: "relative strength index, 0 to 100 (last bar of the window)", value: fmt(body.candles.relativeStrengthIndex[lastCandle], 1) },
                        ]}
                      />
                    </div>
                  </>
                ) : (
                  <Empty>No bars between {controls.candleStart} and {controls.candleEnd} inside the loaded window.</Empty>
                )}
              </div>
            </Section>

            <Section title="2. Equity" question="What did $1.00 become, net of cost, and where did the out-of-sample stretch begin?">
              <div className="space-y-2">
                <ControlBar>
                  <SwitchControl label="Show before-cost equity" checked={controls.showGross} onChange={(v) => set("showGross", v)} />
                  <SwitchControl label="Show buy and hold" checked={controls.showBuyAndHold} onChange={(v) => set("showBuyAndHold", v)} />
                </ControlBar>
                {body.series && <EquityChart series={body.series} splitSeconds={summary.splitTimestampSeconds} showGross={controls.showGross} showBuyAndHold={controls.showBuyAndHold} />}
                <FormulaCard
                  tex={"r_t = h_{t-1}\\Big(\\frac{P_t}{P_{t-1}}-1\\Big)-\\frac{c}{P_t}\\,\\lvert h_t-h_{t-1}\\rvert,\\qquad E_T=\\prod_{t=1}^{T}(1+r_t),\\qquad h_t=\\begin{cases}+1 & F_t>S_t\\\\ -1 & \\text{otherwise}\\end{cases}"}
                  caption="The position used for bar t's return is the one decided at the close of bar t − 1, so nothing is known early. A full flip changes h by 2 and pays one round trip."
                  symbols={[
                    { tex: "F_t", name: `fast line, ${fastLabel} of the close, points (last bar)`, value: fmt(body.candles?.fast[lastCandle] ?? null, 2) },
                    { tex: "S_t", name: `slow line, ${slowLabel} of the close, points (last bar of the candle window)`, value: fmt(body.candles?.slow[lastCandle] ?? null, 2) },
                    { tex: "h_t", name: "position decided at the close of bar t: +1 long, −1 short (0 before both lines exist)", value: `${fmtPercent(summary.longShare, 1)} of bars long, ${fmtPercent(summary.shortShare, 1)} short, ${fmtPercent(summary.flatShare, 2)} flat` },
                    { tex: "P_t", name: "close of bar t, points", value: fmt(body.candles?.close[lastCandle] ?? null, 2) },
                    { tex: "c", name: "trading cost on each side, points", value: fmt(parameters.costPointsPerSide, 4) },
                    { tex: "r_t", name: "net return of bar t, fraction (mean over the window)", value: fmt(netReturn?.mean ?? null, 7) },
                    { tex: "T", name: "bars in the frame (every bar but the first)", value: fmtInt(summary.frameRowCount) },
                    { tex: "E_T", name: "final equity, starting at 1.00", value: fmt(summary.strategy.finalEquity, 5) },
                  ]}
                />
                <FormulaCard
                  tex={"\\mathrm{SR}=\\frac{\\bar r}{s_r}\\sqrt{B},\\qquad B=\\frac{N}{\\text{span in years}}"}
                  caption="Sharpe of the per-bar net return, scaled by the bars per year the series actually has (irregular futures sessions make the textbook 252 × bars-per-day wrong)."
                  symbols={[
                    { tex: "\\bar r", name: "mean net return per bar, fraction", value: fmt(netReturn?.mean ?? null, 7) },
                    { tex: "s_r", name: "sample standard deviation of the net return per bar", value: fmt(netReturn?.standardDeviation ?? null, 6) },
                    { tex: "N", name: "bars loaded", value: fmtInt(summary.loadedBarCount) },
                    { tex: "B", name: "bars per year, from the series' own span", value: fmtInt(summary.annualisationBarsPerYear) },
                    { tex: "\\mathrm{SR}", name: "full-period Sharpe (in-sample / out-of-sample beside it)", value: `${fmt(summary.strategy.sharpeFull, 3)} (${fmt(summary.strategy.sharpeInSample, 2)} / ${fmt(summary.strategy.sharpeOutOfSample, 2)})` },
                  ]}
                />
              </div>
            </Section>

            <Section title="3. Drawdown" question="How far below its high did the equity go, and how often?">
              <div className="space-y-2">
                {body.series && <DrawdownChart series={body.series} worstSeconds={summary.strategy.worstDrawdownSeconds} worstDepth={summary.strategy.maximumDrawdown} />}
                <Finding>
                  The worst point was {fmtPercent(summary.strategy.maximumDrawdown, 1)}
                  {summary.strategy.worstDrawdownSeconds !== null && ` on ${fmtTime(summary.strategy.worstDrawdownSeconds * 1000)}`}. Separate stretches below a high: {" "}
                  {summary.episodesDeeperThan.map((row, i) => `${fmtInt(row.count)} deeper than ${Math.abs(row.threshold * 100)}%${i < summary.episodesDeeperThan.length - 1 ? ", " : ""}`).join("")}.
                  {body.episodes[0] && (body.episodes[0].barsToRecovery === null ? " The deepest one had not recovered by the end of the window." : ` The deepest took ${fmtInt(body.episodes[0].barsToRecovery)} bars to get back to its high.`)}
                </Finding>
                <EpisodesTable episodes={body.episodes} summary={summary} />
                <FormulaCard
                  tex={"D_t=\\frac{E_t}{\\max_{s\\le t}E_s}-1"}
                  caption="The running maximum starts at the first bar's equity, as in the notebook and the analytics package."
                  symbols={[
                    { tex: "E_t", name: "equity at bar t", value: fmt(body.series?.equity[body.series.equity.length - 1] ?? null, 4) },
                    { tex: "\\max_{s\\le t}E_s", name: "highest equity up to bar t", value: "running" },
                    { tex: "D_t", name: "drawdown at bar t; its minimum is the worst drawdown", value: fmtPercent(summary.strategy.maximumDrawdown, 2) },
                  ]}
                />
              </div>
            </Section>

            {body.trades && (
              <Section title="4. Trades and months" question="Is the result many small gains or a few large ones, and which months carried it?">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                    <Stat label="Trades (long / short)" value={`${fmtInt(body.trades.count)} (${fmtInt(body.trades.longCount)} / ${fmtInt(body.trades.shortCount)})`} />
                    <Stat label="Average win / average loss" value={`${fmtPercent(body.trades.averageWin, 2)} / ${fmtPercent(body.trades.averageLoss, 2)}`} />
                    <Stat label="Profit factor" value={fmt(body.trades.profitFactor, 3)} hint="Sum of gains over the absolute sum of losses" />
                    <Stat label="Expectancy per trade" value={fmtPercent(body.trades.expectancy, 3)} tone={toneOf(body.trades.expectancy)} />
                    <Stat label="Average / median holding" value={`${fmt(body.trades.averageHoldingBars, 1)} / ${fmt(body.trades.medianHoldingBars, 0)} bars`} />
                    <Stat label="Best / worst trade" value={`${fmtPercent(body.trades.best, 2)} / ${fmtPercent(body.trades.worst, 2)}`} />
                  </div>
                  <Finding>
                    {fmtPercent(body.trades.winRate, 1)} of the trades gain, at {fmt(body.trades.payoffRatio, 2)} times the size of a loss, so the profit comes from a few large winners; the median trade is held {fmt(body.trades.medianHoldingBars, 0)} bars.
                    Each trade's return includes the round trip paid when it closed, so the factors multiply back to the final equity (difference {fmt(body.trades.factorProductError, 12)}).
                  </Finding>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] text-neutral-400">Net return of one trade (1st to 99th percentile; the edge bins hold the tails)</div>
                      <Histogram bins={body.trades.returnHistogram} unit="net return per trade" markers={[{ x: 0, label: "0", color: OKABE.yellow }]} />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] text-neutral-400">Net return per calendar month, strategy against buy and hold (orange up, blue down)</div>
                      <MonthsChart months={body.months} />
                    </div>
                  </div>
                  <TradeStepper terms={body.trades.terms} flatFactor={body.trades.flatFactor} clipped={body.trades.termsClipped} tradeCount={body.trades.count} />
                </div>
              </Section>
            )}

            {landed && sweepRows.length > 0 && landedRun && (
              <Section title="5. The search this pair came from, and the checks on it" question="Is EMA(5) over SMA(100) special, or one of many pairs that looked good on the same bars?">
                <div className="space-y-3">
                  <Finding>
                    Landed run: {landedRun.symbol} {landedRun.timeframe}, {landedRun.window_start} to {landedRun.window_end}, {fmtInt(landedRun.bar_count)} bars, {fmt(landedRun.cost_points_per_side, 4)} points a side, the first {Math.round(landedRun.train_fraction * 100)}% in-sample
                    (to {landedRun.split_timestamp.slice(0, 16).replace("T", " ")}). It swept {fmtInt(landedRun.sweep_pair_count)} pairs. The notebook's pair ranks {fmtInt(landedRun.notebook_pair_in_sample_rank)} by in-sample Sharpe
                    {winnerRow && notebookRow && winnerRow !== notebookRow ? `; the best in-sample pair is ${winnerRow.configuration_label} ${winnerRow.fast_period} x ${winnerRow.slow_period} (${fmt(winnerRow.in_sample_sharpe, 2)})` : ""}.{" "}
                    {fmtInt(positiveOutOfSample)} of {fmtInt(sweepRows.length)} pairs have a positive out-of-sample Sharpe.
                    {!sameAsLanded && " The controls above differ from the landed run, so the heatmap marks no live pair and the live row below is left out."}
                  </Finding>
                  <ControlBar>
                    <SelectControl label="Heatmap shows" value={controls.sweepMetric} onChange={(v) => set("sweepMetric", v)} options={SWEEP_METRICS.map((metric) => ({ value: metric.value, label: metric.label }))} />
                    <SegmentControl label="Fast over slow" value={controls.sweepOrdering} onChange={(v) => set("sweepOrdering", v)} options={[{ value: "EMA/SMA", label: "EMA / SMA" }, { value: "SMA/EMA", label: "SMA / EMA" }]} />
                  </ControlBar>
                  <SweepHeatmap rows={sweepRows} metric={controls.sweepMetric as SweepMetric} label={controls.sweepOrdering} live={live} />
                  <RealityPanel rows={landed.realityCheck} />
                  {notebookReality && (
                    <FormulaCard
                      tex={"\\mathrm{DSR}=\\Phi\\!\\left(\\frac{(\\widehat{SR}-SR_0)\\sqrt{T-1}}{\\sqrt{1-\\gamma_3\\widehat{SR}+\\frac{\\gamma_4-1}{4}\\widehat{SR}^{2}}}\\right)"}
                      caption="Bailey and López de Prado (2014): the probability that the true Sharpe exceeds what the luckiest of the trials would show with no skill. The analytics package requires more than 0.95."
                      symbols={[
                        { tex: "\\widehat{SR}", name: "observed Sharpe per bar (not annualised)", value: fmt(notebookReality.per_bar_sharpe, 5) },
                        { tex: "SR_0", name: "selection null: Sharpe per bar of the best of the trials when none has skill", value: fmt(notebookReality.selection_null_per_bar_sharpe, 5) },
                        { tex: "T", name: "bars in the return series", value: fmtInt(landedRun.bar_count - 1) },
                        { tex: "\\gamma_3", name: "skewness of the per-bar return", value: fmt(notebookReality.return_skewness, 2) },
                        { tex: "\\gamma_4", name: "kurtosis of the per-bar return (Pearson, normal = 3)", value: fmt(notebookReality.return_kurtosis_pearson, 1) },
                        { tex: "\\Phi", name: `standard normal distribution function; ${fmtInt(notebookReality.trial_count)} trials = ${fmtInt(landedRun.sweep_pair_count)} pairs × ${fmtInt(landedRun.search_timeframe_count)} timeframes searched`, value: "—" },
                        { tex: "\\mathrm{DSR}", name: "Deflated Sharpe Ratio of the notebook's pair", value: fmt(notebookReality.deflated_sharpe_ratio, 3) },
                      ]}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] text-neutral-400">Walk-forward: the after-cost Sharpe of six equal time chunks (orange up, blue down for the notebook's pair)</div>
                    <FoldsChart folds={landed.folds} />
                  </div>
                  <ReferenceTable landed={landed} live={sameAsLanded ? summary : null} />
                  <ClaimsTable landed={landed} live={sameAsLanded ? summary : null} />
                </div>
              </Section>
            )}

            <Section title="6. Every column of the frame" question="The notebook's frame, each column drawn and summarised over the whole window.">
              <div className="space-y-2">
                <ControlBar>
                  <CommitSlider label="Histogram bins" value={controls.bins} min={10} max={80} step={5} onCommit={(v) => set("bins", v)} />
                </ControlBar>
                <ColumnPanels columns={body.columns} />
              </div>
            </Section>
          </>
        )}
        {query.isFetching && !query.isLoading && <p className="text-[11px] text-neutral-500">Recomputing from the lake's bars…</p>}
      </StudyState>
    </div>
  );
}
