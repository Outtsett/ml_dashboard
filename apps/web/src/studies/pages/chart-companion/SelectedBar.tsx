/**
 * The selected bar: its numbers, how unusual its return was and where it ranks
 * among the returns before it, with the rank's sum stepped one bar at a time.
 */

import {
  barTimeText, countInBins, describeSelectedBar, earlierReturns, finiteExtent, niceBins, selectedBar, sixSignificant,
  type CompanionFrame,
} from "@shared/studies/chart-companion";
import { FormulaCard, Histogram, OKABE, Section, SliderControl, Finding, fmtTime, fmt } from "@/studies/kit";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1">
      <dt className="truncate text-[10px] uppercase tracking-wider text-neutral-500" title={label}>{label}</dt>
      <dd className="font-mono text-[11px] tnum text-neutral-100">{value}</dd>
    </div>
  );
}

export function SelectedBarSection({
  frame, selectedMs, index, window, clock, k, onK,
}: {
  frame: CompanionFrame;
  /** The stamp the chart (or a click on the z-score chart) selected; null when nothing is. */
  selectedMs: number | null;
  /** The visible bar it resolves to, or null when it lies outside the visible bars. */
  index: number | null;
  window: number;
  clock: string;
  k: number;
  onK: (next: number) => void;
}) {
  if (selectedMs === null) {
    return (
      <Section title="The selected bar" question="Click a bar on the Market chart, or a point on the z-score chart above.">
        <Finding>Click a bar on the Market chart to see it here: its return, how unusual that return was, and where it ranks among the bars before it.</Finding>
      </Section>
    );
  }
  if (index === null) {
    return (
      <Section title="The selected bar">
        <Finding>The selected bar ({fmtTime(selectedMs)}) is outside the visible range; scroll the chart to it.</Finding>
      </Section>
    );
  }

  const bar = selectedBar(frame, index);
  const words = describeSelectedBar(bar, window);
  const earlier = earlierReturns(frame, index);
  const complete = earlier.length === window && bar.logReturn !== null;
  const step = Math.min(Math.max(1, k), window);
  const indicator = (value: number) => (bar.logReturn !== null && value <= bar.logReturn ? 1 : 0);
  let counted = 0;
  for (let back = 1; back <= step && complete; back += 1) counted += indicator(earlier[window - back] as number);
  const atOrBelow = earlier.reduce((total, value) => total + indicator(value), 0);
  const stepValue = complete ? (earlier[window - step] as number) : null;

  // The window's returns and this bar's, on one set of bins, so the marker always lies on the axis.
  const pool = bar.logReturn === null ? earlier : [...earlier, bar.logReturn];
  const extent = finiteExtent(pool);
  const edges = extent ? niceBins(extent.minimum, extent.maximum, 24) : [];
  const counts = countInBins(edges, earlier);
  const bins = edges.map((edge, position) => ({ lower: edge.lower, upper: edge.upper, count: counts[position] as number }));

  return (
    <Section title="The selected bar" question={`${barTimeText(bar.timestamp)} (${clock})`}>
      <div className="space-y-3">
        <Finding>
          {words.sentence} {words.volatility}
        </Finding>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1.5">
          <Field label={`bar time (${clock})`} value={barTimeText(bar.timestamp)} />
          <Field label="open" value={sixSignificant(bar.open)} />
          <Field label="high" value={sixSignificant(bar.high)} />
          <Field label="low" value={sixSignificant(bar.low)} />
          <Field label="close" value={sixSignificant(bar.close)} />
          <Field label="volume" value={sixSignificant(bar.volume)} />
          <Field label="log_return" value={sixSignificant(bar.logReturn)} />
          <Field label="true_range_points" value={sixSignificant(bar.trueRangePoints)} />
          <Field label="return_zscore" value={bar.returnZscore === null ? "—" : fmt(bar.returnZscore, 3)} />
          <Field label="return_percentile_in_window" value={bar.returnPercentileInWindow === null ? "—" : fmt(bar.returnPercentileInWindow, 3)} />
          <Field label="trailing_true_range_percentile" value={bar.trailingTrueRangePercentile === null ? "—" : fmt(bar.trailingTrueRangePercentile, 3)} />
        </dl>
        {complete && (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Histogram bins={bins} unit="log return" height={170} markers={[{ x: bar.logReturn as number, label: "this bar", color: OKABE.vermillion }]} />
              <p className="text-[10px] text-neutral-500">The {window} log returns before this bar (bars left of zero are blue, right of zero orange) and this bar&apos;s return (vermillion dashed line).</p>
            </div>
            <div className="min-w-0 space-y-2">
              <FormulaCard
                tex={String.raw`p_i=\frac{1}{w}\sum_{k=1}^{w}\mathbf{1}\!\left[r_{i-k}\le r_i\right]`}
                symbols={[
                  { tex: "p_i", name: "return percentile in window: share of the w earlier returns at or below this bar's return", value: `${fmt(atOrBelow / window, 3)} (${atOrBelow} of ${window})` },
                  { tex: "r_i", name: "log return of the selected bar", value: sixSignificant(bar.logReturn) },
                  { tex: "w", name: "trailing window (bars)", value: String(window) },
                  { tex: String.raw`\sum_{k=1}^{w}`, name: "sum over the w earlier bars; k = 1 is the bar just before", value: `first ${step} terms add to ${counted}` },
                  { tex: String.raw`\mathbf{1}[\cdot]`, name: "indicator: 1 when the condition holds, else 0", value: stepValue === null ? "—" : `k = ${step}: ${sixSignificant(stepValue)} ≤ ${sixSignificant(bar.logReturn)} is ${indicator(stepValue) === 1 ? "true, 1" : "false, 0"}` },
                ]}
              />
              <SliderControl label="Step the sum, k" value={step} min={1} max={window} onChange={onK} hint="The same k as the z-score sums above" />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
