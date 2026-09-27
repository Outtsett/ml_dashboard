/**
 * Inside the model — a calibrated classifier: the base model gives this bar a
 * score, and the calibration map (fitted on the validation bars: a smooth
 * S-curve for "sigmoid", a staircase for "isotonic") turns the score into
 * P(up). The reference line is what the score would mean with no
 * calibration: the score itself when it is already a probability (the
 * diagonal), otherwise the S-curve of the score read as log-odds. A toggle
 * draws how far the map moved this bar; a slider reads the map at any score.
 *
 * Reads `structure.calibration` and `bar.calibration`. See `../types.ts`.
 */
import { useState } from "react";

import type { InsideKindViewProps } from "../types";

import { formatPercent } from "@/cycle/format";

import { INSIDE_COLORS, directionColor, formatNumber, logistic, probabilityVerdict } from "../linear/link";
import { modelWords } from "../stacking/StackingView";

const WIDTH = 320;
const HEIGHT = 220;
const MARGIN = { left: 34, right: 10, top: 10, bottom: 30 };

/** The map read at `score`: straight lines between the sampled points, flat beyond the ends. */
export function readCalibrationMap(curve: { baseScore: number[]; probabilityUp: number[] }, score: number): number | null {
  const scores = curve.baseScore;
  const probabilities = curve.probabilityUp;
  const count = Math.min(scores.length, probabilities.length);
  if (count === 0) return null;
  if (score <= (scores[0] ?? score)) return probabilities[0] ?? null;
  if (score >= (scores[count - 1] ?? score)) return probabilities[count - 1] ?? null;
  for (let index = 1; index < count; index += 1) {
    const right = scores[index] ?? 0;
    if (score <= right) {
      const left = scores[index - 1] ?? 0;
      const low = probabilities[index - 1] ?? 0;
      const high = probabilities[index] ?? 0;
      const fraction = right === left ? 1 : (score - left) / (right - left);
      return low + fraction * (high - low);
    }
  }
  return probabilities[count - 1] ?? null;
}

export function CalibrationView({ structure, bar }: InsideKindViewProps) {
  const [showMove, setShowMove] = useState(true);
  const [probe, setProbe] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const map = structure.calibration;
  const point = bar.calibration;
  if (!map || !point) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no calibration map.</p>;
  }

  const scores = map.curve.baseScore;
  const scoreIsProbability = scores.every((score) => score >= 0 && score <= 1) && point.baseScore >= 0 && point.baseScore <= 1;
  const reference = (score: number) => (scoreIsProbability ? score : logistic(score));
  let low = Math.min(...scores, point.baseScore);
  let high = Math.max(...scores, point.baseScore);
  if (scoreIsProbability) {
    low = 0;
    high = 1;
  }
  if (high === low) high = low + 1;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (score: number) => MARGIN.left + ((score - low) / (high - low)) * plotWidth;
  const y = (p: number) => MARGIN.top + (1 - p) * plotHeight;

  const mapPath = scores
    .map((score, index) => `${index === 0 ? "M" : "L"}${x(score).toFixed(2)},${y(map.curve.probabilityUp[index] ?? 0).toFixed(2)}`)
    .join(" ");
  const referencePath = Array.from({ length: 61 }, (_, index) => low + ((high - low) * index) / 60)
    .map((score, index) => `${index === 0 ? "M" : "L"}${x(score).toFixed(2)},${y(reference(score)).toFixed(2)}`)
    .join(" ");

  const before = reference(point.baseScore);
  const moved = point.probabilityUp - before;
  const verdict = probabilityVerdict(point.probabilityUp);
  const probeScore = probe ?? point.baseScore;
  const probeProbability = readCalibrationMap(map.curve, probeScore);
  const methodWords = map.method === "sigmoid" ? "a smooth S-curve (sigmoid, Platt scaling)" : "a staircase (isotonic)";

  return (
    <div className="flex flex-col gap-2" data-testid="inside-calibration-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as a translation table: the {modelWords(map.baseModel).toLowerCase()} gives a score, and {methodWords}, fitted on the validation bars, says how
        often bars with that score really went up.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
        <button
          type="button"
          aria-pressed={showMove}
          onClick={() => setShowMove(!showMove)}
          className={`rounded border px-1.5 py-0.5 text-[10px] text-neutral-200 ${showMove ? "border-white/40 bg-white/15" : "border-white/15 bg-white/[0.04] hover:bg-white/10"}`}
        >
          {showMove ? "Hide how far calibration moved it" : "Show how far calibration moved it"}
        </button>
        <label className="flex items-center gap-2">
          Read the map at a score
          <input
            type="range"
            aria-label="Read the calibration map at a base score"
            min={low}
            max={high}
            step={(high - low) / 200}
            value={probeScore}
            onChange={(event) => setProbe(Number(event.target.value))}
            className="w-36"
          />
        </label>
        <span className="tabular-nums text-neutral-100" data-testid="inside-calibration-probe" data-value={probeProbability ?? undefined}>
          score {formatNumber(probeScore, 3)} → P(up) {formatPercent(probeProbability)}
        </span>
        {probe !== null && (
          <button type="button" onClick={() => setProbe(null)} className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-white/10">
            Back to this bar
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[24rem]" role="img" aria-label="Calibration map: base score across, probability of up up the side">
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0)} y2={y(0)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={y(0)} y2={y(1)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(0.5)} y2={y(0.5)} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.35} strokeDasharray="4 3" />
        {["0%", "50%", "100%"].map((label, index) => (
          <text key={label} x={MARGIN.left - 4} y={y(index / 2) + 3} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
            {label}
          </text>
        ))}
        <text x={MARGIN.left} y={HEIGHT - 16} fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(low, 2)}
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 16} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(high, 2)}
        </text>
        <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill={INSIDE_COLORS.neutral}>
          base model's score
        </text>
        <path d={referencePath} fill="none" stroke={INSIDE_COLORS.neutral} strokeWidth={1.2} strokeDasharray="3 3" data-testid="inside-calibration-reference" />
        <path
          d={mapPath}
          fill="none"
          stroke={INSIDE_COLORS.sky}
          strokeWidth={2}
          data-testid="inside-calibration-map"
          onMouseEnter={() => setHover(`The calibration map (${map.method}), fitted on the validation bars`)}
          onMouseLeave={() => setHover(null)}
        />
        {showMove && (
          <g data-testid="inside-calibration-move">
            <circle cx={x(point.baseScore)} cy={y(before)} r={3.5} fill="none" stroke={INSIDE_COLORS.neutral} strokeWidth={1.5} />
            <line x1={x(point.baseScore)} x2={x(point.baseScore)} y1={y(before)} y2={y(point.probabilityUp)} stroke={directionColor(moved)} strokeWidth={2} />
            <text x={x(point.baseScore) + 6} y={(y(before) + y(point.probabilityUp)) / 2 + 3} fontSize={9} fill={directionColor(moved)}>
              {moved >= 0 ? "▲" : "▼"} {moved >= 0 ? "+" : "−"}
              {Math.abs(moved * 100).toFixed(1)} points
            </text>
          </g>
        )}
        {probe !== null && probeProbability !== null && <circle cx={x(probeScore)} cy={y(probeProbability)} r={4} fill="none" stroke={INSIDE_COLORS.step} strokeWidth={2} />}
        <circle
          cx={x(point.baseScore)}
          cy={y(point.probabilityUp)}
          r={5}
          fill={INSIDE_COLORS.bar}
          onMouseEnter={() => setHover(`This bar: base score ${formatNumber(point.baseScore, 4)} → P(up) ${formatPercent(point.probabilityUp, 2)}`)}
          onMouseLeave={() => setHover(null)}
        >
          <title>{`This bar: base score ${formatNumber(point.baseScore, 4)} → P(up) ${formatPercent(point.probabilityUp, 2)}`}</title>
        </circle>
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[10px] text-neutral-300">
        <span style={{ color: INSIDE_COLORS.sky }}>━ calibration map</span>
        <span style={{ color: INSIDE_COLORS.neutral }}>┅ {scoreIsProbability ? "no calibration (the diagonal: the score taken as P(up))" : "no calibration (the score read as log-odds through the S-curve)"}</span>
        <span style={{ color: INSIDE_COLORS.bar }}>● this bar</span>
      </div>
      <p className="min-h-4 text-[10px] text-neutral-400" data-testid="inside-hover-readout">
        {hover ?? "Hover the map or this bar's point for exact values."}
      </p>
      {showMove && (
        <p className="text-[11px] text-neutral-200">
          Without calibration this score would read {formatPercent(before, 1)}; the map moved it{" "}
          <span style={{ color: directionColor(moved) }}>
            {moved >= 0 ? "▲ up" : "▼ down"} by {Math.abs(moved * 100).toFixed(1)} percentage points
          </span>
          .
        </p>
      )}
      <p className="text-xs text-neutral-100" data-testid="inside-probability" data-value={point.probabilityUp}>
        ● This bar: base score {formatNumber(point.baseScore, 4)} → P(up) ={" "}
        <span className="font-semibold" style={{ color: verdict.color }}>
          {formatPercent(point.probabilityUp, 2)} {verdict.glyph} {verdict.word}
        </span>
      </p>
    </div>
  );
}
