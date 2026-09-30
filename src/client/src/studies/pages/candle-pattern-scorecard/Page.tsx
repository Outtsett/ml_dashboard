/**
 * Candle pattern scorecard. Every control filters the 883 scorecard rows in
 * the browser; nothing is recomputed on the server.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { benjaminiYekutieli } from "@shared/studies/multipleTesting";
import {
  AXIS, ColumnGrid, ControlBar, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat,
  StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt, fmtUsd, useStudyControls, useStudyQuery, Finding,
} from "@/studies/kit";
import type { ScorecardBody, ScorecardRow } from "@shared/studies/candle-pattern-scorecard";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
const HORIZONS = [1, 2, 3, 6] as const;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - mx, dy = (ys[i] as number) - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** One recognition row per pattern (the recognition columns repeat on every row of a pattern). */
function recognitionRows(rows: ScorecardRow[], minimumPrevalence: number) {
  const byPattern = new Map<string, ScorecardRow>();
  for (const row of rows) if (!byPattern.has(row.pattern_name)) byPattern.set(row.pattern_name, row);
  return [...byPattern.values()]
    .filter((row) => num(row.recognition_area_under_curve) !== null && (num(row.recognition_prevalence) ?? 0) >= minimumPrevalence)
    .map((row) => ({
      pattern: row.pattern_name,
      auc: row.recognition_area_under_curve as number,
      precision: num(row.recognition_average_precision),
      prevalence: num(row.recognition_prevalence),
      positives: num(row.recognition_positive_window_count),
    }))
    .sort((a, b) => b.auc - a.auc);
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    minimumPrevalence: 0,
    timeframe: "5m",
    horizon: 6,
    side: "both",
    topCount: 25,
    costBand: true,
    rank: 1,
  });
  const query = useStudyQuery<ScorecardBody>("candle-pattern-scorecard");
  const rows = query.data?.data.rows ?? [];
  const pointValue = query.data?.data.pointValueUsd ?? 2;

  const recognition = recognitionRows(rows, controls.minimumPrevalence);
  const recognitionMedian = median(recognition.map((row) => row.auc));

  const direction = rows
    .filter((row) => row.timeframe === controls.timeframe && row.forward_candle_count === controls.horizon)
    .filter((row) => controls.side === "both" || row.pattern_side === controls.side)
    .filter((row) => num(row.edge_in_direction_pattern_claimed_usd_per_contract) !== null)
    .map((row) => {
      const sign = row.pattern_side === "bearish" ? -1 : 1;
      const scale = (num(row.average_range_points) ?? 0) * pointValue * sign;
      const low = (num(row.forward_move_difference_interval_low) ?? 0) * scale;
      const high = (num(row.forward_move_difference_interval_high) ?? 0) * scale;
      const edge = row.edge_in_direction_pattern_claimed_usd_per_contract as number;
      const lower = Math.min(low, high), upper = Math.max(low, high);
      return {
        label: `${row.pattern_name} · ${row.pattern_side}`,
        edge,
        whisker: [edge - lower, upper - edge] as [number, number],
        clears: edge > (num(row.round_trip_cost_usd) ?? Infinity),
        firings: row.firing_count_holdout,
        pValue: num(row.forward_move_difference_bootstrap_p_value),
        upWhenFired: num(row.up_rate_when_fired),
        upBaseline: num(row.up_rate_baseline),
        survives: row.survives_multiple_testing_correction === true,
      };
    })
    .sort((a, b) => b.edge - a.edge)
    .slice(0, controls.topCount);

  const cost = num(rows[0]?.round_trip_cost_usd) ?? 0;
  const scatter = rows
    .filter((row) => num(row.recognition_area_under_curve) !== null && num(row.edge_in_direction_pattern_claimed_usd_per_contract) !== null)
    .map((row) => ({ auc: row.recognition_area_under_curve as number, edge: row.edge_in_direction_pattern_claimed_usd_per_contract as number, side: row.pattern_side, label: `${row.pattern_name} · ${row.pattern_side} · ${row.timeframe} · ${row.forward_candle_count}` }));
  const correlation = pearson(scatter.map((point) => point.auc), scatter.map((point) => point.edge));

  const pValues = rows.map((row) => num(row.forward_move_difference_bootstrap_p_value)).filter((value): value is number => value !== null);
  const by = benjaminiYekutieli(pValues, 0.1);
  const ladder = by.steps.slice(0, 60).map((step) => ({ rank: step.rank, p: Math.max(step.pValue, 1e-5), threshold: step.threshold }));
  const rank = Math.min(Math.max(1, controls.rank), Math.max(1, ladder.length));
  const current = by.steps[rank - 1];

  const nominal = rows.filter((row) => row.covers_round_trip_cost === true && row.interval_excludes_zero === true).length;
  const survivors = rows.filter((row) => row.survives_multiple_testing_correction === true).length;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Tests run" value={fmtInt(rows.length)} hint="pattern × side × timeframe × horizon on the 2025 holdout" />
          <Stat label="Clear the cost, interval excludes 0" value={fmtInt(nominal)} hint="before any correction for testing many things" />
          <Stat label="Expected by chance at 5%" value={fmt(rows.length * 0.05, 1)} hint="false positives a nominal 5% test lets through" />
          <Stat label="Survive BY at 10% and the cost" value={fmtInt(survivors)} tone={survivors > 0 ? OKABE.orange : OKABE.blue} />
        </div>

        <Section title="A. Recognition: can a network read the pattern?" question="Area under the ROC curve per pattern, from the chart-CNN recognition run.">
          <ControlBar>
            <SliderControl label="Minimum prevalence" value={controls.minimumPrevalence} min={0} max={0.3} step={0.005} onChange={(v) => set("minimumPrevalence", v)} format={(v) => `${(v * 100).toFixed(1)}%`} hint="Hide patterns that fire on fewer windows than this" />
          </ControlBar>
          <Finding>
            {recognition.length} patterns shown; median AUC {fmt(recognitionMedian, 3)}
            {recognition.length > 0 && `, lowest ${recognition[recognition.length - 1]?.pattern} at ${fmt(recognition[recognition.length - 1]?.auc, 3)}`}. 0.5 is a coin flip.
          </Finding>
          <ResponsiveContainer width="100%" height={Math.max(220, 17 * recognition.length)}>
            <BarChart data={recognition} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" domain={[0.5, 1]} {...AXIS} />
              <YAxis type="category" dataKey="pattern" width={110} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} />
              <ReferenceLine x={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
              <Bar dataKey="auc" name="AUC" fill={OKABE.sky} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="B. Direction: does the firing pay after cost?" question="Edge in the pattern's claimed direction, USD per contract, with its bootstrap interval; the band is ± one round trip.">
          <ControlBar onReset={reset}>
            <SegmentControl label="Timeframe" value={controls.timeframe} options={TIMEFRAMES.map((v) => ({ value: v, label: v }))} onChange={(v) => set("timeframe", v)} />
            <SegmentControl label="Bars ahead" value={controls.horizon} options={HORIZONS.map((v) => ({ value: v, label: String(v) }))} onChange={(v) => set("horizon", v)} />
            <SelectControl label="Side" value={controls.side} options={[{ value: "both", label: "both" }, { value: "bullish", label: "bullish ▲" }, { value: "bearish", label: "bearish ▼" }]} onChange={(v) => set("side", v)} />
            <SliderControl label="Show top" value={controls.topCount} min={5} max={60} onChange={(v) => set("topCount", v)} />
            <SwitchControl label="Cost band" checked={controls.costBand} onChange={(v) => set("costBand", v)} />
          </ControlBar>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.orange }}>■ clears the cost</span> · <span style={{ color: OKABE.blue }}>■ does not</span> · round trip {fmtUsd(cost)}
          </p>
          <ResponsiveContainer width="100%" height={Math.max(220, 18 * direction.length)}>
            <ComposedChart data={direction} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(v: number) => `$${v}`} />
              <YAxis type="category" dataKey="label" width={190} {...AXIS} interval={0} />
              {controls.costBand && <ReferenceArea x1={-cost} x2={cost} fill={OKABE.grey} fillOpacity={0.22} />}
              <ReferenceLine x={0} stroke={OKABE.grey} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof direction)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{row.label}</div>
                      <div>edge {fmtUsd(row.edge)} · firings {fmtInt(row.firings)}</div>
                      <div>bootstrap p {fmt(row.pValue, 4)}</div>
                      <div>up rate {fmt(row.upWhenFired, 3)} vs {fmt(row.upBaseline, 3)} baseline</div>
                      <div>{row.survives ? "survives BY" : "does not survive BY"}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="edge" isAnimationActive={false}>
                {direction.map((row) => (
                  <Cell key={row.label} fill={row.clears ? OKABE.orange : OKABE.blue} />
                ))}
                <ErrorBar dataKey="whisker" direction="x" width={4} stroke="#d4d4d4" />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </Section>

        <Section title="C. Does reading well mean trading well?" question={`Recognition AUC against direction edge, every test. Pearson r = ${fmt(correlation, 3)}.`}>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="auc" name="AUC" domain={[0.8, 1]} {...AXIS} />
              <YAxis type="number" dataKey="edge" name="edge USD" {...AXIS} />
              <ZAxis range={[28, 28]} />
              <ReferenceLine y={cost} stroke={OKABE.orange} strokeDasharray="4 3" label={{ value: "cost", fill: OKABE.orange, fontSize: 10 }} />
              <ReferenceLine y={0} stroke={OKABE.grey} />
              <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} />
              <Scatter name="bullish ▲" data={scatter.filter((p) => p.side === "bullish")} fill={OKABE.orange} shape="triangle" isAnimationActive={false} />
              <Scatter name="bearish ▼" data={scatter.filter((p) => p.side === "bearish")} fill={OKABE.blue} shape="diamond" isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.orange }}>▲ bullish</span> · <span style={{ color: OKABE.blue }}>◆ bearish</span></p>
        </Section>

        <Section title="D. Testing 883 things at once: the Benjamini-Yekutieli ladder" question="Step the rank and watch each sorted p-value meet its threshold.">
          <ControlBar>
            <SliderControl label="Rank i" value={rank} min={1} max={Math.max(1, ladder.length)} onChange={(v) => set("rank", v)} />
          </ControlBar>
          <FormulaCard
            tex={"p_{(i)} \\le \\frac{q\\, i}{m\\, c(m)}, \\qquad c(m)=\\sum_{k=1}^{m}\\frac{1}{k}"}
            caption={current ? `Rank ${rank}: ${fmt(current.pValue, 5)} ${current.passes ? "≤" : ">"} ${fmt(current.threshold, 6)}, so this test ${current.passes ? "passes" : "fails"}. Tests passing: ${by.cutoffRank}.` : undefined}
            symbols={[
              { tex: "p_{(i)}", name: "the i-th smallest bootstrap p-value", value: fmt(current?.pValue, 5) },
              { tex: "i", name: "rank being tested", value: String(rank) },
              { tex: "m", name: "number of tests", value: fmtInt(by.testCount) },
              { tex: "q", name: "false-discovery rate allowed", value: fmt(by.falseDiscoveryRate, 2) },
              { tex: "c(m)", name: "harmonic number: the price of arbitrary dependence between tests", value: fmt(by.harmonic, 4) },
              { tex: "\\frac{q\\,i}{m\\,c(m)}", name: "threshold at this rank", value: fmt(current?.threshold, 6) },
            ]}
          />
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={ladder} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="rank" {...AXIS} />
              <YAxis scale="log" domain={[1e-5, 0.1]} allowDataOverflow {...AXIS} tickFormatter={(v: number) => v.toExponential(0)} />
              <Tooltip {...TOOLTIP} formatter={(value) => Number(value).toExponential(3)} />
              <ReferenceLine x={rank} stroke={OKABE.purple} />
              <Line dataKey="p" name="sorted p-value" stroke={OKABE.orange} dot={{ r: 2 }} isAnimationActive={false} />
              <Line dataKey="threshold" name="BY threshold" stroke={OKABE.blue} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <Finding>
            The stored verdict column (survives_multiple_testing_correction) counts {survivors} survivors; this ladder recomputed in the browser passes {by.cutoffRank} on p-value alone,
            before the cost condition.
          </Finding>
        </Section>

        <Section title="E. Every column of the scorecard">
          <ColumnGrid rows={rows} />
        </Section>
      </StudyState>
    </div>
  );
}
