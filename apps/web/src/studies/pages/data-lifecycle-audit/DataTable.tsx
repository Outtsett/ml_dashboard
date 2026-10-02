/**
 * A table with search, click-to-sort headers, paging and optional row
 * selection: what `mo.ui.table` gave the notebook. Generic over the row, so the
 * findings, the headline measurements, the struck findings, the confirmed facts
 * and every raw measurement table share it.
 */

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtInt } from "@/studies/kit";
import { cellText } from "./style";

export interface TableColumn<Row> {
  key: string;
  label: string;
  /** The value sorted and searched on. */
  value: (row: Row) => string | number | boolean | null | undefined;
  render?: (row: Row) => ReactNode;
  align?: "left" | "right";
  /** Text wraps (long prose) instead of staying on one line. */
  wrap?: boolean;
  /** Tailwind width class for a wrapping column. */
  widthClass?: string;
}

type Direction = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function DataTable<Row>({
  rows, columns, rowKey, pageSize = 10, label, searchable = true, selectedKey, onSelect, initialSort,
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<TableColumn<Row>>;
  rowKey: (row: Row, index: number) => string;
  pageSize?: number;
  label?: string;
  searchable?: boolean;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  initialSort?: { key: string; direction: Direction };
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: Direction } | null>(initialSort ?? null);
  const [pageIndex, setPageIndex] = useState(0);

  const needle = search.trim().toLowerCase();
  const matching = needle === ""
    ? [...rows]
    : rows.filter((row) => columns.some((column) => String(column.value(row) ?? "").toLowerCase().includes(needle)));
  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  if (sort && sortColumn) {
    matching.sort((a, b) => (sort.direction === "asc" ? 1 : -1) * compareValues(sortColumn.value(a), sortColumn.value(b)));
  }
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const visible = matching.slice(page * pageSize, page * pageSize + pageSize);

  const clickHeader = (key: string) => {
    setPageIndex(0);
    setSort((previous) => (previous?.key === key ? { key, direction: previous.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {label && <span className="text-[11px] font-medium text-neutral-300">{label}</span>}
        {searchable && (
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPageIndex(0); }}
            placeholder="search this table"
            aria-label={`Search ${label ?? "table"}`}
            className="h-6 w-44 rounded border border-neutral-700 bg-neutral-950 px-2 text-[11px] text-neutral-200"
          />
        )}
      </div>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full min-w-max border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/60">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th key={column.key} className={`px-2 py-1 font-normal ${column.align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => clickHeader(column.key)} className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-neutral-100 ${active ? "text-neutral-100" : "text-neutral-500"}`}>
                      {column.label}
                      {active && (sort?.direction === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="px-2 py-4 text-center text-neutral-500">No rows match.</td></tr>
            )}
            {visible.map((row, index) => {
              const key = rowKey(row, page * pageSize + index);
              const selected = selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={onSelect ? () => onSelect(selected ? null : key) : undefined}
                  className={`border-b border-neutral-900 align-top ${onSelect ? "cursor-pointer hover:bg-neutral-800/50" : ""} ${selected ? "bg-[#56B4E9]/10 outline outline-1 -outline-offset-1 outline-[#56B4E9]/60" : ""}`}
                  aria-selected={onSelect ? selected : undefined}
                >
                  {columns.map((column) => {
                    const raw = column.value(row);
                    return (
                      <td
                        key={column.key}
                        title={column.wrap ? undefined : typeof raw === "string" && raw.length > 40 ? raw : undefined}
                        className={`px-2 py-1 text-neutral-200 ${column.align === "right" ? "text-right font-mono tnum" : "text-left"} ${column.wrap ? `whitespace-normal ${column.widthClass ?? "min-w-[16rem] max-w-[34rem]"}` : "whitespace-nowrap"}`}
                      >
                        {column.render ? column.render(row) : cellText(raw)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span>{fmtInt(matching.length)} of {fmtInt(rows.length)} rows</span>
        <span className="flex items-center gap-1">
          <button type="button" disabled={page === 0} onClick={() => setPageIndex(page - 1)} aria-label="Previous page" className="rounded border border-neutral-700 p-0.5 disabled:opacity-30 hover:border-neutral-500">
            <ChevronLeft className="h-3 w-3" />
          </button>
          page {page + 1} of {pageCount}
          <button type="button" disabled={page >= pageCount - 1} onClick={() => setPageIndex(page + 1)} aria-label="Next page" className="rounded border border-neutral-700 p-0.5 disabled:opacity-30 hover:border-neutral-500">
            <ChevronRight className="h-3 w-3" />
          </button>
        </span>
      </div>
    </div>
  );
}
