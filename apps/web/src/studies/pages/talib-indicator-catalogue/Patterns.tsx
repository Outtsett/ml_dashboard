/**
 * How often each of the 61 TA-Lib candlestick patterns fires. A pattern column
 * is 0 on a quiet bar, positive on a bullish firing and negative on a bearish
 * one; the counts come from the landed statistics (bars with a nonzero value)
 * and the bullish / bearish split from the landed histogram.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import type { CatalogueBody } from "@shared/studies/talib-indicator-catalogue";
import { patternFires, type Controls, type SetControl } from "./shared";

const PATTERN_GROUP = "Pattern Recognition";

interface PatternRow {
  name: string;
  talibFunction: string;
  fired: number;
  bullish: number;
  bearish: number;
  exact: boolean;
  percent: number;
  bullishShown: number;
  bearishShown: number;
  firedShown: number;
}

export function Patterns({ body, controls, set }: { body: CatalogueBody; controls: Controls; set: SetControl }) {
  const asPercent = controls.patternMeasure === "percent";
  const all: PatternRow[] = body.columns
    .filter((column) => column.talib_group === PATTERN_GROUP)
    .map((column) => {
      const split = patternFires(column, body.histograms[column.column_name]);
      const scale = asPercent && column.bar_count > 0 ? 100 / column.bar_count : 1;
      return {
        name: column.column_name.replace(/^candlestick_/, ""),
        talibFunction: column.talib_function,
        fired: column.nonzero_bar_count,
        bullish: split.bullish,
        bearish: split.bearish,
        exact: split.exact,
        percent: column.bar_count > 0 ? (100 * column.nonzero_bar_count) / column.bar_count : 0,
        bullishShown: split.exact ? split.bullish * scale : 0,
        bearishShown: split.exact ? split.bearish * scale : 0,
        firedShown: split.exact ? 0 : column.nonzero_bar_count * scale,
      };
    });
  const largest = Math.max(0, ...all.map((row) => row.fired));
  const minimum = Math.min(Math.max(0, Math.round(controls.patternMinimum)), largest);
  const rows = all.filter((row) => row.fired >= minimum);
  if (controls.patternOrder === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
  else if (controls.patternOrder === "bullish") rows.sort((a, b) => b.bullish - a.bullish || b.fired - a.fired);
  else if (controls.patternOrder === "bearish") rows.sort((a, b) => b.bearish - a.bearish || b.fired - a.fired);
  else rows.sort((a, b) => b.fired - a.fired || a.name.localeCompare(b.name));

  const barCount = body.summary?.barCount ?? 0;
  const silent = all.filter((row) => row.fired === 0);
  const byFires = [...all].sort((a, b) => b.fired - a.fired);
  const top = byFires[0];
  const totalFires = all.reduce((sum, row) => sum + row.fired, 0);
  const topFive = byFires.slice(0, 5).reduce((sum, row) => sum + row.fired, 0);
  const inexact = all.filter((row) => !row.exact);
  const unit = asPercent ? "percent of bars" : "bars";

  if (all.length === 0) return <Empty>The catalogue has no candlestick pattern column for this bar set.</Empty>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Candlestick patterns" value={fmtInt(all.length)} hint="TA-Lib's Pattern Recognition group, one column each" />
        <Stat label="Most frequent" value={top ? `${top.name}  ${fmt(top.percent, 2)}%` : "—"} hint={top ? `${fmtInt(top.fired)} of ${fmtInt(barCount)} bars` : undefined} tone={OKABE.sky} />
        <Stat label="Never fire on this bar set" value={fmtInt(silent.length)} hint={silent.map((row) => row.name).join(", ") || "every pattern fires at least once"} />
        <Stat label="Firings held by the top five" value={totalFires > 0 ? `${fmt((100 * topFive) / totalFires, 1)}%` : "—"} hint={`${fmtInt(topFive)} of ${fmtInt(totalFires)} firings across all patterns`} />
      </div>

      <Section
        title="How often each candlestick pattern fires"
        question={`One bar per pattern over all ${fmtInt(barCount)} bars. Orange ▲ = bullish firings (a positive value), blue ▼ = bearish firings (a negative value), stacked; sky = a pattern whose split could not be read exactly. Hover for the counts.`}
      >
        <ControlBar>
          <SegmentControl
            label="Measure"
            value={controls.patternMeasure}
            options={[{ value: "bars", label: "bars fired" }, { value: "percent", label: "percent of bars" }]}
            onChange={(value) => set("patternMeasure", value)}
          />
          <SegmentControl
            label="Order"
            value={controls.patternOrder}
            options={[{ value: "fires", label: "most fired" }, { value: "bullish", label: "most bullish" }, { value: "bearish", label: "most bearish" }, { value: "name", label: "name" }]}
            onChange={(value) => set("patternOrder", value)}
          />
          <SliderControl
            label="Fired on at least"
            value={minimum}
            min={0}
            max={Math.max(1, largest)}
            step={Math.max(1, Math.round(largest / 200))}
            onChange={(value) => set("patternMinimum", value)}
            format={(value) => `${fmtInt(value)} bars`}
            hint="Hide the patterns that fire less often than this"
          />
          <span className="self-center font-mono text-[11px] text-neutral-400">{fmtInt(rows.length)} of {fmtInt(all.length)} patterns</span>
        </ControlBar>
        {rows.length === 0 ? (
          <Empty>No pattern fires that often.</Empty>
        ) : (
          <div className="mt-2 max-h-[560px] overflow-y-auto rounded-md border border-neutral-800">
            <ResponsiveContainer width="100%" height={Math.max(200, 15 * rows.length + 40)}>
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 16 }} barCategoryGap={2}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(value: number) => (asPercent ? `${fmt(value, 1)}%` : fmtInt(value))}
                  label={{ value: asPercent ? "share of bars the pattern fired on (percent)" : "bars the pattern fired on (count)", position: "insideBottom", offset: -8, fontSize: 10, fill: "#a3a3a3" }}
                  {...AXIS}
                />
                <YAxis type="category" dataKey="name" width={150} interval={0} {...AXIS} tick={{ fontSize: 9, fill: "#d4d4d4" }} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(value: number, name: string) => [asPercent ? `${fmt(value, 3)}%` : fmtInt(value), `${name} (${unit})`]}
                  labelFormatter={(_label, payload) => {
                    const row = payload?.[0]?.payload as PatternRow | undefined;
                    return row ? `${row.name} (${row.talibFunction}): fired on ${fmtInt(row.fired)} bars, ${fmt(row.percent, 3)}% of all bars` : "";
                  }}
                />
                <Bar dataKey="bullishShown" name="▲ bullish firings" stackId="fires" fill={OKABE.orange} isAnimationActive={false} />
                <Bar dataKey="bearishShown" name="▼ bearish firings" stackId="fires" fill={OKABE.blue} isAnimationActive={false} />
                <Bar dataKey="firedShown" name="firings, direction not split" stackId="fires" fill={OKABE.sky} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <Finding>
          Pattern frequency is very uneven{top ? `: ${top.name} fires on ${fmt(top.percent, 2)}% of bars (${fmtInt(top.fired)})` : ""}, the five most frequent hold {totalFires > 0 ? fmt((100 * topFive) / totalFires, 1) : "—"}% of all
          firings, and {fmtInt(silent.length)} of the {fmtInt(all.length)} never fire on this bar set. A pattern that fires a handful of times cannot be tested, and one that fires on a tenth of all bars
          is describing ordinary candles, so the count decides which patterns are worth studying at all.
          {inexact.length > 0 && ` For ${fmtInt(inexact.length)} pattern(s) the bullish and bearish bins did not add up to the landed nonzero count, so only the total is drawn (sky).`}
        </Finding>
      </Section>

      <Section title="The pattern counts as a table" question="The numbers behind the bars, in the order chosen above.">
        <div className="max-h-[420px] overflow-auto rounded-md border border-neutral-800">
          <table className="w-full whitespace-nowrap font-mono text-[11px] tnum">
            <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-2 py-1 text-left font-normal">pattern</th>
                <th className="px-2 py-1 text-left font-normal">TA-Lib function</th>
                <th className="px-2 py-1 text-right font-normal">bars fired</th>
                <th className="px-2 py-1 text-right font-normal">percent of bars</th>
                <th className="px-2 py-1 text-right font-normal">▲ bullish firings</th>
                <th className="px-2 py-1 text-right font-normal">▼ bearish firings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-neutral-900">
                  <td className="px-2 py-0.5 text-left text-neutral-200">{row.name}</td>
                  <td className="px-2 py-0.5 text-left text-neutral-400">{row.talibFunction}</td>
                  <td className="px-2 py-0.5 text-right text-neutral-200">{fmtInt(row.fired)}</td>
                  <td className="px-2 py-0.5 text-right text-neutral-200">{fmt(row.percent, 3)}%</td>
                  <td className="px-2 py-0.5 text-right" style={{ color: OKABE.orange }}>{row.exact ? fmtInt(row.bullish) : "—"}</td>
                  <td className="px-2 py-0.5 text-right" style={{ color: OKABE.blue }}>{row.exact ? fmtInt(row.bearish) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
