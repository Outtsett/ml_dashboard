/**
 * Every check in the run, latest result per check, with filters and pages of
 * 30. The outcome is a glyph and a word; a failed row also carries a hatched
 * marker, never a colour alone.
 */

import { useState } from "react";
import { OKABE, SelectControl, ControlBar, fmtInt } from "@/studies/kit";
import type { CheckRow } from "@shared/studies/market-bars-validation";
import { outcomeLabel, stamp } from "./format";

const PAGE_SIZE = 30;

export interface CheckFilter {
  tier: string;
  column: string;
  outcome: string;
  search: string;
}

export function applyFilter(checks: readonly CheckRow[], filter: CheckFilter): CheckRow[] {
  const needle = filter.search.trim().toLowerCase();
  return checks.filter((check) => {
    if (filter.tier !== "all" && check.tier !== filter.tier) return false;
    if (filter.column !== "all" && check.column_name !== filter.column) return false;
    if (filter.outcome === "failed" && check.matched) return false;
    if (filter.outcome === "passed" && !check.matched) return false;
    if (needle && !`${check.check_name} ${check.lake_value ?? ""} ${check.postgres_value ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function ChecksTable({
  checks, tiers, columns, filter, onFilter,
}: {
  checks: readonly CheckRow[];
  tiers: readonly string[];
  columns: readonly string[];
  filter: CheckFilter;
  onFilter: (key: keyof CheckFilter, value: string) => void;
}) {
  const [page, setPage] = useState(0);
  const rows = applyFilter(checks, filter);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const change = (key: keyof CheckFilter, value: string) => {
    setPage(0);
    onFilter(key, value);
  };

  return (
    <div className="min-w-0 space-y-2">
      <ControlBar>
        <SelectControl label="Tier" value={filter.tier} options={[{ value: "all", label: "all tiers" }, ...tiers.map((tier) => ({ value: tier, label: tier }))]} onChange={(value) => change("tier", value)} />
        <SelectControl label="Column" value={filter.column} options={[{ value: "all", label: "all columns" }, ...columns.map((column) => ({ value: column, label: column }))]} onChange={(value) => change("column", value)} />
        <SelectControl label="Outcome" value={filter.outcome} options={[{ value: "all", label: "all" }, { value: "failed", label: "✕ failed" }, { value: "passed", label: "✓ passed" }]} onChange={(value) => change("outcome", value)} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Search check or value</span>
          <input
            value={filter.search}
            onChange={(event) => change("search", event.target.value)}
            placeholder="e.g. futures 1s"
            className="h-7 w-44 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
      </ControlBar>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-neutral-500">
              {["tier", "column", "check", "lake value", "PostgreSQL value", "outcome", "recorded"].map((heading) => (
                <th key={heading} className="whitespace-nowrap px-2 py-1 font-normal">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((check) => (
              <tr key={`${check.tier}|${check.column_name}|${check.check_name}`} className="border-t border-neutral-900">
                <td className="whitespace-nowrap px-2 py-0.5 text-neutral-400">{check.tier}</td>
                <td className="whitespace-nowrap px-2 py-0.5 font-mono text-neutral-200">{check.column_name}</td>
                <td className="px-2 py-0.5 text-neutral-300">{check.check_name}</td>
                <td className="max-w-[16rem] truncate px-2 py-0.5 font-mono text-neutral-200" title={check.lake_value ?? ""}>{check.lake_value ?? "—"}</td>
                <td className="max-w-[16rem] truncate px-2 py-0.5 font-mono text-neutral-200" title={check.postgres_value ?? ""}>{check.postgres_value ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-0.5" style={{ color: check.matched ? OKABE.blue : OKABE.vermillion }}>{outcomeLabel(check.matched)}</td>
                <td className="whitespace-nowrap px-2 py-0.5 font-mono text-neutral-500">{stamp(check.recorded_timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>{fmtInt(rows.length)} of {fmtInt(checks.length)} checks</span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Previous</button>
          <span className="font-mono">page {current + 1} of {pageCount}</span>
          <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Next</button>
        </span>
      </div>
    </div>
  );
}
