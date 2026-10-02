/**
 * The conversion as a thing to operate: drag a volatility value (or a head's
 * z-score) and read the bar it means in points, ticks, dollars and percent of
 * price — median, average and the outcome band — plus the same value moved to
 * another bar length by the fitted power law. Every number is computed here
 * from the handler's per-timeframe constants; nothing is re-fetched.
 */

import { FormulaCard, SegmentControl, SelectControl, SliderControl, ControlBar } from "@/studies/kit";
import {
  TIMEFRAME_MINUTES, logRangeToPoints, logRangeToQuantilePoints, standardizedToLogRange,
  type JensenRow, type Instrument, type Scaling, type SummaryRow, type Timeframe,
} from "@shared/studies/volatility-to-price-range";
import { TIMEFRAME_COLOR, fixed, signed, timeframeLabel } from "./style";

export interface CalculatorProps {
  instrument: Instrument;
  timeframe: Timeframe;
  timeframes: readonly Timeframe[];
  summary: readonly SummaryRow[];
  jensen: readonly JensenRow[];
  scaling: Scaling | null;
  lastClose: number;
  gridLow: number;
  gridHigh: number;
  lowerQuantile: number;
  upperQuantile: number;
  mode: "log" | "z";
  value: number;
  target: Timeframe;
  onMode: (mode: "log" | "z") => void;
  onValue: (value: number) => void;
  onTimeframe: (timeframe: Timeframe) => void;
  onTarget: (timeframe: Timeframe) => void;
}

/** The volatility value the calculator's control stands for. */
export function calculatorLogRange(mode: "log" | "z", value: number, row: SummaryRow | undefined): number {
  if (mode === "log") return value;
  return row ? standardizedToLogRange(value, row.meanLogRange, row.standardDeviationLogRange) : Number.NaN;
}

function Readout({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-neutral-900 py-0.5 text-[11px]" title={hint}>
      <span className="text-neutral-400">{label}</span>
      <span className="font-mono tnum" style={{ color: tone ?? "#e5e5e5" }}>{value}</span>
    </div>
  );
}

export function Calculator(props: CalculatorProps) {
  const { instrument, timeframe, summary, jensen, scaling, lowerQuantile, upperQuantile } = props;
  const row = summary.find((entry) => entry.timeframe === timeframe);
  const jensenRow = jensen.find((entry) => entry.timeframe === timeframe);
  const sigma = row?.residualSigma ?? 0;
  const v = calculatorLogRange(props.mode, props.value, row);
  const medianPoints = logRangeToPoints(v);
  const meanLognormal = logRangeToPoints(v, sigma, "mean");
  const meanMeasured = medianPoints * (jensenRow?.measuredFactor ?? Number.NaN);
  const lowerPoints = logRangeToQuantilePoints(v, sigma, lowerQuantile);
  const upperPoints = logRangeToQuantilePoints(v, sigma, upperQuantile);
  const exponent = scaling?.exponentOnMean ?? 0.5;
  const targetV = v + exponent * Math.log(TIMEFRAME_MINUTES[props.target] / TIMEFRAME_MINUTES[timeframe]);
  const targetPoints = logRangeToPoints(targetV);
  const lowerLabel = `${Math.round(lowerQuantile * 100)}th percentile bar`;
  const upperLabel = `${Math.round(upperQuantile * 100)}th percentile bar`;

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Input" value={props.mode} options={[{ value: "log", label: "volatility value v" }, { value: "z", label: "head z-score" }]} onChange={props.onMode} />
        {props.mode === "log" ? (
          <SliderControl label="v = ln(high − low)" value={props.value} min={Math.floor(props.gridLow * 10) / 10} max={Math.ceil(props.gridHigh * 10) / 10} step={0.01} onChange={props.onValue} format={(value) => fixed(value, 2)} />
        ) : (
          <SliderControl label="z-score" value={props.value} min={-4} max={4} step={0.05} onChange={props.onValue} format={(value) => signed(value, 2)} hint="What a head trained on a z-scored target emits" />
        )}
        <SelectControl label="Bar length" value={timeframe} options={props.timeframes.map((entry) => ({ value: entry, label: timeframeLabel(entry) }))} onChange={(value) => props.onTimeframe(value as Timeframe)} />
        <SelectControl label="Move to bar length" value={props.target} options={props.timeframes.map((entry) => ({ value: entry, label: timeframeLabel(entry) }))} onChange={(value) => props.onTarget(value as Timeframe)} />
      </ControlBar>

      <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
        <div className="space-y-2 min-w-0">
          <FormulaCard
            tex={"R_{\\text{points}} = e^{v}, \\qquad R_{\\$} = e^{v}\\cdot P, \\qquad R_{\\text{ticks}} = \\frac{e^{v}}{\\tau}"}
            caption={`Exact arithmetic, not a fit: v is a ${instrument.symbol} range with a logarithm taken.`}
            symbols={[
              { tex: "v", name: "volatility value: natural log of the bar's high − low, in points", value: fixed(v, 4) },
              { tex: "e^{v}", name: "the range that value means: the MEDIAN bar, points", value: fixed(medianPoints, 3) },
              { tex: "P", name: `point value, dollars per point per contract (cost_model.json)`, value: `$${fixed(instrument.pointValue, 2)}` },
              { tex: "\\tau", name: "tick size, points per tick", value: fixed(instrument.tickSize, 2) },
              { tex: "R_{\\$}", name: "the range in dollars per contract", value: `$${fixed(medianPoints * instrument.pointValue, 2)}` },
              { tex: "R_{\\text{ticks}}", name: "the range in ticks", value: fixed(medianPoints / instrument.tickSize, 1) },
            ]}
          />
          {props.mode === "z" && (
            <FormulaCard
              tex={"v = z\\,\\sigma_{\\text{train}} + \\mu_{\\text{train}}"}
              caption="A head trained on a z-scored target emits z; e^z means nothing until it is un-standardised. The window's own mean and spread stand in for the train slice here."
              symbols={[
                { tex: "z", name: "the head's output, standard deviations from the mean", value: signed(props.value, 2) },
                { tex: "\\sigma_{\\text{train}}", name: `standard deviation of log-range, ${timeframe}`, value: fixed(row?.standardDeviationLogRange, 4) },
                { tex: "\\mu_{\\text{train}}", name: `mean log-range, ${timeframe}`, value: fixed(row?.meanLogRange, 4) },
                { tex: "v", name: "the volatility value recovered", value: fixed(v, 4) },
              ]}
            />
          )}
        </div>
        <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
          <div className="mb-1 text-[11px] font-semibold" style={{ color: TIMEFRAME_COLOR[timeframe] }}>
            {timeframeLabel(timeframe)} bar at v = {fixed(v, 3)}
          </div>
          <Readout label="median bar, points" value={fixed(medianPoints, 2)} />
          <Readout label="median bar, ticks" value={fixed(medianPoints / instrument.tickSize, 1)} />
          <Readout label="median bar, dollars per contract" value={`$${fixed(medianPoints * instrument.pointValue, 2)}`} />
          <Readout label="median bar, percent of last close" value={`${fixed((100 * medianPoints) / props.lastClose, 4)}%`} hint={`last close ${fixed(props.lastClose, 2)}`} />
          <Readout label="average bar, lognormal e^(v + s²/2)" value={`${fixed(meanLognormal, 2)} pts · $${fixed(meanLognormal * instrument.pointValue, 2)}`} hint={`s = ${fixed(sigma, 4)}`} />
          <Readout label="average bar, measured factor" value={`${fixed(meanMeasured, 2)} pts · $${fixed(meanMeasured * instrument.pointValue, 2)}`} tone="#E69F00" hint="e^v × the median mean-over-median across this timeframe's volatility bins" />
          <Readout label={lowerLabel} value={`${fixed(lowerPoints, 2)} pts · $${fixed(lowerPoints * instrument.pointValue, 2)}`} />
          <Readout label={upperLabel} value={`${fixed(upperPoints, 2)} pts · $${fixed(upperPoints * instrument.pointValue, 2)}`} hint="The number a stop has to survive" />
          <Readout label="+0.10 in v" value={`+${fixed((Math.exp(0.1) - 1) * 100, 1)}% · +$${fixed(medianPoints * (Math.exp(0.1) - 1) * instrument.pointValue, 2)}`} />
          <Readout
            label={`same value moved to ${props.target}: v + H·ln(${TIMEFRAME_MINUTES[props.target]}/${TIMEFRAME_MINUTES[timeframe]})`}
            value={`v ${fixed(targetV, 3)} → ${fixed(targetPoints, 2)} pts · $${fixed(targetPoints * instrument.pointValue, 2)}`}
            tone={TIMEFRAME_COLOR[props.target]}
            hint={`H = ${fixed(exponent, 4)}`}
          />
        </div>
      </div>
    </div>
  );
}
