/**
 * The page's charts, each drawn from the handler's aggregated body. Every
 * series carries its timeframe's colour AND marker shape; tooltips print the
 * exact values; log axes carry explicit ticks so a reader can read them.
 */

import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Symbols, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP } from "@/studies/kit";
import {
  TIMEFRAME_MINUTES, inverseNormal, linspace, type CalibrationBin, type CurveSpan, type JensenRow, type QuantilePlot,
  type ResidualRow, type Scaling, type Timeframe,
} from "@shared/studies/volatility-to-price-range";
import { INK, TIMEFRAME_COLOR, TIMEFRAME_SHAPE, fixed, signed, timeframeLabel } from "./style";

const LOG_TICKS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

function logTicks(low: number, high: number): number[] {
  const ticks = LOG_TICKS.filter((tick) => tick >= low && tick <= high);
  return ticks.length >= 2 ? ticks : [low, high];
}

function TooltipBox({ lines }: { lines: string[] }) {
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      {lines.map((line, index) => (
        <div key={index} className={index === 0 ? "font-semibold" : undefined}>{line}</div>
      ))}
    </div>
  );
}

function payloadOf<T>(payload: unknown): T | undefined {
  const list = payload as Array<{ payload?: T }> | undefined;
  return list?.[0]?.payload;
}

// ---------------------------------------------------------------------------
// Section 2: Q-Q of log-range against the normal it is assumed to be
// ---------------------------------------------------------------------------

export function QuantilePanels({ plots, shown }: { plots: readonly QuantilePlot[]; shown: ReadonlySet<Timeframe> }) {
  const visible = plots.filter((plot) => shown.has(plot.timeframe));
  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((plot) => {
        const points = plot.normalQuantile.map((x, index) => ({ x, y: plot.observedLogRange[index] as number }));
        const all = [...plot.normalQuantile, ...plot.observedLogRange];
        const low = Math.floor(Math.min(...all) * 2) / 2;
        const high = Math.ceil(Math.max(...all) * 2) / 2;
        return (
          <div key={plot.timeframe} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="flex justify-between text-[11px]">
              <span style={{ color: TIMEFRAME_COLOR[plot.timeframe] }}>{timeframeLabel(plot.timeframe)} · ln(high − low)</span>
              <span className="font-mono text-neutral-400">excess kurtosis {signed(plot.logRangeExcessKurtosis, 2)}</span>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <ScatterChart margin={{ top: 6, right: 8, left: -12, bottom: 12 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="x" name="normal quantile" domain={[low, high]} {...AXIS} tickFormatter={(v: number) => fixed(v, 1)} label={{ value: "normal quantile", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -6 }} />
                <YAxis type="number" dataKey="y" name="observed log-range" domain={[low, high]} {...AXIS} tickFormatter={(v: number) => fixed(v, 1)} />
                <ZAxis range={[10, 10]} />
                <ReferenceLine segment={[{ x: low, y: low }, { x: high, y: high }]} stroke={INK} strokeDasharray="5 3" />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const point = payloadOf<{ x: number; y: number }>(payload);
                    return point ? <TooltipBox lines={[plot.timeframe, `normal quantile ${fixed(point.x, 4)}`, `observed log-range ${fixed(point.y, 4)}`, `= ${fixed(Math.exp(point.y), 2)} points`]} /> : null;
                  }}
                />
                <Scatter data={points} fill={TIMEFRAME_COLOR[plot.timeframe]} fillOpacity={0.6} shape={TIMEFRAME_SHAPE[plot.timeframe]} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3: one e^v curve, and where each timeframe sits on it
// ---------------------------------------------------------------------------

export function CurveChart({
  gridLow, gridHigh, spans, shown, pointValue, marker,
}: { gridLow: number; gridHigh: number; spans: readonly CurveSpan[]; shown: ReadonlySet<Timeframe>; pointValue: number; marker: number | null }) {
  const curve = linspace(gridLow, gridHigh, 400).map((x) => ({ x, y: Math.exp(x) }));
  const visible = spans.filter((span) => shown.has(span.timeframe));
  const yLow = Math.exp(gridLow);
  const yHigh = Math.exp(gridHigh);
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart margin={{ top: 8, right: 16, left: 4, bottom: 16 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="x" domain={[gridLow, gridHigh]} {...AXIS} tickFormatter={(v: number) => fixed(v, 1)} label={{ value: "volatility value v = ln(high − low)", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
        <YAxis type="number" dataKey="y" scale="log" domain={[yLow, yHigh]} ticks={logTicks(yLow, yHigh)} allowDataOverflow {...AXIS} tickFormatter={(v: number) => String(v)} label={{ value: "range, points (log)", angle: -90, fill: "#8a8a8a", fontSize: 10, position: "insideLeft", offset: 12 }} />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const point = payloadOf<{ x: number; y: number; timeframe?: string }>(payload);
            if (!point) return null;
            return <TooltipBox lines={[point.timeframe ? `${point.timeframe} median bar` : "range = e^v", `v ${fixed(point.x, 3)}`, `${fixed(point.y, 2)} points`, `$${fixed(point.y * pointValue, 2)} per contract`]} />;
          }}
        />
        <Line data={curve} dataKey="y" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} name="range = e^v, every timeframe" />
        {visible.map((span) => (
          <Line
            key={`segment-${span.timeframe}`}
            data={linspace(span.logRangePercentile05, span.logRangePercentile95, 40).map((x) => ({ x, y: Math.exp(x), timeframe: span.timeframe }))}
            dataKey="y"
            stroke={TIMEFRAME_COLOR[span.timeframe]}
            strokeWidth={8}
            strokeOpacity={0.5}
            dot={false}
            isAnimationActive={false}
            name={`${span.timeframe} 5th–95th percentile`}
          />
        ))}
        {visible.map((span) => (
          <Scatter
            key={`median-${span.timeframe}`}
            data={[{ x: span.logRangeMedian, y: Math.exp(span.logRangeMedian), timeframe: span.timeframe }]}
            fill={TIMEFRAME_COLOR[span.timeframe]}
            stroke="#111"
            shape={TIMEFRAME_SHAPE[span.timeframe]}
            isAnimationActive={false}
            name={`${span.timeframe} median`}
          />
        ))}
        {marker !== null && Number.isFinite(marker) && <ReferenceLine x={marker} stroke={OKABE.yellow} strokeDasharray="3 3" label={{ value: "calculator v", fill: OKABE.yellow, fontSize: 10, position: "top" }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Section 3: the outcome band as a multiple of the median bar
// ---------------------------------------------------------------------------

export function BandChart({
  spans, residuals, shown, lowerQuantile, upperQuantile,
}: { spans: readonly CurveSpan[]; residuals: readonly ResidualRow[]; shown: ReadonlySet<Timeframe>; lowerQuantile: number; upperQuantile: number }) {
  const zLow = inverseNormal(lowerQuantile);
  const zHigh = inverseNormal(upperQuantile);
  const series = spans
    .filter((span) => shown.has(span.timeframe))
    .map((span) => {
      const sigma = residuals.find((row) => row.timeframe === span.timeframe)?.residualSigma ?? Number.NaN;
      const band: [number, number] = [Math.exp(sigma * zLow), Math.exp(sigma * zHigh)];
      return {
        timeframe: span.timeframe,
        sigma,
        band,
        data: [
          { x: Math.exp(span.logRangePercentile05), band, timeframe: span.timeframe, sigma },
          { x: Math.exp(span.logRangePercentile95), band, timeframe: span.timeframe, sigma },
        ],
      };
    });
  const xs = series.flatMap((entry) => entry.data.map((point) => point.x));
  const xLow = xs.length ? Math.min(...xs) : 1;
  const xHigh = xs.length ? Math.max(...xs) : 10;
  const yHigh = Math.max(2, ...series.map((entry) => entry.band[1])) * 1.05;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart margin={{ top: 8, right: 16, left: 4, bottom: 16 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="x" scale="log" domain={[xLow, xHigh]} ticks={logTicks(xLow, xHigh)} allowDataOverflow {...AXIS} label={{ value: "median range implied by the forecast, points (log)", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
        <YAxis type="number" domain={[0, yHigh]} {...AXIS} tickFormatter={(v: number) => `${fixed(v, 1)}×`} />
        <ReferenceLine y={1} stroke={INK} strokeDasharray="5 3" label={{ value: "median bar", fill: INK, fontSize: 10, position: "insideTopLeft" }} />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const point = payloadOf<{ timeframe: string; band: [number, number]; sigma: number }>(payload);
            if (!point) return null;
            return <TooltipBox lines={[point.timeframe, `residual σ ${fixed(point.sigma, 4)}`, `${Math.round(lowerQuantile * 100)}th percentile ${fixed(point.band[0], 3)}× the median`, `${Math.round(upperQuantile * 100)}th percentile ${fixed(point.band[1], 3)}× the median`]} />;
          }}
        />
        {series.map((entry) => (
          <Area
            key={entry.timeframe}
            data={entry.data}
            dataKey="band"
            type="linear"
            stroke={TIMEFRAME_COLOR[entry.timeframe]}
            strokeWidth={1.5}
            fill={TIMEFRAME_COLOR[entry.timeframe]}
            fillOpacity={0.18}
            isAnimationActive={false}
            name={`${timeframeLabel(entry.timeframe)} band`}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Section 4: predicted e^v against the realised next-bar range, per decile
// ---------------------------------------------------------------------------

export function CalibrationPanels({ calibration, shown, pickedBin }: { calibration: readonly CalibrationBin[]; shown: ReadonlySet<Timeframe>; pickedBin: number }) {
  const byTimeframe = new Map<Timeframe, CalibrationBin[]>();
  for (const bin of calibration) {
    if (!shown.has(bin.timeframe)) continue;
    const list = byTimeframe.get(bin.timeframe) ?? [];
    list.push(bin);
    byTimeframe.set(bin.timeframe, list);
  }
  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {[...byTimeframe.entries()].map(([timeframe, bins]) => {
        const points = bins.map((bin) => ({
          x: bin.analyticMedianPoints,
          y: bin.rangeMedian,
          whisker: [bin.rangeMedian - bin.rangePercentile25, bin.rangePercentile75 - bin.rangeMedian] as [number, number],
          bin: bin.bin + 1,
          count: bin.rangeCount,
          p25: bin.rangePercentile25,
          p75: bin.rangePercentile75,
          bias: bin.biasPercent,
        }));
        const values = bins.flatMap((bin) => [bin.analyticMedianPoints, bin.rangePercentile25, bin.rangePercentile75]).filter((value) => value > 0);
        const low = Math.min(...values) * 0.9;
        const high = Math.max(...values) * 1.1;
        const picked = points.filter((point) => point.bin === pickedBin);
        const medianCount = [...bins.map((bin) => bin.rangeCount)].sort((a, b) => a - b)[Math.floor(bins.length / 2)] ?? 0;
        return (
          <div key={timeframe} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="flex justify-between text-[11px]">
              <span style={{ color: TIMEFRAME_COLOR[timeframe] }}>{timeframeLabel(timeframe)}</span>
              <span className="font-mono text-neutral-400">bars per bin {medianCount.toLocaleString("en-US")}</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 6, right: 8, left: -8, bottom: 12 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="x" scale="log" domain={[low, high]} ticks={logTicks(low, high)} allowDataOverflow {...AXIS} label={{ value: "predicted e^v, points", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -6 }} />
                <YAxis type="number" dataKey="y" scale="log" domain={[low, high]} ticks={logTicks(low, high)} allowDataOverflow {...AXIS} />
                <ZAxis range={[46, 46]} />
                <ReferenceLine segment={[{ x: low, y: low }, { x: high, y: high }]} stroke={INK} strokeDasharray="5 3" ifOverflow="hidden" />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const point = payloadOf<(typeof points)[number]>(payload);
                    return point ? (
                      <TooltipBox lines={[`${timeframe} · decile ${point.bin}`, `predicted ${fixed(point.x, 2)} points`, `realised median ${fixed(point.y, 2)} points`, `interquartile ${fixed(point.p25, 2)} to ${fixed(point.p75, 2)}`, `bias ${signed(point.bias, 2)}%`, `n ${point.count.toLocaleString("en-US")}`]} />
                    ) : null;
                  }}
                />
                <Scatter data={points} fill={TIMEFRAME_COLOR[timeframe]} stroke="#111" shape={TIMEFRAME_SHAPE[timeframe]} isAnimationActive={false}>
                  <ErrorBar dataKey="whisker" direction="y" width={4} stroke={TIMEFRAME_COLOR[timeframe]} />
                </Scatter>
                {picked.length > 0 && <Scatter data={picked} fill="none" stroke={OKABE.yellow} strokeWidth={2} shape="circle" isAnimationActive={false} />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4a: the bias as a difference against a zero rule
// ---------------------------------------------------------------------------

function ShapedDot({ cx, cy, shape, color }: { cx?: number; cy?: number; shape: string; color: string }) {
  if (cx === undefined || cy === undefined) return null;
  return <Symbols cx={cx} cy={cy} type={shape as "circle"} size={56} fill={color} stroke="#111" />;
}

export function BiasChart({ calibration, shown, binCount, pickedBin }: { calibration: readonly CalibrationBin[]; shown: ReadonlySet<Timeframe>; binCount: number; pickedBin: number }) {
  const timeframes = [...new Set(calibration.map((bin) => bin.timeframe))].filter((timeframe) => shown.has(timeframe));
  return (
    <ResponsiveContainer width="100%" height={270}>
      <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="decile" domain={[1, binCount]} ticks={Array.from({ length: binCount }, (_, index) => index + 1)} {...AXIS} label={{ value: "volatility bin (1 = calmest forecast)", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
        <YAxis type="number" {...AXIS} tickFormatter={(v: number) => `${v}%`} />
        <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
        <ReferenceLine x={pickedBin} stroke={OKABE.yellow} strokeDasharray="3 3" />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const point = payloadOf<{ decile: number; bias: number; timeframe: string; predicted: number; realized: number }>(payload);
            return point ? <TooltipBox lines={[`${point.timeframe} · bin ${point.decile}`, `bias ${signed(point.bias, 3)}%`, `predicted ${fixed(point.predicted, 2)} points`, `realised median ${fixed(point.realized, 2)} points`]} /> : null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {timeframes.map((timeframe) => (
          <Line
            key={timeframe}
            data={calibration.filter((bin) => bin.timeframe === timeframe).map((bin) => ({ decile: bin.bin + 1, bias: bin.biasPercent, timeframe, predicted: bin.analyticMedianPoints, realized: bin.rangeMedian }))}
            dataKey="bias"
            name={timeframeLabel(timeframe)}
            stroke={TIMEFRAME_COLOR[timeframe]}
            strokeWidth={2}
            dot={(props: { cx?: number; cy?: number; index?: number }) => <ShapedDot key={`${timeframe}-${props.index}`} cx={props.cx} cy={props.cy} shape={TIMEFRAME_SHAPE[timeframe]} color={TIMEFRAME_COLOR[timeframe]} />}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Section 4b: Gaussian factor against the measured one
// ---------------------------------------------------------------------------

export function JensenChart({ rows, shown }: { rows: readonly JensenRow[]; shown: ReadonlySet<Timeframe> }) {
  const data = rows.filter((row) => shown.has(row.timeframe)).map((row) => ({ ...row, label: timeframeLabel(row.timeframe) }));
  const top = Math.max(1.1, ...data.map((row) => row.measuredFactor)) * 1.03;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis domain={[1, top]} allowDataOverflow {...AXIS} tickFormatter={(v: number) => fixed(v, 2)} />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const row = payloadOf<JensenRow>(payload);
            return row ? <TooltipBox lines={[row.timeframe, `lognormal e^(s²/2) ${fixed(row.lognormalFactor, 4)}`, `measured mean ÷ median ${fixed(row.measuredFactor, 4)}`, `understated by ${fixed(row.understatedByPercent, 2)}%`, `median bin excess kurtosis ${fixed(row.medianBinExcessKurtosis, 1)}`]} /> : null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="lognormalFactor" name="□ lognormal e^(s²/2)" fill={OKABE.sky} fillOpacity={0.3} stroke={OKABE.sky} isAnimationActive={false} />
        <Bar dataKey="measuredFactor" name="■ measured mean ÷ median" fill={OKABE.orange} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Section 5: the square-root-of-time law
// ---------------------------------------------------------------------------

export function ScalingCharts({ scaling, shown }: { scaling: Scaling; shown: ReadonlySet<Timeframe> }) {
  const minutes = scaling.rows.map((row) => row.minutes);
  const lowMinutes = Math.min(...minutes);
  const highMinutes = Math.max(...minutes);
  const anchor = scaling.rows[0];
  const grid = linspace(Math.log(lowMinutes), Math.log(highMinutes), 50);
  const anchorOffset = anchor ? anchor.meanLogRange - scaling.exponentOnMean * Math.log(anchor.minutes) : 0;
  const rootOffset = anchor ? anchor.meanLogRange - 0.5 * Math.log(anchor.minutes) : 0;
  const fit = grid.map((g) => ({ x: Math.exp(g), y: scaling.exponentOnMean * g + anchorOffset }));
  const root = grid.map((g) => ({ x: Math.exp(g), y: 0.5 * g + rootOffset }));
  const rows = scaling.rows.filter((row) => shown.has(row.timeframe));
  const residuals = scaling.rows.map((row) => ({ ...row, label: timeframeLabel(row.timeframe) }));
  return (
    <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="x" scale="log" domain={[lowMinutes, highMinutes]} ticks={Object.values(TIMEFRAME_MINUTES)} allowDataOverflow {...AXIS} label={{ value: "bar length, minutes (log)", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
            <YAxis type="number" dataKey="y" domain={["auto", "auto"]} {...AXIS} tickFormatter={(v: number) => fixed(v, 1)} label={{ value: "mean ln(high − low)", angle: -90, fill: "#8a8a8a", fontSize: 10, position: "insideLeft", offset: 14 }} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const point = payloadOf<{ x: number; y: number; timeframe?: string }>(payload);
                return point ? <TooltipBox lines={[point.timeframe ? `${point.timeframe} measured` : "line", `${fixed(point.x, 1)} minutes`, `mean log-range ${fixed(point.y, 4)}`, `= ${fixed(Math.exp(point.y), 2)} points (geometric mean)`]} /> : null;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line data={fit} dataKey="y" name={`fit, H = ${fixed(scaling.exponentOnMean, 3)}`} stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line data={root} dataKey="y" name="square root of time, H = 0.5" stroke={OKABE.sky} strokeWidth={2} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
            {rows.map((row) => (
              <Scatter key={row.timeframe} data={[{ x: row.minutes, y: row.meanLogRange, timeframe: row.timeframe }]} name={timeframeLabel(row.timeframe)} fill={TIMEFRAME_COLOR[row.timeframe]} stroke="#111" shape={TIMEFRAME_SHAPE[row.timeframe]} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={residuals} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval={0} label={{ value: "measured − fitted, log units", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
            <YAxis {...AXIS} tickFormatter={(v: number) => v.toExponential(0)} />
            <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
            <Tooltip {...TOOLTIP} formatter={(value: number) => [value.toExponential(3), "measured − fitted"]} />
            <Bar dataKey="residualLogUnits" isAnimationActive={false}>
              {residuals.map((row) => (
                <Cell key={row.timeframe} fill={TIMEFRAME_COLOR[row.timeframe]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The EWMA as a weighted sum: step the lag and watch the weight and the total
// ---------------------------------------------------------------------------

export function EwmaWeights({ lambda, lag, lagCount }: { lambda: number; lag: number; lagCount: number }) {
  let running = 0;
  const data = Array.from({ length: lagCount + 1 }, (_, k) => {
    const weight = (1 - lambda) * lambda ** k;
    running += weight;
    return { k, weight, cumulative: running };
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="k" {...AXIS} label={{ value: "lag k, bars back", fill: "#8a8a8a", fontSize: 10, position: "insideBottom", offset: -8 }} />
        <YAxis yAxisId="weight" {...AXIS} tickFormatter={(v: number) => fixed(v, 3)} />
        <YAxis yAxisId="cumulative" orientation="right" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
        <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [name === "cumulative" ? `${fixed(value * 100, 1)}%` : fixed(value, 5), name]} labelFormatter={(label) => `k = ${label}`} />
        <Bar yAxisId="weight" dataKey="weight" name="weight (1 − λ)λ^k" isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.k} fill={row.k === lag ? OKABE.yellow : row.k < lag ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
        <Line yAxisId="cumulative" dataKey="cumulative" name="cumulative" stroke={INK} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
