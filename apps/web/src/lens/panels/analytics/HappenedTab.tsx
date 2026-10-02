/**
 * "What happened" — the descriptive layer: a sentence built from the numbers,
 * the eight-number summary and histogram of per-trade net result, trades by
 * side, equity against buy-and-hold and the deepest drawdown with its dates.
 */

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LensAnalyticsHappened } from "@shared/lens/analytics";
import { formatTimestamp, formatTimestampShort, formatUsd, formatUsdSigned, LENS_CHART_AXIS, LENS_CHART_GRID, LENS_CHART_TOOLTIP_STYLE } from "../format";
import { ANALYTICS_COLORS, EightNumberTable, Explains, Heading, RateBar, Reason, SegmentTable, Sentence } from "./parts";

export function HappenedTab({ happened }: { happened: LensAnalyticsHappened }) {
  const equityData = happened.equity.points.map((point) => ({
    time: point.timestampSeconds,
    model: point.modelCumulativeUsd,
    buyHold: point.buyHoldCumulativeUsd,
  }));
  const histogramData = happened.tradeNetHistogram.map((bin) => ({
    label: `${formatUsd(bin.lower, 0)} to ${formatUsd(bin.upper, 0)}`,
    middle: (bin.lower + bin.upper) / 2,
    count: bin.count,
  }));
  const drawdown = happened.drawdown;

  return (
    <div className="flex flex-col gap-2" data-testid="lens-analytics-happened">
      <Explains>{happened.explanation}</Explains>
      <Sentence testId="lens-analytics-summary">{happened.summarySentence}</Sentence>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span>
          Right before costs (price moved the traded way):{" "}
          <RateBar rate={happened.directionRight} reason="no trades" reference={happened.breakEvenHitRate} />
        </span>
        <span className="text-muted-foreground">
          dashed line = break-even rate{" "}
          {happened.breakEvenHitRate === null ? <Reason>{happened.breakEvenReason}</Reason> : `${(happened.breakEvenHitRate * 100).toFixed(1)}%`} ·
          cost {formatUsd(happened.costPerTradeUsd)} ({happened.costPerTradeTicks.toFixed(1)} ticks) per round trip
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">Trades: {happened.tradesBasis}.</p>

      <Heading>Per-trade net result after costs</Heading>
      <Explains>How much each trade made or lost after costs: the eight summary numbers and how the results are spread.</Explains>
      {happened.tradeNetSummaryReason && happened.tradeNetSummary.count === 0 ? (
        <Reason>{happened.tradeNetSummaryReason}</Reason>
      ) : (
        <>
          <EightNumberTable summary={happened.tradeNetSummary} format={(v) => formatUsdSigned(v)} testId="lens-analytics-trade-summary" />
          {happened.tradeNetSummaryReason && <Reason>{happened.tradeNetSummaryReason}</Reason>}
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...LENS_CHART_GRID} vertical={false} />
                <XAxis dataKey="middle" {...LENS_CHART_AXIS} tickFormatter={(v: number) => formatUsd(v, 0)} label={{ value: "net result per trade (US dollars)", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis {...LENS_CHART_AXIS} allowDecimals={false} label={{ value: "trades", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip {...LENS_CHART_TOOLTIP_STYLE} formatter={(value: number) => [value, "trades"]} labelFormatter={(_, payload) => String(payload?.[0]?.payload?.label ?? "")} />
                <ReferenceLine x={0} stroke={ANALYTICS_COLORS.reference} strokeDasharray="4 3" />
                <Bar dataKey="count" fill={ANALYTICS_COLORS.interval} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <Heading>Trades by side</Heading>
      <Explains>Long and short trades counted separately; the bar columns score every bar the model leaned that way, the trade columns only the trades it took.</Explains>
      <SegmentTable segments={happened.sides} firstColumn="Side" testId="lens-analytics-sides" />

      <Heading>Equity against buy-and-hold</Heading>
      <Explains>The model&apos;s running result after costs (orange, solid) beside holding one contract over the same bars (sky, dashed).</Explains>
      <Sentence testId="lens-analytics-equity">{happened.equity.sentence}</Sentence>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={equityData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid {...LENS_CHART_GRID} />
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} {...LENS_CHART_AXIS} tickFormatter={(v: number) => formatTimestampShort(v)} />
            <YAxis {...LENS_CHART_AXIS} tickFormatter={(v: number) => formatUsd(v, 0)} width={70} />
            <Tooltip {...LENS_CHART_TOOLTIP_STYLE} labelFormatter={(v: number) => formatTimestamp(v)} formatter={(value: number, name: string) => [formatUsdSigned(value), name]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke={ANALYTICS_COLORS.reference} strokeDasharray="4 3" />
            <Line dataKey="model" name="Model, after costs (solid)" stroke={ANALYTICS_COLORS.gain} dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line dataKey="buyHold" name="Buy and hold (dashed)" stroke={ANALYTICS_COLORS.interval} strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Heading>Deepest drawdown</Heading>
      <Explains>The largest fall of the model&apos;s equity below its previous high, and when it happened.</Explains>
      <Sentence testId="lens-analytics-drawdown">{drawdown.sentence}</Sentence>
      <p className="text-[11px] text-muted-foreground">
        Peak {drawdown.peakTimestampSeconds === null ? "start of the record" : formatTimestamp(drawdown.peakTimestampSeconds)} · trough{" "}
        {formatTimestamp(drawdown.troughTimestampSeconds)} · recovered{" "}
        {drawdown.recoveryTimestampSeconds === null ? "not by the end of the record" : formatTimestamp(drawdown.recoveryTimestampSeconds)} · decline over{" "}
        {drawdown.declineBarCount.toLocaleString("en-US")} bars · measured on {drawdown.basis}
      </p>
    </div>
  );
}
