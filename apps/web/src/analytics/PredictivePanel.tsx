import { AnalyticStudies } from "./AnalyticStudies";
/**
 * Predictive — what will happen: the market's state at its last bar, and how
 * often each outcome followed that same state over the next `horizon` bars in
 * this symbol's own history, each probability with its 95 % interval; the
 * same for every state and for all bars; and the latest model run's own
 * probability of up, checked against its calibration.
 */

import type { AnalyticsResponse, OutcomeDistribution } from "@shared/analytics/types";
import { Empty, Histogram, OKABE, ProbabilityBar, Section, Stat, fmt, fmtInt, fmtPercent, fmtTime } from "./common";

function Outcomes({ outcome, costPoints, largePoints, dp }: { outcome: OutcomeDistribution; costPoints: number | null; largePoints: number | null; dp: number }) {
  return (
    <div className="space-y-2">
      <ProbabilityBar label="closes higher" probability={outcome.probabilityUp} />
      <ProbabilityBar label={costPoints === null ? "up (no cost model: before costs)" : `up by more than the round-trip cost (${fmt(costPoints, dp)} pts)`} probability={outcome.probabilityBeatsCostUp} />
      <ProbabilityBar label={costPoints === null ? "down (before costs)" : "down by more than the round-trip cost"} probability={outcome.probabilityBeatsCostDown} color={OKABE.blue} />
      <ProbabilityBar label={`large rise (≥ ${fmt(largePoints, dp)} pts, one standard deviation)`} probability={outcome.probabilityLargeUp} />
      <ProbabilityBar label={`large fall (≤ -${fmt(largePoints, dp)} pts)`} probability={outcome.probabilityLargeDown} color={OKABE.blue} />
    </div>
  );
}

export function PredictivePanel({ data }: { data: AnalyticsResponse }) {
  const p = data.predictive;
  const q = p.current.quantilesPoints;
  // Points to the precision the instrument moves in: futures 2 decimals, forex 5.
  const dp = data.assetClass === "forex" ? 5 : 2;
  const hours = (p.horizonBars * (data.timeframe.endsWith("m") ? Number(data.timeframe.slice(0, -1)) : data.timeframe.endsWith("h") ? Number(data.timeframe.slice(0, -1)) * 60 : 1440)) / 60;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="state now" value={p.state.label} hint={`At the last bar, ${fmtTime(p.asOf)} (${data.clock}). Volatility: the last 20 bars against their median over 500; trend: the close against 50 bars ago.`} />
        <Stat label="horizon" value={`${p.horizonBars} bars (${fmt(hours, hours < 10 ? 1 : 0)} h)`} />
        <Stat label="past cases in this state" value={fmtInt(p.current.sampleCount)} hint={`Bars whose state matched and whose next bars closed without crossing a session gap; the windows overlap, so about ${fmtInt(p.current.probabilityUp.effectiveTotal)} are independent and the intervals use that`} />
        <Stat label="median outcome" value={`${fmt(q.p50, dp)} pts`} tone={q.p50 !== null && q.p50 > 0 ? OKABE.orange : OKABE.blue} hint="Half of the past cases ended above this move, half below" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Outcome probabilities from this state" question={`How often each outcome followed "${p.state.label}" within ${p.horizonBars} bars; the bracket is the 95% interval`}>
          {p.current.sampleCount === 0 ? <Empty>The state is not known yet at the last bar.</Empty> : <Outcomes outcome={p.current} costPoints={p.costPoints} largePoints={p.largeMovePoints} dp={dp} />}
        </Section>
        <Section title="Possible outcomes" question={`Move over the next ${p.horizonBars} bars in points, past cases in this state; dashed lines = 10th, 50th, 90th percentiles`}>
          <Histogram
            bins={p.current.histogram}
            unit="pts"
            markers={[
              ...(q.p10 !== null ? [{ x: q.p10, label: "p10", color: OKABE.blue }] : []),
              ...(q.p50 !== null ? [{ x: q.p50, label: "median", color: "#e5e5e5" }] : []),
              ...(q.p90 !== null ? [{ x: q.p90, label: "p90", color: OKABE.orange }] : []),
            ]}
          />
          <div className="mt-1 flex justify-between text-[10px] font-mono tnum text-neutral-400">
            <span>p10 {fmt(q.p10, dp)}</span>
            <span>p25 {fmt(q.p25, dp)}</span>
            <span>median {fmt(q.p50, dp)}</span>
            <span>p75 {fmt(q.p75, dp)}</span>
            <span>p90 {fmt(q.p90, dp)}</span>
            <span>mean {fmt(p.current.meanPoints, dp)}</span>
          </div>
        </Section>
      </div>

      <Section title="Every state against all bars" question="Does the state change the odds? Compare each row with the last one">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="text-left font-normal">state</th>
              <th className="text-right font-normal">past cases</th>
              <th className="text-right font-normal">P(closes higher) [95%]</th>
              <th className="text-right font-normal">P(large rise)</th>
              <th className="text-right font-normal">P(large fall)</th>
              <th className="text-right font-normal">median pts</th>
              <th className="text-right font-normal">p10 / p90 pts</th>
            </tr>
          </thead>
          <tbody>
            {[...p.byState, p.unconditional].map((row) => (
              <tr key={row.label} className={`border-t border-neutral-900 ${row.label === p.state.label ? "text-[#E69F00]" : "text-neutral-200"}`}>
                <td className="text-left">{row.label === p.state.label ? `▶ ${row.label}` : row.label}</td>
                <td className="text-right">{fmtInt(row.sampleCount)}</td>
                <td className="text-right">
                  {fmtPercent(row.probabilityUp.value)} <span className="text-neutral-500">[{fmtPercent(row.probabilityUp.low)}–{fmtPercent(row.probabilityUp.high)}]</span>
                </td>
                <td className="text-right">{fmtPercent(row.probabilityLargeUp.value)}</td>
                <td className="text-right">{fmtPercent(row.probabilityLargeDown.value)}</td>
                <td className="text-right">{fmt(row.quantilesPoints.p50, dp)}</td>
                <td className="text-right">
                  {fmt(row.quantilesPoints.p10, dp)} / {fmt(row.quantilesPoints.p90, dp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="What the latest model predicts" question="Its probability of up at the last bar it scored, and what that probability turned out to mean in its own record">
        {!p.model ? (
          <Empty>No Model Cycle run on this symbol has scored a bar yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="model" value={p.model.modelLabel} hint={p.model.modelId} />
            <Stat label="P(up) it gave" value={fmtPercent(p.model.probabilityUp)} tone={p.model.probabilityUp >= 0.5 ? OKABE.orange : OKABE.blue} hint={`at ${fmtTime(p.model.timestamp)}`} />
            <Stat
              label="how often up followed"
              value={fmtPercent(p.model.calibratedUpFraction)}
              hint={`Observed up fraction in its calibration bin ${p.model.calibrationBin ?? ""}`}
            />
            <Stat label="calibration bin" value={p.model.calibrationBin ?? "—"} />
          </div>
        )}
      </Section>
      <AnalyticStudies category="Predictive" />
    </div>

  );
}
