/**
 * Section 4 (the directional binary every score is measured against) and
 * section 5 (does any indicator know the direction?).
 */

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import { PREDICTABILITY_VERDICTS, type PredictabilityBody, type PredictabilityVerdict } from "@shared/studies/indicator-study";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { CommitSlider, DataTable, DotWhisker, LegendRow, MultiPicker, csv, type GlyphShape, type WhiskerRow } from "./widgets";

const OUTCOMES = [
  ["up_bar_count", "higher (1)", OKABE.orange],
  ["down_bar_count", "lower (0)", OKABE.blue],
  ["tie_excluded_count", "tie, excluded", OKABE.grey],
  ["roll_excluded_count", "crosses roll, excluded", OKABE.purple],
  ["warmup_or_end_excluded_count", "warmup or end, excluded", "#dddddd"],
] as const;

export function DirectionTab({ controls, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const runs = overview?.runInformation ?? [];
  const data = runs.map((row) => {
    const total = OUTCOMES.reduce((sum, [key]) => sum + row[key], 0) || 1;
    return {
      label: `${row.timeframe} · h = ${row.horizon_bars}`,
      ...Object.fromEntries(OUTCOMES.map(([key, label]) => [label, (row[key] / total) * 100])),
      counts: Object.fromEntries(OUTCOMES.map(([key, label]) => [label, row[key]])),
    };
  });
  const current = runs.find((row) => row.timeframe === timeframe && row.horizon_bars === controls.horizon);
  return (
    <Section title="4 · The directional binary" question="Every score in sections 5 to 7 is measured against this label. A tie is dropped rather than called 'down', and a window that crosses the contract roll is dropped, because part of that move is the switch from MNQZ5 to MNQH6, not a price change.">
      <div className="space-y-3">
        <FormulaCard
          tex={"r_{t,h} = \\ln C_{t+h} - \\ln C_t, \\qquad y_{t,h} = \\begin{cases} 1 & r_{t,h} > 0 \\\\ 0 & r_{t,h} < 0 \\\\ \\text{excluded} & r_{t,h} = 0 \\end{cases}"}
          symbols={[
            { tex: "C_t", name: "close of bar t, index points, unadjusted front month", value: timeframe },
            { tex: "h", name: "horizon: bars ahead (the dropdown at the top)", value: `${controls.horizon} bar(s)` },
            { tex: "r_{t,h}", name: "forward log return, dimensionless (about percent move ÷ 100)", value: "per bar" },
            { tex: "y_{t,h}", name: "direction binary: 1 = higher close h bars later, 0 = lower", value: current ? `1 on ${fmtInt(current.up_bar_count)}, 0 on ${fmtInt(current.down_bar_count)}` : "—" },
            { tex: "n", name: "usable bars (warmup, ties, roll and end removed)", value: current ? fmtInt(current.usable_bar_count) : "—" },
          ]}
        />
        <LegendRow items={OUTCOMES.map(([, label, color]) => ({ label, color, shape: "square" as const }))} />
        <ResponsiveContainer width="100%" height={Math.max(200, 30 * data.length)}>
          <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
            <YAxis type="category" dataKey="label" width={90} {...AXIS} interval={0} />
            <Tooltip
              {...TOOLTIP}
              formatter={(value, name, item) => {
                const counts = (item.payload as { counts: Record<string, number> }).counts;
                return [`${fmt(Number(value), 2)}% · ${fmtInt(counts[String(name)])} bars`, String(name)];
              }}
            />
            {OUTCOMES.map(([, label, color]) => (
              <Bar key={label} dataKey={label} stackId="share" fill={color} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <DataTable
          rows={runs}
          rowKey={(row) => `${row.timeframe}|${row.horizon_bars}`}
          pageSize={9}
          columns={[
            { key: "timeframe", label: "timeframe", value: (row) => row.timeframe },
            { key: "horizon_bars", label: "horizon_bars", value: (row) => row.horizon_bars, numeric: true },
            { key: "bar_count", label: "bar_count", value: (row) => row.bar_count, numeric: true },
            { key: "usable_bar_count", label: "usable_bar_count", value: (row) => row.usable_bar_count, numeric: true },
            { key: "up_bar_count", label: "up_bar_count", value: (row) => row.up_bar_count, numeric: true },
            { key: "down_bar_count", label: "down_bar_count", value: (row) => row.down_bar_count, numeric: true },
            { key: "tie_excluded_count", label: "tie_excluded_count", value: (row) => row.tie_excluded_count, numeric: true },
            { key: "roll_excluded_count", label: "roll_excluded_count", value: (row) => row.roll_excluded_count, numeric: true },
            { key: "warmup_or_end_excluded_count", label: "warmup_or_end_excluded_count", value: (row) => row.warmup_or_end_excluded_count, numeric: true },
            { key: "mean_block_length_bars", label: "mean_block_length_bars", value: (row) => row.mean_block_length_bars, numeric: true, format: (value) => fmt(value as number, 2) },
          ]}
        />
      </div>
    </Section>
  );
}

const VERDICT_STYLE: Record<PredictabilityVerdict, { color: string; shape: GlyphShape }> = {
  "clears the family-wise threshold": { color: OKABE.orange, shape: "diamond" },
  "q < 0.10 only (false-discovery screen)": { color: OKABE.blue, shape: "square" },
  "indistinguishable from the null": { color: OKABE.grey, shape: "circle" },
};

const SCORE_NAME: Record<string, string> = { information_coefficient: "Spearman information coefficient", area_under_curve: "AUC − 0.5" };

function isPredictability(data: unknown): data is PredictabilityBody {
  return typeof data === "object" && data !== null && "comparison" in data;
}

export function PredictabilityTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const query = useStudyQuery<unknown>("indicator-study", { part: "predictability", timeframe, horizon: controls.horizon, variant: controls.predictabilityVariant, statistic: controls.statistic });
  const body = isPredictability(query.data?.data) ? query.data.data : null;
  const allGroups = [...new Set((overview?.catalogue ?? []).map((row) => row.talib_group))].sort();
  const hidden = new Set(csv(controls.predictabilityHiddenGroups));
  const groups = allGroups.filter((group) => !hidden.has(group));
  const rows = body?.rows ?? [];
  const shown = rows
    .filter((row) => groups.includes(row.talib_group) && row.score !== null)
    .sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))
    .slice(0, controls.top);
  const verdictCounts = Object.fromEntries(PREDICTABILITY_VERDICTS.map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length]));
  const scoreName = SCORE_NAME[controls.statistic] ?? controls.statistic;
  const whiskers: WhiskerRow[] = shown.map((row) => ({
    key: row.column_name,
    label: row.column_name,
    value: row.score,
    low: row.lower_95,
    high: row.upper_95,
    ...VERDICT_STYLE[row.verdict],
    ticks: row.familywise_threshold !== null ? [{ value: row.familywise_threshold, color: OKABE.grey }, { value: -row.familywise_threshold, color: OKABE.grey }] : [],
    details: [
      `${row.talib_group} · ${row.feature_kind}`,
      `score ${fmt(row.score, 4)} [${fmt(row.lower_95, 4)}, ${fmt(row.upper_95, 4)}]`,
      `± family-wise threshold ${fmt(row.familywise_threshold, 4)}`,
      `permutation p ${fmt(row.permutation_p_value, 4)} · BH q ${fmt(row.benjamini_hochberg_q_value, 4)}`,
      `usable bars ${fmtInt(row.usable_bar_count)}`,
      row.verdict,
    ],
  }));
  const explainOptions = [...rows].sort((a, b) => a.column_name.localeCompare(b.column_name)).map((row) => ({ value: row.column_name, label: row.column_name }));
  const explain = rows.find((row) => row.column_name === controls.explain) ?? rows.find((row) => row.column_name === "rsi_14") ?? rows[0];
  const run = body?.run;
  const comparisonSeries = (["transformed before scoring", "scored as-is (raw = transformed)"] as const).map((treatment) => ({
    treatment,
    points: (body?.comparison ?? []).filter((row) => row.treatment === treatment),
  }));
  const extent = Math.max(0.01, ...(body?.comparison ?? []).flatMap((row) => [Math.abs(row.raw), Math.abs(row.transformed)]));

  return (
    <div className="space-y-3">
      <Section
        title="5 · Predictability: does any indicator know the direction?"
        question="Two scores per indicator, both signed so an inverse predictor shows as one. The interval is a stationary block bootstrap; the null is every circular shift of the direction series against the unchanged indicator matrix; the family-wise threshold is the 95th percentile of the largest studentized score among all indicators under that null."
      >
        <div className="space-y-2">
          <ControlBar>
            <SegmentControl label="Values" value={controls.predictabilityVariant} options={[{ value: "transformed", label: "transformed" }, { value: "raw", label: "raw" }]} onChange={(value) => set("predictabilityVariant", value)} />
            <SegmentControl label="Score" value={controls.statistic} options={[{ value: "information_coefficient", label: "information coefficient (Spearman)" }, { value: "area_under_curve", label: "AUC − 0.5" }]} onChange={(value) => set("statistic", value)} />
            <CommitSlider label="Indicators shown (strongest first)" value={controls.top} min={10} max={180} step={5} onCommit={(value) => set("top", value)} />
            <MultiPicker label="TA-Lib groups" options={allGroups.map((group) => ({ value: group, label: group }))} selected={groups} onChange={(next) => set("predictabilityHiddenGroups", allGroups.filter((group) => !next.includes(group)).join(","))} />
          </ControlBar>
          <StudyState isLoading={query.isLoading} error={query.error}>
            <StudyNotes notes={query.data?.notes ?? []} />
            <Finding>
              {timeframe}, h = {controls.horizon}, {controls.predictabilityVariant} values, {scoreName}: of {fmtInt(rows.length)} indicators scored,{" "}
              <strong style={{ color: OKABE.orange }}>{fmtInt(verdictCounts["clears the family-wise threshold"])}</strong> clear the family-wise threshold,{" "}
              <strong style={{ color: OKABE.blue }}>{fmtInt(verdictCounts["q < 0.10 only (false-discovery screen)"])}</strong> pass only the false-discovery screen, and{" "}
              {fmtInt(verdictCounts["indistinguishable from the null"])} are indistinguishable from the null. Columns that are one series under two names (max_30 and minmax_max_30,
              sum_30 and sma_30, the four ROC variants) are scored once.
            </Finding>
            <LegendRow items={[...PREDICTABILITY_VERDICTS.map((verdict) => ({ label: verdict, ...VERDICT_STYLE[verdict] })), { label: "grey ticks: ± family-wise threshold", color: OKABE.grey }]} />
            {whiskers.length > 0 ? (
              <DotWhisker rows={whiskers} axisLabel={`${scoreName}: point = score, line = 95% block-bootstrap interval`} references={[{ value: 0, color: "#bdbdbd" }]} format={(value) => fmt(value, 3)} />
            ) : (
              <Empty>No indicator in the chosen groups.</Empty>
            )}
            <DataTable
              rows={body?.thresholds ?? []}
              rowKey={(row) => `${row.variant}|${row.statistic}`}
              pageSize={4}
              columns={[
                { key: "variant", label: "variant", value: (row) => row.variant },
                { key: "statistic", label: "statistic", value: (row) => row.statistic },
                { key: "studentized_threshold_95", label: "studentized_threshold_95", value: (row) => row.studentized_threshold_95, numeric: true, format: (value) => fmt(value as number, 4) },
                { key: "tested_indicator_count", label: "tested_indicator_count", value: (row) => row.tested_indicator_count, numeric: true },
                { key: "familywise_significant_count", label: "familywise_significant_count", value: (row) => row.familywise_significant_count, numeric: true },
                { key: "benjamini_hochberg_q_below_0p10_count", label: "benjamini_hochberg_q_below_0p10_count", value: (row) => row.benjamini_hochberg_q_below_0p10_count, numeric: true },
                { key: "expected_false_discoveries_at_5_percent", label: "expected_false_discoveries_at_5_percent", value: (row) => row.expected_false_discoveries_at_5_percent, numeric: true, format: (value) => fmt(value as number, 2) },
              ]}
            />
          </StudyState>
        </div>
      </Section>

      <Section title="The formula, read with one indicator's numbers" question="Pick an indicator: every symbol takes its value.">
        <ControlBar>
          <SelectControl label="Read the formula with the numbers of" value={explain?.column_name ?? ""} options={explainOptions} onChange={(value) => set("explain", value)} />
        </ControlBar>
        {explain && run ? (
          <FormulaCard
            tex={"\\mathrm{IC} = \\operatorname{corr}\\big(\\operatorname{rank}(x_t),\\ \\operatorname{rank}(r_{t,h})\\big) \\qquad \\mathrm{AUC} - \\tfrac12 = \\frac{1}{n_1}\\sum_{t:\\,y_t=1} u_t \\;-\\; \\frac{1}{n_0}\\sum_{t:\\,y_t=0} u_t, \\quad u_t = \\frac{\\operatorname{rank}(x_t)}{n}"}
            caption={`Verdict for ${explain.column_name}: ${explain.verdict}.`}
            symbols={[
              { tex: "x_t", name: `the indicator at bar t (${explain.feature_kind})`, value: explain.column_name },
              { tex: "r_{t,h}", name: `forward log return over the next ${controls.horizon} ${timeframe} bars`, value: "per bar" },
              { tex: "y_t", name: "direction binary", value: `1 on ${fmtInt(explain.up_bar_count)}, 0 on ${fmtInt(explain.down_bar_count)}` },
              { tex: "n", name: "usable bars (warmup, ties, roll and end removed)", value: fmtInt(explain.usable_bar_count) },
              { tex: "n_1,\\ n_0", name: "bars labelled up, down", value: `${fmtInt(explain.up_bar_count)}, ${fmtInt(explain.down_bar_count)}` },
              { tex: "u_t", name: "rank of x_t divided by n: a placement between 0 and 1", value: "0 … 1" },
              { tex: "\\text{score}", name: scoreName, value: fmt(explain.score, 4) },
              { tex: "[\\,\\cdot\\,]_{95}", name: `95% ${run.bootstrap_interval_method}, mean block ${fmt(run.mean_block_length_bars, 1)} bars, ${fmtInt(run.bootstrap_draws)} draws`, value: `[${fmt(explain.lower_95, 4)}, ${fmt(explain.upper_95, 4)}]` },
              { tex: "p", name: `permutation p-value over ${run.permutation_shift_rule} of y (${fmtInt(run.permutation_shift_count)})`, value: fmt(explain.permutation_p_value, 4) },
              { tex: "q", name: "Benjamini-Hochberg q-value across this family", value: fmt(explain.benjamini_hochberg_q_value, 4) },
              { tex: "\\pm\\tau", name: "family-wise 5% threshold for this indicator", value: `±${fmt(explain.familywise_threshold, 4)}` },
            ]}
          />
        ) : (
          <Empty>No indicator scored here.</Empty>
        )}
      </Section>

      <Section title="Raw against transformed score" question="Points far from the diagonal are level effects: the raw score was carried by where price was, not by the indicator.">
        <LegendRow items={[{ label: "transformed before scoring", color: OKABE.orange, shape: "triangle-up" }, { label: "scored as-is (raw = transformed)", color: OKABE.grey, shape: "circle" }, { label: "diagonal: raw = transformed", color: OKABE.blue, dash: true }]} />
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 24 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="raw" name="score on raw values" domain={[-extent, extent]} {...AXIS} tickFormatter={(value: number) => fmt(value, 2)} label={{ value: "score on raw values", position: "insideBottom", offset: -12, fill: "#bdbdbd", fontSize: 10 }} />
            <YAxis type="number" dataKey="transformed" name="score on transformed values" domain={[-extent, extent]} {...AXIS} tickFormatter={(value: number) => fmt(value, 2)} />
            <ZAxis range={[36, 36]} />
            <ReferenceLine segment={[{ x: -extent, y: -extent }, { x: extent, y: extent }]} stroke={OKABE.blue} strokeDasharray="4 4" />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as { column_name: string; feature_kind: string; raw: number; transformed: number } | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.column_name}</div>
                    <div>{row.feature_kind}</div>
                    <div>raw {fmt(row.raw, 4)} · transformed {fmt(row.transformed, 4)}</div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ display: "none" }} />
            {comparisonSeries.map((series) => (
              <Scatter
                key={series.treatment}
                name={series.treatment}
                data={series.points}
                fill={series.treatment === "transformed before scoring" ? OKABE.orange : OKABE.grey}
                shape={series.treatment === "transformed before scoring" ? "triangle" : "circle"}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </Section>
    </div>
  );
}
