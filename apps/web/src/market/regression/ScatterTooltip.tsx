/**
 * The cursor tooltip: everything about the spot under the pointer, so a panel
 * explains itself without cross-referencing another one.
 *
 *   the variable     what it is, where it comes from, how much of the window it covers
 *   at the cursor    how crowded this spot is, the local trend and slope here,
 *                    and how far bars typically miss the straight line here
 *   the nearest bar  when, its values, its residual and flags, its volatility,
 *                    volume and group
 *   the whole panel  slope, R², Spearman ρ and the false-discovery q
 *
 * Rendered into document.body so a card's overflow never clips it, and flipped
 * to the other side of the pointer near the window's right or bottom edge.
 */

import { createPortal } from "react-dom";
import { densityRegionAt, trendAt } from "@shared/regression/index";
import type { RegressionFit, RegressionPairs } from "@shared/regression/types";
import { SERIES_FAMILY_LABELS } from "@shared/series/types";
import type { OhlcvData } from "@/market/components/types";
import type { BarEncodings, PanelContext, PanelVariableSummary } from "./panels";
import { CLUSTER_COLORS } from "./encoding";
import { REGRESSION_COLORS, formatProbability, formatTimestamp, formatValue, type StampClock } from "./scales";

export interface TooltipSource {
  variable: PanelVariableSummary;
  qValue: number | null;
  /** The bars the panel was fitted on — pairs.barIndex points into these. */
  bars: ReadonlyArray<OhlcvData> | null;
  clock: StampClock;
  encodings: BarEncodings | null;
}

export interface CursorState {
  clientX: number;
  clientY: number;
  /** The cursor in data units. */
  x: number;
  y: number;
  /** Nearest bar within reach, as an index into the pairs; null when none is close. */
  index: number | null;
}

const WIDTH = 300;

function Row({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <span className="shrink-0 text-muted-foreground/80">{label}</span>
      <span className="min-w-0 text-right font-mono tabular-nums text-foreground/90">{value}</span>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 border-t border-white/10 pt-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">{children}</div>;
}

function ordinal(percentile: number): string {
  if (!Number.isFinite(percentile)) return "—";
  const rounded = Math.round(percentile);
  const tens = rounded % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : rounded % 10 === 1 ? "st" : rounded % 10 === 2 ? "nd" : rounded % 10 === 3 ? "rd" : "th";
  return `${rounded}${suffix}`;
}

function crowding(region: number): string {
  if (region >= 0.995) return "outside every contour — almost no bars here";
  if (region > 0.95) return `sparse: only the outer ${Math.round(100 * (1 - region))}% of bars are this thin`;
  return `inside the densest ${Math.max(1, Math.round(100 * region))}% of bars`;
}

export function ScatterTooltip({
  cursor,
  source,
  pairs,
  fit,
  context,
  xLabel,
  yLabel,
}: {
  cursor: CursorState;
  source: TooltipSource;
  pairs: RegressionPairs;
  fit: RegressionFit;
  context: PanelContext | null;
  xLabel: string;
  yLabel: string;
}) {
  if (typeof document === "undefined") return null;
  const { variable, encodings } = source;
  const level = Math.round(fit.confidenceLevel * 100);
  const local = context?.trend ? trendAt(context.trend, cursor.x) : null;
  const region = context?.density ? densityRegionAt(context.density, cursor.x, cursor.y) : null;
  const spreadRatio = local && context?.trend ? local.residualSpread / context.trend.overallResidualSpread : Number.NaN;

  const index = cursor.index;
  const barIndex = index !== null ? (pairs.barIndex[index] as number) : null;
  const bar = barIndex !== null ? source.bars?.[barIndex] : undefined;
  const volatility = barIndex !== null ? encodings?.volatility[barIndex] : undefined;
  const volatilityRank = barIndex !== null ? encodings?.volatilityRank[barIndex] : undefined;
  const volumeRank = barIndex !== null ? encodings?.volumeRank[barIndex] : undefined;
  const group = index !== null && context?.clusters ? (context.clusters.labels[index] as number) : null;

  const flipX = cursor.clientX > window.innerWidth - WIDTH - 28;
  const flipY = cursor.clientY > window.innerHeight * 0.55;
  const position: React.CSSProperties = {
    width: WIDTH,
    ...(flipX ? { right: window.innerWidth - cursor.clientX + 14 } : { left: cursor.clientX + 14 }),
    ...(flipY ? { bottom: window.innerHeight - cursor.clientY + 14 } : { top: cursor.clientY + 14 }),
  };

  return createPortal(
    <div
      role="tooltip"
      data-testid="regression-tooltip"
      style={position}
      className="pointer-events-none fixed z-[90] rounded-md border border-white/15 bg-neutral-950/95 p-2 text-[10px] leading-snug text-foreground shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur"
    >
      <div className="text-[11px] font-semibold text-foreground">{variable.label}</div>
      <div className="text-muted-foreground/85">
        {SERIES_FAMILY_LABELS[variable.family] ?? variable.family} ·{" "}
        {variable.source === "bar" ? `from the bars: ${variable.detail}` : `lake ${variable.detail}`}
      </div>
      <div className="text-muted-foreground/85">
        {variable.matchedBars.toLocaleString()} of {variable.barCount.toLocaleString()} bars have a value · {fit.n.toLocaleString()} in the fit
        {variable.forwardLooking && <span className="text-[#F4A582]"> · computed from later bars (leakage)</span>}
      </div>

      <Heading>At the cursor · X {formatValue(cursor.x)}, Y {formatValue(cursor.y)}</Heading>
      {region !== null && <Row label="crowding" value={crowding(region)} title="Where this spot sits among the density contours (Hyndman highest-density regions)." />}
      {local ? (
        <>
          <Row
            label="local trend"
            value={`${formatValue(local.fitted)} (${level}%: ${formatValue(local.lower)} to ${formatValue(local.upper)})`}
            title="LOESS: a straight line fitted to the nearest 30% of bars around this X, closest weighted most. The band is widened by the same autocorrelation factor as the slope error."
          />
          <Row
            label="local slope"
            value={
              <>
                {formatValue(local.slope)} ± {formatValue(local.slopeStandardError)}
                <span className="text-muted-foreground"> (panel {formatValue(fit.slope)})</span>
              </>
            }
            title={`Slope of the local line at this X, ± its standard error (widened ×${formatValue(context?.autocorrelationInflation ?? 1, 2)} for autocorrelation — the panel's Newey-West ÷ ordinary ratio). Far from the panel slope: the relationship bends here.`}
          />
          <Row label="bars behind it" value={`≈ ${Math.round(local.effectiveCount).toLocaleString()} effective`} title="Kish effective count of the local weights: how many equally weighted bars the local fit is worth." />
          {Number.isFinite(local.residualSpread) && (
            <Row
              label="typical miss here"
              value={
                <>
                  {formatValue(local.residualSpread)}
                  <span className={spreadRatio > 1.25 || spreadRatio < 0.8 ? "text-[#F0E442]" : "text-muted-foreground"}>
                    {" "}
                    (×{formatValue(spreadRatio, 2)} the panel)
                  </span>
                </>
              }
              title="Root-mean-square distance of nearby bars from the straight line. Far from ×1: the spread changes across X (heteroskedasticity), so the straight line's bands are too narrow here or too wide."
            />
          )}
        </>
      ) : (
        <Row label="local trend" value="—" title="Too few distinct X values for a local fit." />
      )}

      {index !== null && (
        <>
          <Heading>Nearest bar · {bar ? formatTimestamp(bar.timestamp, source.clock) : `#${barIndex}`}</Heading>
          <Row label={xLabel.length > 28 ? "X" : xLabel} value={formatValue(pairs.x[index] as number)} />
          <Row label={yLabel.length > 28 ? "Y" : yLabel} value={formatValue(pairs.y[index] as number)} />
          <Row
            label="residual"
            value={`${formatValue(fit.residuals[index] as number)} (studentized ${formatValue(fit.studentizedExternal[index] as number)})`}
            title="Y minus the straight line's value here; studentized = in units of its own standard error, with this bar left out."
          />
          <Row label="Cook's distance" value={formatValue(fit.cookDistance[index] as number)} title="How far the line would move without this bar." />
          {(fit.verticalOutlier[index] === 1 || fit.influential[index] === 1) && (
            <div className="text-right">
              {fit.verticalOutlier[index] === 1 && <span style={{ color: REGRESSION_COLORS.verticalOutlier }}>◆ vertical outlier </span>}
              {fit.influential[index] === 1 && <span style={{ color: REGRESSION_COLORS.influential }}>○ influential</span>}
            </div>
          )}
          {volatility !== undefined && Number.isFinite(volatility) && (
            <Row
              label="volatility, 20 bars"
              value={`${formatValue(volatility)} bp (${ordinal(100 * (volatilityRank ?? Number.NaN))} pct.)`}
              title="Sample standard deviation of the last 20 one-bar log returns, in basis points, and its percentile among the loaded bars."
            />
          )}
          {bar && (
            <Row label="volume" value={`${bar.volume.toLocaleString()} (${ordinal(100 * (volumeRank ?? Number.NaN))} pct.)`} />
          )}
          {group !== null && context?.clusters && (
            <Row
              label="group"
              value={
                <>
                  <span style={{ color: CLUSTER_COLORS[group % CLUSTER_COLORS.length] }}>●</span> {group + 1} of {context.clusters.k}
                  <span className="text-muted-foreground"> ({context.clusters.sizes[group]?.toLocaleString()} bars)</span>
                </>
              }
            />
          )}
        </>
      )}

      <Heading>Whole panel</Heading>
      <div className="font-mono tabular-nums text-foreground/85">
        slope {formatValue(fit.slope)} · R² {formatValue(fit.rSquared)} · ρ {formatValue(fit.spearmanCorrelation)} · q {formatProbability(source.qValue)}
      </div>
      {context?.clusters && (
        <div className="text-muted-foreground/85">
          {context.clusters.k} groups, silhouette {formatValue(context.clusters.silhouette, 2)} — {context.clusters.structure === "none" ? "no real grouping" : `${context.clusters.structure} grouping`}
        </div>
      )}
    </div>,
    document.body,
  );
}
