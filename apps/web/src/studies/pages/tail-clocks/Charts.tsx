/**
 * The four pictures of the page, each a Recharts chart drawn from the body the
 * handler returns: hourly activity (why), the sigma ladder and the histogram
 * against the bell curve (what), and every bar beyond k sigma where it
 * happened (so what). Clocks differ by marker, dash and hatch as well as hue.
 */

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import {
  HISTOGRAM_BIN_COUNT, HISTOGRAM_BIN_WIDTH, HISTOGRAM_LOWER, HISTOGRAM_UPPER, breakAtGaps, histogramDensity, normalDensity,
  type ClockName, type ClockSeries, type ExtremeBar, type TailClocksBody,
} from "@shared/studies/tail-clocks";
import { CLOCK_STYLE, ClockMarker, NEUTRAL } from "./clocks";

/** Recharts hands a custom dot or shape its own geometry props. */
interface GeometryProps {
  cx?: number;
  cy?: number;
  index?: number;
}

function powerTicks(low: number, high: number): number[] {
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(low)); exponent <= Math.ceil(Math.log10(high)); exponent += 1) ticks.push(10 ** exponent);
  return ticks;
}

function exponentLabel(value: number): string {
  if (value === 1) return "1";
  const exponent = Math.round(Math.log10(value));
  return `1e${exponent}`;
}

function compact(value: number): string {
  if (value >= 1e9) return `${fmt(value / 1e9, 1)}B`;
  if (value >= 1e6) return `${fmt(value / 1e6, 1)}M`;
  if (value >= 1e3) return `${fmt(value / 1e3, 1)}k`;
  return fmt(value, 0);
}

// ── WHY: contracts per hour ────────────────────────────────────────────────

export interface ActivityWindowSummary {
  median: number;
  quietest: number;
  busiest: number;
}

export function activityWindow(hours: TailClocksBody["activity"]["hours"], start: number, length: number) {
  const timestamps = hours.timestamps.slice(start, start + length);
  const contracts = hours.contracts.slice(start, start + length);
  const plotted = breakAtGaps(timestamps, contracts);
  const finite = plotted.filter((value): value is number => value !== null && value > 0);
  const sorted = [...finite].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const summary: ActivityWindowSummary | null = median === null ? null : { median, quietest: sorted[0] as number, busiest: sorted[sorted.length - 1] as number };
  return { rows: timestamps.map((timestamp, index) => ({ timestamp, contracts: plotted[index] ?? null })), summary };
}

export function ActivityChart({ rows, summary }: { rows: Array<{ timestamp: number; contracts: number | null }>; summary: ActivityWindowSummary | null }) {
  const positive = rows.map((row) => row.contracts).filter((value): value is number => value !== null && value > 0);
  const low = positive.length ? Math.min(...positive) : 1;
  const high = positive.length ? Math.max(...positive) : 10;
  const ticks = powerTicks(low, high);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={rows} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmtTime(value).slice(5, 10)} {...AXIS} />
        <YAxis scale="log" domain={[ticks[0] ?? 1, ticks[ticks.length - 1] ?? 10]} ticks={ticks} allowDataOverflow tickFormatter={(value: number) => compact(value)} width={48} {...AXIS} />
        <Tooltip {...TOOLTIP} labelFormatter={(value) => `${fmtTime(Number(value))} (stamped clock)`} formatter={(value) => [fmtInt(Number(value)), "contracts in the hour"]} />
        <Area type="linear" dataKey="contracts" stroke={OKABE.blue} strokeWidth={1.3} fill={OKABE.blue} fillOpacity={0.18} isAnimationActive={false} connectNulls={false} dot={false} />
        {summary && (
          <ReferenceLine y={summary.median} stroke={OKABE.purple} strokeDasharray="5 3" strokeWidth={1.3} label={{ value: `median ${fmtInt(summary.median)}`, fill: OKABE.purple, fontSize: 10, position: "insideTopLeft" }} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HourOfDayChart({ rows }: { rows: TailClocksBody["activity"]["hourOfDayMedian"] }) {
  const values = rows.map((row) => row.medianContracts).filter((value) => value > 0);
  const ticks = powerTicks(Math.min(...values, 1), Math.max(...values, 10));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: 4, bottom: 18 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="hour" {...AXIS} interval={1} label={{ value: "stamped hour of the day (Pacific wall clock)", position: "insideBottom", offset: -10, fontSize: 10, fill: "#9a9a9a" }} />
        <YAxis scale="log" domain={[ticks[0] ?? 1, ticks[ticks.length - 1] ?? 10]} ticks={ticks} allowDataOverflow tickFormatter={(value: number) => compact(value)} width={48} {...AXIS} />
        <Tooltip {...TOOLTIP} labelFormatter={(value) => `hour ${value}:00`} formatter={(value) => [fmtInt(Number(value)), "median contracts in the hour"]} />
        <Bar dataKey="medianContracts" fill={OKABE.sky} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VolumeHistogram({ bins }: { bins: TailClocksBody["activity"]["logHistogram"] }) {
  const data = bins.map((bin) => ({ middle: (bin.lowerLog10 + bin.upperLog10) / 2, count: bin.count, lower: bin.lowerLog10, upper: bin.upperLog10 }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 18 }} barCategoryGap={1}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => `1e${fmt(value, 1)}`} {...AXIS} label={{ value: "contracts in the hour (log10 scale)", position: "insideBottom", offset: -10, fontSize: 10, fill: "#9a9a9a" }} />
        <YAxis {...AXIS} width={44} />
        <Tooltip {...TOOLTIP} labelFormatter={(_label, payload) => {
          const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
          return bin ? `${compact(10 ** bin.lower)} to ${compact(10 ** bin.upper)} contracts` : "";
        }} formatter={(value) => [fmtInt(Number(value)), "hours"]} />
        <Bar dataKey="count" fill={OKABE.sky} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── the sigma ladder ───────────────────────────────────────────────────────

export function LadderChart({ series }: { series: ClockSeries[] }) {
  const gates = series[0]?.gates.map((gate) => gate.sigma) ?? [];
  const data = gates.map((sigma, index) => {
    const row: Record<string, number | string | null> = { label: `beyond ${sigma}σ`, sigma };
    for (const entry of series) {
      const ratio = entry.gates[index]?.ratio ?? null;
      row[entry.clock] = ratio !== null && ratio > 0 ? ratio : null;
    }
    return row;
  });
  const ratios = series.flatMap((entry) => entry.gates.map((gate) => gate.ratio ?? 0)).filter((value) => value > 0);
  const ticks = powerTicks(Math.min(...ratios, 1) * 0.5, Math.max(...ratios, 1) * 2);
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 22, right: 18, left: 6, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis scale="log" domain={[ticks[0] ?? 0.1, ticks[ticks.length - 1] ?? 10]} ticks={ticks} allowDataOverflow tickFormatter={(value: number) => `${fmt(value, value < 1 ? 1 : 0)}×`} width={52} {...AXIS} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [`${fmt(Number(value), 2)}× the bell curve`, CLOCK_STYLE[name as ClockName]?.label ?? String(name)]} />
        <ReferenceLine y={1} stroke={NEUTRAL} strokeDasharray="2 3" label={{ value: "a bell curve sits flat on this line", position: "insideBottomRight", fill: NEUTRAL, fontSize: 10 }} />
        {series.map((entry) => {
          const style = CLOCK_STYLE[entry.clock];
          return (
            <Line
              key={entry.clock}
              type="linear"
              dataKey={entry.clock}
              stroke={style.color}
              strokeWidth={1.6}
              strokeDasharray={style.dash}
              isAnimationActive={false}
              connectNulls
              dot={(props: GeometryProps) =>
                props.cx === undefined || props.cy === undefined ? <g key={`dot-${entry.clock}-${props.index}`} /> : <ClockMarker key={`dot-${entry.clock}-${props.index}`} x={props.cx} y={props.cy} clock={entry.clock} size={4} />
              }
            >
              <LabelList
                dataKey={entry.clock}
                position="top"
                offset={9}
                fill={style.color}
                fontSize={10}
                formatter={(value: unknown) => {
                  const ratio = Number(value);
                  return Number.isFinite(ratio) ? (ratio >= 1 ? `${fmt(ratio, 1)}×` : `${fmt(ratio, 1)}× fewer`) : "";
                }}
              />
            </Line>
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── histogram against the bell curve ───────────────────────────────────────

const GRID_STEP = HISTOGRAM_BIN_WIDTH / 5;

export function TailHistogram({ series, sigma }: { series: ClockSeries[]; sigma: number }) {
  const densities = new Map<ClockName, Array<number | null>>(series.map((entry) => [entry.clock, histogramDensity(entry.histogramCounts)]));
  const steps = Math.round((HISTOGRAM_UPPER - HISTOGRAM_LOWER) / GRID_STEP);
  const data: Array<Record<string, number | null>> = [];
  for (let index = 0; index <= steps; index += 1) {
    const x = HISTOGRAM_LOWER + index * GRID_STEP;
    const bin = Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor((x - HISTOGRAM_LOWER) / HISTOGRAM_BIN_WIDTH + 1e-9));
    const row: Record<string, number | null> = { x: Math.round(x * 1000) / 1000, normal: normalDensity(x) };
    for (const entry of series) row[entry.clock] = densities.get(entry.clock)?.[bin] ?? null;
    data.push(row);
  }
  const ticks = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 14, left: 6, bottom: 18 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="x" type="number" domain={[HISTOGRAM_LOWER, HISTOGRAM_UPPER]} ticks={[-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10]} {...AXIS} label={{ value: "bar return, in standard deviations", position: "insideBottom", offset: -10, fontSize: 10, fill: "#9a9a9a" }} />
        <YAxis scale="log" domain={[1e-5, 1]} ticks={ticks} allowDataOverflow tickFormatter={exponentLabel} width={44} {...AXIS} />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(value) => `${fmt(Number(value), 2)}σ`}
          formatter={(value, name) => [Number(value).toExponential(2), name === "normal" ? "the bell curve says" : (CLOCK_STYLE[name as ClockName]?.label ?? String(name))]}
        />
        <ReferenceArea x1={sigma} x2={HISTOGRAM_UPPER} fill={NEUTRAL} fillOpacity={0.1} ifOverflow="hidden" label={{ value: "the tails", fill: NEUTRAL, fontSize: 10, position: "insideTop" }} />
        <ReferenceArea x1={HISTOGRAM_LOWER} x2={-sigma} fill={NEUTRAL} fillOpacity={0.1} ifOverflow="hidden" label={{ value: "the tails", fill: NEUTRAL, fontSize: 10, position: "insideTop" }} />
        {[1, 2, 3].flatMap((level) => [level, -level]).map((x) => (
          <ReferenceLine key={x} x={x} stroke={NEUTRAL} strokeOpacity={0.55} label={{ value: `${Math.abs(x)}σ`, position: "insideBottom", fill: NEUTRAL, fontSize: 9 }} />
        ))}
        <Line type="linear" dataKey="normal" stroke={NEUTRAL} strokeWidth={1.3} strokeDasharray="1 3" dot={false} isAnimationActive={false} />
        {series.map((entry) => (
          <Line key={entry.clock} type="linear" dataKey={entry.clock} stroke={CLOCK_STYLE[entry.clock].color} strokeWidth={1.5} strokeDasharray={CLOCK_STYLE[entry.clock].dash} dot={false} isAnimationActive={false} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── every bar beyond k sigma ───────────────────────────────────────────────

function ExtremeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ExtremeBar }> }) {
  const bar = active ? payload?.[0]?.payload : undefined;
  if (!bar) return null;
  return (
    <div style={TOOLTIP.contentStyle as React.CSSProperties} className="px-2 py-1 text-[11px]">
      <div className="font-medium">{CLOCK_STYLE[bar.clock].label}</div>
      <div className="font-mono tnum">{fmtTime(bar.timestamp)} (stamped)</div>
      <div className="font-mono tnum">{fmt(bar.standardisedReturn, 2)}σ, {fmt(bar.percentReturn, 2)}%</div>
      <div className="font-mono tnum">hour {bar.hour}, {bar.year}</div>
    </div>
  );
}

export function ExtremesScatter({ series, extremes, sigma }: { series: ClockSeries[]; extremes: ExtremeBar[]; sigma: number }) {
  const first = Math.min(...series.map((entry) => entry.firstTimestamp ?? Infinity));
  const last = Math.max(...series.map((entry) => entry.lastTimestamp ?? -Infinity));
  const bigMoves = extremes.map((bar) => Math.abs(bar.standardisedReturn));
  const top = Math.max(sigma + 1, Math.ceil(Math.max(0, ...bigMoves)) + 1);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 10, right: 14, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="timestamp" type="number" domain={Number.isFinite(first) && Number.isFinite(last) ? [first, last] : ["dataMin", "dataMax"]} tickFormatter={(value: number) => String(new Date(value).getUTCFullYear())} {...AXIS} />
        <YAxis dataKey="absolute" type="number" domain={[0, top]} {...AXIS} width={40} label={{ value: "size of move (σ)", angle: -90, position: "insideLeft", fontSize: 10, fill: "#9a9a9a" }} />
        <Tooltip content={<ExtremeTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        {[1, 2, 3].filter((level) => level < sigma).map((level) => <ReferenceLine key={level} y={level} stroke={NEUTRAL} strokeOpacity={0.45} />)}
        <ReferenceLine y={sigma} stroke={NEUTRAL} strokeDasharray="5 3" label={{ value: `${fmt(sigma, 1)}σ`, position: "insideTopRight", fill: NEUTRAL, fontSize: 10 }} />
        {series.map((entry) => (
          <Scatter
            key={entry.clock}
            name={CLOCK_STYLE[entry.clock].label}
            data={extremes.filter((bar) => bar.clock === entry.clock).map((bar) => ({ ...bar, absolute: Math.abs(bar.standardisedReturn) }))}
            isAnimationActive={false}
            shape={(props: GeometryProps) =>
              props.cx === undefined || props.cy === undefined ? <g /> : <ClockMarker x={props.cx} y={props.cy} clock={entry.clock} size={4.5} />
            }
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── counts by hour and by year ─────────────────────────────────────────────

const HATCH: Record<ClockName, string> = { time: "", volume: "url(#hatch-volume)", dollar: "url(#hatch-dollar)" };

/** Grouped bars of counts per category, one bar per clock; hatch as well as hue. */
export function CountBars({ rows, keyName, clocks, label }: { rows: Array<Record<string, number>>; keyName: string; clocks: ClockName[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 18 }}>
        <defs>
          <pattern id="hatch-volume" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={OKABE.orange} fillOpacity={0.25} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.orange} strokeWidth="3" />
          </pattern>
          <pattern id="hatch-dollar" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill={OKABE.green} fillOpacity={0.25} />
            <circle cx="2.5" cy="2.5" r="1.3" fill={OKABE.green} />
          </pattern>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey={keyName} {...AXIS} label={{ value: label, position: "insideBottom", offset: -10, fontSize: 10, fill: "#9a9a9a" }} />
        <YAxis allowDecimals={false} {...AXIS} width={34} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [fmtInt(Number(value)), CLOCK_STYLE[name as ClockName]?.label ?? String(name)]} />
        {clocks.map((clock) => (
          <Bar key={clock} dataKey={clock} fill={HATCH[clock] || CLOCK_STYLE[clock].color} stroke={CLOCK_STYLE[clock].color} strokeWidth={1} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
