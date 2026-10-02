/**
 * The 2D CNN's 32 first-layer filters, each a 5 (price) by 3 (time) patch of weights. Blue = negative weight,
 * orange = positive, a pale centre at zero; the +/- glyphs repeat the sign so colour is never the only signal.
 */

import { OKABE } from "@/studies/kit";
import type { FilterTile } from "@shared/studies/chart-cnn-direction-null-result";

const CENTRE = [232, 232, 232] as const;
const NEGATIVE = [0, 114, 178] as const;
const POSITIVE = [230, 159, 0] as const;

function blend(toward: readonly [number, number, number], amount: number): string {
  const t = Math.min(Math.max(amount, 0), 1);
  const channel = (index: 0 | 1 | 2) => Math.round(CENTRE[index] + (toward[index] - CENTRE[index]) * t);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

export function weightColour(weight: number, clip: number): string {
  if (clip <= 0) return `rgb(${CENTRE.join(",")})`;
  const t = weight / clip;
  return t < 0 ? blend(NEGATIVE, -t) : blend(POSITIVE, t);
}

export function FilterTiles({ tiles, clip, glyphs }: { tiles: readonly FilterTile[]; clip: number; glyphs: boolean }) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(64px,1fr))]">
      {tiles.map((tile) => {
        const rows = tile.weights.length;
        const columns = tile.weights[0]?.length ?? 0;
        return (
          <figure key={tile.filterNumber} className="min-w-0">
            <svg viewBox={`0 0 ${columns} ${rows}`} className="w-full rounded-sm border border-neutral-700" role="img" aria-label={`filter ${tile.filterNumber}`}>
              {tile.weights.flatMap((row, rowIndex) =>
                row.map((weight, columnIndex) => (
                  <g key={`${rowIndex}-${columnIndex}`}>
                    <rect x={columnIndex} y={rowIndex} width={1} height={1} fill={weightColour(weight, clip)} stroke="#0a0a0a" strokeWidth={0.04}>
                      <title>{`filter ${tile.filterNumber}, price row ${rowIndex + 1}, time column ${columnIndex + 1}: weight ${weight.toFixed(4)}`}</title>
                    </rect>
                    {glyphs && Math.abs(weight) > clip * 0.4 && (
                      <text x={columnIndex + 0.5} y={rowIndex + 0.68} textAnchor="middle" fontSize={0.6} fill="#0a0a0a" pointerEvents="none">
                        {weight > 0 ? "+" : "−"}
                      </text>
                    )}
                  </g>
                )),
              )}
            </svg>
            <figcaption
              className="mt-0.5 text-center font-mono text-[10px] text-neutral-400"
              title={`length of the 15 weights ${tile.norm.toFixed(3)}; ${(tile.positiveShare * 100).toFixed(0)}% positive`}
            >
              #{tile.filterNumber} · {tile.norm.toFixed(2)}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export function FilterLegend({ clip }: { clip: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
      <span style={{ color: OKABE.blue }}>{"−"} negative</span>
      <span
        className="h-3 w-40 rounded-sm border border-neutral-700"
        style={{ background: `linear-gradient(to right, ${weightColour(-clip, clip)}, ${weightColour(0, clip)}, ${weightColour(clip, clip)})` }}
        aria-hidden="true"
      />
      <span style={{ color: OKABE.orange }}>+ positive</span>
      <span className="font-mono text-neutral-300">±{clip.toFixed(3)}</span>
    </div>
  );
}
