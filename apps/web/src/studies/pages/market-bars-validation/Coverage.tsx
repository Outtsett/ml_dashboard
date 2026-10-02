/**
 * Column by tier: which of the real columns each tier reached. Blue with a
 * check is all passed, vermillion hatched with a cross has a failure, a dotted
 * empty cell was not tested. An untested column is not a passing one.
 */

import { OKABE, SegmentControl, ControlBar, fmtInt } from "@/studies/kit";
import type { CoverageCell } from "@shared/studies/market-bars-validation";

export type CoverageOrder = "alphabetical" | "table" | "checks";

export function Coverage({
  cells, tableColumns, tiers, order, onOrder,
}: {
  cells: readonly CoverageCell[];
  tableColumns: readonly string[];
  tiers: readonly string[];
  order: CoverageOrder;
  onOrder: (order: CoverageOrder) => void;
}) {
  const byKey = new Map(cells.map((cell) => [`${cell.column}\u0000${cell.tier}`, cell]));
  const totalFor = (column: string) => cells.filter((cell) => cell.column === column).reduce((sum, cell) => sum + cell.checkCount, 0);
  const columns = [...tableColumns];
  if (order === "alphabetical") columns.sort((a, b) => a.localeCompare(b));
  if (order === "checks") columns.sort((a, b) => totalFor(b) - totalFor(a) || a.localeCompare(b));

  return (
    <div className="min-w-0 space-y-2">
      <ControlBar>
        <SegmentControl
          label="Row order"
          value={order}
          options={[{ value: "alphabetical", label: "A-Z" }, { value: "table", label: "table order" }, { value: "checks", label: "most checked" }]}
          onChange={onOrder}
        />
      </ControlBar>
      <p className="flex flex-wrap gap-x-4 text-[11px] text-neutral-400">
        <span><span style={{ color: OKABE.blue }}>■ ✓</span> all passed</span>
        <span><span style={{ color: OKABE.vermillion }}>▨ ✕</span> has a failure</span>
        <span><span className="text-neutral-500">· ·</span> not tested</span>
      </p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[420px] gap-px text-[10px]" style={{ gridTemplateColumns: `minmax(120px,auto) repeat(${tiers.length}, minmax(52px,1fr))` }}>
          <div />
          {tiers.map((tier) => (
            <div key={tier} className="truncate pb-1 text-center uppercase tracking-wider text-neutral-500">{tier}</div>
          ))}
          {columns.map((column) => (
            <div key={column} className="contents">
              <div className="truncate pr-2 font-mono text-neutral-300" title={column}>{column}</div>
              {tiers.map((tier) => {
                const cell = byKey.get(`${column}\u0000${tier}`);
                if (!cell) {
                  return <div key={tier} className="h-5 rounded-sm border border-dashed border-neutral-800" title={`${column}: not tested by the ${tier} tier`} />;
                }
                const failed = cell.failedCount > 0;
                return (
                  <div
                    key={tier}
                    className="flex h-5 items-center justify-center rounded-sm font-mono text-[10px] text-white"
                    style={{
                      background: failed
                        ? `repeating-linear-gradient(45deg, ${OKABE.vermillion}, ${OKABE.vermillion} 4px, #7a3200 4px, #7a3200 8px)`
                        : OKABE.blue,
                    }}
                    title={`${column} · ${tier}: ${fmtInt(cell.checkCount)} checks, ${fmtInt(cell.failedCount)} failed`}
                  >
                    {failed ? `✕ ${cell.failedCount}` : `✓ ${cell.checkCount}`}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
