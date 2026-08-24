/**
 * KpiCard — single KPI cell. Used inside KpiStrip and standalone in dense grids.
 *
 * Layout:
 *   ┌──────────────────────────┐
 *   │ LABEL (uppercase, micro) │
 *   │ 1,245,300                │  ← font-mono tnum, hero-sized
 *   │ +12,420   +0.99%   ▁▂▃▄  │  ← delta · sparkline (optional)
 *   └──────────────────────────┘
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils/utils";
import type { Kpi } from "./PageShell.types";
import { Sparkline } from "./Sparkline";

const DELTA_CLASS = {
  pos: "text-[hsl(var(--data-pos))]",
  neg: "text-[hsl(var(--data-neg))]",
  neutral: "text-muted-foreground",
} as const;

const DELTA_ARROW = {
  pos: "▲",
  neg: "▼",
  neutral: "·",
} as const;

interface KpiCardProps {
  kpi: Kpi;
  dense?: boolean;
}

export function KpiCard({ kpi, dense = false }: KpiCardProps) {
  const sparkDir = kpi.sparkDirection ?? kpi.delta?.direction ?? "neutral";
  const body = (
    <div
      data-testid={kpi.testId ?? `kpi-${kpi.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={cn(
        "flex h-full flex-col justify-between bg-card",
        dense ? "px-3 py-1.5" : "px-3 py-2",
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
          "truncate",
        )}
      >
        {kpi.label}
      </div>
      <div
        className={cn(
          "font-mono tnum tabular-nums font-medium text-foreground",
          dense ? "text-base" : "text-lg",
          "leading-tight",
        )}
        data-testid={`${kpi.testId ?? `kpi-${kpi.label}`}-value`}
      >
        {kpi.value}
      </div>

      {(kpi.delta || kpi.spark) && (
        <div className="mt-0.5 flex items-end justify-between gap-2">
          {kpi.delta ? (
            <span
              className={cn(
                "font-mono tnum text-[11px]",
                DELTA_CLASS[kpi.delta.direction],
              )}
            >
              <span className="mr-0.5 text-[9px]">
                {DELTA_ARROW[kpi.delta.direction]}
              </span>
              {kpi.delta.value}
            </span>
          ) : (
            <span />
          )}
          {kpi.spark && kpi.spark.length >= 2 && (
            <div className="ml-auto h-4 w-16 shrink-0">
              <Sparkline data={kpi.spark} direction={sparkDir} height={16} />
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!kpi.hint) return body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="contents">{body}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4} className="text-xs">
        {kpi.hint}
      </TooltipContent>
    </Tooltip>
  );
}
