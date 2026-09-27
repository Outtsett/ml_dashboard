/**
 * Where the model looked: for the bar being predicted, one attention head's
 * weights over the window's bars (oldest left, the predicted bar right). Each
 * bar's height and viridis colour both carry the weight; hover gives the exact
 * share. A head selector (plus "average of heads") and, when the network has
 * several attention layers, a layer selector change what is drawn.
 */
import { useState } from "react";

import { formatTime } from "@/cycle/format";
import { cn } from "@/shared/utils/utils";

import { VIRIDIS_RAMP, rampColor } from "./colorScale";
import { type AttentionLayer, averageHeads, humanizeName } from "./stages";

const CHART_HEIGHT = 96;
const AVERAGE = -1;

interface AttentionBarsProps {
  layers: AttentionLayer[];
  selectedLayer: string;
  onSelectLayer: (layer: string) => void;
  /** One per window position when known. */
  timestamps: number[] | null;
}

function positionText(position: number, count: number, timestamps: number[] | null): string {
  const stamp = timestamps ? timestamps[position] : undefined;
  const when = stamp !== undefined ? formatTime(stamp) : null;
  const which = position === count - 1 ? `bar ${position + 1} of ${count}, the bar being predicted` : `bar ${position + 1} of ${count}`;
  return when ? `${when} (${which})` : which;
}

export function AttentionBars({ layers, selectedLayer, onSelectLayer, timestamps }: AttentionBarsProps) {
  const [head, setHead] = useState<number>(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const layer = layers.find((entry) => entry.layer === selectedLayer) ?? layers[0];
  if (!layer) return null;
  const selectedHead = head === AVERAGE ? AVERAGE : layer.heads.some((entry) => entry.head === head) ? head : (layer.heads[0]?.head ?? 0);
  const weights = selectedHead === AVERAGE ? averageHeads(layer.heads) : (layer.heads.find((entry) => entry.head === selectedHead)?.weights ?? []);
  const count = weights.length;
  const largest = Math.max(0, ...weights);
  const top = weights.indexOf(largest);
  const barWidth = Math.max(4, Math.min(18, Math.floor(320 / Math.max(1, count))));
  const width = count * barWidth;
  const headName = selectedHead === AVERAGE ? "the average of the heads" : `head ${selectedHead + 1}`;

  return (
    <section data-testid="neural-attention" className="space-y-2 rounded border border-neutral-800 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-medium text-neutral-200">Where the model looked</span>
        {layers.length > 1 && (
          <label className="flex items-center gap-1 text-neutral-400">
            Layer
            <select
              data-testid="attention-layer-select"
              className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-200"
              value={layer.layer}
              onChange={(event) => onSelectLayer(event.target.value)}
            >
              {layers.map((entry) => (
                <option key={entry.layer} value={entry.layer}>
                  {humanizeName(entry.layer)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div role="group" aria-label="Attention head" className="flex flex-wrap gap-1">
          {layer.heads.map((entry) => (
            <button
              key={entry.head}
              type="button"
              data-testid={`attention-head-${entry.head}`}
              aria-pressed={selectedHead === entry.head}
              onClick={() => setHead(entry.head)}
              className={cn(
                "rounded border px-1.5 py-0.5",
                selectedHead === entry.head ? "border-neutral-300 text-neutral-100" : "border-neutral-700 text-neutral-400 hover:text-neutral-200",
              )}
            >
              Head {entry.head + 1}
            </button>
          ))}
          {layer.heads.length > 1 && (
            <button
              type="button"
              data-testid="attention-head-average"
              aria-pressed={selectedHead === AVERAGE}
              onClick={() => setHead(AVERAGE)}
              className={cn(
                "rounded border px-1.5 py-0.5",
                selectedHead === AVERAGE ? "border-neutral-300 text-neutral-100" : "border-neutral-700 text-neutral-400 hover:text-neutral-200",
              )}
            >
              Average of heads
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-neutral-400">
        {humanizeName(layer.layer)}, {headName}: when predicting, the last bar split its attention over the window like this — taller and yellower means it
        leaned on that bar more. Most attention: {count > 0 ? `${positionText(top, count, timestamps)}, ${(largest * 100).toFixed(1)}%` : "—"}.
      </p>
      <svg role="img" aria-label={`Attention weights, ${headName}`} width={width} height={CHART_HEIGHT + 2} className="block" onMouseLeave={() => setHovered(null)}>
        {weights.map((weight, position) => {
          const barHeight = largest > 0 ? Math.max(1, (weight / largest) * CHART_HEIGHT) : 1;
          return (
            <rect
              key={position}
              data-testid="attention-bar"
              data-position={position}
              data-weight={weight}
              x={position * barWidth + 0.5}
              y={CHART_HEIGHT - barHeight}
              width={barWidth - 1}
              height={barHeight}
              fill={rampColor(VIRIDIS_RAMP, weight, { low: 0, high: largest })}
              stroke={hovered === position ? "#CC79A7" : "none"}
              strokeWidth={hovered === position ? 2 : 0}
              onMouseEnter={() => setHovered(position)}
            />
          );
        })}
        <line x1={0} x2={width} y1={CHART_HEIGHT + 1} y2={CHART_HEIGHT + 1} stroke="#B8BEC8" strokeWidth={1} />
      </svg>
      {count > 1 && (
        <div className="flex justify-between text-[9px] text-neutral-500" style={{ width }}>
          <span>{positionText(0, count, timestamps)}</span>
          <span>predicted ⇢</span>
        </div>
      )}
      <p data-testid="attention-readout" className="min-h-[1rem] font-mono text-[11px] text-neutral-300">
        {hovered !== null && weights[hovered] !== undefined
          ? `${positionText(hovered, count, timestamps)}: ${(weights[hovered] * 100).toFixed(2)}% of ${headName}'s attention (weight ${weights[hovered].toFixed(4)})`
          : "Hover a bar for its exact weight."}
      </p>
    </section>
  );
}
