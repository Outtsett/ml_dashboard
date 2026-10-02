/**
 * KpiStrip — Bloomberg-style horizontal KPI ribbon.
 *
 * Visual contract:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ NAV         DAILY P&L       99% VaR        EXPOSURE       SORTINO    │
 *   │ 1,245,300   +12,420 +0.99   −18,200       1.84M / 0.42    2.13       │
 *   │ ▁▂▄▆█▇▆     ▁▂▃▄▅            ▇▆▅▄▃         ▃▃▄▄▅           ▁▂▃▃      │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Renders a flex row of `KpiCard` cells. Auto-wraps on narrow screens, but
 * the assumption is each KPI gets ~140-180px and a typical strip holds 4-8.
 *
 * The strip is unopinionated about data — caller passes pre-formatted Kpi[].
 */

import { cn } from "@/shared/utils/utils";
import type { Kpi } from "./PageShell.types";
import { KpiCard } from "./KpiCard";

interface KpiStripProps {
  kpis: Kpi[];
  /** Compact mode — slimmer padding, smaller font. */
  dense?: boolean;
  /** Maximum cells per row before wrapping. Default unlimited (flex-wrap). */
  maxCols?: number;
  className?: string;
}

export function KpiStrip({ kpis, dense = false, maxCols, className }: KpiStripProps) {
  if (!kpis || kpis.length === 0) return null;

  return (
    <div
      data-testid="kpi-strip"
      className={cn(
        "grid shrink-0 border-b border-border/50 bg-card/30",
        dense ? "gap-px p-0" : "gap-px",
        className,
      )}
      style={{
        gridTemplateColumns: maxCols
          ? `repeat(${maxCols}, minmax(0, 1fr))`
          : `repeat(${kpis.length}, minmax(120px, 1fr))`,
      }}
    >
      {kpis.map((k, i) => (
        <KpiCard key={`${k.label}-${i}`} kpi={k} dense={dense} />
      ))}
    </div>
  );
}
