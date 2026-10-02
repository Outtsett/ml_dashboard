/**
 * One real window drawn the way the network saw it: only its last `barCount`
 * bars, scaled to their own high-low range and centred in five slots, rising
 * bars hollow and falling bars filled (the notebook's torch renderer's rules,
 * gpu_render.render_batch). Colour repeats the fill: rising orange, falling
 * blue. With `showContext` the earlier bars of the five are drawn faded,
 * on the whole window's range, behind a dashed line: the network never saw them.
 */

import { OKABE, fmt } from "@/studies/kit";
import type { ExampleWindow } from "@shared/studies/chart-cnn-pattern-recognition";
import { shortPatternName } from "@shared/studies/chart-cnn-pattern-recognition";

const WIDTH = 130;
const HEIGHT = 84;
const PAD = 5;
const SLOT = WIDTH / 5;

export function CandleThumb({ window, showContext }: { window: ExampleWindow; showContext: boolean }) {
  const count = Math.min(5, Math.max(1, window.barCount));
  const firstSeen = 5 - count;
  const drawn = window.bars.map((bar, index) => ({ ...bar, index })).filter((bar) => showContext || bar.index >= firstSeen);
  const low = Math.min(...drawn.map((bar) => bar.low));
  const high = Math.max(...drawn.map((bar) => bar.high));
  const range = Math.max(high - low, 1e-9);
  const y = (price: number) => PAD + (HEIGHT - 2 * PAD) * (1 - (price - low) / range);
  // Centred like the renderer when only the seen bars are drawn; in place when the context is shown.
  const offset = showContext ? 0 : ((5 - count) * SLOT) / 2 - firstSeen * SLOT;
  const title = window.bars
    .map((bar, index) => `bar ${index + 1}${index < firstSeen ? " (not seen)" : ""}: open ${bar.open} high ${bar.high} low ${bar.low} close ${bar.close}`)
    .join("\n");

  return (
    <figure className="min-w-0 rounded border border-neutral-800 bg-neutral-950 p-1" title={title}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label={`${window.targetPattern} window, score ${fmt(window.score, 3)}`}>
        {showContext && firstSeen > 0 && (
          <line x1={firstSeen * SLOT} x2={firstSeen * SLOT} y1={0} y2={HEIGHT} stroke={OKABE.grey} strokeDasharray="3 3" strokeWidth={0.8} />
        )}
        {drawn.map((bar) => {
          const x = offset + bar.index * SLOT;
          const middle = x + SLOT / 2;
          const rising = bar.close >= bar.open;
          const color = rising ? OKABE.orange : OKABE.blue;
          const top = y(Math.max(bar.open, bar.close));
          const bottom = y(Math.min(bar.open, bar.close));
          const faded = bar.index < firstSeen;
          return (
            <g key={bar.index} opacity={faded ? 0.35 : 1}>
              <line x1={middle} x2={middle} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={1.4} />
              <rect
                x={x + SLOT / 5}
                y={top}
                width={SLOT - (2 * SLOT) / 5}
                height={Math.max(bottom - top, 0.8)}
                fill={rising ? "#0a0a0a" : color}
                stroke={color}
                strokeWidth={1.4}
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-0.5 flex justify-between gap-1 font-mono text-[10px] leading-tight text-neutral-300">
        <span>p={fmt(window.score, 3)}</span>
        <span className="truncate text-neutral-500" title={window.targetPattern}>{shortPatternName(window.targetPattern)}</span>
      </figcaption>
      <div className="font-mono text-[10px] leading-tight text-neutral-500">{window.time.slice(0, 16)}</div>
    </figure>
  );
}

export function CandleGrid({ title, windows, showContext, empty }: { title: string; windows: readonly ExampleWindow[]; showContext: boolean; empty: string }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-neutral-200">{title}</h4>
      {windows.length === 0 ? (
        <p className="text-[11px] text-neutral-500">{empty}</p>
      ) : (
        <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(110px,1fr))]">
          {windows.map((window) => (
            <CandleThumb key={window.windowId} window={window} showContext={showContext} />
          ))}
        </div>
      )}
    </div>
  );
}
