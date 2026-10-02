/**
 * Lake data selector — every column in the lake, offered as a chart series.
 *
 * Grouped by what the column measures rather than by which table it happens to
 * live in, because "volatility" is the question a person has; `mnq_swing_5m` is
 * not. Each row states how it will be drawn and how much of it exists, so
 * clicking it holds no surprise: a price draws on the candles, everything else
 * takes a pane, and a column computed from later bars says so before it is
 * ever put on screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { ChevronsUpDown, Database, Search, X } from "lucide-react";
import {
  SERIES_FAMILY_LABELS,
  type SeriesCatalog,
  type SeriesColumn,
  type SeriesFamily,
} from "@shared/series/types";
import type { LakeSeriesStatus } from "@/market/lib/useLakeSeries";
import { LAKE_SERIES_LIMIT } from "@/market/lib/useLakeSeries";
import { cn } from "@/shared/utils/utils";

const FAMILY_ORDER: SeriesFamily[] = [
  "trend",
  "momentum",
  "volatility",
  "volume",
  "price_structure",
  "mean_reversion",
  "microstructure",
  "statistics",
  "pattern",
  "regime",
  "trade_level",
  "label",
  "reference",
];

const RENDER_MODE_WORDS: Record<string, string> = {
  price_overlay: "on the price",
  pane_line: "own pane",
  pane_histogram: "own pane, bars",
  pane_step: "own pane, steps",
  markers: "marks the bar",
  background: "shades the chart",
};

const FAMILY_DOT: Record<string, string> = {
  trend: "#0072B2",
  momentum: "#E69F00",
  volatility: "#CC79A7",
  volume: "#56B4E9",
  price_structure: "#009E73",
  mean_reversion: "#F0E442",
  microstructure: "#999999",
  statistics: "#56B4E9",
  pattern: "#CC79A7",
  regime: "#999999",
  label: "#D55E00",
  trade_level: "#E69F00",
  reference: "#999999",
};

interface LakeSeriesSelectorProps {
  catalog?: SeriesCatalog;
  catalogError: string | null;
  isCatalogLoading: boolean;
  selectedIds: string[];
  statuses: LakeSeriesStatus[];
  onToggle: (id: string) => void;
  onClear: () => void;
  atLimit: boolean;
  isFetching: boolean;
}

interface Grouped {
  family: SeriesFamily;
  objects: Array<{ object: string; timeframe: string | null; columns: SeriesColumn[] }>;
  count: number;
}

export function LakeSeriesSelector({
  catalog,
  catalogError,
  isCatalogLoading,
  selectedIds,
  statuses,
  onToggle,
  onClear,
  atLimit,
  isFetching,
}: LakeSeriesSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch("");
  }, [open]);

  const grouped = useMemo<Grouped[]>(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    const byFamily = new Map<SeriesFamily, Map<string, { timeframe: string | null; columns: SeriesColumn[] }>>();

    for (const object of catalog.objects) {
      for (const column of object.columns) {
        if (column.unavailableReason) continue;
        if (
          needle &&
          !column.column.toLowerCase().includes(needle) &&
          !column.label.toLowerCase().includes(needle) &&
          !object.object.toLowerCase().includes(needle) &&
          !SERIES_FAMILY_LABELS[column.family].toLowerCase().includes(needle)
        ) {
          continue;
        }
        const objects = byFamily.get(column.family) ?? new Map();
        const entry = objects.get(object.object) ?? { timeframe: object.timeframe, columns: [] };
        entry.columns.push(column);
        objects.set(object.object, entry);
        byFamily.set(column.family, objects);
      }
    }

    return FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => {
      const objects = Array.from(byFamily.get(family)!.entries())
        .map(([object, entry]) => ({ object, timeframe: entry.timeframe, columns: entry.columns }))
        .sort((a, b) => a.object.localeCompare(b.object));
      return {
        family,
        objects,
        count: objects.reduce((total, entry) => total + entry.columns.length, 0),
      };
    });
  }, [catalog, search]);

  const selected = new Set(selectedIds);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 border-white/10 bg-black/30 px-2.5 font-mono text-xs"
          data-testid="lake-series-trigger"
        >
          <Database className="h-3 w-3" />
          Lake data
          {selectedIds.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
              {selectedIds.length}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-white/5 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder={
              catalog
                ? `Search ${catalog.chartableColumnCount} lake columns…`
                : "Search lake columns…"
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="flex-1 bg-transparent font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            data-testid="lake-series-search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              <X className="h-3 w-3 text-zinc-500 hover:text-zinc-300" />
            </button>
          )}
        </div>

        {catalogError && (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-amber-300/90">
            {catalogError}
          </p>
        )}
        {isCatalogLoading && (
          <p className="px-2 py-3 text-[11px] text-zinc-500">Reading the lake catalog…</p>
        )}

        {statuses.length > 0 && !search && (
          <div className="border-b border-white/5 px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                On the chart {isFetching && "· loading"}
              </span>
              <button
                type="button"
                onClick={onClear}
                className="text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                clear all
              </button>
            </div>
            <ul className="space-y-0.5">
              {statuses.map((status) => (
                <li key={status.id} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: FAMILY_DOT[status.family] ?? "#999999" }}
                  />
                  <span className="truncate font-mono text-zinc-200">{status.column}</span>
                  <span className="shrink-0 text-zinc-600">{status.object}</span>
                  {status.forwardLooking && (
                    <Badge variant="outline" className="h-3.5 shrink-0 px-1 text-[9px]">
                      forward-looking
                    </Badge>
                  )}
                  <span className="ml-auto shrink-0 tnum text-zinc-500">
                    {status.emptyReason ? "no rows here" : `${status.pointCount.toLocaleString()} pts`}
                    {status.downsampled && " · bucketed"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${status.column}`}
                    onClick={() => onToggle(status.id)}
                    className="shrink-0 text-zinc-500 hover:text-zinc-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            {atLimit && (
              <p className="mt-1 text-[10px] text-zinc-500">
                {LAKE_SERIES_LIMIT} at once — remove one to add another.
              </p>
            )}
          </div>
        )}

        <ScrollArea className="max-h-[440px]">
          <div className="py-1">
            {grouped.map((group) => (
              <section key={group.family} className="mb-1">
                <header className="flex items-center gap-1.5 px-2 py-1">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: FAMILY_DOT[group.family] ?? "#999999" }}
                  />
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {SERIES_FAMILY_LABELS[group.family]}
                  </h4>
                  <span className="tnum text-[10px] text-zinc-600">{group.count}</span>
                </header>

                {group.objects.map((entry) => (
                  <div key={`${group.family}:${entry.object}`} className="mb-0.5">
                    <p className="px-2 py-0.5 font-mono text-[10px] text-zinc-600">
                      {entry.object}
                      {entry.timeframe ? ` · ${entry.timeframe}` : ""}
                    </p>
                    <ul>
                      {entry.columns.map((column) => {
                        const isSelected = selected.has(column.id);
                        const blocked = !isSelected && atLimit;
                        return (
                          <li key={column.id}>
                            <button
                              type="button"
                              disabled={blocked}
                              onClick={() => onToggle(column.id)}
                              data-testid={`lake-column-${column.id}`}
                              className={cn(
                                "flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-white/5",
                                isSelected && "bg-white/10",
                                blocked && "cursor-not-allowed opacity-40",
                              )}
                            >
                              <span className="w-3 shrink-0 text-center text-zinc-400" aria-hidden>
                                {isSelected ? "✓" : ""}
                              </span>
                              <span className="truncate font-mono text-zinc-200">{column.column}</span>
                              <span className="truncate text-zinc-500">{column.label}</span>
                              <span className="ml-auto shrink-0 text-[9px] text-zinc-600">
                                {RENDER_MODE_WORDS[column.renderMode] ?? column.renderMode}
                              </span>
                              {column.forwardLooking && (
                                <Badge variant="outline" className="h-3.5 shrink-0 px-1 text-[9px]">
                                  forward
                                </Badge>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            ))}

            {catalog && grouped.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-zinc-500">
                Nothing in the lake matches “{search}”.
              </p>
            )}
          </div>
        </ScrollArea>

        {catalog && (
          <footer className="border-t border-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-600">
            {catalog.objectCount} objects · {catalog.columnCount} columns ·{" "}
            {catalog.chartableColumnCount} drawable. Measured{" "}
            {catalog.generatedAtIso.slice(0, 10)}.
          </footer>
        )}
      </PopoverContent>
    </Popover>
  );
}
