/**
 * Small shared presentational pieces for Model Lens panels.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/utils/utils";
import { trendGlyph, trendToneClass, type FormattedEstimate } from "./format";

/** One KPI-style cell: uppercase label, mono value, optional small supporting line. */
export function StatCell({
  label,
  value,
  hint,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  sub?: string;
  tone?: "pos" | "neg" | "neutral" | "warn";
  testId?: string;
}) {
  const toneClass =
    tone === "pos"
      ? "text-(--color-data-pos)"
      : tone === "neg"
        ? "text-(--color-data-neg)"
        : tone === "warn"
          ? "text-(--color-data-warn)"
          : "text-foreground";
  return (
    <div className="flex min-w-[8rem] flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5" title={hint} data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <span className={cn("font-mono tnum tabular-nums text-base leading-tight", toneClass)}>{value}</span>
      {sub && <span className="font-mono tnum text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** An estimate rendered as "value [ci_low, ci_high]" with the glyph + n/method on hover. */
export function EstimateStat({ label, estimate, testId }: { label: string; estimate: FormattedEstimate; testId?: string }) {
  return (
    <div className="flex min-w-[9rem] flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5" title={estimate.title} data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <span className={cn("font-mono tnum tabular-nums text-sm leading-tight", trendToneClass(estimate.tone))}>
        <span className="mr-1 text-[10px]" aria-hidden="true">
          {trendGlyph(estimate.tone)}
        </span>
        {estimate.display}
      </span>
      <span className="font-mono tnum text-[10px] text-muted-foreground">{estimate.title}</span>
    </div>
  );
}

export function CaptionRow({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

/** Glyph used for a regime label everywhere in the lens (never color alone). */
export function regimeGlyph(regime: "bull" | "bear" | "sideways" | null): string {
  switch (regime) {
    case "bull":
      return "▲";
    case "bear":
      return "▼";
    case "sideways":
      return "◆";
    default:
      return "·";
  }
}

export function regimeColorVar(regime: "bull" | "bear" | "sideways" | null): string {
  switch (regime) {
    case "bull":
      return "hsl(var(--data-pos))";
    case "bear":
      return "hsl(var(--data-neg))";
    case "sideways":
      return "hsl(var(--data-warn))";
    default:
      return "hsl(var(--data-neutral))";
  }
}

export function regimeLabel(regime: "bull" | "bear" | "sideways" | null): string {
  switch (regime) {
    case "bull":
      return "Bull";
    case "bear":
      return "Bear";
    case "sideways":
      return "Sideways";
    default:
      return "Unknown";
  }
}
