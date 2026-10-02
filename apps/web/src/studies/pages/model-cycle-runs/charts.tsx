/**
 * The page's charts (Recharts, animation off). Colours are Okabe-Ito and every
 * series also carries a shape, a pattern or a label: orange is up / positive /
 * long, blue down / negative / short, never red against green.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { AXIS, Empty, GRID, OKABE, TOOLTIP, eightNumberSummary, fmt, fmtInt, fmtUsd } from "@/studies/kit";
import {
  cividis, scopeLabel,
  type CalibrationBin, type ColumnProfile, type ConfusionCell, type DailyRow, type DistributionRow, type DrawdownRow,
  type EquityPoint, type ForecastPoint, type GroupedBin, type HistogramBin, type Row, type RunRecord,
} from "@shared/studies/model-cycle-runs";
import { PALETTE, SHAPES, SHAPE_GLYPH, shortRecipe, stamp, type ScatterShape } from "./common";

const AXIS_LABEL = { fill: "hsl(var(--muted-foreground))", fontSize: 10 } as const;

// ─── histograms ─────────────────────────────────────────────────────────────

/** Bars for server-binned counts. `signSplit` colours bars left of zero blue and right of zero orange. */
export function HistogramBars({ bins, label, color = OKABE.sky, signSplit = false, height = 180 }: {
  bins: readonly HistogramBin[]; label: string; color?: string; signSplit?: boolean; height?: number;
}) {
  if (bins.length === 0) return <Empty>No values.</Empty>;
  const data = bins.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, count: bin.count, lower: bin.lower, upper: bin.upper }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 2)} {...AXIS} />
        <YAxis {...AXIS} width={40} />
        <Tooltip
          {...TOOLTIP}
          formatter={(value) => [fmtInt(Number(value)), "bars"]}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
            return row ? `${label}: ${fmt(row.lower, 4)} to ${fmt(row.upper, 4)}` : "";
          }}
        />
        <Bar dataKey="count" isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.middle} fill={signSplit ? (row.middle < 0 ? OKABE.blue : OKABE.orange) : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── the run list ───────────────────────────────────────────────────────────

export function RunScatter({ runs }: { runs: readonly RunRecord[] }) {
  const points = runs.filter((run) => run.net_profit_usd !== null && run.sharpe_ratio !== null);
  if (points.length === 0) return <Empty>The run scatter needs runs with a net profit and a Sharpe ratio.</Empty>;
  const labels = [...new Set(points.map((run) => run.model_label ?? "unlabelled"))];
  const statuses = [...new Set(points.map((run) => run.status ?? "unknown"))];
  const series = labels
    .flatMap((label, labelIndex) =>
      statuses.map((status, statusIndex) => ({
        key: `${label} · ${status}`,
        color: PALETTE[labelIndex % PALETTE.length] as string,
        shape: SHAPES[statusIndex % SHAPES.length] as ScatterShape,
        data: points
          .filter((run) => (run.model_label ?? "unlabelled") === label && (run.status ?? "unknown") === status)
          .map((run) => ({ x: run.sharpe_ratio as number, y: run.net_profit_usd as number, recipe: run.recipe, trades: run.trade_count, accuracy: run.accuracy })),
      })),
    )
    .filter((entry) => entry.data.length > 0);
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" name="Sharpe ratio" {...AXIS} label={{ value: "Sharpe ratio (per bar, annualised)", position: "insideBottom", offset: -10, ...AXIS_LABEL }} />
          <YAxis type="number" dataKey="y" name="Net profit, USD" {...AXIS} width={56} tickFormatter={(value: number) => `$${fmt(value, 0)}`} />
          <ZAxis range={[90, 90]} />
          <ReferenceLine y={0} stroke={OKABE.grey} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as { x: number; y: number; recipe: string; trades: number | null; accuracy: number | null } | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-mono">{shortRecipe(point.recipe)}</div>
                  <div>Sharpe {fmt(point.x, 3)} · net {fmtUsd(point.y)}</div>
                  <div>{fmtInt(point.trades)} trades · accuracy {fmt(point.accuracy, 4)}</div>
                </div>
              );
            }}
          />
          {series.map((entry) => (
            <Scatter key={entry.key} name={entry.key} data={entry.data} fill={entry.color} shape={entry.shape} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
        {series.map((entry) => (
          <span key={entry.key}>
            <span style={{ color: entry.color }}>{SHAPE_GLYPH[entry.shape]}</span> {entry.key}
          </span>
        ))}
      </p>
    </div>
  );
}

// ─── predictions ────────────────────────────────────────────────────────────

export function EquityChart({ equity }: { equity: readonly EquityPoint[] }) {
  if (equity.length === 0) return <Empty>No equity curve.</Empty>;
  const data = equity.map((point) => ({ time: point.timestamp * 1000, equity: point.equity, position: point.position, fold: point.fold }));
  const starts: Array<{ time: number; fold: number }> = [];
  for (const point of data) {
    if (point.fold !== null && !starts.some((start) => start.fold === point.fold)) starts.push({ time: point.time, fold: point.fold });
  }
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={{ top: 14, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => stamp(value / 1000).slice(5, 10)} {...AXIS} />
        <YAxis {...AXIS} width={56} tickFormatter={(value: number) => `$${fmt(value, 0)}`} />
        <ReferenceLine y={0} stroke={OKABE.grey} />
        {starts.map((start) => (
          <ReferenceLine key={start.fold} x={start.time} stroke={OKABE.sky} strokeDasharray="4 3" label={{ value: `fold ${start.fold + 1}`, fill: OKABE.sky, fontSize: 9, position: "top" }} />
        ))}
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(value) => stamp(Number(value) / 1000)}
          formatter={(value, name) => [name === "equity" ? fmtUsd(Number(value)) : fmt(Number(value), 0), name === "equity" ? "equity" : "position held"]}
        />
        <Line dataKey="equity" stroke={OKABE.orange} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ForecastScatter({ points }: { points: readonly ForecastPoint[] }) {
  if (points.length === 0) return <Empty>No forecast resolved.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="move" name="Predicted move" {...AXIS} label={{ value: "Predicted move, points (on the tick grid)", position: "insideBottom", offset: -10, ...AXIS_LABEL }} />
        <YAxis type="number" dataKey="error" name="Error" {...AXIS} width={44} />
        <ZAxis range={[22, 22]} />
        <ReferenceLine y={0} stroke={OKABE.grey} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const point = payload?.[0]?.payload as ForecastPoint | undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                <div>predicted move {fmt(point.move, 2)} · error {fmt(point.error, 2)}</div>
                <div>forecast close {fmt(point.forecast, 2)} · close {fmt(point.close, 2)}</div>
              </div>
            );
          }}
        />
        <Scatter data={points as ForecastPoint[]} fill={OKABE.green} fillOpacity={0.45} shape="circle" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const PROFILE_KEYS: Array<[keyof ColumnProfile["summary"], string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"], ["kurtosis", "kurt"],
  ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

/** Every numeric column of a server-profiled frame: its histogram with its eight numbers beneath. */
export function ProfileGrid({ profiles }: { profiles: readonly ColumnProfile[] }) {
  if (profiles.length === 0) return <Empty>No numeric column to profile.</Empty>;
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
      {profiles.map((profile) => {
        const data = profile.bins.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, count: bin.count, lower: bin.lower, upper: bin.upper }));
        return (
          <div key={profile.column} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={profile.column}>{profile.column}</div>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
                <XAxis dataKey="middle" hide />
                <YAxis hide />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "bars"]}
                  labelFormatter={(_label, payload) => {
                    const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                    return bin ? `${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
                  }}
                />
                <Bar dataKey="count" fill={OKABE.sky} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
              <dt className="col-span-3 text-neutral-500">n {fmtInt(profile.summary.count)}</dt>
              {PROFILE_KEYS.map(([key, label]) => (
                <div key={key} className="flex justify-between gap-1">
                  <span className="text-neutral-500">{label}</span>
                  <span className="text-neutral-200">{fmt(profile.summary[key] as number | null, 3)}</span>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

// ─── trades ─────────────────────────────────────────────────────────────────

/** Closed trades by net profit, stacked by side: long is solid orange, short is blue with diagonal hatching. */
export function TradesHistogram({ bins }: { bins: readonly GroupedBin[] }) {
  if (bins.length === 0) return <Empty>No trade closed.</Empty>;
  const data = bins.map((bin) => ({ middle: bin.middle, lower: bin.lower, upper: bin.upper, long: bin.counts.long ?? 0, short: bin.counts.short ?? 0 }));
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
          <defs>
            <pattern id="short-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={OKABE.blue} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#0a0a0a" strokeWidth="2.2" />
            </pattern>
          </defs>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} />
          <YAxis {...AXIS} width={34} allowDecimals={false} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return row ? `net profit ${fmtUsd(row.lower)} to ${fmtUsd(row.upper)}` : "";
            }}
            formatter={(value, name) => [fmtInt(Number(value)), name === "long" ? "long ▲" : "short ▼"]}
          />
          <Bar dataKey="long" stackId="side" fill={OKABE.orange} isAnimationActive={false} />
          <Bar dataKey="short" stackId="side" fill="url(#short-hatch)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>■ long ▲</span> · <span style={{ color: OKABE.blue }}>▨ short ▼ (hatched)</span> · net profit per trade, USD
      </p>
    </div>
  );
}

// ─── tuning and training ────────────────────────────────────────────────────

const STATE_STYLE: Record<string, { color: string; shape: ScatterShape; glyph: string }> = {
  complete: { color: OKABE.orange, shape: "circle", glyph: "●" },
  pruned: { color: OKABE.sky, shape: "diamond", glyph: "◆" },
  failed: { color: OKABE.vermillion, shape: "cross", glyph: "✚" },
};

/** Optuna trials, one small chart per fold: trial number against the search score, shaped by state. */
export function TrialsGrid({ trials }: { trials: readonly Row[] }) {
  const folds = [...new Set(trials.map((row) => Number(row.fold_index ?? 0)))].sort((a, b) => a - b);
  if (folds.length === 0) return <Empty>No tuning trial.</Empty>;
  return (
    <div className="space-y-1">
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {folds.map((fold) => {
          const rows = trials.filter((row) => Number(row.fold_index ?? 0) === fold);
          const states = [...new Set(rows.map((row) => String(row.state ?? "complete")))];
          return (
            <div key={fold} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
              <div className="mb-1 text-[11px] text-neutral-300">Fold {fold + 1} · {rows.length} trials</div>
              <ResponsiveContainer width="100%" height={170}>
                <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="trial" name="Trial" allowDecimals={false} {...AXIS} label={{ value: "Trial", position: "insideBottom", offset: -8, ...AXIS_LABEL }} />
                  <YAxis type="number" dataKey="objective" name="Search score" {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 2)} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: "3 3" }} formatter={(value, name) => [fmt(Number(value), 5), String(name)]} />
                  {states.map((state) => {
                    const style = STATE_STYLE[state] ?? { color: OKABE.grey, shape: "square" as ScatterShape, glyph: "■" };
                    return (
                      <Scatter
                        key={state}
                        name={state}
                        data={rows
                          .filter((row) => String(row.state ?? "complete") === state && typeof row.objective_value === "number")
                          .map((row) => ({ trial: Number(row.trial), objective: row.objective_value as number }))}
                        fill={style.color}
                        shape={style.shape}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400">
        {Object.entries(STATE_STYLE).map(([state, style]) => (
          <span key={state} className="mr-3"><span style={{ color: style.color }}>{style.glyph}</span> {state}</span>
        ))}
        · a search score on the inner validation blocks, optimistic by construction
      </p>
    </div>
  );
}

const DASHES = ["", "6 3", "2 2", "8 3 2 3"];
const ROLE_COLOR: Record<string, string> = { direction: OKABE.orange, price: OKABE.purple };

/** Validation loss per epoch: colour is the model role, dash is the fold; the final fit is bold, a tuning trial is faint. */
export function EpochsChart({ epochs, showTrials }: { epochs: readonly Row[]; showTrials: boolean }) {
  const usable = epochs.filter((row) => typeof row.validation_loss === "number" && typeof row.epoch === "number");
  if (usable.length === 0) return <Empty>No validation loss recorded.</Empty>;
  const keyOf = (row: Row) =>
    `${String(row.model_role ?? "direction")} · fold ${Number(row.fold_index ?? 0) + 1} · ${row.trial === null || row.trial === undefined ? "final fit" : `trial ${Number(row.trial)}`}`;
  const shown = usable.filter((row) => showTrials || row.trial === null || row.trial === undefined);
  const keys = [...new Set(shown.map(keyOf))];
  const byEpoch = new Map<number, Record<string, number>>();
  for (const row of shown) {
    const epoch = Number(row.epoch);
    const entry = byEpoch.get(epoch) ?? { epoch };
    entry[keyOf(row)] = row.validation_loss as number;
    byEpoch.set(epoch, entry);
  }
  const data = [...byEpoch.values()].sort((a, b) => (a.epoch as number) - (b.epoch as number));
  const styleOf = (key: string) => {
    const [role, fold, kind] = key.split(" · ");
    const foldIndex = Number((fold ?? "fold 1").replace("fold ", "")) - 1;
    return { color: ROLE_COLOR[role ?? "direction"] ?? OKABE.sky, dash: DASHES[foldIndex % DASHES.length] ?? "", final: kind === "final fit" };
  };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...AXIS} label={{ value: "Epoch / round", position: "insideBottom", offset: -8, ...AXIS_LABEL }} />
        <YAxis {...AXIS} width={52} tickFormatter={(value: number) => fmt(value, 3)} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 5), String(name)]} />
        {keys.length <= 12 && <Legend wrapperStyle={{ fontSize: 10 }} />}
        {keys.map((key) => {
          const style = styleOf(key);
          return (
            <Line
              key={key} dataKey={key} name={key} stroke={style.color} strokeDasharray={style.dash} strokeWidth={style.final ? 2 : 1}
              strokeOpacity={style.final ? 1 : 0.35} dot={style.final ? { r: 2 } : false} connectNulls isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── metrics ────────────────────────────────────────────────────────────────

/** One metric across the run and its folds: orange at or above zero (▲), blue below (▼). */
export function MetricBars({ rows, unit }: { rows: ReadonlyArray<{ scope: string; value: number | null; samples: number | null; note: string | null }>; unit: string }) {
  if (rows.every((row) => row.value === null)) return <Empty>This metric is null in every scope; see the reasons in the matrix.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows as Array<(typeof rows)[number]>} margin={{ top: 14, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="scope" {...AXIS} />
        <YAxis {...AXIS} width={56} tickFormatter={(value: number) => fmt(value, Math.abs(value) >= 100 ? 0 : 3)} label={{ value: unit, angle: -90, position: "insideLeft", ...AXIS_LABEL }} />
        <ReferenceLine y={0} stroke={OKABE.grey} />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!row) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                <div className="font-semibold">{row.scope}</div>
                <div>{row.value === null ? "null" : fmt(row.value, 6)} · n {fmtInt(row.samples)}</div>
                {row.note && <div className="max-w-xs text-neutral-400">{row.note}</div>}
              </div>
            );
          }}
        />
        <Bar
          dataKey="value"
          isAnimationActive={false}
          label={({ x, y, width, value }: { x?: number; y?: number; width?: number; value?: number | string }) =>
            typeof value === "number" ? (
              <text x={(x ?? 0) + (width ?? 0) / 2} y={(y ?? 0) - 3} textAnchor="middle" fontSize={10} fill={value >= 0 ? OKABE.orange : OKABE.blue}>
                {value >= 0 ? "▲" : "▼"}
              </text>
            ) : (
              <g />
            )
          }
        >
          {rows.map((row) => (
            <Cell key={row.scope} fill={(row.value ?? 0) >= 0 ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── calibration and calls ──────────────────────────────────────────────────

/** Mean P(up) in a bin against the share that went up; size is the bars scored, shape and colour the scope. */
export function ReliabilityChart({ bins }: { bins: readonly CalibrationBin[] }) {
  const usable = bins.filter((bin) => bin.scored_bar_count > 0 && bin.mean_probability_up !== null && bin.observed_up_fraction !== null);
  if (usable.length === 0) return <Empty>No scored bin.</Empty>;
  const scopes = [...new Set(usable.map((bin) => scopeLabel(bin.scope, bin.fold_index)))];
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="predicted" name="Mean P(up) in the bin" domain={[0, 1]} {...AXIS} label={{ value: "Mean P(up) in the bin", position: "insideBottom", offset: -10, ...AXIS_LABEL }} />
          <YAxis type="number" dataKey="observed" name="Share that went up" domain={[0, 1]} {...AXIS} width={40} />
          <ZAxis type="number" dataKey="bars" range={[30, 260]} name="Scored bars" />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={OKABE.grey} strokeDasharray="4 4" />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as { scope: string; bin: number; lower: number; upper: number; bars: number; predicted: number; observed: number; gap: number | null } | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.scope} · bin {point.bin} ({fmt(point.lower, 3)} to {fmt(point.upper, 3)})</div>
                  <div>{fmtInt(point.bars)} scored bars</div>
                  <div>mean P(up) {fmt(point.predicted, 4)} · went up {fmt(point.observed, 4)} · gap {fmt(point.gap, 4)}</div>
                </div>
              );
            }}
          />
          {scopes.map((scope, index) => (
            <Scatter
              key={scope}
              name={scope}
              fill={PALETTE[index % PALETTE.length]}
              shape={SHAPES[index % SHAPES.length]}
              isAnimationActive={false}
              data={usable
                .filter((bin) => scopeLabel(bin.scope, bin.fold_index) === scope)
                .map((bin) => ({
                  scope, bin: bin.bin_number, lower: bin.probability_lower, upper: bin.probability_upper, bars: bin.scored_bar_count,
                  predicted: bin.mean_probability_up as number, observed: bin.observed_up_fraction as number, gap: bin.calibration_gap,
                }))}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
        {scopes.map((scope, index) => (
          <span key={scope}><span style={{ color: PALETTE[index % PALETTE.length] }}>{SHAPE_GLYPH[SHAPES[index % SHAPES.length] as ScatterShape]}</span> {scope}</span>
        ))}
        <span>dashed line: P(up) means what it says</span>
      </p>
    </div>
  );
}

/** One confusion matrix per scope, shaded on cividis by the share of scored bars, with the share and the count written in the cell. */
export function ConfusionGrids({ cells }: { cells: readonly ConfusionCell[] }) {
  if (cells.length === 0) return <Empty>No confusion matrix.</Empty>;
  const scopes = [...new Set(cells.map((cell) => scopeLabel(cell.scope, cell.fold_index)))];
  const actual = [...new Set(cells.map((cell) => cell.actual_direction))].sort();
  const called = [...new Set(cells.map((cell) => cell.predicted_direction))].sort();
  const maximum = Math.max(...cells.map((cell) => cell.share_of_scored_bars ?? 0), 1e-9);
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
      {scopes.map((scope) => (
        <div key={scope} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
          <div className="mb-1 text-[11px] text-neutral-300">{scope}</div>
          <table className="w-full border-separate border-spacing-0.5 text-center text-[10px] font-mono tnum">
            <thead>
              <tr>
                <th className="font-normal text-neutral-500">went ↓ called →</th>
                {called.map((label) => <th key={label} className="font-normal text-neutral-400">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {actual.map((row) => (
                <tr key={row}>
                  <th className="text-left font-normal text-neutral-400">{row}</th>
                  {called.map((column) => {
                    const cell = cells.find((candidate) => scopeLabel(candidate.scope, candidate.fold_index) === scope && candidate.actual_direction === row && candidate.predicted_direction === column);
                    const share = cell?.share_of_scored_bars ?? 0;
                    const tone = share / maximum;
                    return (
                      <td
                        key={column}
                        title={`${scope}: went ${row}, called ${column}: ${fmtInt(cell?.bar_count ?? 0)} bars, ${fmt(share * 100, 2)}% of scored bars`}
                        className="rounded px-1 py-2"
                        style={{ background: cividis(tone), color: tone > 0.55 ? "#111" : "#eee" }}
                      >
                        <div>{fmt(share * 100, 1)}%</div>
                        <div className="opacity-75">{fmtInt(cell?.bar_count ?? 0)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── session days and drawdowns ─────────────────────────────────────────────

export function DailyChart({ days }: { days: readonly DailyRow[] }) {
  if (days.length === 0) return <Empty>No session day.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={days as DailyRow[]} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="session_day" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...AXIS} width={56} tickFormatter={(value: number) => `$${fmt(value, 0)}`} />
        <ReferenceLine y={0} stroke={OKABE.grey} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [fmtUsd(Number(value)), name === "net_profit_usd" ? "net profit that day" : "running total"]} />
        <Bar dataKey="net_profit_usd" isAnimationActive={false}>
          {days.map((day) => (
            <Cell key={`${day.session_day}-${day.fold_index}`} fill={day.net_profit_usd >= 0 ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
        <Line dataKey="cumulative_net_profit_usd" stroke="#e5e5e5" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Drawdown depths in order, one small chart per scope; a faded bar is a drawdown that never recovered. */
export function DrawdownGrid({ drawdowns }: { drawdowns: readonly DrawdownRow[] }) {
  if (drawdowns.length === 0) return <Empty>No drawdown.</Empty>;
  const scopes = [...new Set(drawdowns.map((row) => scopeLabel(row.scope, row.fold_index)))];
  return (
    <div className="space-y-1">
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {scopes.map((scope) => {
          const rows = drawdowns.filter((row) => scopeLabel(row.scope, row.fold_index) === scope);
          return (
            <div key={scope} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
              <div className="mb-1 text-[11px] text-neutral-300">{scope} · {rows.length} episodes</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={rows as DrawdownRow[]} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="drawdown_number" {...AXIS} />
                  <YAxis {...AXIS} width={44} tickFormatter={(value: number) => `$${fmt(value, 0)}`} />
                  <Tooltip
                    {...TOOLTIP}
                    content={({ payload }) => {
                      const row = payload?.[0]?.payload as DrawdownRow | undefined;
                      if (!row) return null;
                      return (
                        <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                          <div className="font-semibold">{scope} · drawdown {row.drawdown_number} (rank {row.depth_rank})</div>
                          <div>depth {fmtUsd(row.depth_usd)}</div>
                          <div>{fmtInt(row.bars_to_trough)} bars to the trough · {row.recovered ? `${fmtInt(row.bars_to_recovery)} bars to recover` : "never recovered"}</div>
                          <div>{fmt(row.underwater_days, 2)} days underwater</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="depth_usd" isAnimationActive={false}>
                    {rows.map((row) => (
                      <Cell key={row.drawdown_number} fill={OKABE.blue} fillOpacity={row.recovered ? 1 : 0.4} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.blue }}>■</span> recovered · <span style={{ color: OKABE.blue, opacity: 0.4 }}>■</span> faded: never recovered</p>
    </div>
  );
}

// ─── distributions ──────────────────────────────────────────────────────────

const BOX_LEFT = 210;
const BOX_WIDTH = 640;
const BOX_PLOT = BOX_WIDTH - BOX_LEFT - 12;
const BOX_ROW = 22;

/** Box-and-whisker rows for the USD quantities of each scope: whisker minimum to maximum, box 25th to 75th percentile, yellow tick the median. */
export function BoxRows({ rows }: { rows: readonly DistributionRow[] }) {
  const usd = rows.filter((row) => row.unit === "usd" && row.count > 0 && row.minimum !== null && row.maximum !== null);
  if (usd.length === 0) return <Empty>No USD quantity to draw.</Empty>;
  const scopes = [...new Set(usd.map((row) => scopeLabel(row.scope, row.fold_index)))];
  return (
    <div className="space-y-2">
      {scopes.map((scope) => {
        const group = usd.filter((row) => scopeLabel(row.scope, row.fold_index) === scope);
        const low = Math.min(...group.map((row) => row.minimum as number));
        const high = Math.max(...group.map((row) => row.maximum as number));
        const span = high > low ? high - low : 1;
        const x = (value: number) => BOX_LEFT + ((value - low) / span) * BOX_PLOT;
        return (
          <div key={scope} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="text-[11px] text-neutral-300">{scope}</div>
            <svg viewBox={`0 0 ${BOX_WIDTH} ${group.length * BOX_ROW + 22}`} className="w-full" role="img" aria-label={`Distribution of USD quantities, ${scope}`}>
              {low < 0 && high > 0 && <line x1={x(0)} x2={x(0)} y1={0} y2={group.length * BOX_ROW} stroke={OKABE.grey} strokeDasharray="3 3" />}
              {group.map((row, index) => {
                const y = index * BOX_ROW + BOX_ROW / 2;
                const title = `${row.quantity_label} · ${row.segment_value} (n ${row.count}): mean ${fmt(row.mean, 2)}, median ${fmt(row.median, 2)}, sd ${fmt(row.standard_deviation, 2)}, skew ${fmt(row.skewness, 2)}, kurt ${fmt(row.kurtosis, 2)}, p25 ${fmt(row.percentile_25, 2)}, p75 ${fmt(row.percentile_75, 2)}, min ${fmt(row.minimum, 2)}, max ${fmt(row.maximum, 2)}`;
                return (
                  <g key={`${row.quantity_name}-${row.segment_value}`}>
                    <title>{title}</title>
                    <text x={BOX_LEFT - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#a3a3a3">{`${row.quantity_label} · ${row.segment_value}`.slice(0, 42)}</text>
                    <line x1={x(row.minimum as number)} x2={x(row.maximum as number)} y1={y} y2={y} stroke={OKABE.grey} strokeWidth={1.5} />
                    <line x1={x(row.minimum as number)} x2={x(row.minimum as number)} y1={y - 4} y2={y + 4} stroke={OKABE.grey} />
                    <line x1={x(row.maximum as number)} x2={x(row.maximum as number)} y1={y - 4} y2={y + 4} stroke={OKABE.grey} />
                    {row.percentile_25 !== null && row.percentile_75 !== null && (
                      <rect x={x(row.percentile_25)} y={y - 5} width={Math.max(1, x(row.percentile_75) - x(row.percentile_25))} height={10} fill={OKABE.sky} fillOpacity={0.6} />
                    )}
                    {row.median !== null && <line x1={x(row.median)} x2={x(row.median)} y1={y - 7} y2={y + 7} stroke={OKABE.yellow} strokeWidth={3} />}
                  </g>
                );
              })}
              <text x={BOX_LEFT} y={group.length * BOX_ROW + 14} fontSize={9} fill="#a3a3a3">{fmtUsd(low)}</text>
              <text x={BOX_LEFT + BOX_PLOT} y={group.length * BOX_ROW + 14} fontSize={9} fill="#a3a3a3" textAnchor="end">{fmtUsd(high)}</text>
            </svg>
          </div>
        );
      })}
      <p className="text-[11px] text-neutral-400">whisker minimum to maximum · <span style={{ color: OKABE.sky }}>▮ box</span> 25th to 75th percentile · <span style={{ color: OKABE.yellow }}>▌ median</span> · hover a row for the eight numbers</p>
    </div>
  );
}

// ─── comparison ─────────────────────────────────────────────────────────────

export function CompareScatter({ rows }: { rows: ReadonlyArray<Record<string, number | string | null>> }) {
  const points = rows
    .filter((row) => typeof row.sharpe_ratio === "number" && typeof row.probabilistic_sharpe_ratio === "number")
    .map((row) => ({ x: row.sharpe_ratio as number, y: row.probabilistic_sharpe_ratio as number, recipe: String(row.recipe), net: row.net_profit_usd as number | null }));
  if (points.length === 0) return <Empty>No run has a Sharpe ratio and its probabilistic form.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="x" name="Sharpe ratio" {...AXIS} label={{ value: "Sharpe ratio", position: "insideBottom", offset: -10, ...AXIS_LABEL }} />
        <YAxis type="number" dataKey="y" name="P(true Sharpe > 0)" domain={[0, 1]} {...AXIS} width={40} />
        <ZAxis range={[80, 80]} />
        <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
        <ReferenceLine x={0} stroke={OKABE.grey} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                <div className="font-mono">{shortRecipe(point.recipe)}</div>
                <div>Sharpe {fmt(point.x, 3)} · P(true Sharpe above zero) {fmt(point.y, 3)}</div>
                <div>net profit {fmtUsd(point.net)}</div>
              </div>
            );
          }}
        />
        <Scatter data={points} fill={OKABE.orange} shape="circle" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ─── small helpers for the tabs ─────────────────────────────────────────────

/** Eight numbers of the numeric columns of a small frame, for a SummaryTable. */
export function summariesOf(rows: readonly Row[], exclude: readonly string[] = []): Array<{ name: string; summary: ReturnType<typeof eightNumberSummary> }> {
  const first = rows[0];
  if (!first) return [];
  const out: Array<{ name: string; summary: ReturnType<typeof eightNumberSummary> }> = [];
  for (const key of Object.keys(first)) {
    if (exclude.includes(key)) continue;
    const values = rows.map((row) => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length > 0) out.push({ name: key, summary: eightNumberSummary(values) });
  }
  return out;
}

const SUMMARY_ROWS: Array<[keyof ReturnType<typeof eightNumberSummary>, string]> = [
  ["count", "count"], ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"], ["skewness", "skewness"],
  ["kurtosis", "excess kurtosis"], ["percentile25", "25th percentile"], ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
];

/** The eight numbers (and the count) of each column side by side, with room between the columns. */
export function EightNumberTable({ columns }: { columns: ReadonlyArray<{ name: string; summary: ReturnType<typeof eightNumberSummary> }> }) {
  if (columns.length === 0) return <Empty>No numeric column.</Empty>;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="sticky left-0 bg-neutral-950 py-0.5 pr-3 text-left font-normal">statistic</th>
            {columns.map((column) => (
              <th key={column.name} className="whitespace-nowrap px-3 py-0.5 text-right font-normal">{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SUMMARY_ROWS.map(([key, label]) => (
            <tr key={key} className="border-t border-neutral-900">
              <td className="sticky left-0 whitespace-nowrap bg-neutral-950 py-0.5 pr-3 text-neutral-400">{label}</td>
              {columns.map((column) => (
                <td key={column.name} className="whitespace-nowrap px-3 py-0.5 text-right text-neutral-200">
                  {key === "count" ? fmtInt(column.summary.count) : fmt(column.summary[key] as number | null, 4)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
