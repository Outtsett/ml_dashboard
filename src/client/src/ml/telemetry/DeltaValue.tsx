/**
 * DeltaValue — a number that shows its own movement.
 *
 * The primitive the rest of the telemetry surface is built on. Renders a value
 * and, when it changes, briefly floats a signed delta chip beside it before
 * decaying back to rest. This is what makes a training run feel alive rather
 * than merely current.
 *
 * Direction is carried by THREE channels, never by color alone: the sign on
 * the delta, a glyph (▲ ▼ —), and the tone color. A deuteranope reading this
 * on a projector still gets the direction. Screen readers get `trendLabel()`
 * text; the glyph itself is aria-hidden so it is not announced as punctuation.
 *
 * Motion is suppressed entirely under `prefers-reduced-motion` — the value
 * still updates, it simply swaps rather than animates.
 */

import { useEffect, useRef, useState } from "react";
import {
  trendTone,
  trendGlyph,
  trendLabel,
  trendToneClass,
  type TrendTone,
} from "@/shared/theme/dataColors";
import { usePrefersReducedMotion } from "@/shared/hooks/useReducedMotion";

/** How long the delta chip stays visible before fading, in milliseconds. */
const CHIP_LIFETIME_MS = 1200;

export interface DeltaValueProps {
  /** Current value. A non-finite value renders as an em dash. */
  value: number;
  /** Formats the main readout. Defaults to 4 significant decimals, trimmed. */
  format?: (value: number) => string;
  /** Formats the delta chip. Defaults to a signed version of `format`. */
  formatDelta?: (delta: number) => string;
  /**
   * Movement smaller than this counts as flat. Set it to something meaningful
   * for the unit — without it, floating-point noise reads as constant motion.
   */
  epsilon?: number;
  /**
   * Inverts the tone mapping for metrics where down is good (loss, drawdown,
   * error rate). The glyph still reflects actual direction — only the color
   * flips, because "loss fell" is a decrease AND an improvement, and the
   * reader needs both facts.
   */
  lowerIsBetter?: boolean;
  /** Optional label rendered above the value. */
  label?: string;
  className?: string;
}

function defaultFormat(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(3);
  return value.toExponential(1);
}

export function DeltaValue({
  value,
  format = defaultFormat,
  formatDelta,
  epsilon = 0,
  lowerIsBetter = false,
  label,
  className = "",
}: DeltaValueProps) {
  const reducedMotion = usePrefersReducedMotion();

  // The last value we actually rendered. A ref, not state: updating it must not
  // itself trigger a render, or every value change costs two passes.
  const previous = useRef<number | null>(null);
  const [chip, setChip] = useState<{ delta: number; key: number } | null>(null);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = Number.isFinite(value) ? value : prev;

    // First observation has nothing to compare against — a value arriving is
    // not a change. Without this guard every metric flashes "+x" on mount.
    if (prev === null || !Number.isFinite(value)) return;

    const delta = value - prev;
    if (trendTone(delta, epsilon) === "flat") return;
    if (reducedMotion) return;

    // A fresh change replaces any in-flight chip and restarts the clock, so a
    // fast stream shows the latest movement rather than queuing stale ones.
    setChip({ delta, key: Date.now() });
    if (chipTimer.current) clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setChip(null), CHIP_LIFETIME_MS);
  }, [value, epsilon, reducedMotion]);

  // Timers must not outlive the component — a late fire would setState on an
  // unmounted node during a run that ends mid-animation.
  useEffect(
    () => () => {
      if (chipTimer.current) clearTimeout(chipTimer.current);
    },
    [],
  );

  const rawTone: TrendTone = chip ? trendTone(chip.delta, epsilon) : "flat";
  // Tone is about good-vs-bad; the glyph is about up-vs-down. They diverge for
  // lower-is-better metrics, and both are needed.
  const colorTone: TrendTone =
    lowerIsBetter && rawTone !== "flat" ? (rawTone === "up" ? "down" : "up") : rawTone;

  const deltaFormatter =
    formatDelta ?? ((d: number) => `${d > 0 ? "+" : "−"}${format(Math.abs(d))}`);

  return (
    <div className={`flex flex-col leading-tight ${className}`}>
      {label && (
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {label}
        </span>
      )}
      <span className="flex items-baseline gap-1.5">
        <span className="metric-value tnum text-sm text-foreground">{format(value)}</span>
        {chip && (
          <span
            key={chip.key}
            className={`flex items-center gap-0.5 text-[10px] font-mono tnum ${trendToneClass(
              colorTone,
            )} ${reducedMotion ? "" : "animate-in fade-in slide-in-from-bottom-1 duration-200"}`}
          >
            <span aria-hidden="true">{trendGlyph(rawTone)}</span>
            <span>{deltaFormatter(chip.delta)}</span>
            <span className="sr-only">{trendLabel(rawTone)}</span>
          </span>
        )}
      </span>
    </div>
  );
}
