/**
 * "What comes next" — the predictive layer: the model's most recent
 * prediction with its conformal interval, the regime it was made in, whether
 * the rolling hit rate is holding up, and the drift alarm. An old prediction
 * is labelled as old, with its date and age, before anything else is read.
 */

import { describeAge, type LensAnalyticsNext } from "@shared/lens/analytics";
import { regimeColorVar, regimeGlyph, regimeLabel } from "../common";
import { formatInt, formatNumber, formatPercent, formatTimestamp } from "../format";
import { ANALYTICS_COLORS, Explains, Heading, Reason, Sentence } from "./parts";

/** The interval as a horizontal range in basis points around zero. */
function IntervalStrip({ interval }: { interval: NonNullable<LensAnalyticsNext["interval"]> }) {
  const extent = Math.max(Math.abs(interval.lowerBasisPoints), Math.abs(interval.upperBasisPoints), 1);
  const position = (value: number) => `${50 + (value / extent) * 45}%`;
  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="lens-analytics-interval">
      <div className="relative h-5 w-full max-w-md rounded-sm bg-muted" aria-hidden="true">
        <div
          className="absolute top-1 h-3 rounded-sm opacity-50"
          style={{
            left: position(interval.lowerBasisPoints),
            width: `${((interval.upperBasisPoints - interval.lowerBasisPoints) / extent) * 45}%`,
            backgroundColor: ANALYTICS_COLORS.interval,
          }}
        />
        <div className="absolute top-0 h-5 border-l border-dashed" style={{ left: "50%", borderColor: ANALYTICS_COLORS.reference }} />
        <div className="absolute top-0 h-5 w-[2px] -translate-x-1/2 bg-foreground" style={{ left: position(interval.medianBasisPoints) }} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        shaded = {Math.round(interval.coverage * 100)}% interval · tick = median · dashed = no move · basis points over the next {interval.horizonBars} bars
      </p>
    </div>
  );
}

export function NextTab({ next }: { next: LensAnalyticsNext }) {
  const latest = next.latest;
  return (
    <div className="flex flex-col gap-2" data-testid="lens-analytics-next">
      <Explains>{next.explanation}</Explains>

      {latest?.isOld && (
        <p
          className="rounded-md border border-(--color-data-warn) px-2 py-1 text-xs font-medium text-foreground"
          data-testid="lens-analytics-old-prediction"
        >
          ⚠ Old prediction: made {formatTimestamp(latest.timestampSeconds)}, {latest.ageText} ago. Its horizon of {describeAge(latest.horizonSeconds)} has
          already passed, so it describes the past, not what comes next.
        </p>
      )}

      <Heading>Most recent prediction</Heading>
      <Explains>The last bar the model scored, what it expected and how wide its uncertainty was.</Explains>
      {next.available && latest ? (
        <>
          <div className="flex flex-wrap gap-4 text-xs" data-testid="lens-analytics-latest">
            <span>
              Probability of up <span className="font-mono tnum text-sm">{formatNumber(latest.probabilityUp, 3)}</span>
            </span>
            <span>
              Leaning{" "}
              <span className="font-semibold">
                {latest.leaning === "up" ? "▲ up" : "▼ down"}
              </span>
            </span>
            <span>
              Signal at threshold {formatNumber(latest.threshold, 3)}:{" "}
              <span className="font-semibold">{latest.signal === null ? "none (inside the band)" : latest.signal}</span>
            </span>
            <span>
              Regime{" "}
              <span style={{ color: regimeColorVar(latest.regime) }}>{regimeGlyph(latest.regime)}</span> {regimeLabel(latest.regime)}
            </span>
            <span className="text-muted-foreground">bar {formatInt(latest.rowIndex)} · {formatTimestamp(latest.timestampSeconds)}</span>
          </div>
          {next.interval ? <IntervalStrip interval={next.interval} /> : <Reason>{next.intervalReason}</Reason>}
        </>
      ) : (
        <Reason>{next.reason}</Reason>
      )}

      <div className="flex flex-col gap-1" data-testid="lens-analytics-next-sentences">
        {next.sentences.map((sentence) => (
          <Sentence key={sentence}>{sentence}</Sentence>
        ))}
      </div>

      <Heading>Rolling hit rate and drift</Heading>
      <Explains>Whether the model&apos;s recent accuracy is holding up, and whether the drift detector has flagged a run of worse trades.</Explains>
      <div className="flex flex-wrap gap-4 text-xs">
        {next.rollingHitRate ? (
          <span>
            Last {formatInt(next.rollingHitRate.windowBars)} bars: <span className="font-mono tnum">{formatPercent(next.rollingHitRate.latest)}</span>{" "}
            ({formatInt(next.rollingHitRate.latestLabelledCount)} labelled) · trend{" "}
            <span className="font-semibold">
              {next.rollingHitRate.trend === "rising" ? "▲ rising" : next.rollingHitRate.trend === "falling" ? "▼ falling" : next.rollingHitRate.trend === "flat" ? "— flat" : "unknown"}
            </span>{" "}
            · coin-flip band {formatPercent(next.rollingHitRate.nullBandLower)}–{formatPercent(next.rollingHitRate.nullBandUpper)}
          </span>
        ) : (
          <Reason>{next.rollingReason}</Reason>
        )}
        <span data-testid="lens-analytics-drift">
          Drift alarm: <span className="font-semibold">{next.drift.alarmOn ? "⚠ ON" : "off"}</span> · {formatInt(next.drift.alarmCount)} alarms over{" "}
          {formatInt(next.drift.tradeCount)} trades · {next.drift.rule}
        </span>
      </div>
    </div>
  );
}
