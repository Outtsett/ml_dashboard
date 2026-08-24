/**
 * ExposureBars — horizontal bars showing notional exposure by category.
 *
 * Each row: [label] [────█████████──── ] [value · pct]. Bars use the
 * categorical palette so adjacent rows don't blur. Sorted by value desc.
 */

import { useMemo } from "react";
import { cn } from "@/shared/utils/utils";

interface ExposureRow {
  name: string;
  value: number;
  pct: number;
}

interface ExposureBarsProps {
  rows: ExposureRow[];
  /** Label for the metric (rendered in the header). */
  label?: string;
  /** Currency formatter. */
  formatValue?: (v: number) => string;
  /** Maximum number of bars before grouping the rest under "Other". */
  maxRows?: number;
  className?: string;
}

const CAT_VARS = [
  "--data-cat-1",
  "--data-cat-2",
  "--data-cat-3",
  "--data-cat-4",
  "--data-cat-5",
  "--data-cat-6",
  "--data-cat-7",
  "--data-cat-8",
  "--data-cat-9",
  "--data-cat-10",
] as const;

export function ExposureBars({
  rows,
  label,
  formatValue,
  maxRows = 8,
  className,
}: ExposureBarsProps) {
  const display = useMemo(() => {
    if (rows.length <= maxRows) return rows;
    const head = rows.slice(0, maxRows - 1);
    const tail = rows.slice(maxRows - 1);
    const tailValue = tail.reduce((s, r) => s + r.value, 0);
    const tailPct = tail.reduce((s, r) => s + r.pct, 0);
    return [...head, { name: `Other (${tail.length})`, value: tailValue, pct: tailPct }];
  }, [rows, maxRows]);

  if (display.length === 0) {
    return (
      <div className={cn("rounded-md border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-[11px] text-muted-foreground", className)}>
        No exposure.
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      <ul className="space-y-1">
        {display.map((row, i) => {
          const colorVar = CAT_VARS[i % CAT_VARS.length]!;
          const widthPct = Math.max(0.5, row.pct * 100); // floor at 0.5% so a sliver is visible
          return (
            <li
              key={row.name}
              className="grid grid-cols-[80px_1fr_auto] items-center gap-2 text-[11px]"
              data-testid={`exposure-row-${row.name}`}
            >
              <span className="truncate font-mono text-foreground/90">{row.name}</span>
              <div className="h-3 overflow-hidden rounded-sm bg-white/[0.04]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.min(100, widthPct)}%`,
                    backgroundColor: `hsl(var(${colorVar}))`,
                  }}
                />
              </div>
              <div className="flex items-baseline gap-2 text-right">
                <span className="font-mono tnum text-foreground/80">
                  {formatValue ? formatValue(row.value) : row.value.toFixed(0)}
                </span>
                <span className="w-10 font-mono tnum text-[10px] text-muted-foreground">
                  {(row.pct * 100).toFixed(1)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
