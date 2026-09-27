/**
 * The last step of a "sum, then link" model: the curve that turns the raw
 * sum into P(up), with this bar's point on it (and, while the user steps
 * through the waterfall, a hollow point at the running sum so far). For a
 * price model the link is the identity, so this draws the move instead: the
 * sum in typical moves times points per typical move.
 *
 * Hovering the curve reads it at the pointer. The P(up) printed here is the
 * link applied to the sum the view drew — it must equal the bar's
 * `output.probabilityUp`.
 */
import { useState, type MouseEvent } from "react";

import type { CycleExplainBar, CycleExplainLink, CycleExplainStructure } from "@shared/cycle/explain";

import { formatPercent } from "@/cycle/format";

import { INSIDE_COLORS, applyLink, directionColor, directionGlyph, formatNumber, formatSigned, isDrawableLink, linkSentence, probabilityVerdict, rawOutputName } from "./link";

const WIDTH = 300;
const HEIGHT = 180;
const MARGIN = { left: 34, right: 10, top: 10, bottom: 28 };
const SAMPLES = 120;

/** The raw-score range the curve is drawn over: the curve's own bend, widened to hold both points. */
export function linkDomain(link: CycleExplainLink, curve: CycleExplainStructure["logisticCurve"], values: number[]): [number, number] {
  let low = -5;
  let high = 5;
  if (link === "probit") {
    low = -3;
    high = 3;
  } else if (link === "logistic_curve" && curve && curve.slope !== 0) {
    const center = -curve.intercept / curve.slope;
    const half = 5 / Math.abs(curve.slope);
    low = center - half;
    high = center + half;
  }
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const pad = (high - low) * 0.08;
    low = Math.min(low, value - pad);
    high = Math.max(high, value + pad);
  }
  return [low, high];
}

interface LinkCurveProps {
  link: CycleExplainLink;
  structure: CycleExplainStructure;
  bar: CycleExplainBar;
  /** The sum the view drew — the model's raw output. */
  raw: number;
  /** The running sum while stepping, drawn hollow; omit or equal to `raw` when every term is in. */
  running?: number;
  /** What the running point is called ("after 3 of 6 features"). */
  runningLabel?: string;
}

export function LinkCurve({ link, structure, bar, raw, running, runningLabel }: LinkCurveProps) {
  if (link === "identity") return <PriceMove bar={bar} raw={raw} running={running} runningLabel={runningLabel} />;
  if (!isDrawableLink(link)) return null;
  return <ProbabilityCurve link={link} curve={structure.logisticCurve} raw={raw} running={running} runningLabel={runningLabel} />;
}

function ProbabilityCurve({
  link,
  curve,
  raw,
  running,
  runningLabel,
}: {
  link: CycleExplainLink;
  curve: CycleExplainStructure["logisticCurve"];
  raw: number;
  running?: number;
  runningLabel?: string;
}) {
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const probability = applyLink(link, raw, curve);
  const showRunning = running !== undefined && Math.abs(running - raw) > 1e-12;
  const runningProbability = showRunning ? applyLink(link, running, curve) : null;
  const [low, high] = linkDomain(link, curve, showRunning ? [raw, running] : [raw]);

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (score: number) => MARGIN.left + ((score - low) / (high - low)) * plotWidth;
  const y = (p: number) => MARGIN.top + (1 - p) * plotHeight;

  const path: string[] = [];
  for (let index = 0; index <= SAMPLES; index += 1) {
    const score = low + ((high - low) * index) / SAMPLES;
    const p = applyLink(link, score, curve);
    if (p === null) continue;
    path.push(`${path.length === 0 ? "M" : "L"}${x(score).toFixed(2)},${y(p).toFixed(2)}`);
  }

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const svgX = ((event.clientX - box.left) / box.width) * WIDTH;
    const score = low + ((svgX - MARGIN.left) / plotWidth) * (high - low);
    setHoverScore(Math.max(low, Math.min(high, score)));
  };
  const hoverProbability = hoverScore === null ? null : applyLink(link, hoverScore, curve);
  const verdict = probability === null ? null : probabilityVerdict(probability);

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="inside-link-curve" data-link={link}>
      <p className="text-[11px] font-medium text-neutral-200">From the sum to the probability of up, P(up)</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-[22rem]"
        role="img"
        aria-label={`Link curve: ${rawOutputName(link)} on the horizontal axis, probability of up on the vertical axis`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverScore(null)}
      >
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0.5)} y2={y(0.5)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.5} strokeDasharray="4 3" />
        <text x={MARGIN.left - 4} y={y(1) + 4} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          100%
        </text>
        <text x={MARGIN.left - 4} y={y(0.5) + 3} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          50%
        </text>
        <text x={MARGIN.left - 4} y={y(0) + 3} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          0%
        </text>
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0)} y2={y(0)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <text x={MARGIN.left} y={HEIGHT - 16} fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(low, 2)}
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 16} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(high, 2)}
        </text>
        <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill={INSIDE_COLORS.neutral}>
          {rawOutputName(link)}
        </text>
        <path d={path.join(" ")} fill="none" stroke={INSIDE_COLORS.sky} strokeWidth={2} />
        {hoverScore !== null && hoverProbability !== null && (
          <circle cx={x(hoverScore)} cy={y(hoverProbability)} r={3} fill={INSIDE_COLORS.neutral} />
        )}
        {showRunning && runningProbability !== null && running !== undefined && (
          <circle cx={x(running)} cy={y(runningProbability)} r={5} fill="none" stroke={INSIDE_COLORS.step} strokeWidth={2}>
            <title>{`${runningLabel ?? "Running sum"}: ${formatSigned(running, 4)} → P(up) ${formatPercent(runningProbability)}`}</title>
          </circle>
        )}
        {probability !== null && (
          <>
            <line x1={x(raw)} x2={x(raw)} y1={y(0)} y2={y(probability)} stroke={INSIDE_COLORS.bar} strokeOpacity={0.6} strokeDasharray="2 2" />
            <circle cx={x(raw)} cy={y(probability)} r={5} fill={INSIDE_COLORS.bar} data-testid="inside-link-point">
              <title>{`This bar: ${rawOutputName(link)} ${formatSigned(raw, 4)} → P(up) ${formatPercent(probability)}`}</title>
            </circle>
          </>
        )}
      </svg>
      <p className="min-h-4 text-[10px] text-neutral-400" data-testid="inside-link-hover">
        {hoverScore !== null && hoverProbability !== null
          ? `At ${rawOutputName(link)} ${formatSigned(hoverScore, 3)}: P(up) = ${formatPercent(hoverProbability)}`
          : "Hover the curve to read it at any score."}
      </p>
      {showRunning && runningProbability !== null && running !== undefined && (
        <p className="text-[10px] text-neutral-300" data-testid="inside-link-running">
          ◯ {runningLabel ?? "Running sum"}: {formatSigned(running, 4)} → P(up) {formatPercent(runningProbability)}
        </p>
      )}
      {probability !== null && verdict !== null ? (
        <p className="text-xs text-neutral-100" data-testid="inside-probability" data-value={probability}>
          ● This bar: {formatSigned(raw, 4)} → P(up) ={" "}
          <span className="font-semibold" style={{ color: verdict.color }}>
            {formatPercent(probability, 2)} {verdict.glyph} {verdict.word}
          </span>
        </p>
      ) : (
        <p className="text-xs text-neutral-400">The validation curve was not recorded, so this score has no probability.</p>
      )}
      <p className="text-[10px] text-neutral-400">{linkSentence(link, curve)}</p>
    </div>
  );
}

function PriceMove({ bar, raw, running, runningLabel }: { bar: CycleExplainBar; raw: number; running?: number; runningLabel?: string }) {
  const scale = bar.output.scale;
  const movePoints = scale === null ? null : raw * scale;
  const predictedClose = movePoints === null ? null : bar.output.close + movePoints;
  const showRunning = running !== undefined && Math.abs(running - raw) > 1e-12;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[11px]" data-testid="inside-price-move" data-value={movePoints ?? undefined}>
      <p className="font-medium text-neutral-200">From the sum to a price</p>
      <p className="text-neutral-300">
        Predicted move:{" "}
        <span style={{ color: directionColor(raw) }}>
          {directionGlyph(raw)} {formatSigned(raw, 4)} typical moves
        </span>
      </p>
      <p className="text-neutral-300">
        × {formatNumber(scale, 2)} points per typical move (the trailing volatility at this bar) ={" "}
        <span className="font-semibold" style={{ color: directionColor(raw) }}>
          {directionGlyph(raw)} {formatSigned(movePoints, 2)} points
        </span>
      </p>
      <p className="text-neutral-300">
        Predicted close: {formatNumber(predictedClose, 2)} (from this bar's close {formatNumber(bar.output.close, 2)})
      </p>
      {showRunning && running !== undefined && (
        <p className="text-[10px] text-neutral-400" data-testid="inside-link-running">
          ◯ {runningLabel ?? "Running sum"}: {formatSigned(running, 4)} typical moves = {formatSigned(scale === null ? null : running * scale, 2)} points
        </p>
      )}
      <p className="text-[10px] text-neutral-400">{linkSentence("identity", null)}</p>
    </div>
  );
}
