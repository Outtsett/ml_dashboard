/**
 * The running total of a tree ensemble for one bar, and the step / play /
 * scrub control that adds trees one at a time.
 *
 * Boosting ("sum"): the base value plus every leaf so far, on the raw scale
 * (log-odds, or target units for a price model), with the chance of up (or the
 * move in points) on a second axis beside it. Forests ("mean"): the histogram
 * of the trees' votes so far and the running mean. Either way the last point
 * is `bar.trees.runningTotal`'s last value, which the contract makes equal to
 * `bar.output.raw` — the readout says whether it does.
 */
import { useEffect, useState, type PointerEvent } from "react";
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";

import type { CycleExplainBar, CycleExplainRole, CycleExplainStructure } from "@shared/cycle/explain";

import { Measured } from "@/ml/architecture/Measured";

import { CYCLE_COLORS } from "../../chartModel";
import { formatPercent } from "../../format";
import { linkBoundary, linkInverse } from "../OutputChain";
import { aggregationAt, formatSigned, formatValue, leafCenter, pushColor, pushGlyph, usedTreeTotal } from "./treeTypes";

// ─── stepping ───────────────────────────────────────────────────────────────

/** Milliseconds between play frames. */
export const PLAY_FRAME_MILLISECONDS = 60;

export interface TreeStepperState {
  step: number;
  total: number;
  playing: boolean;
  setStep: (step: number) => void;
  stepBy: (delta: number) => void;
  togglePlay: () => void;
}

/**
 * How many trees are counted. Starts at all of them; "all" stays "all" when
 * the bar changes to one whose model uses a different count.
 */
export function useTreeStepper(total: number): TreeStepperState {
  const [stored, setStored] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const step = stored === null ? total : Math.min(stored, total);

  const setStep = (next: number) => {
    const clamped = Math.max(0, Math.min(total, Math.round(next)));
    setStored(clamped >= total ? null : clamped);
  };

  useEffect(() => {
    if (!playing) return;
    const increment = Math.max(1, Math.ceil(total / 120));
    const timer = window.setInterval(() => {
      setStored((current) => {
        const next = (current === null ? total : current) + increment;
        return next >= total ? null : next;
      });
    }, PLAY_FRAME_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  // Reaching the last tree ends the play.
  useEffect(() => {
    if (playing && stored === null) setPlaying(false);
  }, [playing, stored]);

  return {
    step,
    total,
    playing,
    setStep,
    stepBy: (delta) => {
      setPlaying(false);
      setStep(step + delta);
    },
    togglePlay: () => {
      if (playing) {
        setPlaying(false);
        return;
      }
      if (step >= total) setStored(0);
      setPlaying(total > 0);
    },
  };
}

const buttonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-neutral-300 hover:bg-white/[0.08] disabled:opacity-40";

export function TreeStepper({ stepper }: { stepper: TreeStepperState }) {
  const { step, total, playing } = stepper;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="tree-stepper">
      <button type="button" className={buttonClass} onClick={() => stepper.setStep(0)} disabled={step === 0} aria-label="Back to no trees" title="Back to no trees">
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={buttonClass} onClick={() => stepper.stepBy(-1)} disabled={step === 0} aria-label="Remove one tree" title="Remove one tree">
        <StepBack className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={stepper.togglePlay}
        disabled={total === 0}
        aria-label={playing ? "Pause" : "Play: add the trees one at a time"}
        title={playing ? "Pause" : "Play: add the trees one at a time"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className={buttonClass} onClick={() => stepper.stepBy(1)} disabled={step >= total} aria-label="Add one tree" title="Add one tree">
        <StepForward className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={buttonClass} onClick={() => stepper.setStep(total)} disabled={step >= total} aria-label="All trees" title="All trees">
        <SkipForward className="h-3.5 w-3.5" />
      </button>
      <input
        type="range"
        min={0}
        max={total}
        step={1}
        value={step}
        onChange={(event) => stepper.setStep(Number(event.target.value))}
        aria-label="Trees counted"
        className="min-w-[120px] flex-1 accent-[#CC79A7]"
      />
      <span className="w-24 text-right font-mono text-[11px] tabular-nums text-neutral-400" data-testid="tree-stepper-count">
        {step} of {total} trees
      </span>
    </div>
  );
}

// ─── the running total ──────────────────────────────────────────────────────

export interface AggregationProps {
  bar: CycleExplainBar;
  structure: CycleExplainStructure;
  role: CycleExplainRole;
  step: number;
  onStep: (step: number) => void;
}

const CHART_HEIGHT = 160;
const MARGIN = { left: 46, right: 58, top: 12, bottom: 22 };

function niceTicks(minimum: number, maximum: number, count = 4): number[] {
  if (!(maximum > minimum)) return [minimum];
  const rough = (maximum - minimum) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = Math.ceil(minimum / unit) * unit; value <= maximum + unit * 1e-9; value += unit) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

function SumChart({ bar, structure, role, step, onStep, width }: AggregationProps & { width: number }) {
  const trees = bar.trees!;
  const total = trees.leafValues.length;
  const values = [trees.baseValue, ...trees.runningTotal];
  const boundary = linkBoundary(bar.link, structure);
  const final = values[values.length - 1] ?? trees.baseValue;
  const [hover, setHover] = useState<number | null>(null);

  let low = Math.min(...values, final);
  let high = Math.max(...values, final);
  if (boundary !== null) {
    low = Math.min(low, boundary);
    high = Math.max(high, boundary);
  }
  const padding = (high - low || 1) * 0.12;
  low -= padding;
  high += padding;
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (k: number) => MARGIN.left + (total === 0 ? 0 : (k / total) * plotWidth);
  const y = (value: number) => MARGIN.top + (1 - (value - low) / (high - low)) * plotHeight;
  const polyline = (upTo: number) =>
    values
      .slice(0, upTo + 1)
      .map((value, k) => `${x(k)},${y(value)}`)
      .join(" ");

  const probabilityTicks = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]
    .map((probability) => ({ probability, raw: linkInverse(bar.link, probability, structure) }))
    .filter((tick): tick is { probability: number; raw: number } => tick.raw !== null && tick.raw >= low && tick.raw <= high);
  const scale = bar.output.scale;
  const leftTicks = niceTicks(low, high);
  const current = values[step] ?? final;
  const shown = hover ?? step;
  const shownValue = values[shown] ?? final;
  const shownPoint = aggregationAt(bar, structure, shown);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const k = Math.round(((event.clientX - rect.left - MARGIN.left) / plotWidth) * total);
    setHover(Math.max(0, Math.min(total, k)));
  };

  return (
    <svg
      width={width}
      height={CHART_HEIGHT}
      role="img"
      aria-label="Running total of the trees"
      className="block cursor-crosshair select-none"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onClick={() => hover !== null && onStep(hover)}
    >
      {leftTicks.map((tick) => (
        <g key={`left-${tick}`}>
          <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.05)" />
          <text x={MARGIN.left - 4} y={y(tick) + 3} fontSize={9} textAnchor="end" fill={CYCLE_COLORS.neutral} fontFamily="var(--font-mono)">
            {formatValue(tick, 3)}
          </text>
        </g>
      ))}
      <text x={4} y={MARGIN.top - 2} fontSize={9} fill={CYCLE_COLORS.neutral}>
        {role === "price" ? "target units" : bar.link === "logistic" ? "log-odds" : "raw"}
      </text>
      {role === "price" && scale !== null
        ? leftTicks.map((tick) => (
            <text key={`right-${tick}`} x={MARGIN.left + plotWidth + 4} y={y(tick) + 3} fontSize={9} fill={CYCLE_COLORS.sky} fontFamily="var(--font-mono)">
              {formatSigned(tick * scale, 3)} pts
            </text>
          ))
        : probabilityTicks.map((tick) => (
            <text key={`right-${tick.probability}`} x={MARGIN.left + plotWidth + 4} y={y(tick.raw) + 3} fontSize={9} fill={CYCLE_COLORS.sky} fontFamily="var(--font-mono)">
              {Math.round(tick.probability * 100)}% up
            </text>
          ))}
      {boundary !== null && (
        <g>
          <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(boundary)} y2={y(boundary)} stroke={CYCLE_COLORS.neutral} strokeDasharray="3 3" opacity={0.6} />
          <text x={MARGIN.left + 3} y={y(boundary) - 3} fontSize={9} fill={CYCLE_COLORS.neutral}>
            {role === "price" ? "no move" : "50% — above is ▲ up, below ▼ down"}
          </text>
        </g>
      )}
      <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(final)} y2={y(final)} stroke={CYCLE_COLORS.yellow} strokeDasharray="5 3" opacity={0.8} />
      <text x={MARGIN.left + plotWidth - 2} y={y(final) - 3} fontSize={9} textAnchor="end" fill={CYCLE_COLORS.yellow}>
        final {formatValue(final)}
      </text>
      <polyline points={polyline(total)} fill="none" stroke={CYCLE_COLORS.neutral} strokeOpacity={0.35} strokeWidth={1} />
      <polyline points={polyline(step)} fill="none" stroke={CYCLE_COLORS.sky} strokeWidth={2} />
      <circle cx={x(step)} cy={y(current)} r={4} fill={pushColor(current - (boundary ?? 0))} stroke="white" strokeWidth={1} />
      <text x={x(step)} y={y(current) - 7} fontSize={10} textAnchor="middle" fill={pushColor(current - (boundary ?? 0))}>
        {pushGlyph(current - (boundary ?? 0))}
      </text>
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="rgba(255,255,255,0.3)" />
          <text x={MARGIN.left + 4} y={CHART_HEIGHT - 6} fontSize={10} fill="white" fontFamily="var(--font-mono)">
            {`after ${shown} trees: ${formatValue(shownValue)}${shownPoint.probabilityUp !== null && role !== "price" ? ` → ${formatPercent(shownPoint.probabilityUp)} up` : ""}${role === "price" && scale !== null ? ` = ${formatSigned(shownValue * scale, 3)} points` : ""} · click to go there`}
          </text>
        </g>
      )}
    </svg>
  );
}

function VoteChart({ bar, structure, step, width }: AggregationProps & { width: number }) {
  const trees = bar.trees!;
  const total = trees.leafValues.length;
  const center = leafCenter(structure);
  const direction = structure.link === "mean_probability";
  const minimum = direction ? 0 : Math.min(...trees.leafValues, center);
  const maximum = direction ? 1 : Math.max(...trees.leafValues, center);
  const binCount = 10;
  const binWidth = (maximum - minimum || 1) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  for (let index = 0; index < step; index += 1) {
    const value = trees.leafValues[index] ?? 0;
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor((value - minimum) / binWidth)));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  const tallest = Math.max(1, ...counts);
  const [hover, setHover] = useState<number | null>(null);
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (value: number) => MARGIN.left + ((value - minimum) / (maximum - minimum || 1)) * plotWidth;
  const barHeight = (count: number) => (count / tallest) * plotHeight;
  const mean = step === 0 ? null : trees.runningTotal[step - 1] ?? null;
  const final = trees.runningTotal[total - 1] ?? null;

  return (
    <svg width={width} height={CHART_HEIGHT} role="img" aria-label="The trees' votes" className="block select-none" onPointerLeave={() => setHover(null)}>
      {counts.map((count, bin) => {
        const from = minimum + bin * binWidth;
        const middle = from + binWidth / 2;
        const color = pushColor(middle - center);
        const left = x(from) + 1;
        const barWidth = Math.max(1, x(from + binWidth) - x(from) - 2);
        return (
          <g key={bin} onPointerEnter={() => setHover(bin)}>
            <rect x={left} y={MARGIN.top} width={barWidth} height={plotHeight} fill="transparent" />
            <rect x={left} y={MARGIN.top + plotHeight - barHeight(count)} width={barWidth} height={barHeight(count)} fill={color} opacity={hover === bin ? 1 : 0.75} />
            {count > 0 && (
              <text x={left + barWidth / 2} y={MARGIN.top + plotHeight - barHeight(count) - 2} fontSize={9} textAnchor="middle" fill={color}>
                {count}
              </text>
            )}
          </g>
        );
      })}
      <line x1={x(center)} x2={x(center)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={CYCLE_COLORS.neutral} strokeDasharray="3 3" />
      {final !== null && <line x1={x(final)} x2={x(final)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={CYCLE_COLORS.yellow} strokeDasharray="5 3" />}
      {mean !== null && <line x1={x(mean)} x2={x(mean)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={CYCLE_COLORS.sky} strokeWidth={2} />}
      {[minimum, center, maximum].map((tick) => (
        <text key={tick} x={x(tick)} y={CHART_HEIGHT - 8} fontSize={9} textAnchor="middle" fill={CYCLE_COLORS.neutral} fontFamily="var(--font-mono)">
          {direction ? `${Math.round(tick * 100)}%` : formatValue(tick, 3)}
        </text>
      ))}
      <text x={MARGIN.left} y={MARGIN.top - 2} fontSize={9} fill={CYCLE_COLORS.neutral}>
        {direction ? "each tree's vote for up · ▼ blue below 50%, ▲ orange above" : "each tree's predicted move · ▼ blue below zero, ▲ orange above"}
      </text>
      {hover !== null && (
        <text x={MARGIN.left + plotWidth} y={MARGIN.top + 10} fontSize={10} textAnchor="end" fill="white" fontFamily="var(--font-mono)" pointerEvents="none">
          {`${counts[hover]} of ${step} trees voted ${formatValue(minimum + hover * binWidth, 3)} to ${formatValue(minimum + (hover + 1) * binWidth, 3)}`}
        </text>
      )}
    </svg>
  );
}

export function Aggregation(props: AggregationProps) {
  const { bar, structure, role, step } = props;
  const trees = bar.trees;
  if (!trees || !structure.trees) return <p className="text-xs text-neutral-400">This bar carries no tree paths.</p>;
  const total = usedTreeTotal(trees);
  const mean = structure.trees.aggregation === "mean";
  const point = aggregationAt(bar, structure, step);
  const finalPoint = aggregationAt(bar, structure, total);
  const finalValue = finalPoint.value;
  const matches = finalValue !== null && Math.abs(finalValue - bar.output.raw) <= 1e-9 * Math.max(1, Math.abs(bar.output.raw));
  const scale = bar.output.scale;

  let readout: string;
  if (point.value === null) readout = `No trees counted yet — step or play to add them.`;
  else if (mean) readout = `After ${point.treesIncluded} of ${total} trees: the average vote is ${formatValue(point.value)}`;
  else readout = `After ${point.treesIncluded} of ${total} trees: start ${formatValue(trees.baseValue)} + leaves ${formatSigned(point.leafSum)} = ${formatValue(point.value)}`;
  if (point.value !== null) {
    if (role === "price" && scale !== null) readout += ` target units × ${formatValue(scale)} = ${formatSigned(point.value * scale)} points`;
    else if (point.probabilityUp !== null && !(mean && bar.link === "mean_probability")) readout += ` → ${formatPercent(point.probabilityUp)} chance of up`;
    else if (point.probabilityUp !== null) readout += ` = ${formatPercent(point.probabilityUp)} chance of up`;
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="tree-aggregation">
      <p className="text-[11px] text-neutral-500">
        {mean
          ? "Each tree votes; the forest's answer is the average of the votes. Add the trees one at a time and watch the average settle."
          : "Start at the base value and add each tree's leaf; the total, through the link, is the model's answer."}
      </p>
      <Measured height={CHART_HEIGHT} minWidth={120} className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
        {({ width }) => (mean ? <VoteChart {...props} width={width} /> : <SumChart {...props} width={width} />)}
      </Measured>
      <p className="font-mono text-[11px] text-neutral-200" data-testid="aggregation-readout" data-value={point.value ?? ""}>
        {readout}
      </p>
      <p className="text-[11px] text-neutral-400" data-testid="aggregation-final" data-value={finalValue ?? ""}>
        All {total} trees land on <span className="font-mono">{formatValue(finalValue)}</span>; the model's output is{" "}
        <span className="font-mono">{formatValue(bar.output.raw)}</span> — {matches ? "✓ the same number" : "✗ they differ"}.
      </p>
    </div>
  );
}
