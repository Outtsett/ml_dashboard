/**
 * RegistryTable — Tanstack-Table v8 of model_versions for Stage 6 Promote.
 *
 * W7.e of `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md`.
 * Reads `state.registryFilters` (status[], catalogId, symbol, timeframe) and
 * fetches `GET /api/model-versions?…` via TanStack Query. Row click dispatches
 * `setSelectedVersion(id, mode='lineage')` which opens the right-side drawer.
 *
 * Color tiers reuse the rules from `DashboardTab.tsx` (Sharpe ≥2 emerald,
 * ≥1 emerald-soft, ≥0 amber, <0 rose) so the registry page is visually
 * consistent with the rest of ML Studio.
 *
 * Default sort: `promoted_at` desc — newest promotions first; falls back to
 * `created_at` if a row was never promoted.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Loader2, Rocket, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useMLStudio } from "../../MLStudioContext";

// ─── Types (mirror server `/api/model-versions` row shape) ───────────────────

export type ModelVersionStatus =
  | "candidate"
  | "shadow"
  | "paper"
  | "live"
  | "retired";

export interface ModelVersionRow {
  id: number;
  catalogId: string;
  modelId: string | null;
  versionId: string;
  status: ModelVersionStatus;
  symbol: string;
  timeframe: string;
  dataHash: string | null;
  sharpe: number | null;
  profitFactor: number | null;
  ece: number | null;
  promotedAt: string | null;
  createdAt: string;
}

// ─── Color helpers (mirror DashboardTab tiers) ───────────────────────────────

function sharpeColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 2.0) return "text-[hsl(var(--data-pos))]";
  if (v >= 1.0) return "text-[hsl(var(--data-pos)/0.8)]";
  if (v >= 0) return "text-amber-400";
  return "text-[hsl(var(--data-neg))]";
}

interface StatusVisual {
  label: string;
  className: string;
}

function statusVisual(status: ModelVersionStatus): StatusVisual {
  switch (status) {
    case "live":
      return {
        label: "Live",
        className: "border-[color-mix(in_srgb,hsl(var(--data-neg)/0.4)_88%,black)] text-[color-mix(in_srgb,hsl(var(--data-neg))_80%,white)] bg-[color-mix(in_srgb,hsl(var(--data-neg)/0.1)_88%,black)]",
      };
    case "paper":
      return {
        label: "Paper",
        className: "border-primary/40 text-primary bg-primary/10",
      };
    case "shadow":
      return {
        label: "Shadow",
        className: "border-violet-500/40 text-violet-300 bg-violet-500/10",
      };
    case "candidate":
      return {
        label: "Candidate",
        className: "border-amber-500/40 text-amber-300 bg-amber-500/10",
      };
    case "retired":
      return {
        label: "Retired",
        className: "border-white/15 text-muted-foreground bg-white/5",
      };
  }
}

function StatusBadge({ status }: { status: ModelVersionStatus }) {
  const v = statusVisual(status);
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 px-1.5 py-0 text-[10px] font-medium gap-1",
        v.className,
      )}
    >
      {v.label}
    </Badge>
  );
}

function fmtNumber(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString();
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return h.length <= 10 ? h : `${h.slice(0, 8)}…`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface RegistryQueryParams {
  status: string[];
  catalogId: string | null;
  symbol: string | null;
  timeframe: string | null;
}

const REGISTRY_QUERY_KEY = ["/api/model-versions"] as const;

export function useModelVersionRegistry(params: RegistryQueryParams) {
  return useQuery<ModelVersionRow[]>({
    queryKey: [...REGISTRY_QUERY_KEY, params],
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams();
      for (const s of params.status) search.append("status", s);
      if (params.catalogId) search.set("catalogId", params.catalogId);
      if (params.symbol) search.set("symbol", params.symbol);
      if (params.timeframe) search.set("timeframe", params.timeframe);
      const url = `/api/model-versions${search.toString() ? `?${search}` : ""}`;
      const res = await fetch(url, { signal, credentials: "include" });
      if (res.status === 404) return [];
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as ModelVersionRow[]) : [];
    },
    staleTime: 30_000,
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface RegistryTableProps {
  /** Override fetched rows (testing hook). When provided, no fetch occurs. */
  rows?: ModelVersionRow[];
  /** Visible empty-state subtitle. */
  emptyHint?: string;
}

export function RegistryTable({ rows: rowsOverride, emptyHint }: RegistryTableProps) {
  const { state, dispatch } = useMLStudio();
  const queryEnabled = rowsOverride === undefined;
  const query = useModelVersionRegistry(state.registryFilters);

  const rows: ModelVersionRow[] = rowsOverride ?? query.data ?? [];
  const isLoading = queryEnabled && query.isLoading;
  const isError = queryEnabled && query.isError;

  const [sorting, setSorting] = useState<SortingState>([
    { id: "promoted_at", desc: true },
  ]);

  const columns = useMemo<ColumnDef<ModelVersionRow>[]>(
    () => [
      {
        id: "version_id",
        header: "Version",
        accessorFn: (r) => r.versionId,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-foreground">
            {row.original.versionId}
          </span>
        ),
      },
      {
        id: "catalog_id",
        header: "Catalog",
        accessorFn: (r) => r.catalogId,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5 min-w-[120px]">
            <span className="text-xs font-medium text-foreground truncate">
              {row.original.catalogId}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {row.original.symbol} · {row.original.timeframe}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "data_hash",
        header: "Data hash",
        accessorFn: (r) => r.dataHash ?? "",
        cell: ({ row }) => (
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title={row.original.dataHash ?? ""}
          >
            {shortHash(row.original.dataHash)}
          </span>
        ),
      },
      {
        id: "sharpe",
        header: "Sharpe",
        accessorFn: (r) => r.sharpe ?? null,
        cell: ({ row }) => (
          <span
            className={cn(
              "font-mono text-xs",
              sharpeColor(row.original.sharpe),
            )}
          >
            {fmtNumber(row.original.sharpe, 2)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "promoted_at",
        header: "Promoted",
        accessorFn: (r) =>
          r.promotedAt ? Date.parse(r.promotedAt) : 0,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {fmtDate(row.original.promotedAt)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({
                  type: "setSelectedVersion",
                  versionId: row.original.id,
                  mode: "lineage",
                });
              }}
              data-testid={`registry-lineage-${row.original.id}`}
            >
              <Layers className="h-3 w-3" />
              Lineage
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-[color-mix(in_srgb,hsl(var(--data-pos))_80%,white)] hover:text-[color-mix(in_srgb,hsl(var(--data-pos))_62%,white)]"
              disabled={row.original.status === "live" || row.original.status === "retired"}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({
                  type: "setSelectedVersion",
                  versionId: row.original.id,
                  mode: "promote",
                });
              }}
              data-testid={`registry-promote-${row.original.id}`}
            >
              <Rocket className="h-3 w-3" />
              Promote
            </Button>
          </div>
        ),
      },
    ],
    [dispatch],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Model registry
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {isLoading
            ? "Loading…"
            : `${rows.length} version${rows.length === 1 ? "" : "s"}`}
        </span>
      </header>
      {isError ? (
        <div className="px-5 py-12 text-center text-xs text-[color-mix(in_srgb,hsl(var(--data-neg))_80%,white)]">
          <AlertCircle className="h-5 w-5 mx-auto mb-2" />
          Failed to load model versions:{" "}
          <span className="font-mono">{(query.error as Error)?.message}</span>
        </div>
      ) : isLoading ? (
        <div className="px-5 py-12 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 mx-auto mb-2 animate-spin" />
          Loading model versions…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-xs text-muted-foreground">
          <Layers className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-foreground/80">
            No model versions yet
          </p>
          <p className="mt-1 text-muted-foreground/80">
            {emptyHint ??
              "Save & train a model in Stage 4, then run a backtest in Stage 5 to register a candidate version."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortable = h.column.getCanSort();
                    return (
                      <th
                        key={h.id}
                        className={cn(
                          "px-3 py-2 font-medium text-muted-foreground/80 text-[10px] uppercase tracking-widest whitespace-nowrap",
                          sortable && "cursor-pointer hover:text-foreground",
                        )}
                        onClick={
                          sortable
                            ? h.column.getToggleSortingHandler()
                            : undefined
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {{ asc: "↑", desc: "↓" }[
                            h.column.getIsSorted() as string
                          ] ?? ""}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const isSelected =
                  state.selectedVersionId === row.original.id;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-white/5 last:border-0 cursor-pointer transition-colors",
                      isSelected
                        ? "bg-primary/10"
                        : "hover:bg-white/[0.04]",
                    )}
                    onClick={() =>
                      dispatch({
                        type: "setSelectedVersion",
                        versionId: row.original.id,
                        mode: "lineage",
                      })
                    }
                    data-testid={`registry-row-${row.original.id}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
