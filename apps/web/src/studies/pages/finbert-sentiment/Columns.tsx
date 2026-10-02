/**
 * Section B: the nine columns every model gets, on a bar grid: one step line
 * per column (the bar the stepper below is on is marked in all nine), the
 * eight numbers of each, their plain-words definitions, and a histogram per
 * column.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, Finding, GRID, OKABE, Section, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import {
  DISPLAY_NAMES, FEATURE_DEFINITIONS, FEATURE_NAMES, eightNumbers, featureScales, type FeatureName,
} from "@shared/studies/finbert-sentiment";
import { EightTable } from "./parts";
import { strideSample, thinSeries } from "./prep";

const MAXIMUM_POINTS = 500;

function Panel({ name, times, values, cursorMs, cursorIndex }: { name: FeatureName; times: Float64Array; values: Float64Array; cursorMs: number | null; cursorIndex: number }) {
  const points = thinSeries(times, values, MAXIMUM_POINTS).map((point) => ({ timeMs: point.time * 1000, value: point.value }));
  const binary = name === "finbert_news_coverage_flag";
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-neutral-200" title={DISPLAY_NAMES[name]}>
            {DISPLAY_NAMES[name]}
          </div>
          <div className="truncate font-mono text-[10px] text-neutral-500">{name}</div>
        </div>
        {cursorIndex >= 0 && cursorIndex < values.length && (
          <div className="shrink-0 font-mono text-[11px] tnum text-neutral-200" title="Value on the bar the stepper is on">
            ◆ {fmt(values[cursorIndex] as number, 4)}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="timeMs" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmtTime(value).slice(5, 13)} minTickGap={48} {...AXIS} />
          <YAxis {...AXIS} width={40} domain={binary ? [0, 1] : ["auto", "auto"]} ticks={binary ? [0, 1] : undefined} tickFormatter={(value: number) => fmt(value, binary ? 0 : 2)} />
          <Tooltip {...TOOLTIP} labelFormatter={(value) => `bar open ${fmtTime(Number(value))} UTC`} formatter={(value) => [fmt(Number(value), 4), name]} />
          {cursorMs !== null && <ReferenceLine x={cursorMs} stroke={OKABE.purple} strokeDasharray="3 3" />}
          <Line type="stepAfter" dataKey="value" stroke={OKABE.blue} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Columns({
  times, features, gridMinutes, cursorIndex, truncated,
}: {
  times: Float64Array;
  features: Record<FeatureName, Float64Array>;
  gridMinutes: number;
  cursorIndex: number;
  truncated: boolean;
}) {
  if (times.length === 0) {
    return (
      <Section title="B. The nine columns every model gets" question="No bars in this window yet (the window starts after now).">
        <Finding>Pick a window that has started.</Finding>
      </Section>
    );
  }
  const scales = featureScales(gridMinutes);
  const summaries = FEATURE_NAMES.map((name) => ({ name: DISPLAY_NAMES[name], summary: eightNumbers(features[name]) }));
  const cursorMs = cursorIndex >= 0 && cursorIndex < times.length ? (times[cursorIndex] as number) * 1000 : null;
  const gridRows = strideSample(
    Array.from({ length: times.length }, (_, i) => i),
    20_000,
  ).map((i) => Object.fromEntries(FEATURE_NAMES.map((name) => [name, features[name][i] as number])) as Record<FeatureName, number>);
  const coverage = summaries[FEATURE_NAMES.indexOf("finbert_news_coverage_flag")]?.summary.mean ?? null;

  return (
    <div className="space-y-3">
      <Section
        title={`B. The nine columns every model gets, on a ${fmtInt(times.length)}-bar grid`}
        question={`Each bar reads only headlines known strictly before it opens. Half-lives: short ${scales.shortSeconds / 60} min, long ${fmtInt(scales.longSeconds / 60)} min; window ${scales.windowSeconds / 60} min (from the ${gridMinutes}-minute bar). None of the columns is z-scored.`}
      >
        <Finding>
          The purple dashed line is the bar the stepper below is on. News coverage is {fmt(coverage === null ? null : coverage * 100, 1)}% of these bars: elsewhere every value reads 0 and the coverage flag says the news is unknown, not neutral.
          {truncated && " The grid is capped at the newest 50,000 bars."}
        </Finding>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {FEATURE_NAMES.map((name) => (
            <Panel key={name} name={name} times={times} values={features[name]} cursorMs={cursorMs} cursorIndex={cursorIndex} />
          ))}
        </div>
      </Section>

      <Section title="Eight numbers of each column" question="The same nine columns, summarised over every bar of the grid.">
        <EightTable rows={summaries} label="column" />
        <details className="mt-2 text-[11px] text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">What each column is, in words</summary>
          <dl className="mt-1 grid gap-x-3 gap-y-1 grid-cols-[auto_1fr]">
            {FEATURE_NAMES.map((name) => (
              <div key={name} className="contents">
                <dt className="font-mono text-neutral-200">{name}</dt>
                <dd>{FEATURE_DEFINITIONS[name]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Section>

      <Section title="Every column as a distribution" question="A histogram per column over all bars (coverage is a 0 / 1 flag: its mean above is the share of covered bars).">
        <ColumnGrid rows={gridRows} title="The nine finbert_* columns" />
      </Section>
    </div>
  );
}
