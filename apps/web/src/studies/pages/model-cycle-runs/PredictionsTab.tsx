/**
 * Predictions: the chosen run's processed bars. The eight numbers and a
 * histogram of every numeric column are aggregated in DuckDB (exact over all
 * bars); the equity curve and the forecast scatter are thinned to a few
 * thousand points.
 */

import { Finding, Section, Stat, fmt, fmtInt, fmtPercent, fmtUsd, OKABE } from "@/studies/kit";
import { EightNumberTable, EquityChart, ForecastScatter, HistogramBars, ProfileGrid } from "./charts";
import { SkillCard } from "./Formulas";
import { stamp, type TabProps } from "./common";

export function PredictionsTab({ run, recipe }: TabProps) {
  const summary = run.predictionSummary;
  if (!summary) {
    return (
      <Section title={`Predictions: nothing landed for ${recipe || "this recipe"}`}>
        <p className="text-xs text-neutral-400">{run.absent.predictions ?? "Pick a run above."}</p>
      </Section>
    );
  }
  const profile = (column: string) => run.predictionProfile.find((entry) => entry.column === column);
  const probability = profile("probability_up");
  const forecastError = profile("forecast_error_points");
  const finalEquity = run.equity[run.equity.length - 1]?.equity ?? null;
  const peak = run.equity.reduce<number | null>((best, point) => (point.equity !== null && (best === null || point.equity > best) ? point.equity : best), null);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Processed bars" value={fmtInt(summary.count)} hint={`${stamp(summary.firstTimestamp)} to ${stamp(summary.lastTimestamp)}`} />
        <Stat label="Forecasts made" value={`${fmtInt(summary.forecastCount)} (${fmtInt(summary.resolvedForecastCount)} resolved)`} hint="bars with a forecast close; resolved = the forecast bar has printed" />
        <Stat
          label={`Forecasts on the ${fmt(summary.tickSize, 2)} grid`}
          value={summary.onGridFraction === null ? "no forecast" : fmtPercent(summary.onGridFraction)}
          hint="share of forecast closes that are a whole number of ticks"
          tone={summary.onGridFraction === 1 ? OKABE.orange : OKABE.blue}
        />
        <Stat label="Final equity" value={fmtUsd(finalEquity)} hint={`peak ${fmtUsd(peak)}`} tone={finalEquity !== null && finalEquity >= 0 ? OKABE.orange : OKABE.blue} />
      </div>

      <Section
        title={`Predictions: ${fmtInt(summary.count)} processed bars of ${recipe}`}
        question="The eight numbers (and the count) of every numeric column, over all bars."
      >
        <EightNumberTable columns={run.predictionProfile.map((entry) => ({ name: entry.column, summary: entry.summary }))} />
      </Section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Equity curve of the test walk" question="USD, marked to market bar by bar; dashed lines open each fold's test span.">
          <EquityChart equity={run.equity} />
          <Finding>
            Ends at {fmtUsd(finalEquity)} from a peak of {fmtUsd(peak)} over {fmtInt(summary.count)} bars.
            {run.equity.length < summary.count && ` Drawn thinned to ${fmtInt(run.equity.length)} points at a fixed stride.`}
          </Finding>
        </Section>

        <Section title="P(up) across processed bars" question="How spread out the model's probability is; the bin count is the slider above.">
          <HistogramBars bins={probability?.bins ?? []} label="P(up)" color={OKABE.blue} />
          {probability && (
            <Finding>
              P(up) runs from {fmt(probability.summary.minimum, 4)} to {fmt(probability.summary.maximum, 4)}, median {fmt(probability.summary.median, 4)}, standard deviation {fmt(probability.summary.standardDeviation, 4)}.
            </Finding>
          )}
        </Section>

        <Section title="Price forecast error" question="Forecast minus actual move, index points, over bars whose forecast has resolved.">
          <HistogramBars bins={forecastError?.bins ?? []} label="forecast error, points" signSplit />
          {forecastError ? (
            <Finding>
              {fmtInt(forecastError.summary.count)} resolved forecasts: median error {fmt(forecastError.summary.median, 3)}, standard deviation {fmt(forecastError.summary.standardDeviation, 3)}, from {fmt(forecastError.summary.minimum, 2)} to {fmt(forecastError.summary.maximum, 2)}.
            </Finding>
          ) : (
            <Finding>This run made no price forecast.</Finding>
          )}
        </Section>

        <Section title="Forecast against its error" question="Predicted move (on the tick grid) against the error it left; hover for the forecast and actual close.">
          <ForecastScatter points={run.forecastScatter} />
          {run.forecastScatter.length > 0 && run.forecastScatter.length < summary.resolvedForecastCount && (
            <Finding>Thinned to {fmtInt(run.forecastScatter.length)} of {fmtInt(summary.resolvedForecastCount)} points at a fixed stride.</Finding>
          )}
        </Section>
      </div>

      <SkillCard record={run.record} />

      <Section title="Every column of the predictions frame" question="Each numeric column as its own histogram with its eight numbers; the bin count is the slider above.">
        <ProfileGrid profiles={run.predictionProfile} />
      </Section>
    </div>
  );
}
