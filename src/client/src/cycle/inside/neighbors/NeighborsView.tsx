/**
 * Inside the model — k-nearest neighbors: the training bars whose inputs
 * looked most like this bar's, on a timeline (when they happened) against
 * their distance (how alike), each drawn ▲ orange if it went up and ▼ blue if
 * it went down, sized by its vote weight. A slider sets how many of them
 * count, so the user can watch the vote change; the model's own k is marked,
 * and at that k the vote is the model's output.
 *
 * Reads `bar.neighbors` and `structure.neighbors`. See `../types.ts`.
 */
import { useState } from "react";

import type { InsideKindViewProps } from "../types";

import { formatCount, formatPercent, formatTime } from "@/cycle/format";

import { INSIDE_COLORS, directionColor, directionGlyph, formatNumber, formatSigned, probabilityVerdict } from "../linear/link";
import { neighborVote, sortedNeighbors, type Neighbor } from "./vote";

const WIDTH = 360;
const HEIGHT = 190;
const MARGIN = { left: 40, right: 12, top: 12, bottom: 30 };

function triangle(cx: number, cy: number, size: number, up: boolean): string {
  const half = size;
  return up
    ? `${cx},${cy - half} ${cx - half},${cy + half * 0.8} ${cx + half},${cy + half * 0.8}`
    : `${cx},${cy + half} ${cx - half},${cy - half * 0.8} ${cx + half},${cy - half * 0.8}`;
}

function describe(neighbor: Neighbor, rank: number, role: InsideKindViewProps["role"]): string {
  const outcome =
    role === "price"
      ? `moved ${formatSigned(neighbor.target, 3)} typical moves`
      : neighbor.target >= 0.5
        ? "went up ▲"
        : "went down ▼";
  return `#${rank} ${formatTime(neighbor.timestamp)}: distance ${formatNumber(neighbor.distance, 4)}, vote weight ${formatNumber(neighbor.weight, 4)}, ${outcome}`;
}

export function NeighborsView({ structure, bar, role }: InsideKindViewProps) {
  const block = bar.neighbors;
  const neighbors = block ? sortedNeighbors(block) : [];
  const modelCount = Math.min(structure.neighbors?.neighborCount ?? neighbors.length, neighbors.length);
  const [chosen, setChosen] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (!block || neighbors.length === 0) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no neighbors.</p>;
  }
  const counted = Math.max(1, Math.min(chosen ?? modelCount, neighbors.length));
  const vote = neighborVote(neighbors, counted);
  const modelVote = neighborVote(neighbors, modelCount);

  const times = neighbors.map((neighbor) => neighbor.timestamp);
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const timeSpan = lastTime - firstTime || 1;
  const largestDistance = Math.max(...neighbors.map((neighbor) => neighbor.distance), 1e-12);
  const largestWeight = Math.max(...neighbors.map((neighbor) => neighbor.weight), 1e-12);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (time: number) => MARGIN.left + ((time - firstTime) / timeSpan) * plotWidth;
  // Top = most alike (distance 0), bottom = the farthest neighbor listed.
  const y = (distance: number) => MARGIN.top + (distance / (largestDistance * 1.05)) * plotHeight;

  const wentUp = (neighbor: Neighbor) => (role === "price" ? neighbor.target > 0 : neighbor.target >= 0.5);
  const weighting = structure.neighbors?.weighting ?? "uniform";

  return (
    <div className="flex flex-col gap-2" data-testid="inside-neighbors-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as asking the most look-alike moments in the training bars what happened next: {role === "price" ? "their average move" : "the share that went up"} is the answer.
      </p>
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
        Neighbors counted
        <input
          type="range"
          aria-label="Neighbors counted"
          min={1}
          max={neighbors.length}
          step={1}
          value={counted}
          onChange={(event) => setChosen(Number(event.target.value))}
          className="w-40"
        />
        <span className="tabular-nums text-neutral-100" data-testid="inside-neighbors-counted">
          {counted}
        </span>
        <span className="text-[10px] text-neutral-400">
          (the model counts {modelCount}; {weighting === "distance" ? "closer neighbors weigh more: weight = 1 ÷ distance" : "every neighbor weighs the same"})
        </span>
        {counted !== modelCount && (
          <button
            type="button"
            className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-white/10"
            onClick={() => setChosen(null)}
          >
            Back to the model's {modelCount}
          </button>
        )}
      </label>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[30rem]" role="img" aria-label="The nearest training bars: time across, distance down, up bars as orange up-triangles, down bars as blue down-triangles">
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.4} />
        <text x={MARGIN.left - 4} y={MARGIN.top + 4} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          0
        </text>
        <text x={MARGIN.left - 4} y={y(largestDistance) + 3} textAnchor="end" fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatNumber(largestDistance, 2)}
        </text>
        <text x={10} y={MARGIN.top + plotHeight / 2} fontSize={9} fill={INSIDE_COLORS.neutral} transform={`rotate(-90 10 ${MARGIN.top + plotHeight / 2})`} textAnchor="middle">
          distance (top = most alike)
        </text>
        <text x={MARGIN.left} y={HEIGHT - 16} fontSize={9} fill={INSIDE_COLORS.neutral}>
          {formatTime(firstTime)}
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 16} fontSize={9} textAnchor="end" fill={INSIDE_COLORS.neutral}>
          {formatTime(lastTime)}
        </text>
        <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill={INSIDE_COLORS.neutral}>
          when the training bar happened (this bar is later: {formatTime(bar.timestamp)})
        </text>
        {neighbors.map((neighbor, index) => {
          const isCounted = index < counted;
          const up = wentUp(neighbor);
          const color = up ? INSIDE_COLORS.up : INSIDE_COLORS.down;
          const size = 3 + 6 * Math.sqrt(Math.max(neighbor.weight, 0) / largestWeight);
          const text = describe(neighbor, index + 1, role);
          return (
            <polygon
              key={`${neighbor.timestamp}-${index}`}
              points={triangle(x(neighbor.timestamp), y(neighbor.distance), size, up)}
              fill={isCounted ? color : "none"}
              stroke={isCounted ? color : INSIDE_COLORS.neutral}
              strokeOpacity={isCounted ? 1 : 0.6}
              strokeWidth={1.2}
              data-testid="inside-neighbor-marker"
              data-counted={isCounted}
              onMouseEnter={() => setHover(text)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{text}</title>
            </polygon>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[10px] text-neutral-300">
        <span style={{ color: INSIDE_COLORS.up }}>▲ went up</span>
        <span style={{ color: INSIDE_COLORS.down }}>▼ went down</span>
        <span>hollow grey = not counted at this setting</span>
        <span>bigger = larger vote weight</span>
      </div>
      <p className="min-h-4 text-[10px] text-neutral-400" data-testid="inside-hover-readout">
        {hover ?? "Hover a neighbor for its time, distance, weight and what happened next."}
      </p>

      <VoteBar role={role} vote={vote} counted={counted} />

      {modelVote !== null && (
        <p className="text-xs text-neutral-100" data-testid="inside-sum" data-value={modelVote}>
          {role === "price" ? (
            <>
              The model's {modelCount} neighbors: weighted mean move{" "}
              <span className="font-semibold" style={{ color: directionColor(modelVote) }}>
                {directionGlyph(modelVote)} {formatSigned(modelVote, 4)} typical moves
              </span>
              {bar.output.scale !== null && <> = {formatSigned(modelVote * bar.output.scale, 2)} points</>}
            </>
          ) : (
            <span data-testid="inside-probability" data-value={modelVote}>
              The model's {modelCount} neighbors: P(up) ={" "}
              <span className="font-semibold" style={{ color: probabilityVerdict(modelVote).color }}>
                {formatPercent(modelVote, 2)} {probabilityVerdict(modelVote).glyph} {probabilityVerdict(modelVote).word}
              </span>
            </span>
          )}
        </p>
      )}
      <p className="text-[10px] text-neutral-400">
        Out of {formatCount(structure.neighbors?.trainingBarCount ?? null)} training bars, these {neighbors.length} were the closest in the model's inputs.
      </p>
    </div>
  );
}

function VoteBar({ role, vote, counted }: { role: InsideKindViewProps["role"]; vote: number | null; counted: number }) {
  if (vote === null) {
    return (
      <p className="text-[11px] text-neutral-400" data-testid="inside-neighbors-vote">
        The counted neighbors carry no vote weight.
      </p>
    );
  }
  if (role === "price") {
    return (
      <p className="text-[11px] text-neutral-200" data-testid="inside-neighbors-vote" data-value={vote}>
        With {counted} counted: weighted mean move{" "}
        <span style={{ color: directionColor(vote) }}>
          {directionGlyph(vote)} {formatSigned(vote, 4)} typical moves
        </span>
      </p>
    );
  }
  const verdict = probabilityVerdict(vote);
  return (
    <div className="flex flex-col gap-1" data-testid="inside-neighbors-vote" data-value={vote}>
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-3 w-full max-w-[30rem]" aria-hidden>
        <rect x={0} y={0} width={vote * 100} height={8} fill={INSIDE_COLORS.up} />
        <rect x={vote * 100} y={0} width={(1 - vote) * 100} height={8} fill={INSIDE_COLORS.down} />
        <line x1={50} x2={50} y1={0} y2={8} stroke={INSIDE_COLORS.neutral} strokeWidth={0.6} />
      </svg>
      <p className="text-[11px] text-neutral-200">
        With {counted} counted: <span style={{ color: INSIDE_COLORS.up }}>▲ up {formatPercent(vote)}</span> ·{" "}
        <span style={{ color: INSIDE_COLORS.down }}>▼ down {formatPercent(1 - vote)}</span> → the vote says{" "}
        <span style={{ color: verdict.color }}>
          {verdict.glyph} {verdict.word}
        </span>
      </p>
    </div>
  );
}
