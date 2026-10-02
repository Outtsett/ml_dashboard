/**
 * RegimeBadge — 4-state market-regime indicator.
 *
 * States cover the standard quant regime taxonomy:
 *   trend  — directional, low vol-of-vol     (green)
 *   chop   — range-bound, low realized vol   (neutral)
 *   vol_up — volatility expansion            (warn)
 *   vol_dn — volatility contraction          (info / muted blue)
 *
 * Optional confidence score (0..1) renders as a thin progress bar under the
 * label so a glance reads both regime AND certainty.
 */

import { Activity, BarChart3, Waves, ArrowDown } from "lucide-react";
import { cn } from "@/shared/utils/utils";

export type RegimeState = "trend" | "chop" | "vol_up" | "vol_dn";

const REGIME_LABEL: Record<RegimeState, string> = {
  trend: "Trend",
  chop: "Chop",
  vol_up: "Vol ↑",
  vol_dn: "Vol ↓",
};

const REGIME_ICON = {
  trend: Activity,
  chop: BarChart3,
  vol_up: Waves,
  vol_dn: ArrowDown,
} as const;

const REGIME_CLASS: Record<RegimeState, { border: string; text: string; bg: string; bar: string }> = {
  trend: {
    border: "border-[hsl(var(--data-pos))]/30",
    text: "text-[hsl(var(--data-pos))]",
    bg: "bg-[hsl(var(--data-pos))]/10",
    bar: "bg-[hsl(var(--data-pos))]",
  },
  chop: {
    border: "border-[hsl(var(--data-neutral))]/30",
    text: "text-[hsl(var(--data-neutral))]",
    bg: "bg-[hsl(var(--data-neutral))]/10",
    bar: "bg-[hsl(var(--data-neutral))]",
  },
  vol_up: {
    border: "border-[hsl(var(--data-warn))]/30",
    text: "text-[hsl(var(--data-warn))]",
    bg: "bg-[hsl(var(--data-warn))]/10",
    bar: "bg-[hsl(var(--data-warn))]",
  },
  vol_dn: {
    border: "border-primary/30",
    text: "text-primary",
    bg: "bg-primary/10",
    bar: "bg-primary",
  },
};

interface RegimeBadgeProps {
  regime: RegimeState;
  /** Optional 0..1 confidence — renders a slim bar under the label. */
  confidence?: number;
  /** Override the label. */
  label?: string;
  className?: string;
  testId?: string;
}

export function RegimeBadge({
  regime,
  confidence,
  label,
  className,
  testId,
}: RegimeBadgeProps) {
  const c = REGIME_CLASS[regime];
  const Icon = REGIME_ICON[regime];
  const display = label ?? REGIME_LABEL[regime];
  const pct = confidence != null ? Math.max(0, Math.min(1, confidence)) : null;

  return (
    <span
      data-testid={testId ?? `regime-${regime}`}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] uppercase tracking-wider",
        c.border,
        c.text,
        c.bg,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      <span>{display}</span>
      {pct != null && (
        <span
          className="ml-1 inline-block h-0.5 w-6 overflow-hidden rounded-full bg-white/10"
          aria-label={`confidence ${(pct * 100).toFixed(0)}%`}
        >
          <span
            className={cn("block h-full", c.bar)}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
      )}
    </span>
  );
}
