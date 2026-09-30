/**
 * "What to do" — the prescriptive layer: the entry threshold that maximised
 * net result per trade on these rows (with its bootstrap interval and the
 * in-sample warning), expected value by conviction after costs, the break-even
 * hit rate, a capped fractional Kelly size and the recommendation, with every
 * rule it was derived from and the input each rule read.
 */

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LensAnalyticsToDo, LensAnalyticsVerdict } from "@shared/lens/analytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { formatInt, formatNumber, formatPercent, formatUsdSigned, LENS_CHART_AXIS, LENS_CHART_GRID, LENS_CHART_TOOLTIP_STYLE } from "../format";
import { ANALYTICS_COLORS, EstimateText, Explains, Heading, RateBar, Reason, Sentence } from "./parts";

const VERDICT_TEXT: Record<LensAnalyticsVerdict, { glyph: string; words: string }> = {
  trade: { glyph: "▲", words: "Trade the current signal" },
  do_not_trade: { glyph: "■", words: "Do not trade the current signal" },
  gather_more_data: { glyph: "◆", words: "Gather more data" },
};

export function ToDoTab({ toDo }: { toDo: LensAnalyticsToDo }) {
  const search = toDo.thresholdSearch;
  const gridData = search.grid.map((point) => ({
    threshold: point.threshold,
    trades: point.tradeCount,
    mean: point.eligible ? point.meanTradeNetUsd : null,
  }));
  const recommendation = toDo.recommendation;
  const verdict = VERDICT_TEXT[recommendation.verdict];

  return (
    <div className="flex flex-col gap-2" data-testid="lens-analytics-todo">
      <Explains>{toDo.explanation}</Explains>

      <Heading>Recommendation</Heading>
      <Explains>A verdict from fixed rules checked in order; the first rule that fires decides, and every rule&apos;s input is shown.</Explains>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2" data-testid="lens-analytics-recommendation">
        <p className="text-sm font-semibold text-foreground">
          <span aria-hidden="true" className="mr-1">
            {verdict.glyph}
          </span>
          {verdict.words}
        </p>
        <Sentence testId="lens-analytics-recommendation-sentence">{recommendation.sentence}</Sentence>
        <ol className="mt-2 space-y-0.5 text-[11px]" data-testid="lens-analytics-rules">
          {recommendation.rules.map((rule, index) => (
            <li key={rule.name} className={rule.name === recommendation.decidingRule ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {index + 1}. {rule.triggered ? "✗ fires" : "✓ passes"} — {rule.question}{" "}
              <span className="font-mono">({rule.input})</span>
              {rule.triggered ? ` → ${VERDICT_TEXT[rule.verdictWhenTriggered].words.toLowerCase()}` : ""}
              {rule.name === recommendation.decidingRule ? " ← decides" : ""}
            </li>
          ))}
        </ol>
      </div>

      <Heading>Entry threshold that maximised net result per trade</Heading>
      <Explains>The lens&apos;s trade rule re-run at every threshold from 0.50 to 0.95: mean net result per trade after costs (orange line) and how many trades each took (grey bars).</Explains>
      <Sentence testId="lens-analytics-threshold">{search.sentence}</Sentence>
      <p className="text-[11px] font-medium text-(--color-data-warn)" data-testid="lens-analytics-threshold-warning">
        ⚠ {search.warning}
      </p>
      {search.reason === null || search.grid.length > 0 ? (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gridData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="threshold" type="number" domain={[0.5, 0.95]} {...LENS_CHART_AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
              <YAxis yAxisId="mean" {...LENS_CHART_AXIS} tickFormatter={(v: number) => formatUsdSigned(v, 0)} width={64} />
              <YAxis yAxisId="trades" orientation="right" {...LENS_CHART_AXIS} allowDecimals={false} width={40} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                labelFormatter={(v: number) => `threshold ${v.toFixed(2)}`}
                formatter={(value: number, name: string) => [name.startsWith("Mean") ? formatUsdSigned(value) : formatInt(value), name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine yAxisId="mean" y={0} stroke={ANALYTICS_COLORS.reference} strokeDasharray="4 3" />
              <ReferenceLine yAxisId="mean" x={search.currentThreshold} stroke={ANALYTICS_COLORS.interval} strokeDasharray="2 2" label={{ value: "current", fontSize: 9, position: "top" }} />
              {search.best && (
                <ReferenceLine yAxisId="mean" x={search.best.threshold} stroke={ANALYTICS_COLORS.expected} label={{ value: "best", fontSize: 9, position: "top" }} />
              )}
              <Bar yAxisId="trades" dataKey="trades" name="Trades (grey bars)" fill={ANALYTICS_COLORS.reference} opacity={0.35} isAnimationActive={false} />
              <Line yAxisId="mean" dataKey="mean" name={`Mean net per trade (line; blank below ${search.minimumTrades} trades)`} stroke={ANALYTICS_COLORS.gain} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Reason>{search.reason}</Reason>
      )}

      <Heading>Expected value per trade by conviction, after costs</Heading>
      <Explains>{toDo.convictionBuckets.definition}</Explains>
      {toDo.convictionBuckets.reason ? (
        <Reason>{toDo.convictionBuckets.reason}</Reason>
      ) : (
        <Table data-testid="lens-analytics-conviction">
          <TableHeader>
            <TableRow>
              <TableHead>Conviction</TableHead>
              <TableHead className="text-right">Bars</TableHead>
              <TableHead>Mean net per trade [95% interval]</TableHead>
              <TableHead>Share profitable after costs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {toDo.convictionBuckets.buckets.map((bucket) => (
              <TableRow key={bucket.label}>
                <TableCell className="whitespace-nowrap">{bucket.label}</TableCell>
                <TableCell className="text-right font-mono tnum">{formatInt(bucket.rowCount)}</TableCell>
                <TableCell>
                  <EstimateText estimate={bucket.meanNetUsd} reason={bucket.reason} />
                </TableCell>
                <TableCell>
                  <RateBar rate={bucket.profitableShare} reason={bucket.reason} reference={0.5} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Heading>Break-even hit rate</Heading>
      <Explains>How often the model must be right, given what its right and wrong trades were worth and what each trade costs.</Explains>
      <Sentence testId="lens-analytics-break-even">{toDo.breakEven.sentence}</Sentence>
      {toDo.breakEven.reason === null && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            break-even = (average loss {formatUsdSigned(toDo.breakEven.averageGrossLossUsd)} + cost {formatUsdSigned(toDo.breakEven.costPerTradeUsd)}) ÷ (average win{" "}
            {formatUsdSigned(toDo.breakEven.averageGrossWinUsd)} + average loss {formatUsdSigned(toDo.breakEven.averageGrossLossUsd)}) ={" "}
            {formatPercent(toDo.breakEven.breakEvenHitRate)}
          </span>
          <RateBar rate={toDo.breakEven.observedHitRate} reference={toDo.breakEven.breakEvenHitRate} />
          <span>dashed line = break-even</span>
        </div>
      )}

      <Heading>Position size (capped fractional Kelly)</Heading>
      <Explains>The Kelly fraction of risk capital from the win share and the payoff ratio, halved and capped at 25%, with every input shown.</Explains>
      <Sentence testId="lens-analytics-kelly">{toDo.kelly.sentence}</Sentence>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
        {(
          [
            ["Trades", formatInt(toDo.kelly.tradeCount)],
            ["Win share, p", toDo.kelly.winShare === null ? "—" : formatNumber(toDo.kelly.winShare, 3)],
            ["Average net win", formatUsdSigned(toDo.kelly.averageNetWinUsd)],
            ["Average net loss", formatUsdSigned(toDo.kelly.averageNetLossUsd === null ? null : -toDo.kelly.averageNetLossUsd)],
            ["Payoff ratio, b", toDo.kelly.payoffRatio === null ? "—" : formatNumber(toDo.kelly.payoffRatio, 3)],
            ["Full Kelly", toDo.kelly.fullKellyFraction === null ? "—" : formatNumber(toDo.kelly.fullKellyFraction, 3)],
            ["Fraction used", `${formatNumber(toDo.kelly.fraction, 2)}, capped at ${formatPercent(toDo.kelly.cap, 0)}`],
            ["Suggested size", toDo.kelly.suggestedFraction === null ? "—" : formatPercent(toDo.kelly.suggestedFraction)],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="font-mono tnum">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
