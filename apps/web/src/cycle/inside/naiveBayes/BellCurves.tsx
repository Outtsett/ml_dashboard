/**
 * One feature inside a Gaussian naive Bayes model: the bell curve the model
 * fitted to that feature on the training bars that went up (orange, solid)
 * and on those that went down (blue, dashed), with this bar's value as a
 * line. The evidence is how much taller the up curve is than the down curve
 * at that line, on a log scale: ln(height up ÷ height down).
 *
 * Hover the plot to read both heights and the log ratio at any value.
 */
import { useState, type MouseEvent } from "react";

import { INSIDE_COLORS, directionColor, directionGlyph, formatNumber, formatSigned } from "../linear/link";

const WIDTH = 320;
const HEIGHT = 150;
const MARGIN = { left: 8, right: 8, top: 10, bottom: 26 };
const SAMPLES = 160;

export function normalDensity(value: number, mean: number, variance: number): number {
  return Math.exp(-((value - mean) ** 2) / (2 * variance)) / Math.sqrt(2 * Math.PI * variance);
}

/** ln N(value | up) − ln N(value | down), computed in log space so far tails do not underflow. */
export function logLikelihoodRatio(value: number, means: [number, number], variances: [number, number]): number {
  const logDensity = (mean: number, variance: number) => -0.5 * Math.log(2 * Math.PI * variance) - (value - mean) ** 2 / (2 * variance);
  return logDensity(means[1], variances[1]) - logDensity(means[0], variances[0]);
}

interface BellCurvesProps {
  featureName: string;
  /** [down, up]. */
  means: [number, number];
  variances: [number, number];
  /** This bar's model input for the feature. */
  value: number | null;
  /** The explainer's evidence for this feature (the waterfall term). */
  evidence: number | null;
}

export function BellCurves({ featureName, means, variances, value, evidence }: BellCurvesProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const deviations = variances.map((variance) => Math.sqrt(Math.max(variance, 1e-12)));
  let low = Math.min(means[0] - 3.5 * (deviations[0] ?? 1), means[1] - 3.5 * (deviations[1] ?? 1));
  let high = Math.max(means[0] + 3.5 * (deviations[0] ?? 1), means[1] + 3.5 * (deviations[1] ?? 1));
  if (value !== null && Number.isFinite(value)) {
    const pad = (high - low) * 0.05;
    low = Math.min(low, value - pad);
    high = Math.max(high, value + pad);
  }
  const peak = Math.max(normalDensity(means[0], means[0], variances[0]), normalDensity(means[1], means[1], variances[1]));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (v: number) => MARGIN.left + ((v - low) / (high - low)) * plotWidth;
  const y = (density: number) => MARGIN.top + (1 - density / (peak * 1.08)) * plotHeight;

  const curvePath = (classIndex: 0 | 1) => {
    const parts: string[] = [];
    for (let index = 0; index <= SAMPLES; index += 1) {
      const v = low + ((high - low) * index) / SAMPLES;
      parts.push(`${index === 0 ? "M" : "L"}${x(v).toFixed(2)},${y(normalDensity(v, means[classIndex], variances[classIndex])).toFixed(2)}`);
    }
    return parts.join(" ");
  };

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const svgX = ((event.clientX - box.left) / box.width) * WIDTH;
    setHoverValue(Math.max(low, Math.min(high, low + ((svgX - MARGIN.left) / plotWidth) * (high - low))));
  };

  const readAt = (v: number) => {
    const up = normalDensity(v, means[1], variances[1]);
    const down = normalDensity(v, means[0], variances[0]);
    return { up, down, ratio: logLikelihoodRatio(v, means, variances) };
  };
  const atBar = value === null ? null : readAt(value);
  const atHover = hoverValue === null ? null : readAt(hoverValue);

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="inside-bell-curves" data-feature={featureName}>
      <p className="text-[11px] font-medium text-neutral-200">{featureName}: the two bell curves the model fitted</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-[24rem]"
        role="img"
        aria-label={`${featureName}: the fitted bell curve for up bars and for down bars, with this bar's value`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverValue(null)}
      >
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0)} y2={y(0)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <path d={curvePath(1)} fill="none" stroke={INSIDE_COLORS.up} strokeWidth={2} data-testid="bell-curve-up" />
        <path d={curvePath(0)} fill="none" stroke={INSIDE_COLORS.down} strokeWidth={2} strokeDasharray="5 3" data-testid="bell-curve-down" />
        {value !== null && atBar && (
          <>
            <line x1={x(value)} x2={x(value)} y1={MARGIN.top} y2={y(0)} stroke={INSIDE_COLORS.bar} strokeWidth={1.5} />
            <circle cx={x(value)} cy={y(atBar.up)} r={3.5} fill={INSIDE_COLORS.up}>
              <title>{`Up curve height at this bar: ${formatNumber(atBar.up, 4)}`}</title>
            </circle>
            <circle cx={x(value)} cy={y(atBar.down)} r={3.5} fill={INSIDE_COLORS.down}>
              <title>{`Down curve height at this bar: ${formatNumber(atBar.down, 4)}`}</title>
            </circle>
          </>
        )}
        {hoverValue !== null && <line x1={x(hoverValue)} x2={x(hoverValue)} y1={MARGIN.top} y2={y(0)} stroke={INSIDE_COLORS.neutral} strokeDasharray="2 2" />}
        <text x={MARGIN.left} y={HEIGHT - 12} fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(low, 2)}
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 12} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(high, 2)}
        </text>
        <text x={WIDTH / 2} y={HEIGHT - 2} textAnchor="middle" fontSize={9} fill={INSIDE_COLORS.neutral}>
          model input value
        </text>
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[10px] text-neutral-300">
        <span style={{ color: INSIDE_COLORS.up }}>━ Up bars (orange, solid)</span>
        <span style={{ color: INSIDE_COLORS.down }}>┅ Down bars (blue, dashed)</span>
        <span style={{ color: INSIDE_COLORS.bar }}>│ This bar</span>
      </div>
      <p className="min-h-4 text-[10px] text-neutral-400" data-testid="inside-bell-hover">
        {atHover && hoverValue !== null
          ? `At ${formatSigned(hoverValue, 3)}: up height ${formatNumber(atHover.up, 4)}, down height ${formatNumber(atHover.down, 4)}, evidence ln(up ÷ down) = ${formatSigned(atHover.ratio, 4)}`
          : "Hover the curves to read both heights at any value."}
      </p>
      {atBar && value !== null && (
        <p className="text-[11px] text-neutral-200" data-testid="inside-bell-evidence">
          This bar's value {formatSigned(value, 3)}: up height {formatNumber(atBar.up, 4)} vs down height {formatNumber(atBar.down, 4)} → evidence{" "}
          <span style={{ color: directionColor(evidence ?? atBar.ratio) }}>
            {directionGlyph(evidence ?? atBar.ratio)} {formatSigned(evidence ?? atBar.ratio, 4)}
          </span>{" "}
          ({(evidence ?? atBar.ratio) >= 0 ? "pushes toward up" : "pushes toward down"})
        </p>
      )}
    </div>
  );
}
