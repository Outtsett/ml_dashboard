/**
 * Section 1 of the study: what each pair costs to trade. The coverage table,
 * the spread distribution per pair (basis points or pips), the hour-of-day
 * curve with the notebook's rollover ratio, and the spread / ATR(14) ladder
 * across the seven timeframes.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, SwitchControl, TOOLTIP,
  fmt, fmtInt, fmtPercent, fmtTime,
} from "@/studies/kit";
import {
  LADDER_TIMEFRAMES, cividis, hourRatio, median,
  type FxPairSignalsBody, type SpreadRow, type TradabilityRow,
} from "@shared/studies/fx-pair-signals";
import { DataTable } from "./DataTable";
import type { Controls, SetControl } from "./controls";

const UNIT_LABEL: Record<string, string> = { basis_points: "basis points", pips: "pips" };

function spreadValue(row: SpreadRow, unit: string, statistic: string): number | null {
  const value = (row as unknown as Record<string, unknown>)[`spread_${unit}_${statistic}`];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const LADDER_METRICS: Array<{ value: keyof TradabilityRow; label: string; unit: string }> = [
  { value: "spread_over_average_true_range", label: "spread / ATR(14)", unit: "ratio" },
  { value: "round_trip_over_average_true_range", label: "round trip / ATR(14)", unit: "ratio" },
  { value: "breakeven_move_pips", label: "break-even move (pips)", unit: "pips" },
  { value: "average_true_range_14_bars_basis_points", label: "ATR(14) in basis points", unit: "basis points" },
  { value: "average_true_range_14_bars_pips", label: "ATR(14) in pips", unit: "pips" },
];

function metricOf(row: TradabilityRow | undefined, metric: string): number | null {
  const value = row ? (row as unknown as Record<string, unknown>)[metric] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function CostSection({ body, controls, set }: { body: FxPairSignalsBody; controls: Controls; set: SetControl }) {
  const unit = controls.spreadUnit;
  const unitLabel = UNIT_LABEL[unit] ?? unit;

  // ── coverage ──
  const totalBars = body.inventory.reduce((sum, row) => sum + row.bar_count, 0);
  const coverage = body.inventory.map((row) => row.quote_coverage_ratio);
  const coverageLow = coverage.length ? Math.min(...coverage) : null;
  const coverageHigh = coverage.length ? Math.max(...coverage) : null;

  // ── spread per pair ──
  const spreadSorted = [...body.spread].sort((a, b) => (spreadValue(a, unit, "median") ?? 0) - (spreadValue(b, unit, "median") ?? 0));
  const spreadChart = spreadSorted.map((row) => {
    const middle = spreadValue(row, unit, "median") ?? 0;
    return {
      pair: row.pair,
      median: middle,
      whisker: [middle - (spreadValue(row, unit, "percentile_25") ?? middle), (spreadValue(row, unit, "percentile_75") ?? middle) - middle] as [number, number],
      mean: spreadValue(row, unit, "mean"),
    };
  });
  const rankIn = (u: string, pair: string) =>
    [...body.spread].sort((a, b) => (spreadValue(a, u, "median") ?? 0) - (spreadValue(b, u, "median") ?? 0)).findIndex((row) => row.pair === pair) + 1;
  const nzdPips = rankIn("pips", "NZDUSD");
  const nzdBasis = rankIn("basis_points", "NZDUSD");

  // ── hour of day ──
  const curve =
    controls.hourPair === "all"
      ? body.hourAcrossPairs.map((row) => ({ hour_utc: row.hour_utc, value: unit === "pips" ? row.median_pips : row.median_basis_points }))
      : body.spreadHour
          .filter((row) => row.pair === controls.hourPair)
          .map((row) => ({ hour_utc: row.hour_utc, value: spreadValue(row as unknown as SpreadRow, unit, "median") ?? 0 }));
  const ratio = hourRatio(curve, controls.spikeHour, controls.ordinaryBelow);
  const hourLabel = controls.hourPair === "all" ? "median across all pairs of each pair's median" : `${controls.hourPair}'s median`;

  // ── ladder ──
  const metric = LADDER_METRICS.find((candidate) => candidate.value === controls.ladderMetric) ?? LADDER_METRICS[0]!;
  const byPair = new Map<string, Map<string, TradabilityRow>>();
  for (const row of body.tradability) {
    if (!byPair.has(row.pair)) byPair.set(row.pair, new Map());
    byPair.get(row.pair)!.set(row.timeframe, row);
  }
  const ladderPairs = [...byPair.keys()].sort(
    (a, b) => (metricOf(byPair.get(a)?.get(controls.ladderSort), metric.value) ?? Infinity) - (metricOf(byPair.get(b)?.get(controls.ladderSort), metric.value) ?? Infinity),
  );
  const allValues = body.tradability.map((row) => metricOf(row, metric.value)).filter((value): value is number => value !== null && value > 0);
  const logLow = allValues.length ? Math.log(Math.min(...allValues)) : 0;
  const logHigh = allValues.length ? Math.log(Math.max(...allValues)) : 1;
  const shade = (value: number | null) => (value === null || value <= 0 ? "#111" : cividis((Math.log(value) - logLow) / (logHigh - logLow || 1)));
  const ladderData = LADDER_TIMEFRAMES.map((timeframe) => {
    const point: Record<string, number | string | null> = { timeframe };
    for (const pair of ladderPairs) point[pair] = metricOf(byPair.get(pair)?.get(timeframe), metric.value);
    return point;
  });
  const medianAt = (timeframe: string) => median(ladderPairs.map((pair) => metricOf(byPair.get(pair)?.get(timeframe), "spread_over_average_true_range") ?? Number.NaN));
  const formulaRow = byPair.get(controls.formulaPair)?.get(controls.formulaTimeframe);

  return (
    <>
      <Section title="Coverage" question="How much history each pair has, and how much of it carries two-sided bid and ask quotes.">
        <Finding>
          {body.inventory.length} pairs, {fmtInt(totalBars)} one-minute bars. Two-sided bid/ask exists on {fmtPercent(coverageLow)} to {fmtPercent(coverageHigh)} of
          rows, all of it recent, so every spread number below is measured on that window and none of it is extrapolated backwards.
        </Finding>
        <div className="mt-2">
          <DataTable
            rows={body.inventory}
            rowKey={(row) => row.pair}
            initialSort={{ key: "pair", descending: false }}
            columns={[
              { key: "pair", label: "pair", align: "left" },
              { key: "bar_count", label: "one-minute bars", cell: (row) => fmtInt(row.bar_count) },
              { key: "first_bar_timestamp", label: "first bar (UTC)", cell: (row) => fmtTime(row.first_bar_timestamp) },
              { key: "last_bar_timestamp", label: "last bar (UTC)", cell: (row) => fmtTime(row.last_bar_timestamp) },
              { key: "bars_with_quotes_count", label: "bars with quotes", cell: (row) => fmtInt(row.bars_with_quotes_count) },
              { key: "first_quote_timestamp", label: "first quote (UTC)", cell: (row) => fmtTime(row.first_quote_timestamp) },
              {
                key: "quote_coverage_ratio",
                label: "quote coverage",
                cell: (row) => (
                  <span className="flex items-center justify-end gap-1">
                    <span className="inline-block h-1.5 w-16 rounded bg-neutral-800">
                      <span className="block h-1.5 rounded" style={{ width: `${Math.min(100, row.quote_coverage_ratio * 100)}%`, background: OKABE.sky }} />
                    </span>
                    {fmtPercent(row.quote_coverage_ratio)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Section>

      <Section title="1 · Spread" question="A pip is not a pip: rank in basis points of price, never in pips.">
        <ControlBar>
          <SegmentControl label="Unit" value={unit} options={[{ value: "basis_points", label: "basis points" }, { value: "pips", label: "pips" }]} onChange={(v) => set("spreadUnit", v)} />
        </ControlBar>
        <Finding>
          NZDUSD ranks {nzdPips || "—"} of {body.spread.length} by median spread in pips and {nzdBasis || "—"} of {body.spread.length} in basis points: it trades
          near 0.58, so one pip is a larger share of its price than on a pair near 1.10 or 150.
        </Finding>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] text-neutral-400">Median spread per pair in {unitLabel}; the whisker runs from the 25th to the 75th percentile.</p>
            <ResponsiveContainer width="100%" height={Math.max(240, 16 * spreadChart.length + 40)}>
              <ComposedChart data={spreadChart} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmt(v, 1)} />
                <YAxis type="category" dataKey="pair" width={60} {...AXIS} interval={0} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 3), name]} />
                <Bar dataKey="median" name={`median (${unitLabel})`} fill={OKABE.sky} isAnimationActive={false}>
                  <ErrorBar dataKey="whisker" direction="x" width={4} stroke="#d4d4d4" />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <DataTable
              rows={spreadSorted}
              rowKey={(row) => row.pair}
              maxHeight={420}
              columns={[
                { key: "pair", label: "pair", align: "left" },
                { key: "bp", label: "median bp", sortValue: (row) => spreadValue(row, "basis_points", "median"), cell: (row) => fmt(spreadValue(row, "basis_points", "median"), 3), title: "median spread in basis points of the mid price" },
                { key: "pp", label: "median pips", sortValue: (row) => spreadValue(row, "pips", "median"), cell: (row) => fmt(spreadValue(row, "pips", "median"), 2) },
                ...(["mean", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"] as const).map((statistic) => ({
                  key: statistic,
                  label: statistic.replace(/_/g, " "),
                  sortValue: (row: SpreadRow) => spreadValue(row, unit, statistic),
                  cell: (row: SpreadRow) => fmt(spreadValue(row, unit, statistic), statistic === "excess_kurtosis" ? 1 : statistic === "skewness" ? 2 : 3),
                })),
                { key: "count", label: "two-sided bars", sortValue: (row) => spreadValue(row, unit, "count"), cell: (row) => fmtInt(spreadValue(row, unit, "count")) },
              ]}
            />
            <p className="mt-1 text-[10px] text-neutral-500">Distribution columns are in {unitLabel}; kurtosis is excess (a Gaussian reads 0).</p>
          </div>
        </div>
      </Section>

      <Section title="Spread by hour of day (UTC)" question={`The ${hourLabel}, in ${unitLabel}, over the two-sided window.`}>
        <ControlBar onReset={() => { set("hourPair", "all"); set("spikeHour", 21); set("ordinaryBelow", 20); }}>
          <SelectControl
            label="Pair"
            value={controls.hourPair}
            options={[{ value: "all", label: "all pairs (median of medians)" }, ...body.spread.map((row) => ({ value: row.pair, label: row.pair })).sort((a, b) => a.label.localeCompare(b.label))]}
            onChange={(v) => set("hourPair", v)}
          />
          <SliderControl label="Hour tested" value={controls.spikeHour} min={0} max={23} onChange={(v) => set("spikeHour", v)} format={(v) => `${v}:00`} hint="The hour compared against the ordinary hours (the notebook: 21, the rollover)" />
          <SliderControl label="Ordinary hours below" value={controls.ordinaryBelow} min={1} max={24} onChange={(v) => set("ordinaryBelow", v)} format={(v) => `0-${v - 1}`} hint="Hours before this count as ordinary (the notebook: 20)" />
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="hour_utc" {...AXIS} interval={1} />
                <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmt(v, 1)} />
                <Tooltip {...TOOLTIP} labelFormatter={(hour) => `${hour}:00 UTC`} formatter={(value: number) => [fmt(value, 3), `median spread (${unitLabel})`]} />
                {ratio.ordinary !== null && <ReferenceLine y={ratio.ordinary} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "ordinary median", fill: "#a3a3a3", fontSize: 9, position: "insideTopLeft" }} />}
                <Bar dataKey="value" isAnimationActive={false} label={{ position: "top", fontSize: 9, fill: OKABE.orange, formatter: (value: number) => (value === ratio.spike ? "▲" : "") }}>
                  {curve.map((row) => (
                    <Cell key={row.hour_utc} fill={row.hour_utc === controls.spikeHour ? OKABE.orange : row.hour_utc < controls.ordinaryBelow ? OKABE.blue : OKABE.sky} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">
              <span style={{ color: OKABE.orange }}>▲ ■ hour tested</span> · <span style={{ color: OKABE.blue }}>■ ordinary hour</span> · <span style={{ color: OKABE.sky }}>■ other</span>
            </p>
          </div>
          <div className="min-w-0 space-y-2">
            <Finding>
              The curve reads a median of {fmt(ratio.ordinary, 2)} {unitLabel} over hours 0-{controls.ordinaryBelow - 1}, and hour {controls.spikeHour} reads{" "}
              {fmt(ratio.spike, 2)}: a {fmt(ratio.ratio, 1)}x ratio. Between the cheapest and dearest ordinary hour the spread differs by {fmtPercent(ratio.ordinaryRange)}.
              Do not open or close in the 21:00 UTC hour unless the signal is worth about four times the usual cost; session structure otherwise barely matters for cost.
            </Finding>
            <FormulaCard
              tex={"R = \\frac{s_{h^\\ast}}{\\operatorname{median}_{\\,h < H}\\; s_h}"}
              caption="The notebook's rollover call-out, recomputed as the controls move."
              symbols={[
                { tex: "R", name: "how many times the ordinary cost the tested hour charges", value: `${fmt(ratio.ratio, 2)}x` },
                { tex: "s_h", name: `spread in hour h (${hourLabel})`, value: unitLabel },
                { tex: "h^\\ast", name: "the hour tested", value: `${controls.spikeHour}:00 UTC` },
                { tex: "s_{h^\\ast}", name: "spread in the tested hour", value: `${fmt(ratio.spike, 3)} ${unitLabel}` },
                { tex: "H", name: "first hour not counted as ordinary", value: `${controls.ordinaryBelow} (${ratio.ordinaryHourCount} ordinary hours)` },
                { tex: "\\operatorname{median}_{h<H} s_h", name: "median spread over the ordinary hours", value: `${fmt(ratio.ordinary, 3)} ${unitLabel}` },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="The ratio that decides tradability" question="spread / ATR(14) at the holding horizon: the share of a typical bar's true range surrendered on entry. Double it for a round trip.">
        <ControlBar onReset={() => { set("ladderMetric", "spread_over_average_true_range"); set("ladderSort", "1d"); set("ladderHighlight", "none"); set("ladderLog", true); }}>
          <SelectControl label="Measure" value={controls.ladderMetric} options={LADDER_METRICS.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => set("ladderMetric", v)} />
          <SegmentControl label="Sort pairs by" value={controls.ladderSort} options={LADDER_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("ladderSort", v)} />
          <SelectControl label="Highlight" value={controls.ladderHighlight} options={[{ value: "none", label: "none" }, ...ladderPairs.map((p) => ({ value: p, label: p }))]} onChange={(v) => set("ladderHighlight", v)} />
          <SwitchControl label="Log scale" checked={controls.ladderLog} onChange={(v) => set("ladderLog", v)} />
        </ControlBar>
        <Finding>
          Cost per unit of movement collapses with the holding horizon: the median pair gives up {fmt(medianAt("1m"), 2)} of an ATR(14) on entry at 1m, {fmt(medianAt("1h"), 3)} at 1h
          and {fmt(medianAt("1d"), 4)} at 1d. At 1.0 the spread eats a whole average bar and nothing can be traded there.
        </Finding>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <DataTable
              rows={ladderPairs}
              rowKey={(pair) => pair}
              maxHeight={440}
              columns={[
                { key: "pair", label: "pair", align: "left", cell: (pair) => pair, sortValue: (pair) => pair },
                ...LADDER_TIMEFRAMES.map((timeframe) => ({
                  key: timeframe,
                  label: timeframe,
                  sortValue: (pair: string) => metricOf(byPair.get(pair)?.get(timeframe), metric.value),
                  cell: (pair: string) => {
                    const value = metricOf(byPair.get(pair)?.get(timeframe), metric.value);
                    return (
                      <span className="inline-block w-full rounded-sm px-1" style={{ background: shade(value), color: "#f5f5f5", textShadow: "0 0 2px #000" }}>
                        {fmt(value, value !== null && value < 0.01 ? 4 : 3)}
                      </span>
                    );
                  },
                })),
              ]}
            />
            <p className="mt-1 text-[10px] text-neutral-500">{metric.label}, shaded on a log cividis scale (dark = small). Sorted by {controls.ladderSort}; click a header to re-sort.</p>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={ladderData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="timeframe" {...AXIS} />
                <YAxis {...AXIS} width={52} scale={controls.ladderLog ? "log" : "linear"} domain={["auto", "auto"]} allowDataOverflow tickFormatter={(v: number) => (v < 0.01 ? v.toExponential(0) : fmt(v, 2))} />
                <Tooltip
                  {...TOOLTIP}
                  itemSorter={(item) => -(Number(item.value) || 0)}
                  formatter={(value: number, name: string) => [fmt(value, 4), name]}
                  wrapperStyle={{ maxHeight: 260, overflowY: "auto" }}
                />
                {ladderPairs.map((pair) => {
                  const lit = controls.ladderHighlight === pair;
                  const dim = controls.ladderHighlight !== "none" && !lit;
                  return (
                    <Line
                      key={pair}
                      dataKey={pair}
                      stroke={lit ? OKABE.orange : OKABE.blue}
                      strokeOpacity={dim ? 0.2 : 0.85}
                      strokeWidth={lit ? 3 : 1.25}
                      dot={{ r: lit ? 3 : 1.5 }}
                      isAnimationActive={false}
                    />
                  );
                })}
                {controls.ladderHighlight !== "none" && <Legend payload={[{ value: `▲ ${controls.ladderHighlight}`, type: "line", color: OKABE.orange }]} />}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">{metric.label} per pair across the seven timeframes; one line per pair, the highlighted pair thick orange.</p>
          </div>
        </div>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <ControlBar>
            <SelectControl label="Formula pair" value={controls.formulaPair} options={ladderPairs.map((p) => ({ value: p, label: p })).sort((a, b) => a.label.localeCompare(b.label))} onChange={(v) => set("formulaPair", v)} />
            <SegmentControl label="Timeframe" value={controls.formulaTimeframe} options={LADDER_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("formulaTimeframe", v)} />
          </ControlBar>
          <FormulaCard
            tex={"\\frac{\\tilde s}{\\mathrm{ATR}_{14}}, \\qquad \\mathrm{ATR}_{14} = \\operatorname{median}_t \\frac{1}{14}\\sum_{i=0}^{13} \\mathrm{TR}_{t-i}, \\qquad \\text{break-even} = \\frac{2\\tilde s}{\\mathrm{ATR}_{14}}"}
            caption={`${controls.formulaPair} at ${controls.formulaTimeframe} (pair_spread.py: trailing 14-bar mean of the true range, min_samples = 14, then its median over the bars).`}
            symbols={[
              { tex: "\\tilde s", name: "median two-sided spread over the quoted window (one-minute bars, the same at every timeframe)", value: `${fmt(formulaRow?.median_spread_pips, 2)} pips` },
              { tex: "\\mathrm{TR}_t", name: "true range of bar t: the largest of high - low, |high - previous close|, |low - previous close|", value: "per bar" },
              { tex: "\\mathrm{ATR}_{14}", name: "average true range over 14 bars, median across the history", value: `${fmt(formulaRow?.average_true_range_14_bars_pips, 2)} pips (${fmt(formulaRow?.average_true_range_14_bars_basis_points, 2)} bp)` },
              { tex: "\\tilde s / \\mathrm{ATR}_{14}", name: "share of a typical bar surrendered on entry", value: fmt(formulaRow?.spread_over_average_true_range, 4) },
              { tex: "2\\tilde s / \\mathrm{ATR}_{14}", name: "round trip, in ATRs: how far price must travel to break even", value: fmt(formulaRow?.round_trip_over_average_true_range, 4) },
              { tex: "2\\tilde s", name: "break-even move", value: `${fmt(formulaRow?.breakeven_move_pips, 2)} pips` },
            ]}
          />
        </div>
      </Section>
    </>
  );
}
