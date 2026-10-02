/**
 * MetricCell — monospaced, tabular-aligned numeric cell with pos/neg coloring.
 *
 * Use everywhere a quant expects numbers to align on the decimal point:
 *   - inside <DenseTable> body rows
 *   - inside KPI strips
 *   - inside parameter diff drawers
 *
 * The component is dumb about formatting — callers must format `value`
 * upstream (currency, %, etc.) so the same cell handles every kind of number.
 * The pos/neg/zero color decision is taken from the optional `numeric` prop
 * (raw JS number) when provided; otherwise from the explicit `tone` prop.
 */

import { cn } from "@/shared/utils/utils";
import type { ReactNode } from "react";

export type MetricTone = "pos" | "neg" | "neutral" | "warn" | "auto";

interface MetricCellProps {
  /** Pre-formatted display string. Falls back to `—` when nullish. */
  value: ReactNode;
  /** Raw numeric value — used by `tone="auto"` to pick pos/neg/neutral. */
  numeric?: number | null | undefined;
  /** Coloring strategy. `auto` requires `numeric`. Default neutral. */
  tone?: MetricTone;
  /** Right-align (default true — numeric columns). Pass false for IDs / hashes. */
  align?: "left" | "right" | "center";
  /** Apply muted styling — used for placeholder / not-yet-computed cells. */
  muted?: boolean;
  /** Compact mode for ultra-dense tables (12px). Default is 13px / .8125rem. */
  compact?: boolean;
  /** Append an optional unit suffix (rendered smaller/muted). */
  unit?: string;
  /** Override the className. */
  className?: string;
  /** Testid override. */
  testId?: string;
}

function pickTone(tone: MetricTone, numeric: number | null | undefined): Exclude<MetricTone, "auto"> {
  if (tone !== "auto") return tone;
  if (numeric == null || Number.isNaN(numeric)) return "neutral";
  if (numeric > 0) return "pos";
  if (numeric < 0) return "neg";
  return "neutral";
}

const TONE_CLASS: Record<Exclude<MetricTone, "auto">, string> = {
  pos: "text-[hsl(var(--data-pos))]",
  neg: "text-[hsl(var(--data-neg))]",
  neutral: "text-foreground/90",
  warn: "text-[hsl(var(--data-warn))]",
};

export function MetricCell({
  value,
  numeric,
  tone = "neutral",
  align = "right",
  muted = false,
  compact = false,
  unit,
  className,
  testId,
}: MetricCellProps) {
  const resolved = pickTone(tone, numeric);
  const display = value === null || value === undefined || value === "" ? "—" : value;
  const isEmpty = display === "—";

  return (
    <span
      data-testid={testId}
      className={cn(
        "font-mono tnum tabular-nums leading-snug",
        compact ? "text-[11px]" : "text-[13px]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        muted || isEmpty ? "text-muted-foreground/50" : TONE_CLASS[resolved],
        className,
      )}
    >
      {display}
      {unit && !isEmpty && (
        <span className="ml-0.5 text-[0.85em] text-muted-foreground/70">{unit}</span>
      )}
    </span>
  );
}
