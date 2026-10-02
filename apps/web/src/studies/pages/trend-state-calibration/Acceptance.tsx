/**
 * Acceptance: how often the flag enters against its null, whether its side agrees
 * with the forward trend label (with the null band and the break-even line the
 * gates use), the episode economics with every distribution's eight numbers, and
 * the selection-honesty statistics.
 */

import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, GRID, Histogram, OKABE, Section, SliderControl, TOOLTIP, fmt, histogram,
} from "@/studies/kit";
import type { DistributionRow, EpisodeRow, MetricRow, OverfittingRow } from "@shared/studies/trend-state-calibration";
import { DataTable, SESSION_LABEL, cell, rungStyle, useWidth } from "./common";

const SOURCE_COLOR = { real: OKABE.blue, null: OKABE.orange, target: "#e5e5e5" } as const;

/** What each gate requires, from trend/calibration.py (evaluate / calibrate). */
const GATE_RULES: Array<[string, string]> = [
  ["no_lookahead", "validate.assert_no_lookahead passes on every block column (no value at a bar depends on later bars)"],
  ["purge_covers_lookback", "the purge covers the block's lookback plus the label horizon (validate.assert_purge_covers_lookback)"],
  ["null_entry_rate_within_factor_two_of_target", "each session type's null entry rate within a factor of two of its target"],
  ["enough_episodes", "at least the minimum number of real episodes"],
  ["agreement_above_null", "the agreement interval's low end above both 0.5 and the null's 95th percentile"],
  ["net_points_positive", "the net-points-per-episode interval's low end above zero"],
  ["agreement_above_break_even", "the agreement interval's low end above the largest break-even hit rate"],
  ["stable_across_sessions", "every session type with enough episodes has the same sign of excess agreement"],
  ["stable_across_months", "at least 70% of months with five or more episodes carry the overall sign"],
  ["null_tail_supported", "every session type's chosen p entry has at least 100 expected null exceedances"],
  ["overfitting_controlled", "probability of backtest overfitting below 0.5 and deflated Sharpe probability at least 0.95"],
];

const AGREEMENT_METRICS = ["agreement_at_entry", "agreement_at_entry_block_x2", "agreement_at_entry_block_x4", "agreement_at_entry_block_x8", "agreement_by_session", "agreement_by_month"];

function EntriesPerSession({ metrics }: { metrics: MetricRow[] }) {
  const rows = metrics.filter((row) => row.metric === "entries_per_session");
  return (
    <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
      {rows.map((row) => {
        const data = [
          { source: "real", value: row.value, error: [0, 0] as [number, number], color: SOURCE_COLOR.real, glyph: "●" },
          {
            source: "null (shuffled returns)", value: row.null_mean,
            error: [Math.max(0, (row.null_mean ?? 0) - (row.null_low ?? row.null_mean ?? 0)), Math.max(0, (row.null_high ?? row.null_mean ?? 0) - (row.null_mean ?? 0))] as [number, number],
            color: SOURCE_COLOR.null, glyph: "▲",
          },
          { source: "target", value: row.target, error: [0, 0] as [number, number], color: SOURCE_COLOR.target, glyph: "■" },
        ];
        return (
          <div key={row.stratum} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="text-[11px] font-medium text-neutral-200">{SESSION_LABEL[row.stratum] ?? row.stratum}</div>
            <div className="text-[10px] text-neutral-500">real ÷ null {fmt(row.real_over_null, 2)} · {cell(row.observation_count)} sessions</div>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="source" {...AXIS} tickFormatter={(value: string) => value.split(" ")[0] ?? value} />
                <YAxis {...AXIS} width={34} />
                <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 3), "entries per session"]} />
                <Bar dataKey="value" isAnimationActive={false}>
                  {data.map((entry) => (
                    <Cell key={entry.source} fill={entry.color} />
                  ))}
                  <ErrorBar dataKey="error" width={6} stroke="#d4d4d4" />
                  <LabelList dataKey="value" position="top" fontSize={9} fill="#d4d4d4" formatter={(value: number) => fmt(value, 3)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

function ForestPlot({ rows, nullBand, breakEven }: { rows: MetricRow[]; nullBand: { low: number; high: number } | null; breakEven: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelWidth = Math.min(210, Math.max(120, width * 0.34));
  const plotLeft = labelWidth + 8;
  const plotWidth = Math.max(80, width - plotLeft - 12);
  const rowHeight = 20;
  const top = 8;
  const height = top + rows.length * rowHeight + 28;
  const x = (value: number) => plotLeft + value * plotWidth;
  return (
    <div ref={ref} className="min-w-0">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="agreement intervals">
          {nullBand && <rect x={x(nullBand.low)} y={top} width={Math.max(1, x(nullBand.high) - x(nullBand.low))} height={rows.length * rowHeight} fill={OKABE.orange} opacity={0.22} />}
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + rows.length * rowHeight} stroke="#404040" strokeDasharray={tick === 0.5 ? "4 3" : "1 3"} strokeWidth={tick === 0.5 ? 1.4 : 1} />
              <text x={x(tick)} y={top + rows.length * rowHeight + 12} textAnchor="middle" fontSize={10} fill="#a3a3a3">{tick}</text>
            </g>
          ))}
          {breakEven !== null && (
            <g>
              <line x1={x(breakEven)} x2={x(breakEven)} y1={top} y2={top + rows.length * rowHeight} stroke={OKABE.purple} strokeDasharray="2 2" />
              <text x={x(breakEven) + 3} y={top + 8} fontSize={9} fill={OKABE.purple}>break-even {fmt(breakEven, 3)}</text>
            </g>
          )}
          {rows.map((row, index) => {
            const y = top + index * rowHeight + rowHeight / 2;
            const label = `${row.metric.replace("agreement_", "")} · ${row.stratum}`;
            const hasInterval = row.low !== null && row.high !== null && Number.isFinite(row.low) && Number.isFinite(row.high);
            return (
              <g key={`${row.metric}-${row.stratum}`}>
                <title>{`${label}: ${fmt(row.value, 3)} [${fmt(row.low, 3)}, ${fmt(row.high, 3)}], ${cell(row.observation_count)} episodes`}</title>
                <rect x={0} y={y - rowHeight / 2} width={width} height={rowHeight} fill="transparent" />
                <text x={labelWidth} y={y + 3} textAnchor="end" fontSize={10} fill="#d4d4d4">{label}</text>
                {hasInterval && <line x1={x(row.low as number)} x2={x(row.high as number)} y1={y} y2={y} stroke={OKABE.blue} strokeWidth={2} />}
                {row.value !== null && <circle cx={x(row.value)} cy={y} r={3.5} fill={hasInterval ? OKABE.blue : "none"} stroke={OKABE.blue} strokeWidth={1.5} />}
                <text x={width - 2} y={y + 3} textAnchor="end" fontSize={9} fill="#737373">n {cell(row.observation_count)}</text>
              </g>
            );
          })}
          <text x={plotLeft + plotWidth / 2} y={height - 2} textAnchor="middle" fontSize={10} fill="#737373">agreement of the flag's side with the forward trend label</text>
        </svg>
      )}
      <p className="text-[10px] text-neutral-500">
        ● filled = with a 95% stationary-bootstrap interval (episode level) · ○ hollow = too few episodes for an interval · <span style={{ color: OKABE.orange }}>▭ orange band</span> = the null's 2.5–97.5%
        range (flag and label independent by construction) · dashed = 0.5 · <span style={{ color: OKABE.purple }}>dotted = largest break-even hit rate</span>
      </p>
    </div>
  );
}

export function Acceptance({
  metrics, episodes, distributions, overfitting, rungs, settings, bins, setBins,
}: {
  metrics: MetricRow[];
  episodes: EpisodeRow[];
  distributions: DistributionRow[];
  overfitting: OverfittingRow[];
  rungs: string[];
  settings: Record<string, string | number | boolean | null>;
  bins: number;
  setBins: (value: number) => void;
}) {
  const entries = metrics.filter((row) => row.metric === "entries_per_session");
  const agreement = AGREEMENT_METRICS.flatMap((metric) => metrics.filter((row) => row.metric === metric));
  const nullRow = metrics.find((row) => row.metric === "agreement_at_entry_null");
  const nullBand = nullRow && nullRow.low !== null && nullRow.high !== null ? { low: nullRow.low, high: nullRow.high } : null;
  const breakEvenRows = metrics.filter((row) => row.metric === "break_even_hit_rate");
  const breakEven = breakEvenRows.length ? Math.max(...breakEvenRows.map((row) => row.value ?? 0)) : null;
  const overall = metrics.find((row) => row.metric === "agreement_at_entry");
  const net = metrics.filter((row) => ["net_points_per_episode", "net_points_by_session", "net_points_by_month"].includes(row.metric));
  const netOverall = metrics.find((row) => row.metric === "net_points_per_episode");
  const cost = typeof settings.round_trip_cost_points === "number" ? settings.round_trip_cost_points : null;
  const gates = GATE_RULES.map(([name, rule]) => ({ name, rule, passed: settings[`check_${name}`] }));

  return (
    <div className="space-y-3">
      <Section title="How often the flag enters: real bars against the null it was calibrated on" question="● real (blue), ▲ null mean with its 2.5–97.5% range (orange), ■ target (light).">
        <EntriesPerSession metrics={metrics} />
        <div className="mt-2">
          <DataTable
            rows={entries as unknown as Array<Record<string, unknown>>}
            columns={[
              { key: "stratum", label: "session type", align: "left" },
              { key: "value", label: "real" }, { key: "null_mean", label: "null mean" }, { key: "null_low", label: "null low" }, { key: "null_high", label: "null high" },
              { key: "target", label: "target" }, { key: "real_over_null", label: "real ÷ null" }, { key: "observation_count", label: "sessions" },
            ]}
          />
        </div>
      </Section>

      <Section title="Does the flag's side agree with where price then went?" question="Agreement at entry (and with block bootstraps ×2, ×4, ×8), by session type and by month.">
        <ForestPlot rows={agreement} nullBand={nullBand} breakEven={breakEven} />
        {overall && (
          <Finding>
            Overall agreement {fmt(overall.value, 3)} [{fmt(overall.low, 3)}, {fmt(overall.high, 3)}] over {cell(overall.observation_count)} episodes; the null's range is
            {" "}{nullBand ? `${fmt(nullBand.low, 3)} to ${fmt(nullBand.high, 3)}` : "not recorded"} and the largest break-even hit rate {fmt(breakEven, 3)}. The interval's low end
            {" "}{(overall.low ?? 0) > Math.max(0.5, nullBand?.high ?? 0.5) ? "clears" : "does not clear"} the null and {(overall.low ?? 0) > (breakEven ?? 1) ? "clears" : "does not clear"} break-even.
          </Finding>
        )}
        <h4 className="mt-3 mb-1 text-xs font-semibold text-neutral-200">Break-even hit rate the agreement must clear: 0.5 + cost ÷ (2 · E|move over the rung's span|)</h4>
        <DataTable
          rows={breakEvenRows as unknown as Array<Record<string, unknown>>}
          maxHeight={260}
          columns={[
            { key: "stratum", label: "session type", align: "left" },
            { key: "rung", label: "rung", align: "left", render: (row) => { const style = rungStyle(rungs.indexOf(String(row.rung))); return <span style={{ color: style.color }}>{style.glyph} {String(row.rung)}</span>; } },
            { key: "value", label: "break-even hit rate", render: (row) => cell(row.value, 4) },
            { key: "expected_absolute_move_points", label: "expected absolute move (points)" },
            { key: "observation_count", label: "bars" },
          ]}
        />
      </Section>

      <Section title="The acceptance gates" question="What each gate of trend/calibration.py requires, and whether this run passed it.">
        <DataTable
          rows={gates as unknown as Array<Record<string, unknown>>}
          columns={[
            { key: "passed", label: "", align: "left", render: (row) => (row.passed === true ? <span style={{ color: OKABE.orange }}>✓ pass</span> : row.passed === false ? <span style={{ color: OKABE.blue }}>✗ fail</span> : <span className="text-neutral-500">—</span>) },
            { key: "name", label: "gate", align: "left" },
            { key: "rule", label: "rule", align: "left" },
          ]}
        />
      </Section>

      <Section title="Economics and lengths: every distribution with its eight numbers" question={`Net points per episode after the ${fmt(cost, 3)}-point round trip, and real episode lengths.`}>
        <ControlBar>
          <SliderControl label="Bins" value={bins} min={5} max={100} onChange={setBins} />
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-neutral-200">Net points per flag episode</div>
            <Histogram bins={histogram(episodes.map((episode) => episode.net_points), bins)} unit="points" markers={[{ x: 0, label: "0", color: OKABE.grey }]} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-neutral-200">Real episode lengths (bars)</div>
            <Histogram bins={histogram(episodes.map((episode) => episode.bars), bins)} unit="bars" />
          </div>
        </div>
        {netOverall && (
          <Finding>
            Net {fmt(netOverall.value, 2)} points per episode [{fmt(netOverall.low, 2)}, {fmt(netOverall.high, 2)}]: the interval {(netOverall.low ?? 0) > 0 ? "sits above" : "straddles or sits below"} zero, so the
            net_points_positive gate {(netOverall.low ?? 0) > 0 ? "passes" : "fails"}.
          </Finding>
        )}
        <div className="mt-2">
          <DataTable
            rows={net as unknown as Array<Record<string, unknown>>}
            maxHeight={300}
            columns={[
              { key: "metric", label: "metric", align: "left" }, { key: "stratum", label: "stratum", align: "left" },
              { key: "value", label: "value" }, { key: "low", label: "low" }, { key: "high", label: "high" }, { key: "observation_count", label: "episodes" },
            ]}
          />
        </div>
        <h4 className="mt-3 mb-1 text-xs font-semibold text-neutral-200">Distributions (real and null)</h4>
        <DataTable
          rows={distributions as unknown as Array<Record<string, unknown>>}
          columns={[
            { key: "name", label: "quantity", align: "left" }, { key: "group", label: "group", align: "left" }, { key: "observation_count", label: "count" },
            { key: "mean", label: "mean" }, { key: "median", label: "median" }, { key: "standard_deviation", label: "standard deviation" },
            { key: "skewness", label: "skewness" }, { key: "kurtosis", label: "kurtosis" }, { key: "percentile_25", label: "25th percentile" },
            { key: "percentile_75", label: "75th percentile" }, { key: "minimum", label: "minimum" }, { key: "maximum", label: "maximum" },
          ]}
        />
      </Section>

      <Section title="Selection honesty over the (p entry, p exit) grid" question="Probability of backtest overfitting (combinatorially symmetric cross-validation) and the deflated Sharpe of the chosen point.">
        {overfitting.length ? (
          <DataTable
            rows={overfitting as Array<Record<string, unknown>>}
            columns={Object.keys(overfitting[0] ?? {}).map((key) => ({ key, label: key.replace(/_/g, " ").replace(/^n /, "number of "), align: typeof overfitting[0]?.[key] === "string" ? "left" as const : "right" as const }))}
          />
        ) : (
          <p className="text-[11px] text-neutral-500">The overfitting stage was not run for this recipe.</p>
        )}
      </Section>
    </div>
  );
}
