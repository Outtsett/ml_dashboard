/**
 * ProgressFill — a composited progress bar fill.
 *
 * What: renders the coloured fill of a horizontal (or vertical) meter at `value` percent.
 * Why:  animating `width`/`height` is non-composited — every frame re-runs layout on the main
 *       thread and is reported as a layout-shift / non-composited-animation by Lighthouse.
 *       This fill is always 100% of its track and is sized with `transform: scaleX()` (or
 *       `scaleY()`), which the compositor animates on the GPU with zero layout work.
 *
 * Contract: place inside a track that owns size, background, radius and `overflow-hidden`.
 *   <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
 *     <ProgressFill value={pct} className="bg-emerald-500" />
 *   </div>
 */

import type { CSSProperties } from "react";
import { cn } from "@/shared/utils/utils";

export interface ProgressFillProps {
  /** Percent filled, 0–100. Out-of-range and non-finite values are clamped. */
  value: number;
  /** Colour / gradient / shadow classes. Size and radius belong to the track. */
  className?: string;
  /** Fill direction: horizontal grows from the left, vertical from the bottom. */
  orientation?: "horizontal" | "vertical";
  /** Transition length in ms; 0 disables the animation. */
  durationMs?: number;
  /** Extra inline style (e.g. a dynamic background colour). Never pass width/height. */
  style?: CSSProperties;
}

/** Clamp to [0, 1]; NaN/Infinity collapse to 0 so a bad metric never renders a full bar. */
function toFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 100));
}

export function ProgressFill({
  value,
  className,
  orientation = "horizontal",
  durationMs = 300,
  style,
}: ProgressFillProps) {
  const fraction = toFraction(value);
  const horizontal = orientation === "horizontal";
  return (
    <div
      aria-hidden
      className={cn(
        "h-full w-full will-change-transform motion-reduce:transition-none",
        horizontal ? "origin-left" : "origin-bottom",
        className,
      )}
      style={{
        ...style,
        transform: horizontal ? `scaleX(${fraction})` : `scaleY(${fraction})`, // composited resize
        // Colour is paint-only (no layout), so status fills that change hue may ease too.
        transition: durationMs > 0 ? `transform ${durationMs}ms ease-out, background-color ${durationMs}ms ease-out` : undefined,
      }}
    />
  );
}
