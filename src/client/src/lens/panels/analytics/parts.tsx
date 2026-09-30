/**
 * Small pieces the four analytics tabs share: a rate drawn as a point inside
 * its 95% interval, the plain-words reason that replaces a value whose sample
 * is too small, a segment table, and the eight-number summary.
 *
 * Colour never carries meaning alone: the interval is a shaded bar with its
 * numbers printed beside it, a reference is a dashed line named in the legend,
 * a gain carries ▲ and a loss ▼.
 */

import type { ReactNode } from "react";
import type { Probability } from "@shared/analytics/types";
import type { LensAnalyticsSegment } from "@shared/lens/analytics";
import type { LensEightNumberSummary, LensEstimate } from "@shared/lens/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { formatInt, formatNumber, formatPercent, formatUsdSigned } from "../format";

/** Okabe-Ito hues used by the analytics drawings. */
export const ANALYTICS_COLORS = {
  interval: "#56B4E9", // sky: a 95% interval
  point: "#E69F00", // orange: the measured value
  expected: "#D55E00", // vermillion: what the model said (calibration)
  reference: "#F0E442", // Okabe-Ito yellow (black is invisible on the dark theme): dashed coin flip / break-even line
  gain: "#E69F00",
  loss: "#0072B2",
} as const;

/** One plain sentence saying what a view shows. */
export function Explains({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <h4 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h4>;
}

/** The sentence a number was turned into, set as the lead of a block. */
export function Sentence({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-sm leading-relaxed text-foreground" data-testid={testId}>
      {children}
    </p>
  );
}

/** Shown in place of a value: why it is not stated. */
export function Reason({ children }: { children: ReactNode }) {
  return <span className="text-[11px] italic text-muted-foreground">not shown: {children}</span>;
}

export function SignedUsd({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span>—</span>;
  const glyph = value > 0 ? "▲" : value < 0 ? "▼" : "—";
  const color = value > 0 ? ANALYTICS_COLORS.gain : value < 0 ? ANALYTICS_COLORS.loss : undefined;
  return (
    <span className="font-mono tnum tabular-nums">
      <span aria-hidden="true" className="mr-0.5 text-[10px]" style={{ color }}>
        {glyph}
      </span>
      {formatUsdSigned(value)}
    </span>
  );
}

/**
 * A share drawn on a 0-100% track: the shaded bar is the 95% interval, the
 * tick the measured value, the dashed line a reference (coin flip, break
 * even), the ◆ what the model itself predicted.
 */
export function RateBar({
  rate,
  reason,
  reference,
  expected,
  testId,
}: {
  rate: Probability | null;
  reason?: string | null;
  reference?: number | null;
  expected?: number | null;
  testId?: string;
}) {
  if (!rate || rate.value === null) return <Reason>{reason ?? "no sample"}</Reason>;
  const clamp = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  const low = rate.low ?? rate.value;
  const high = rate.high ?? rate.value;
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <div className="relative h-3 w-28 shrink-0 rounded-sm bg-muted" aria-hidden="true">
        <div
          className="absolute top-0 h-3 rounded-sm opacity-50"
          style={{ left: clamp(low), width: `${Math.max(0.5, (Math.min(1, high) - Math.max(0, low)) * 100)}%`, backgroundColor: ANALYTICS_COLORS.interval }}
        />
        {reference !== undefined && reference !== null && (
          <div className="absolute top-[-2px] h-4 border-l border-dashed" style={{ left: clamp(reference), borderColor: ANALYTICS_COLORS.reference }} />
        )}
        {expected !== undefined && expected !== null && (
          <span className="absolute top-[-4px] -translate-x-1/2 text-[10px] leading-none" style={{ left: clamp(expected), color: ANALYTICS_COLORS.expected }}>
            ◆
          </span>
        )}
        <div className="absolute top-[-1px] h-[14px] w-[2px] -translate-x-1/2 bg-foreground" style={{ left: clamp(rate.value) }} />
      </div>
      <span className="font-mono text-[11px] tnum tabular-nums">
        {formatPercent(rate.value)}{" "}
        <span className="text-muted-foreground">
          [{formatPercent(rate.low)}, {formatPercent(rate.high)}] · n {formatInt(rate.total)}
          {rate.effectiveTotal < rate.total ? ` (≈${formatInt(rate.effectiveTotal)} independent)` : ""}
        </span>
      </span>
    </div>
  );
}

/** A dollar estimate with its interval and sample, or the reason it is not shown. */
export function EstimateText({ estimate, reason }: { estimate: LensEstimate | null; reason?: string | null }) {
  if (!estimate || estimate.value === null) return <Reason>{reason ?? "no sample"}</Reason>;
  return (
    <span className="font-mono text-[11px] tnum tabular-nums" title={estimate.method}>
      <SignedUsd value={estimate.value} />{" "}
      <span className="text-muted-foreground">
        [{formatUsdSigned(estimate.ciLow)}, {formatUsdSigned(estimate.ciHigh)}] · n {formatInt(estimate.n)}
      </span>
    </span>
  );
}

export function RateLegend({ referenceLabel, withExpected = false }: { referenceLabel: string; withExpected?: boolean }) {
  return (
    <p className="mb-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
      <span>
        <span className="mr-1 inline-block h-2 w-4 rounded-sm align-middle opacity-50" style={{ backgroundColor: ANALYTICS_COLORS.interval }} />
        95% interval (Wilson)
      </span>
      <span>
        <span className="mr-1 inline-block h-3 w-[2px] bg-foreground align-middle" />
        measured
      </span>
      <span>
        <span className="mr-1 inline-block h-3 border-l border-dashed align-middle" style={{ borderColor: ANALYTICS_COLORS.reference }} />
        {referenceLabel}
      </span>
      {withExpected && (
        <span>
          <span className="mr-1" style={{ color: ANALYTICS_COLORS.expected }}>
            ◆
          </span>
          the model&apos;s own probability
        </span>
      )}
    </p>
  );
}

/** Rows and trades for each slice: direction hit rate over bars, win rate and mean over trades. */
export function SegmentTable({ segments, firstColumn, testId }: { segments: LensAnalyticsSegment[]; firstColumn: string; testId?: string }) {
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead>{firstColumn}</TableHead>
          <TableHead>Direction hit rate (bars)</TableHead>
          <TableHead className="text-right">Trades</TableHead>
          <TableHead>Win rate (trades)</TableHead>
          <TableHead className="text-right">Mean net per trade</TableHead>
          <TableHead className="text-right">Total net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {segments.map((segment) => (
          <TableRow key={segment.key}>
            <TableCell className="whitespace-nowrap font-medium">{segment.label}</TableCell>
            <TableCell>
              <RateBar rate={segment.directionHitRate} reason={segment.directionReason} reference={0.5} />
            </TableCell>
            <TableCell className="text-right font-mono tnum tabular-nums">{formatInt(segment.tradeCount)}</TableCell>
            <TableCell>
              <RateBar rate={segment.winRate} reason={segment.tradeReason} reference={0.5} />
            </TableCell>
            <TableCell className="text-right">
              {segment.meanTradeNetUsd === null ? <Reason>{segment.tradeReason}</Reason> : <SignedUsd value={segment.meanTradeNetUsd} />}
            </TableCell>
            <TableCell className="text-right">
              <SignedUsd value={segment.tradeCount > 0 ? segment.totalNetUsd : null} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function EightNumberTable({ summary, format, testId }: { summary: LensEightNumberSummary; format: (v: number | null) => string; testId?: string }) {
  const cells: Array<[string, string]> = [
    ["Count", formatInt(summary.count)],
    ["Mean", format(summary.mean)],
    ["Median", format(summary.median)],
    ["Standard deviation", format(summary.standardDeviation)],
    ["Skewness", formatNumber(summary.skewness, 3)],
    ["Excess kurtosis", formatNumber(summary.kurtosis, 3)],
    ["25th percentile", format(summary.percentile25)],
    ["75th percentile", format(summary.percentile75)],
    ["Minimum", format(summary.minimum)],
    ["Maximum", format(summary.maximum)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-5" data-testid={testId}>
      {cells.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="font-mono tnum tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
