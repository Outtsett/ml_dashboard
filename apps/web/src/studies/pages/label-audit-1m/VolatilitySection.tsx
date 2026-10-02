/**
 * Section 3 of the audit: the forward log realised-range target, the
 * zero-range floor the pre-fix label put on 0.451 % of bars, and the
 * exponentially weighted persistence baseline every volatility head must beat.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend as ChartLegend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, SummaryTable, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime,
} from "@/studies/kit";
import { ZERO_RANGE_FLOOR, exponentialForecast, rSquared, type LabelAuditBody } from "@shared/studies/label-audit-1m";
import { Legend } from "./parts";

type Volatility = LabelAuditBody["volatility"];

const SMOOTHING_FACTORS = ["0.8", "0.9", "0.94", "0.97", "0.99"] as const;

export function VolatilitySection({ volatility, controls, set }: {
  volatility: Volatility;
  controls: { policy: string; cutoff: number; bins: number; smoothing: string; sampleStep: number };
  set: {
    policy: (value: "floored" | "masked") => void;
    cutoff: (value: number) => void;
    bins: (value: number) => void;
    smoothing: (value: string) => void;
    sampleStep: (value: number) => void;
  };
}) {
  const summary = volatility.summary;
  const smoothing = Number(controls.smoothing);
  const baselines = SMOOTHING_FACTORS.map((factor) => {
    const floored = volatility.baselines.find((row) => row.zero_range_policy === "floored" && Math.abs(row.exponential_smoothing_factor - Number(factor)) < 1e-9);
    const masked = volatility.baselines.find((row) => row.zero_range_policy === "masked" && Math.abs(row.exponential_smoothing_factor - Number(factor)) < 1e-9);
    return { factor, floored: floored?.r_squared ?? null, masked: masked?.r_squared ?? null, flooredCount: floored?.scored_bar_count ?? null, maskedCount: masked?.scored_bar_count ?? null };
  });
  const chosen = baselines.find((row) => row.factor === controls.smoothing);

  const histogram = volatility.histogram.map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2 }));
  const floorShown = controls.policy === "floored" && controls.cutoff < ZERO_RANGE_FLOOR;

  // The walk-through: the persistence forecast stepped bar by bar on 120 real bars.
  const sampleValues = volatility.sample.map((point) => point.log_range ?? Number.NaN);
  const sampleForecast = exponentialForecast(sampleValues, smoothing);
  const walk = volatility.sample.map((point, index) => ({
    index,
    time: point.time,
    logRange: point.log_range,
    forecast: Number.isFinite(sampleForecast[index] as number) ? (sampleForecast[index] as number) : null,
    zero: point.zero_range && point.log_range !== null ? point.log_range : null,
  }));
  const step = Math.min(Math.max(0, controls.sampleStep), Math.max(0, walk.length - 1));
  const current = walk[step];
  const previousForecast = step > 0 ? walk[step - 1]?.forecast ?? null : null;
  const pairs = walk.slice(0, -1).map((point, index) => [walk[index + 1]?.logRange ?? null, point.forecast] as const).filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
  const sampleScore = rSquared(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]));
  const zeroInSample = walk.filter((point) => point.zero !== null).length;

  return (
    <Section title="3 · Volatility: the forward log realised range, and the baseline it must beat" question="Target: log(high − low) of the next bar. Baseline: the exponentially weighted persistence forecast shipped beside it, not the target mean.">
      <ControlBar>
        <SegmentControl label="Zero-range bars" value={controls.policy} options={[{ value: "floored", label: "floored (pre-fix)" }, { value: "masked", label: "masked (current)" }]} onChange={(value) => set.policy(value as "floored" | "masked")} hint="Floored: high == low becomes log(1e-9) = −20.7. Masked: those bars are left out." />
        <SliderControl label="Show values above" value={controls.cutoff} min={-22} max={0} step={0.5} onChange={set.cutoff} format={(value) => fmt(value, 1)} hint="The notebook drew values above −5; go below −20.7 to see the floor spike" />
        <SliderControl label="Bins" value={controls.bins} min={20} max={200} step={5} onChange={set.bins} />
        <SelectControl label="Smoothing factor λ" value={controls.smoothing} options={SMOOTHING_FACTORS.map((value) => ({ value, label: `λ = ${value}` }))} onChange={set.smoothing} />
      </ControlBar>

      <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Zero-range bars (high = low)" value={summary ? `${fmtInt(summary.zero_range_bar_count)} · ${fmtPercent(summary.zero_range_share, 3)}` : "—"} hint="Out of every labelled bar" />
        <Stat label="Floor distance from the mean" value={summary ? `${fmt(summary.floor_distance_in_standard_deviations, 1)} σ` : "—"} tone={OKABE.blue} hint="(log(1e-9) − mean) / standard deviation of the floored log-range" />
        <Stat label="Lag-1 autocorrelation of log-range" value={summary ? fmt(summary.lag_one_autocorrelation, 4) : "—"} />
        <Stat label="Target-mean R² (the naive baseline)" value={summary ? fmt(summary.target_mean_r_squared, 4) : "—"} hint="Predicting the sample mean scores zero by construction" />
      </div>

      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Next-bar log-range, values above {fmt(controls.cutoff, 1)} ({controls.policy})</h4>
          <Legend items={[
            { glyph: "■", label: `${fmtInt(volatility.shownCount)} bars shown`, color: OKABE.sky },
            { glyph: "┄", label: `median ${fmt(volatility.histogramMedian, 3)}`, color: OKABE.orange },
            { glyph: "·", label: `${fmtInt(volatility.belowCutoffCount)} bars at or below the cutoff`, color: OKABE.grey },
          ]} />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={histogram} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap={0}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 1)} {...AXIS} label={{ value: "log(high − low) of bar t+1, points", position: "insideBottom", offset: -2, fill: "#737373", fontSize: 10 }} height={32} />
              <YAxis {...AXIS} width={52} tickFormatter={(value: number) => fmtInt(value)} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value) => [fmtInt(Number(value)), "bars"]}
                labelFormatter={(_label, payload) => {
                  const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return bin ? `${fmt(bin.lower, 3)} to ${fmt(bin.upper, 3)} (range ${fmt(Math.exp(bin.lower), 3)} to ${fmt(Math.exp(bin.upper), 3)} pts)` : "";
                }}
              />
              {volatility.histogramMedian !== null && <ReferenceLine x={volatility.histogramMedian} stroke={OKABE.orange} strokeDasharray="4 3" label={{ value: "median", fill: OKABE.orange, fontSize: 9, position: "top" }} />}
              {floorShown && <ReferenceLine x={ZERO_RANGE_FLOOR} stroke={OKABE.vermillion} label={{ value: "floor log(1e-9)", fill: OKABE.vermillion, fontSize: 9, position: "insideTopRight" }} />}
              <Bar dataKey="count" fill={OKABE.sky} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            {controls.policy === "floored"
              ? <>The zero-range spike is a real one-minute event: {summary ? fmtInt(summary.zero_range_bar_count) : "—"} bars floored to log(1e-9) = {fmt(ZERO_RANGE_FLOOR, 1)}, {summary ? fmt(summary.floor_distance_in_standard_deviations, 1) : "—"} standard deviations from the mean. Mask them in volatility_labels.py instead of flooring (applied: mask_zero_range defaults to True).</>
              : <>Masked, the target is close to symmetric (compare the skewness and kurtosis columns to the floored ones): the floor was the whole left tail.</>}
          </Finding>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">The eight numbers of the contemporaneous log-range ({controls.policy})</h4>
          {volatility.eight ? <SummaryTable columns={[{ name: `log-range, ${controls.policy}`, summary: volatility.eight, decimals: 4 }]} /> : <p className="text-xs text-neutral-500">Not served.</p>}
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Persistence baseline R² against the next bar's log-range, per λ</h4>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={baselines} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="factor" {...AXIS} tickFormatter={(value: string) => `λ ${value}`} />
              <YAxis domain={[0, 1]} tickFormatter={(value: number) => value.toFixed(1)} {...AXIS} width={32} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), name === "floored" ? "▼ floored R²" : "▲ masked R²"]} labelFormatter={(value) => `λ = ${value}`} />
              <ChartLegend wrapperStyle={{ fontSize: 10 }} formatter={(value) => (value === "floored" ? "▼ floored zero-range bars (pre-fix)" : "▲ masked zero-range bars")} />
              <Bar dataKey="floored" name="floored" fill={OKABE.vermillion} isAnimationActive={false}>
                {baselines.map((row) => <Cell key={row.factor} fillOpacity={row.factor === controls.smoothing ? 1 : 0.55} />)}
                <LabelList dataKey="floored" position="top" formatter={(value: number) => fmt(value, 3)} fill="#a3a3a3" fontSize={9} />
              </Bar>
              <Bar dataKey="masked" name="masked" fill={OKABE.sky} isAnimationActive={false}>
                {baselines.map((row) => <Cell key={row.factor} fillOpacity={row.factor === controls.smoothing ? 1 : 0.55} />)}
                <LabelList dataKey="masked" position="top" formatter={(value: number) => fmt(value, 3)} fill="#a3a3a3" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {summary && (
            <Finding>
              The best floored baseline is λ = {fmt(summary.best_floored_smoothing_factor, 2)} at R² {fmt(summary.best_floored_r_squared, 4)}; masking the {fmtInt(summary.zero_range_bar_count)} zero-range bars (and their neighbours: {fmtInt(summary.masked_scored_bar_count)} bars scored) lifts the best to {fmt(summary.best_masked_r_squared, 4)} at λ = {fmt(summary.best_masked_smoothing_factor, 2)}.
              0.451 % of bars cost the baseline {fmt(summary.floor_cost_r_squared, 4)} of R². Make skill over this baseline, not raw R², the objective of every volatility head.
            </Finding>
          )}
        </div>
        <FormulaCard
          tex={"e_t = \\lambda\\, e_{t-1} + (1-\\lambda)\\,\\ell_t, \\qquad R^2 = 1 - \\frac{\\sum_t (\\ell_{t+1} - e_t)^2}{\\sum_t (\\ell_{t+1} - \\bar{\\ell})^2}"}
          caption={`λ = ${controls.smoothing}: R² ${fmt(chosen?.floored, 4)} with zero-range bars floored (${fmtInt(chosen?.flooredCount)} bars), ${fmt(chosen?.masked, 4)} masked (${fmtInt(chosen?.maskedCount)} bars).`}
          symbols={[
            { tex: "t", name: "bar index in the walk-through below", value: current ? `${step} (${fmtTime(current.time)})` : "—" },
            { tex: "\\ell_t", name: "log(high − low) of bar t, points", value: fmt(current?.logRange, 4) },
            { tex: "\\lambda", name: "smoothing factor: weight kept on the previous average", value: controls.smoothing },
            { tex: "e_{t-1}", name: "persistence forecast made at the previous bar", value: fmt(previousForecast, 4) },
            { tex: "e_t", name: "forecast made at bar t for bar t+1", value: fmt(current?.forecast, 4) },
            { tex: "\\ell_{t+1}", name: "what bar t+1 actually did", value: fmt(walk[step + 1]?.logRange, 4) },
            { tex: "\\bar{\\ell}", name: "mean log-range over the scored bars", value: fmt(summary?.log_range_mean, 4) },
            { tex: "R^2", name: `forecast skill over the mean on the whole series (λ ${controls.smoothing}, ${controls.policy})`, value: fmt(controls.policy === "floored" ? chosen?.floored : chosen?.masked, 4) },
          ]}
        />
      </div>

      <div className="mt-3 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">Step the recursion: 120 real bars around the most recent zero-range bar ({controls.policy})</h4>
        <ControlBar>
          <SliderControl label="Bar t" value={step} min={0} max={Math.max(0, walk.length - 1)} onChange={set.sampleStep} format={(value) => String(value)} hint="Move t and watch the formula's symbols take this bar's values" />
        </ControlBar>
        <Legend items={[
          { glyph: "━", label: "ℓ_t log-range of the bar", color: OKABE.sky },
          { glyph: "┅", label: `e_t forecast, λ ${controls.smoothing}`, color: OKABE.orange },
          { glyph: "✕", label: `zero-range bar (${zeroInSample} here)`, color: OKABE.vermillion },
          { glyph: "│", label: "bar t", color: OKABE.purple },
        ]} />
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={walk} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="index" type="number" domain={[0, Math.max(1, walk.length - 1)]} {...AXIS} />
            <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmt(value, 1)} />
            <Tooltip {...TOOLTIP} labelFormatter={(value) => { const point = walk[Number(value)]; return point ? `t = ${value} · ${fmtTime(point.time)}` : ""; }} formatter={(value, name) => [fmt(Number(value), 4), name === "logRange" ? "ℓ_t" : name === "forecast" ? "e_t" : "zero-range ℓ_t"]} />
            <ReferenceLine x={step} stroke={OKABE.purple} />
            <Line dataKey="logRange" stroke={OKABE.sky} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="forecast" stroke={OKABE.orange} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Scatter dataKey="zero" fill={OKABE.vermillion} shape="cross" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Finding>
          On these 120 bars the λ {controls.smoothing} forecast scores R² {fmt(sampleScore, 4)} against the next bar{controls.policy === "floored" ? "; one floored bar drags the forecast down for dozens of bars after it, which is the mechanism behind the whole-series gap" : "; with the zero-range bar masked the forecast carries straight across it"}.
        </Finding>
      </div>
    </Section>
  );
}
