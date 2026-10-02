/**
 * Volatility value to price range. The server reads the bars and runs the
 * whole notebook (EWMA, calibration, fits) for the controls in the top bar;
 * the timeframe picker, the timeframe toggles, the calculator, the lag and
 * bin steppers and the per-column graphics work in the browser on what came back.
 */

import {
  ColumnGrid, ControlBar, Empty, Finding, FormulaCard, Section, SegmentControl, SelectControl, SliderControl, Stat,
  StudyNotes, StudyState, SwitchControl, OKABE, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  TIMEFRAMES, TIMEFRAME_MINUTES, inverseNormal, sampleRows,
  type CalibrationBin, type DistributionRow, type LadderRow, type LoadRow, type ResidualRow, type ScalingRow, type SummaryRow,
  type Timeframe, type VolatilityStudyBody, type JensenRow, type BiasRow,
} from "@shared/studies/volatility-to-price-range";
import { BandChart, BiasChart, CalibrationPanels, CurveChart, EwmaWeights, JensenChart, QuantilePanels, ScalingCharts } from "./charts";
import { Calculator, calculatorLogRange } from "./Calculator";
import { DataTable, HeatTable, type Column } from "./tables";
import { DateField, TimeframeToggles, parseShown, useSettled } from "./inputs";
import { TIMEFRAME_COLOR, day, fixed, signed, timeframeLabel } from "./style";

const SLUG = "volatility-to-price-range";

function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

function tfCell<Row extends { timeframe: Timeframe }>(): Column<Row> {
  return {
    key: "timeframe",
    label: "timeframe",
    align: "left",
    value: (row) => TIMEFRAMES.indexOf(row.timeframe),
    render: (row) => <span style={{ color: TIMEFRAME_COLOR[row.timeframe] }}>{timeframeLabel(row.timeframe)}</span>,
  };
}

function numberColumn<Row>(key: string, label: string, pick: (row: Row) => number, decimals: number, hint?: string): Column<Row> {
  return { key, label, hint, value: (row) => (Number.isFinite(pick(row)) ? pick(row) : null), render: (row) => fixed(pick(row), decimals) };
}

function spread(values: number[]): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return "—";
  return `${fixed(Math.min(...finite), 2)} to ${fixed(Math.max(...finite), 2)}`;
}

function isMonotoneRising(values: number[]): boolean {
  return values.length > 1 && values.every((value, index) => index === 0 || value >= (values[index - 1] as number));
}

const LOAD_COLUMNS: Array<Column<LoadRow>> = [
  tfCell<LoadRow>(),
  { key: "source", label: "read from", align: "left", value: (row) => row.source },
  numberColumn("bars", "bars", (row) => row.barCount, 0),
  numberColumn("zero", "zero-range bars masked", (row) => row.zeroRangeBarCount, 0, "high = low: ln would be −∞, so the bar is left out rather than floored to ln(1e−9)"),
  numberColumn("labels", "forward labels", (row) => row.forwardLabelCount, 0, "bars whose next bar has a finite log-range"),
  numberColumn("gap", "labels dropped at gaps", (row) => row.gapLabelCount, 0),
  { key: "first", label: "first bar", value: (row) => row.firstBar, render: (row) => day(row.firstBar) },
  { key: "last", label: "last bar", value: (row) => row.lastBar, render: (row) => day(row.lastBar) },
  numberColumn("close", "last close", (row) => row.lastClose, 2),
];

const DISTRIBUTION_COLUMNS: Array<Column<DistributionRow>> = [
  tfCell<DistributionRow>(),
  { key: "series", label: "series", align: "left", value: (row) => row.series, render: (row) => (row.series === "range_points" ? "range, points" : "log-range") },
  numberColumn("count", "count", (row) => row.count, 0),
  numberColumn("mean", "mean", (row) => row.mean, 4),
  numberColumn("median", "median", (row) => row.median, 4),
  numberColumn("sd", "standard deviation", (row) => row.standardDeviation, 4),
  numberColumn("skew", "skewness", (row) => row.skewness, 4),
  numberColumn("kurt", "excess kurtosis", (row) => row.excessKurtosis, 4),
  numberColumn("p25", "25th percentile", (row) => row.percentile25, 4),
  numberColumn("p75", "75th percentile", (row) => row.percentile75, 4),
  numberColumn("min", "minimum", (row) => row.minimum, 4),
  numberColumn("max", "maximum", (row) => row.maximum, 4),
];

const RESIDUAL_COLUMNS: Array<Column<ResidualRow>> = [
  tfCell<ResidualRow>(),
  numberColumn("sigma", "residual σ, log units", (row) => row.residualSigma, 4, "standard deviation of next-bar log-range minus the EWMA forecast"),
  numberColumn("jensen", "Jensen factor e^(σ²/2)", (row) => row.jensenFactor, 4),
  numberColumn("wider", "average bar wider than median, %", (row) => row.meanBarWiderPercent, 2),
  numberColumn("pairs", "pairs fitted", (row) => row.fittedPairCount, 0),
];

function ladderColumns(lowerQuantile: number, upperQuantile: number): Array<Column<LadderRow>> {
  const low = Math.round(lowerQuantile * 100);
  const high = Math.round(upperQuantile * 100);
  return [
    { key: "percentile", label: "volatility percentile", align: "left", value: (row) => row.percentile, render: (row) => row.percentileLabel },
    numberColumn("v", "log-range v", (row) => row.logRange, 3),
    numberColumn("medianPoints", "median, points", (row) => row.medianPoints, 2),
    numberColumn("meanPoints", "average, points", (row) => row.meanPoints, 2),
    numberColumn("ticks", "median, ticks", (row) => row.medianTicks, 1),
    numberColumn("medianUsd", "median, dollars", (row) => row.medianUsd, 2),
    numberColumn("meanUsd", "average, dollars", (row) => row.meanUsd, 2),
    numberColumn("lowPoints", `${low}th percentile, points`, (row) => row.lowerQuantilePoints, 2),
    numberColumn("lowUsd", `${low}th percentile, dollars`, (row) => row.lowerQuantileUsd, 2),
    numberColumn("highPoints", `${high}th percentile, points`, (row) => row.upperQuantilePoints, 2),
    numberColumn("highUsd", `${high}th percentile, dollars`, (row) => row.upperQuantileUsd, 2),
    numberColumn("pct", "median, % of price", (row) => row.medianPercentOfPrice, 4),
  ];
}

const CALIBRATION_COLUMNS: Array<Column<CalibrationBin>> = [
  { key: "bin", label: "bin", align: "left", value: (row) => row.bin, render: (row) => String(row.bin + 1) },
  numberColumn("vmean", "forecast mean v", (row) => row.volatilityMean, 4),
  numberColumn("analytic", "analytic median, points", (row) => row.analyticMedianPoints, 3, "e^(bin mean forecast)"),
  numberColumn("n", "bars", (row) => row.rangeCount, 0),
  numberColumn("mean", "realised mean", (row) => row.rangeMean, 3),
  numberColumn("median", "realised median", (row) => row.rangeMedian, 3),
  numberColumn("sd", "standard deviation", (row) => row.rangeStandardDeviation, 3),
  numberColumn("skew", "skewness", (row) => row.rangeSkewness, 3),
  numberColumn("kurt", "excess kurtosis", (row) => row.rangeExcessKurtosis, 2),
  numberColumn("p25", "25th percentile", (row) => row.rangePercentile25, 2),
  numberColumn("p75", "75th percentile", (row) => row.rangePercentile75, 2),
  numberColumn("min", "minimum", (row) => row.rangeMinimum, 2),
  numberColumn("max", "maximum", (row) => row.rangeMaximum, 2),
  numberColumn("medianUsd", "median, dollars", (row) => row.rangeMedianUsd, 2),
  numberColumn("meanUsd", "mean, dollars", (row) => row.rangeMeanUsd, 2),
  numberColumn("ratio", "mean ÷ median", (row) => row.meanOverMedian, 4),
  numberColumn("bias", "bias, %", (row) => row.biasPercent, 3, "(analytic ÷ realised median − 1) × 100"),
];

const BIAS_COLUMNS: Array<Column<BiasRow>> = [
  tfCell<BiasRow>(),
  numberColumn("median", "median bias, %", (row) => row.medianBiasPercent, 3),
  numberColumn("min", "smallest bin bias, %", (row) => row.minimumBiasPercent, 3),
  numberColumn("max", "largest bin bias, %", (row) => row.maximumBiasPercent, 3),
  numberColumn("n", "bars per bin", (row) => row.barsPerBin, 0),
];

const JENSEN_COLUMNS: Array<Column<JensenRow>> = [
  tfCell<JensenRow>(),
  numberColumn("sigma", "residual σ", (row) => row.residualSigma, 4),
  numberColumn("lognormal", "lognormal factor", (row) => row.lognormalFactor, 4),
  numberColumn("measured", "measured factor", (row) => row.measuredFactor, 4),
  numberColumn("under", "understated by, %", (row) => row.understatedByPercent, 2),
  numberColumn("kmed", "median bin excess kurtosis", (row) => row.medianBinExcessKurtosis, 1),
  numberColumn("kmax", "largest bin excess kurtosis", (row) => row.maximumBinExcessKurtosis, 1),
];

function scalingColumns(exponent: number): Array<Column<ScalingRow>> {
  return [
    tfCell<ScalingRow>(),
    numberColumn("minutes", "minutes", (row) => row.minutes, 0),
    numberColumn("measured", "measured median, points", (row) => row.measuredMedianPoints, 2),
    numberColumn("root", "T^0.500 prediction", (row) => row.predictedSquareRootPoints, 2, "1m median × √minutes"),
    numberColumn("rootError", "error, %", (row) => row.errorSquareRootPercent, 2),
    numberColumn("fitted", `T^${fixed(exponent, 3)} prediction`, (row) => row.predictedFittedPoints, 2, "e^c · minutes^H from the fit on ln(median)"),
    numberColumn("fittedError", "error, %", (row) => row.errorFittedPercent, 2),
    numberColumn("sd", "sd of log-range", (row) => row.standardDeviationLogRange, 4),
  ];
}

const SUMMARY_COLUMNS: Array<Column<SummaryRow>> = [
  tfCell<SummaryRow>(),
  numberColumn("bars", "bars", (row) => row.barCount, 0),
  numberColumn("meanV", "mean v", (row) => row.meanLogRange, 4),
  numberColumn("sdV", "sd of v", (row) => row.standardDeviationLogRange, 4),
  numberColumn("medianPoints", "median, points", (row) => row.medianPoints, 2),
  numberColumn("meanPoints", "mean, points", (row) => row.meanPoints, 2),
  numberColumn("medianUsd", "median, dollars", (row) => row.medianUsd, 2),
  numberColumn("meanUsd", "mean, dollars", (row) => row.meanUsd, 2),
  numberColumn("ticks", "median, ticks", (row) => row.medianTicks, 0),
  numberColumn("pct", "median, % of price", (row) => row.medianPercentOfPrice, 4),
  numberColumn("sigma", "residual σ", (row) => row.residualSigma, 4),
  numberColumn("jensen", "Jensen factor", (row) => row.jensenFactor, 4),
  numberColumn("tenth", "dollars per +0.10 of v at the median", (row) => row.usdPerTenthOfVolatilityAtMedian, 2),
];

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    symbol: "MNQ",
    start: "2025-09-25",
    end: "",
    lambda: 0.94,
    bins: 10,
    lowerQuantile: 0.1,
    sigmaFit: "window",
    trainFraction: 0.7,
    gapRule: false,
    gapMultiple: 3,
    qqPoints: 1000,
    timeframe: "1m",
    target: "1h",
    shown: "1m,5m,15m,30m,45m,1h",
    distribution: "log_range",
    calcMode: "log",
    calcValue: 2,
    lag: 5,
    pickedBin: 1,
  });

  const serverText = JSON.stringify({
    symbol: controls.symbol,
    start: controls.start,
    end: controls.end,
    lambda: controls.lambda,
    bins: controls.bins,
    lowerQuantile: controls.lowerQuantile,
    sigmaFit: controls.sigmaFit,
    trainFraction: controls.trainFraction,
    gapRule: String(controls.gapRule),
    gapMultiple: controls.gapMultiple,
    qqPoints: controls.qqPoints,
  });
  const serverControls = JSON.parse(useSettled(serverText)) as Record<string, string | number>;
  const query = useStudyQuery<VolatilityStudyBody>(SLUG, serverControls);
  const body = query.data?.data;

  const timeframe: Timeframe = isTimeframe(controls.timeframe) ? controls.timeframe : "1m";
  const target: Timeframe = isTimeframe(controls.target) ? controls.target : "1h";
  const shown = parseShown(controls.shown);
  const available = body?.timeframes ?? [];
  const activeTimeframe: Timeframe = available.includes(timeframe) ? timeframe : (available[0] ?? "1m");
  const binCount = body?.parameters.binCount ?? controls.bins;
  const pickedBin = Math.min(Math.max(1, controls.pickedBin), binCount);
  const lowerQuantile = body?.parameters.lowerQuantile ?? controls.lowerQuantile;
  const upperQuantile = body?.parameters.upperQuantile ?? 1 - controls.lowerQuantile;
  const pointValue = body?.instrument.pointValue ?? 2;

  const summaryOf = (entry: Timeframe) => body?.summary.find((row) => row.timeframe === entry);
  const residualOf = (entry: Timeframe) => body?.residuals.find((row) => row.timeframe === entry);
  const biasOf = (entry: Timeframe) => body?.bias.find((row) => row.timeframe === entry);
  const loadOf = (entry: Timeframe) => body?.load.find((row) => row.timeframe === entry);
  const active = summaryOf(activeTimeframe);
  const activeLoad = loadOf(activeTimeframe);
  const calcRange = calculatorLogRange(controls.calcMode === "z" ? "z" : "log", controls.calcValue, active);

  const rangeRows = body?.distributions.filter((row) => row.series === "range_points") ?? [];
  const logRows = body?.distributions.filter((row) => row.series === "log_range") ?? [];
  const distributionRows = body?.distributions.filter((row) => row.series === controls.distribution) ?? [];

  const activeCalibration = body?.calibration.filter((row) => row.timeframe === activeTimeframe) ?? [];
  const pickedCalibration = activeCalibration.find((row) => row.bin + 1 === pickedBin);
  const ladderRows = body?.ladder.filter((row) => row.timeframe === activeTimeframe) ?? [];
  const percentileLabels = [...new Set(body?.ladder.map((row) => row.percentileLabel) ?? [])];
  const usdMatrix = percentileLabels.map((label) =>
    available.map((entry) => body?.ladder.find((row) => row.timeframe === entry && row.percentileLabel === label)?.medianUsd ?? null),
  );

  const jensenRows = body?.jensen ?? [];
  const understated = jensenRows.map((row) => row.understatedByPercent);
  const residualSigmas = body?.residuals.map((row) => row.residualSigma) ?? [];
  const firstBand = residualOf(available[0] ?? "1m");
  const lastBand = residualOf(available[available.length - 1] ?? "1h");
  const zUpper = inverseNormal(upperQuantile);
  const zLower = inverseNormal(lowerQuantile);
  const bandWidth = (sigma: number | undefined) => (sigma === undefined ? Number.NaN : Math.exp(sigma * zUpper) / Math.exp(sigma * zLower));
  const scaling = body?.scaling ?? null;
  const sdValues = scaling?.rows.map((row) => row.standardDeviationLogRange) ?? [];
  const minuteSpan = scaling && scaling.rows.length > 1 ? Math.max(...scaling.rows.map((row) => row.minutes)) / Math.min(...scaling.rows.map((row) => row.minutes)) : Number.NaN;
  const sample = body?.samples.find((frame) => frame.timeframe === activeTimeframe);
  const sampleFrame = sample ? sampleRows(sample) : [];
  const pickedSigma = residualOf(activeTimeframe)?.residualSigma ?? Number.NaN;
  const pickedJensen = jensenRows.find((row) => row.timeframe === activeTimeframe);
  const firstPrice = body?.load[0]?.lastClose;

  const timeframeOptions = (available.length > 0 ? available : [...TIMEFRAMES]).map((entry) => ({ value: entry, label: timeframeLabel(entry) }));

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <ControlBar onReset={reset}>
          <SelectControl
            label="Symbol"
            value={controls.symbol}
            options={(body?.availableSymbols.length ? body.availableSymbols : [controls.symbol]).map((symbol) => ({ value: symbol, label: symbol }))}
            onChange={(value) => set("symbol", value)}
            hint="Roots from cost_model.json that have bars in the views"
          />
          <DateField label="Window start" value={controls.start} min="2023-01-01" onChange={(value) => set("start", value)} hint="The notebook used 2025-09-25, about three months" />
          <DateField label="Window end" value={controls.end} allowEmpty onChange={(value) => set("end", value)} hint="Empty reads to the latest bar" />
          <SliderControl label="EWMA λ" value={controls.lambda} min={0.8} max={0.99} step={0.01} onChange={(value) => set("lambda", value)} format={(value) => fixed(value, 2)} hint="RiskMetrics decay of the persistence forecast (notebook 0.94)" />
          <SliderControl label="Volatility bins" value={controls.bins} min={5} max={20} onChange={(value) => set("bins", value)} hint="Equal-count bins of the forecast in the calibration" />
          <SliderControl
            label="Outcome band"
            value={controls.lowerQuantile}
            min={0.02}
            max={0.4}
            step={0.01}
            onChange={(value) => set("lowerQuantile", value)}
            format={(value) => `${Math.round(value * 100)}th–${Math.round((1 - value) * 100)}th`}
            hint="The quantile pair of the band around a forecast (notebook 10th–90th)"
          />
          <SegmentControl label="σ fitted on" value={controls.sigmaFit} options={[{ value: "window", label: "whole window" }, { value: "train", label: "first part only" }]} onChange={(value) => set("sigmaFit", value)} hint="The notebook fits σ on every bar it then converts" />
          {controls.sigmaFit === "train" && (
            <SliderControl label="First part" value={controls.trainFraction} min={0.3} max={0.9} step={0.05} onChange={(value) => set("trainFraction", value)} format={(value) => `${Math.round(value * 100)}%`} />
          )}
          <SwitchControl label="Drop labels across session gaps" checked={controls.gapRule} onChange={(value) => set("gapRule", value)} hint="A next bar after a break is not the next bar; the notebook keeps them" />
          {controls.gapRule && (
            <SliderControl label="Gap = more than" value={controls.gapMultiple} min={1.5} max={20} step={0.5} onChange={(value) => set("gapMultiple", value)} format={(value) => `${fixed(value, 1)} × typical`} />
          )}
          <SliderControl label="Q-Q points" value={controls.qqPoints} min={200} max={3000} step={100} onChange={(value) => set("qqPoints", value)} hint="Quantile positions per panel (notebook 3,000)" />
        </ControlBar>

        {!body || body.timeframes.length === 0 ? (
          <Empty>No bars for this symbol and window, so there is nothing to convert. The notes above say which views were read.</Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-6">
              <Stat label="Point value" value={`$${fixed(body.instrument.pointValue, 2)}`} hint={`${body.instrument.symbol}, cost_model.json`} />
              <Stat label="Tick" value={`${fixed(body.instrument.tickSize, 2)} pt = $${fixed(body.instrument.tickValue, 2)}`} />
              <Stat label={`${activeTimeframe} bars`} value={fmtInt(activeLoad?.barCount)} hint={`${day(activeLoad?.firstBar ?? Number.NaN)} to ${day(activeLoad?.lastBar ?? Number.NaN)}`} />
              <Stat label={`${activeTimeframe} median bar`} value={`$${fixed(active?.medianUsd, 2)}`} hint={`${fixed(active?.medianPoints, 2)} points`} />
              <Stat label="Exponent H" value={fixed(scaling?.exponentOnMean, 4)} hint="range ∝ T^H; 0.5 is square root of time" tone={OKABE.orange} />
              <Stat label={`${activeTimeframe} median bias`} value={`${signed(biasOf(activeTimeframe)?.medianBiasPercent, 2)}%`} hint="how far e^v sits above the realised median" />
            </div>

            <ControlBar>
              <SelectControl label="Inspect a timeframe" value={activeTimeframe} options={timeframeOptions} onChange={(value) => set("timeframe", value)} hint="Drives the ladder, calibration table, calculator and per-column graphics" />
              <TimeframeToggles shown={shown} available={available} onChange={(value) => set("shown", value)} />
            </ControlBar>

            <Section title="The conversion" question="Drag a volatility value and read the bar it means. e^v is exact; the two corrections below are measured.">
              <Calculator
                instrument={body.instrument}
                timeframe={activeTimeframe}
                timeframes={available}
                summary={body.summary}
                jensen={body.jensen}
                scaling={scaling}
                lastClose={activeLoad?.lastClose ?? Number.NaN}
                gridLow={body.curve.gridLow}
                gridHigh={body.curve.gridHigh}
                lowerQuantile={lowerQuantile}
                upperQuantile={upperQuantile}
                mode={controls.calcMode === "z" ? "z" : "log"}
                value={controls.calcValue}
                target={target}
                onMode={(mode) => set("calcMode", mode)}
                onValue={(value) => set("calcValue", value)}
                onTimeframe={(value) => set("timeframe", value)}
                onTarget={(value) => set("target", value)}
              />
              <Finding>
                The relationship is multiplicative, so there is no fixed “points per unit of volatility”: +1.00 in v is {fixed(Math.E, 3)}× the range at any level, and +0.10 is +{fixed((Math.exp(0.1) - 1) * 100, 1)}% —
                on the {activeTimeframe} median bar that is ${fixed(active?.usdPerTenthOfVolatilityAtMedian, 2)} per contract.
              </Finding>
            </Section>

            <Section title="1. The bars and the volatility series" question="ln(high − low) per bar, zero-range bars masked rather than floored (ln(1e−9) would sit about 12.7 standard deviations from the mean).">
              <DataTable rows={body.load} columns={LOAD_COLUMNS} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
              <div className="mt-3">
                <ColumnGrid rows={sampleFrame} exclude={["timestamp"]} title={`Every column of the ${activeTimeframe} frame (evenly thinned to ${fmtInt(sampleFrame.length)} of ${fmtInt(sample?.totalBars)} bars; the exact nine statistics are in section 2)`} />
              </div>
            </Section>

            <Section title="2. Why the conversion is done in logs" question="Nine statistics of the range and of its logarithm per timeframe, and the log-range against the normal it is assumed to be.">
              <ControlBar>
                <SegmentControl label="Series" value={controls.distribution} options={[{ value: "log_range", label: "log-range" }, { value: "range_points", label: "range, points" }]} onChange={(value) => set("distribution", value)} />
              </ControlBar>
              <DataTable rows={distributionRows} columns={DISTRIBUTION_COLUMNS} rowKey={(row) => `${row.timeframe}-${row.series}`} highlight={(row) => row.timeframe === activeTimeframe} />
              <Finding>
                The range in points is right-skewed with fat tails (skewness {spread(rangeRows.map((row) => row.skewness))}, excess kurtosis {spread(rangeRows.map((row) => row.excessKurtosis))}), while its logarithm is nearly symmetric and near-mesokurtic
                (skewness {spread(logRows.map((row) => row.skewness))}, excess kurtosis {spread(logRows.map((row) => row.excessKurtosis))}). That is what licenses the lognormal conversion — and why e^(forecast) returns the median, not the mean.
              </Finding>
              <div className="mt-2">
                <QuantilePanels plots={body.quantilePlots} shown={shown} />
              </div>
              <Finding>
                <span style={{ color: OKABE.orange }}>Fix:</span> convert with e^v on the log-range scale at every timeframe; take the mean-versus-median correction from section 4b, not from this fit. Dashed line = perfect agreement with the normal.
              </Finding>
            </Section>

            <Section title="3. The conversion ladder" question="Each volatility value: the median bar, the average bar and the outcome band, with the spread a causal EWMA forecaster leaves behind.">
              <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <FormulaCard
                    tex={"\\hat v_{t+1} = \\lambda\\,\\hat v_{t} + (1-\\lambda)\\,v_{t} = (1-\\lambda)\\sum_{k=0}^{\\infty} \\lambda^{k}\\, v_{t-k}"}
                    caption={`Step the lag: bar t − ${controls.lag} gets weight ${fixed((1 - controls.lambda) * controls.lambda ** controls.lag, 5)}; bars up to it carry ${fixed((1 - controls.lambda ** (controls.lag + 1)) * 100, 1)}% of the forecast. Effective memory 1 ÷ (1 − λ) = ${fixed(1 / (1 - controls.lambda), 1)} bars.`}
                    symbols={[
                      { tex: "\\hat v_{t+1}", name: "forecast of the next bar's log-range, made at bar t", value: "—" },
                      { tex: "\\lambda", name: "decay: how much of yesterday's average survives", value: fixed(controls.lambda, 2) },
                      { tex: "v_{t-k}", name: "log-range of the bar k bars back", value: `k = ${controls.lag}` },
                      { tex: "(1-\\lambda)\\lambda^{k}", name: "that bar's weight in the forecast", value: fixed((1 - controls.lambda) * controls.lambda ** controls.lag, 5) },
                      { tex: "\\sum", name: "sum over every past bar (a missing bar carries the average forward)", value: `${fixed((1 - controls.lambda ** (controls.lag + 1)) * 100, 1)}% by k` },
                    ]}
                  />
                  <ControlBar>
                    <SliderControl label="Lag k" value={controls.lag} min={0} max={60} onChange={(value) => set("lag", value)} />
                  </ControlBar>
                  <EwmaWeights lambda={controls.lambda} lag={controls.lag} lagCount={60} />
                </div>
                <div className="min-w-0 space-y-2">
                  <DataTable rows={body.residuals} columns={RESIDUAL_COLUMNS} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
                  <FormulaCard
                    tex={"\\bar R = e^{\\,v + s^{2}/2}, \\qquad R_{q} = e^{\\,v + s\\,z_{q}}"}
                    caption={`At the calculator's v on ${activeTimeframe}: median ${fixed(Math.exp(calcRange), 2)} points, average ${fixed(Math.exp(calcRange + 0.5 * pickedSigma * pickedSigma), 2)}, band ${fixed(Math.exp(calcRange + pickedSigma * zLower), 2)} to ${fixed(Math.exp(calcRange + pickedSigma * zUpper), 2)}.`}
                    symbols={[
                      { tex: "v", name: "volatility value (the calculator's)", value: fixed(calcRange, 3) },
                      { tex: "s", name: `residual σ of the EWMA forecast, ${activeTimeframe}, log units`, value: fixed(pickedSigma, 4) },
                      { tex: "e^{s^2/2}", name: "Gaussian mean-over-median factor", value: fixed(Math.exp(0.5 * pickedSigma * pickedSigma), 4) },
                      { tex: "z_{q}", name: `standard-normal quantile, q = ${Math.round(upperQuantile * 100)}%`, value: fixed(zUpper, 4) },
                      { tex: "R_{q}", name: `the ${Math.round(upperQuantile * 100)}th-percentile bar, points`, value: fixed(Math.exp(calcRange + pickedSigma * zUpper), 2) },
                    ]}
                  />
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <div className="text-[11px] font-semibold text-neutral-200">Ladder for {timeframeLabel(activeTimeframe)} (reference price: last close {fixed(activeLoad?.lastClose, 2)})</div>
                <DataTable rows={ladderRows} columns={ladderColumns(lowerQuantile, upperQuantile)} rowKey={(row) => row.percentileLabel} />
                <Finding>
                  Read a row as: a volatility value of v on a {activeTimeframe} bar means a typical high-low travel of the median in points (and dollars per contract), with an
                  {` ${Math.round((upperQuantile - lowerQuantile) * 100)}%`} band between the two percentile columns. The percent-of-price column is the one to compare across periods or instruments: the same points bought a very different move at
                  {` ${fixed(firstPrice, 0)}`} than at half that price.
                </Finding>
              </div>
              <div className="mt-3 space-y-1">
                <div className="text-[11px] font-semibold text-neutral-200">Median high-low travel, dollars per contract — the lookup this exists to produce</div>
                <HeatTable
                  corner="volatility percentile"
                  rowLabels={percentileLabels}
                  columnLabels={available.map((entry) => <span key={entry} style={{ color: TIMEFRAME_COLOR[entry] }}>{timeframeLabel(entry)}</span>)}
                  values={usdMatrix}
                  format={(value) => `$${fixed(value, 2)}`}
                  logScale
                  onPick={(_row, column) => {
                    const picked = available[column];
                    if (picked) set("timeframe", picked);
                  }}
                  picked={null}
                />
                <p className="text-[10px] text-neutral-500">Cividis, coloured by the logarithm of the dollars; click a column to inspect that timeframe.</p>
              </div>
              <div className="mt-3 grid gap-3 grid-cols-1 xl:grid-cols-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-neutral-200">One e^v curve, six timeframes: bar length only moves you along it</div>
                  <CurveChart gridLow={body.curve.gridLow} gridHigh={body.curve.gridHigh} spans={body.curve.spans} shown={shown} pointValue={pointValue} marker={calcRange} />
                  <Finding>
                    There is one conversion; the timeframe decides which stretch of it you occupy (thick = 5th to 95th percentile, marker = median).{" "}
                    <span style={{ color: OKABE.orange }}>Fix:</span> convert with the same e^v at every timeframe and read dollars as points × {fixed(pointValue, 2)}; do not keep a separate rule per bar size.
                  </Finding>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-neutral-200">How wide is the outcome band, as a multiple of the median bar?</div>
                  <BandChart spans={body.curve.spans} residuals={body.residuals} shown={shown} lowerQuantile={lowerQuantile} upperQuantile={upperQuantile} />
                  <Finding>
                    The band's top-over-bottom ratio is {fixed(bandWidth(firstBand?.residualSigma), 2)}× on {firstBand?.timeframe} and {fixed(bandWidth(lastBand?.residualSigma), 2)}× on {lastBand?.timeframe}; residual σ runs {spread(residualSigmas)}.{" "}
                    <span style={{ color: OKABE.orange }}>Fix:</span> widen the stop multiple as the bar coarsens.
                  </Finding>
                </div>
              </div>
            </Section>

            <Section title="4. Does the formula hold on real bars?" question="Bin every bar by its causal EWMA forecast and compare e^(bin mean forecast) with the realised NEXT-bar range in the bin.">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-neutral-200">{timeframeLabel(activeTimeframe)} — realised next-bar range by volatility bin (points unless marked)</div>
                <DataTable rows={activeCalibration} columns={CALIBRATION_COLUMNS} rowKey={(row) => String(row.bin)} highlight={(row) => row.bin + 1 === pickedBin} />
              </div>
              <div className="mt-3">
                <CalibrationPanels calibration={body.calibration} shown={shown} pickedBin={pickedBin} />
                <Finding>
                  Dot = realised median, whisker = interquartile range, dashed = predicted equals realised. <span style={{ color: OKABE.orange }}>Fix:</span> subtract the measured bias below before sizing off e^v; the markers sit consistently {(biasOf(activeTimeframe)?.medianBiasPercent ?? 0) >= 0 ? "below" : "above"} the dashed line.
                </Finding>
              </div>
              <div className="mt-3 grid gap-3 grid-cols-1 xl:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <div className="text-[11px] font-semibold text-neutral-200">4a. The bias as a difference: predicted ÷ realised − 1</div>
                  <BiasChart calibration={body.calibration} shown={shown} binCount={binCount} pickedBin={pickedBin} />
                  <DataTable rows={body.bias} columns={BIAS_COLUMNS} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
                  <Finding>
                    Median bias runs {spread(body.bias.map((row) => row.medianBiasPercent))}% across timeframes; the spread between bins widens as bars coarsen, partly because each bin holds fewer bars
                    ({fmtInt(body.bias[0]?.barsPerBin)} on {body.bias[0]?.timeframe} against {fmtInt(body.bias[body.bias.length - 1]?.barsPerBin)} on {body.bias[body.bias.length - 1]?.timeframe}).{" "}
                    <span style={{ color: OKABE.orange }}>Fix:</span> scale e^v down by the per-timeframe median bias before quoting a points or dollar figure.
                  </Finding>
                </div>
                <div className="min-w-0 space-y-2">
                  <ControlBar>
                    <SliderControl label="Step the bin" value={pickedBin} min={1} max={binCount} onChange={(value) => set("pickedBin", value)} />
                  </ControlBar>
                  <FormulaCard
                    tex={"\\text{bias}_{b} = \\left(\\frac{e^{\\,\\bar{\\hat v}_{b}}}{\\tilde R_{b}} - 1\\right)\\times 100"}
                    caption={pickedCalibration ? `${activeTimeframe}, bin ${pickedBin} of ${binCount}: ${fixed(pickedCalibration.analyticMedianPoints, 3)} ÷ ${fixed(pickedCalibration.rangeMedian, 3)} − 1 = ${signed(pickedCalibration.biasPercent, 3)}%.` : undefined}
                    symbols={[
                      { tex: "b", name: "volatility bin, 1 = calmest forecast", value: String(pickedBin) },
                      { tex: "\\bar{\\hat v}_{b}", name: "mean EWMA forecast of the bars in the bin, log points", value: fixed(pickedCalibration?.volatilityMean, 4) },
                      { tex: "e^{\\,\\bar{\\hat v}_{b}}", name: "what the formula says the median next bar is, points", value: fixed(pickedCalibration?.analyticMedianPoints, 3) },
                      { tex: "\\tilde R_{b}", name: "realised median next-bar range in the bin, points", value: fixed(pickedCalibration?.rangeMedian, 3) },
                      { tex: "n_{b}", name: "bars in the bin", value: fmtInt(pickedCalibration?.rangeCount) },
                      { tex: "\\text{bias}_{b}", name: "percent the formula overstates the typical bar", value: `${signed(pickedCalibration?.biasPercent, 3)}%` },
                    ]}
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-3 grid-cols-1 xl:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <div className="text-[11px] font-semibold text-neutral-200">4b. The Gaussian Jensen factor is a lower bound — use the measured ratio</div>
                  <JensenChart rows={jensenRows} shown={shown} />
                  <DataTable rows={jensenRows} columns={JENSEN_COLUMNS} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
                </div>
                <div className="min-w-0 space-y-2">
                  <FormulaCard
                    tex={"m = \\operatorname{median}_{b}\\frac{\\bar R_{b}}{\\tilde R_{b}} \\;\\ge\\; e^{s^{2}/2}"}
                    caption={pickedJensen ? `${activeTimeframe}: measured ${fixed(pickedJensen.measuredFactor, 4)} against lognormal ${fixed(pickedJensen.lognormalFactor, 4)}, under-stated by ${fixed(pickedJensen.understatedByPercent, 2)}%.` : undefined}
                    symbols={[
                      { tex: "\\bar R_{b}", name: "realised mean next-bar range in bin b, points", value: fixed(pickedCalibration?.rangeMean, 3) },
                      { tex: "\\tilde R_{b}", name: "realised median in bin b, points", value: fixed(pickedCalibration?.rangeMedian, 3) },
                      { tex: "m", name: "measured mean-over-median, median across bins", value: fixed(pickedJensen?.measuredFactor, 4) },
                      { tex: "s", name: "residual σ of the forecast", value: fixed(pickedJensen?.residualSigma, 4) },
                      { tex: "e^{s^{2}/2}", name: "what a normal residual would give", value: fixed(pickedJensen?.lognormalFactor, 4) },
                    ]}
                  />
                  <Finding>
                    The measured factor exceeds the Gaussian one on every timeframe shown (under-statement {spread(understated)}%){isMonotoneRising(understated) ? ", growing monotonically as the bar coarsens" : ""}. Conditional on the forecast the
                    realised range carries large excess kurtosis (median bin {spread(jensenRows.map((row) => row.medianBinExcessKurtosis))}), so the mean sits further above the median than a normal residual predicts. e^(v + s²/2) is the right form with
                    the wrong constant. <span style={{ color: OKABE.orange }}>Fix:</span> take the factor from the measured mean ÷ median on the timeframe in use.
                  </Finding>
                </div>
              </div>
            </Section>

            {scaling && (
              <Section title="5. One law connects the timeframes" question="Mean log-range against ln(bar minutes): a straight line means range ∝ T^H; H = 0.5 is the square root of time.">
                <ScalingCharts scaling={scaling} shown={shown} />
                <div className="mt-2 grid gap-3 grid-cols-1 xl:grid-cols-2">
                  <FormulaCard
                    tex={"\\mathbb{E}[\\ln R] = H\\ln T + c \\quad\\Rightarrow\\quad v_{T_2} = v_{T_1} + H\\,\\ln\\frac{T_2}{T_1}"}
                    caption={`Moving the calculator's value from ${activeTimeframe} to ${target}: ${fixed(calcRange, 3)} + ${fixed(scaling.exponentOnMean, 4)} × ln(${TIMEFRAME_MINUTES[target]}/${TIMEFRAME_MINUTES[activeTimeframe]}) = ${fixed(calcRange + scaling.exponentOnMean * Math.log(TIMEFRAME_MINUTES[target] / TIMEFRAME_MINUTES[activeTimeframe]), 3)}.`}
                    symbols={[
                      { tex: "H", name: "scaling exponent fitted on the mean log-range", value: fixed(scaling.exponentOnMean, 4) },
                      { tex: "R^{2}", name: "fit quality on the mean", value: fixed(scaling.rSquaredOnMean, 6) },
                      { tex: "H_{\\text{median}}", name: "exponent fitted on ln(median range) — use this one to predict medians", value: fixed(scaling.exponentOnMedian, 4) },
                      { tex: "T", name: "bar length, minutes", value: `${TIMEFRAME_MINUTES[activeTimeframe]} → ${TIMEFRAME_MINUTES[target]}` },
                      { tex: "c", name: "intercept of the fit on the mean", value: fixed(scaling.interceptOnMean, 4) },
                    ]}
                  />
                  <div className="min-w-0 space-y-1">
                    <DataTable rows={scaling.rows} columns={scalingColumns(scaling.exponentOnMedian)} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
                  </div>
                </div>
                <Finding>
                  The level obeys a power law very nearly exactly: H = {fixed(scaling.exponentOnMean, 4)} on the mean (R² {fixed(scaling.rSquaredOnMean, 5)}) and {fixed(scaling.exponentOnMedian, 4)} on the median (R² {fixed(scaling.rSquaredOnMedian, 5)}), against 0.5 for a random walk.
                  The spread barely moves: sd(v) runs {spread(sdValues)} — a {fixed(Math.max(...sdValues) / Math.min(...sdValues), 3)}× band across a {fixed(minuteSpan, 0)}× change in bar length. The exponent on the mean is fitted to E[ln R], the geometric mean,
                  not the median; anchoring a median prediction on it manufactures an error that is pure anchoring, so the table uses the median's own exponent. Forecast quality does not transfer: residual σ runs {spread(residualSigmas)}.{" "}
                  <span style={{ color: OKABE.orange }}>Fix:</span> convert a volatility value between timeframes by adding {fixed(scaling.exponentOnMean, 3)} × ln(minute ratio); do not re-derive a ladder per bar size.
                </Finding>
              </Section>
            )}

            <Section title="6. Summary — the number asked for" question="Per timeframe: the typical and average bar in points, dollars, ticks and percent of price, with the residual spread and the dollars one tenth of v is worth.">
              <DataTable rows={body.summary} columns={SUMMARY_COLUMNS} rowKey={(row) => row.timeframe} highlight={(row) => row.timeframe === activeTimeframe} />
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-neutral-300">
                <li>
                  The conversion is exact arithmetic, not a fit: points = e^v, dollars = e^v × {fixed(pointValue, 2)}, ticks = e^v ÷ {fixed(body.instrument.tickSize, 2)}. Un-standardise a head's z-score first: v = z·σ + μ.
                </li>
                <li>A volatility value is multiplicative in price movement: +1.00 in v is 2.718× the range, +0.10 is +10.5%.</li>
                <li>
                  e^(forecast) is the median bar; the average bar is wider by the measured factor ({spread(jensenRows.map((row) => row.measuredFactor))}), not the Gaussian e^(s²/2) ({spread(jensenRows.map((row) => row.lognormalFactor))}).
                </li>
                <li>
                  One conversion covers every timeframe to an hour: range scales as T^{fixed(scaling?.exponentOnMean, 3)}, and the spread of v is nearly constant in log space. Shift v by H × ln(minute ratio) instead of building a second ladder.
                </li>
                <li>Points are not comparable across time; use the percent-of-price column for any cross-period or cross-instrument comparison.</li>
              </ol>
            </Section>

            <Section title="Every column of the calibration table" question={`${activeTimeframe}, one panel per column across the ${binCount} volatility bins.`}>
              <ColumnGrid rows={activeCalibration as unknown as Array<Record<string, unknown>>} exclude={["bin"]} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
