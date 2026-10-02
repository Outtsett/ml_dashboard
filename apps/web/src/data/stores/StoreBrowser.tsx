/**
 * StoreBrowser — look at a table's rows without writing SQL.
 *
 * Pick an object on the left, and the grid pages, sorts and filters it through
 * typed predicates the server turns into SQL itself. Nobody types a query, and
 * nothing the browser sends is treated as SQL.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/utils/utils";

export type StoreKey = "lake" | "sqlite";

export interface StoreColumn {
  name: string;
  type: string;
  numeric: boolean;
}

export interface RowFilter {
  column: string;
  operator: "equals" | "contains" | "greater_than" | "less_than" | "between";
  value: string;
  valueTo?: string;
}

interface RowsResponse {
  store: StoreKey;
  name: string;
  columns: StoreColumn[];
  rows: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  matchedRowCount: number | null;
  statement: string;
}

interface ObjectDetail {
  store: StoreKey;
  name: string;
  columns: StoreColumn[];
  rowCount: number | null;
}

const PAGE_SIZES = [25, 100, 250, 500] as const;

const OPERATOR_LABELS: Record<RowFilter["operator"], string> = {
  equals: "is",
  contains: "contains",
  greater_than: "greater than",
  less_than: "less than",
  between: "between",
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export interface StoreBrowserProps {
  store: StoreKey;
  objectName: string;
}

export function StoreBrowser({ store, objectName }: StoreBrowserProps) {
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(0);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDirection, setOrderDirection] = useState<"ascending" | "descending">("ascending");
  const [filters, setFilters] = useState<RowFilter[]>([]);
  const [draft, setDraft] = useState<RowFilter>({ column: "", operator: "equals", value: "" });

  useEffect(() => {
    setPage(0);
    setOrderBy(null);
    setFilters([]);
    setDraft({ column: "", operator: "equals", value: "" });
  }, [store, objectName]);

  const detail = useQuery({
    queryKey: ["stores", "object", store, objectName],
    queryFn: ({ signal }) =>
      fetch(`/api/stores/objects/${store}/${encodeURIComponent(objectName)}`, { signal }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<ObjectDetail>;
      }),
    staleTime: 60_000,
  });

  const search = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
      orderDirection,
    });
    if (orderBy) params.set("orderBy", orderBy);
    if (filters.length) params.set("filters", JSON.stringify(filters));
    return params.toString();
  }, [pageSize, page, orderBy, orderDirection, filters]);

  const rows = useQuery({
    queryKey: ["stores", "rows", store, objectName, search],
    queryFn: ({ signal }) =>
      fetch(`/api/stores/rows/${store}/${encodeURIComponent(objectName)}?${search}`, { signal }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `${r.status}`);
        return body as RowsResponse;
      }),
    placeholderData: (previous) => previous,
  });

  const columns = detail.data?.columns ?? rows.data?.columns ?? [];
  const totalRows = filters.length ? rows.data?.matchedRowCount ?? null : detail.data?.rowCount ?? null;
  const lastPage = totalRows === null ? null : Math.max(0, Math.ceil(totalRows / pageSize) - 1);

  const toggleSort = (column: string) => {
    if (orderBy !== column) {
      setOrderBy(column);
      setOrderDirection("ascending");
    } else if (orderDirection === "ascending") {
      setOrderDirection("descending");
    } else {
      setOrderBy(null);
    }
    setPage(0);
  };

  const addFilter = () => {
    if (!draft.column || draft.value === "") return;
    setFilters((prev) => [...prev, draft]);
    setDraft({ column: "", operator: "equals", value: "" });
    setPage(0);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="store-browser">
      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <Select value={draft.column} onValueChange={(column) => setDraft((d) => ({ ...d, column }))}>
          <SelectTrigger className="h-7 w-48 text-xs" data-testid="filter-column">
            <SelectValue placeholder="column" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((column) => (
              <SelectItem key={column.name} value={column.name}>
                <span className="font-mono text-xs">{column.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">{column.type}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={draft.operator}
          onValueChange={(operator) => setDraft((d) => ({ ...d, operator: operator as RowFilter["operator"] }))}
        >
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OPERATOR_LABELS) as RowFilter["operator"][]).map((operator) => (
              <SelectItem key={operator} value={operator}>
                {OPERATOR_LABELS[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft.value}
          onChange={(event) => setDraft((d) => ({ ...d, value: event.target.value }))}
          onKeyDown={(event) => event.key === "Enter" && addFilter()}
          placeholder="value"
          className="h-7 w-40 text-xs"
          data-testid="filter-value"
        />
        {draft.operator === "between" && (
          <Input
            value={draft.valueTo ?? ""}
            onChange={(event) => setDraft((d) => ({ ...d, valueTo: event.target.value }))}
            placeholder="and"
            className="h-7 w-40 text-xs"
          />
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addFilter}>
          Add filter
        </Button>

        {filters.map((filter, index) => (
          <span
            key={`${filter.column}-${index}`}
            className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
          >
            <span className="font-mono">{filter.column}</span>
            <span className="text-muted-foreground">{OPERATOR_LABELS[filter.operator]}</span>
            <span className="font-mono">{filter.value}{filter.operator === "between" ? `…${filter.valueTo ?? ""}` : ""}</span>
            <button
              type="button"
              aria-label={`Remove filter on ${filter.column}`}
              onClick={() => {
                setFilters((prev) => prev.filter((_, i) => i !== index));
                setPage(0);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {/* ── Grid ────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        {rows.error ? (
          <p className="p-3 text-xs text-destructive">{(rows.error as Error).message}</p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                {columns.map((column) => {
                  const sorted = orderBy === column.name;
                  return (
                    <th key={column.name} className="border-b border-border px-2 py-1.5 align-bottom">
                      <button
                        type="button"
                        onClick={() => toggleSort(column.name)}
                        className="flex flex-col items-start gap-0.5 text-left hover:text-foreground"
                        title={`Sort by ${column.name}`}
                      >
                        <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-foreground">
                          {column.name}
                          {sorted && <span aria-hidden>{orderDirection === "ascending" ? "▲" : "▼"}</span>}
                          <span className="sr-only">{sorted ? `sorted ${orderDirection}` : ""}</span>
                        </span>
                        <span className="text-[10px] font-normal text-muted-foreground">{column.type}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(rows.data?.rows ?? []).map((row, index) => (
                <tr key={index} className={cn("border-b border-border/40", index % 2 === 1 && "bg-muted/20")}>
                  {columns.map((column) => (
                    <td key={column.name} className={cn("px-2 py-1 font-mono tnum", column.numeric && "text-right")}>
                      {formatCell(row[column.name])}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.isLoading && (rows.data?.rows.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={Math.max(1, columns.length)} className="px-2 py-4 text-center text-muted-foreground">
                    No rows match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Paging ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="tnum">
          {totalRows !== null ? (
            <>
              rows {(page * pageSize + 1).toLocaleString()}–
              {Math.min((page + 1) * pageSize, totalRows).toLocaleString()} of {totalRows.toLocaleString()}
              {filters.length ? " matching" : ""}
            </>
          ) : (
            <>rows {(page * pageSize + 1).toLocaleString()}–{((page + 1) * pageSize).toLocaleString()}</>
          )}
          {rows.isFetching && " · loading…"}
        </span>
        <span className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(0); }}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tnum">page {page + 1}{lastPage !== null ? ` of ${(lastPage + 1).toLocaleString()}` : ""}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Next page"
            disabled={lastPage !== null && page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </span>
      </div>
    </div>
  );
}
