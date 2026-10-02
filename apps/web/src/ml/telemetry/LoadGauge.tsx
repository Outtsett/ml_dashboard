/**
 * LoadGauge — a radial load meter with its own recent history.
 *
 * Deliberately not built on GaugeRenderer: that one is a diagnostics renderer
 * driven by a MetricContext with good/bad/great thresholds and a half-ring HUD
 * layout. A hardware load meter has no "good" value — 95% utilization during
 * training is exactly what you want to see — so severity zones would be
 * actively misleading. This is a plain full-ring percentage with a sparkline.
 *
 * The ring is drawn with stroke-dasharray rather than an arc path: one element,
 * no path math, and the browser interpolates the sweep for free.
 */

import { useMemo } from "react";
import { usePrefersReducedMotion } from "@/shared/hooks/useReducedMotion";

const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SIZE = 56;

export interface LoadGaugeProps {
  label: string;
  /** Current value in the same unit as `max`. */
  value: number;
  max?: number;
  /** Recent values, oldest first, for the sparkline. Empty hides it. */
  history?: number[];
  /** Appended to the centered readout. */
  unit?: string;
  /** Secondary line under the label, e.g. "62 °C" or "7.8 / 16 GB". */
  detail?: string;
}

/** Sparkline path over a fixed 0..max domain so the baseline never shifts. */
function sparklinePath(values: number[], max: number, width: number, height: number): string {
  if (values.length < 2) return "";
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const clamped = Math.max(0, Math.min(max, v));
      const y = height - (clamped / max) * height;
      return `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function LoadGauge({
  label,
  value,
  max = 100,
  history = [],
  unit = "%",
  detail,
}: LoadGaugeProps) {
  const reducedMotion = usePrefersReducedMotion();

  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
  const fraction = max > 0 ? safeValue / max : 0;

  // Sparkline is capped well below the retained history so a 300-sample buffer
  // does not render 300 path segments into a 64px-wide box.
  const trail = useMemo(() => history.slice(-48), [history]);
  const path = useMemo(() => sparklinePath(trail, max, 64, 14), [trail, max]);

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--data-neutral) / 0.18)"
            strokeWidth={4}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--data-pos))"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className={reducedMotion ? "" : "transition-[stroke-dashoffset] motion-slow"}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center metric-value tnum text-[11px] text-foreground">
          {safeValue.toFixed(0)}
          <span className="text-[8px] text-muted-foreground ml-px">{unit}</span>
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {label}
        </span>
        {detail && (
          <span className="text-[10px] font-mono tnum text-muted-foreground">{detail}</span>
        )}
        {path && (
          <svg width={64} height={14} aria-hidden="true" className="opacity-70">
            <path d={path} fill="none" stroke="hsl(var(--data-pos))" strokeWidth={1} />
          </svg>
        )}
      </div>
    </div>
  );
}
