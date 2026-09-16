/**
 * Lake columns as chart series.
 *
 * The 151 built-in indicators are computed in a worker from the bars already on
 * screen. A lake column is different: it is already stored, so it is fetched
 * for the window on screen and handed to the chart in exactly the same shape.
 * Everything downstream — the overlay lines, the subchart panes, the markers —
 * is the existing rendering path, untouched.
 *
 * What the catalog decides, this hook obeys:
 *   - `price_overlay` draws on the candles, because the values ARE prices.
 *   - anything else gets a pane, grouped by object and value shape, so columns
 *     sharing one axis are columns that belong on one axis.
 *   - a flag that fires rarely becomes a marker on its bars.
 *   - a forward-looking column keeps that flag all the way to the pane header.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SERIES_MAX_POINTS,
  type SeriesCatalog,
  type SeriesColumn,
  type SeriesObject,
  type SeriesResponse,
} from "@shared/series/types";
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import {
  registerInstanceLabel,
  registerInstanceReferenceLines,
  registerHistogramColumn,
  registerSeriesTitle,
  unregisterInstanceLabel,
  unregisterInstanceReferenceLines,
  unregisterSeriesTitle,
} from "@/market/lib/indicator_panels";

const STORAGE_KEY = "lake-series-selection-v1";
export const LAKE_SERIES_LIMIT = 8;

/** Okabe-Ito, one hue per family. Never red/green for meaning. */
const FAMILY_COLORS: Record<string, string> = {
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

/** Rotation used when several columns share one pane, so each stays readable. */
const PANE_ROTATION = ["#E69F00", "#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442", "#D55E00"];

const REFERENCE_LINE_COLORS = {
  zero: "rgba(255,255,255,0.28)",
  level: "rgba(255,255,255,0.18)",
  clip: "rgba(204,121,167,0.45)",
} as const;

export interface LakeSeriesStatus {
  id: string;
  object: string;
  column: string;
  label: string;
  family: string;
  renderMode: string;
  forwardLooking: boolean;
  pointCount: number;
  downsampled: boolean;
  emptyReason?: string;
}

function loadSelection(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function saveSelection(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A full quota must not take the chart down with it.
  }
}

/** Columns that share an object AND a value shape can share one axis. */
export function paneKeyFor(column: SeriesColumn): string {
  if (column.renderMode === "price_overlay") return "__price__";
  return `lake:${column.object}:${column.valueShape}`;
}

function overlayColumnFor(column: SeriesColumn): string {
  return `${paneKeyFor(column)}::${column.column}`;
}

export function useLakeSeriesCatalog() {
  return useQuery({
    queryKey: ["lake-series", "catalog"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/charts/series/catalog", { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `${response.status}`);
      return body as SeriesCatalog;
    },
    staleTime: Infinity,
    retry: false,
  });
}

export interface UseLakeSeriesOptions {
  symbol: string;
  timeframe: string;
  /** The bars currently loaded, which bound how far a request may reach. */
  bars: Array<{ timestamp: number | string }>;
  /**
   * What the chart is actually showing, in epoch MILLISECONDS — the unit
   * `TradingChart` emits. Values are fetched for this rather than for every
   * loaded bar: the buffer can hold a hundred days while seven are on screen,
   * and thinning across all of it leaves the visible week sparse.
   */
  visibleRange?: { start: number; end: number } | null;
}

/** Bars arrive in epoch milliseconds; the chart and the lake both speak seconds. */
function toSeconds(timestamp: number | string): number {
  const value = typeof timestamp === "string" ? Number(timestamp) || Date.parse(timestamp) : timestamp;
  return value > 2e10 ? Math.floor(value / 1000) : Math.floor(value);
}

export function useLakeSeries({ symbol, timeframe, bars, visibleRange }: UseLakeSeriesOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>(loadSelection);
  const catalog = useLakeSeriesCatalog();

  useEffect(() => saveSelection(selectedIds), [selectedIds]);

  const columnsById = useMemo(() => {
    const map = new Map<string, { object: SeriesObject; column: SeriesColumn }>();
    for (const object of catalog.data?.objects ?? []) {
      for (const column of object.columns) map.set(column.id, { object, column });
    }
    return map;
  }, [catalog.data]);

  const loadedRange = useMemo(() => {
    if (bars.length === 0) return null;
    let first = toSeconds(bars[0]!.timestamp);
    let last = first;
    for (const bar of bars) {
      const seconds = toSeconds(bar.timestamp);
      if (seconds < first) first = seconds;
      if (seconds > last) last = seconds;
    }
    // The window is inclusive of the final bar, so the end is pushed past it.
    return { from: first, to: last + 1 };
  }, [bars]);

  const window = useMemo(() => {
    if (!loadedRange) return null;
    if (!visibleRange || visibleRange.end <= visibleRange.start) return loadedRange;
    // Pad the viewport so a small pan does not immediately run off the edge of
    // what was fetched, then round to whole minutes to keep the query key — and
    // therefore the cache — stable while the chart settles.
    // The chart reports milliseconds; the lake and this request speak seconds.
    const startSeconds = toSeconds(visibleRange.start);
    const endSeconds = toSeconds(visibleRange.end);
    const pad = (endSeconds - startSeconds) * 0.25;
    const from = Math.max(loadedRange.from, Math.floor((startSeconds - pad) / 60) * 60);
    const to = Math.min(loadedRange.to, Math.ceil((endSeconds + pad) / 60) * 60);
    return to > from ? { from, to } : loadedRange;
  }, [loadedRange, visibleRange]);

  const requestedIds = useMemo(
    () => selectedIds.filter((id) => columnsById.has(id)).slice(0, LAKE_SERIES_LIMIT),
    [selectedIds, columnsById],
  );

  const query = useQuery({
    queryKey: ["lake-series", "values", requestedIds.join(","), symbol, timeframe, window?.from, window?.to],
    enabled: requestedIds.length > 0 && window !== null,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams({
        ids: requestedIds.join(","),
        symbol,
        timeframe,
        from: String(window!.from),
        to: String(window!.to),
        // Always ask for the full budget. Tying this to the number of bars
        // currently in memory made a sixteen-day window arrive as ~500 points —
        // forty-six-minute buckets, which turned a moving average into a
        // zigzag across the candles.
        maxPoints: String(SERIES_MAX_POINTS),
      });
      const response = await fetch(`/api/charts/series?${parameters}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `${response.status}`);
      return body as SeriesResponse;
    },
  });

  // Register what the panes need to label and line themselves, and take the
  // registrations back down when a column is deselected.
  useEffect(() => {
    const registeredPanes = new Set<string>();
    const registeredColumns: string[] = [];

    const byPane = new Map<string, SeriesColumn[]>();
    for (const id of requestedIds) {
      const entry = columnsById.get(id);
      if (!entry) continue;
      const key = paneKeyFor(entry.column);
      if (key === "__price__") continue;
      const list = byPane.get(key) ?? [];
      list.push(entry.column);
      byPane.set(key, list);
    }

    for (const [paneKey, columns] of byPane) {
      const first = columns[0]!;
      const forwardLooking = columns.some((column) => column.forwardLooking);
      registerInstanceLabel(
        paneKey,
        `${first.object}${forwardLooking ? " · forward-looking" : ""}`,
      );
      registerInstanceReferenceLines(
        paneKey,
        first.referenceLines.map((line) => ({
          value: line.value,
          color: REFERENCE_LINE_COLORS[line.kind],
        })),
      );
      registeredPanes.add(paneKey);

      columns.forEach((column) => {
        const overlayColumn = overlayColumnFor(column);
        registerSeriesTitle(
          overlayColumn,
          `${column.label}${column.forwardLooking ? " (forward-looking)" : ""}`,
        );
        if (column.renderMode === "pane_histogram") registerHistogramColumn(overlayColumn);
        registeredColumns.push(overlayColumn);
      });
    }

    // A marker prints its name on every bar it fires, so it gets the short
    // column name. "is a confirmed zigzag pivot" repeated forty times buried
    // the candles underneath it.
    for (const id of requestedIds) {
      const entry = columnsById.get(id);
      if (!entry || entry.column.renderMode !== "markers") continue;
      const overlayColumn = overlayColumnFor(entry.column);
      registerSeriesTitle(overlayColumn, entry.column.column);
      registeredColumns.push(overlayColumn);
    }

    return () => {
      registeredPanes.forEach((paneKey) => {
        unregisterInstanceLabel(paneKey);
        unregisterInstanceReferenceLines(paneKey);
      });
      registeredColumns.forEach(unregisterSeriesTitle);
    };
  }, [requestedIds, columnsById]);

  const overlays = useMemo<IndicatorOverlay[]>(() => {
    const series = query.data?.series ?? [];
    const paneCounters = new Map<string, number>();

    return series
      .map((entry) => {
        const definition = columnsById.get(entry.id);
        if (!definition || entry.points.length === 0) return null;
        const { column } = definition;

        const paneKey = paneKeyFor(column);
        const index = paneCounters.get(paneKey) ?? 0;
        paneCounters.set(paneKey, index + 1);

        const color =
          index === 0
            ? FAMILY_COLORS[column.family] ?? "#E69F00"
            : PANE_ROTATION[index % PANE_ROTATION.length]!;

        const displayType: IndicatorOverlay["displayType"] =
          column.renderMode === "price_overlay"
            ? "overlay"
            : column.renderMode === "markers"
              ? "marker"
              : "subchart";

        const data = entry.points
          // An unknown is dropped from the line rather than drawn as a zero.
          .filter((point) => point.value !== null && Number.isFinite(point.value))
          .map((point) => ({ time: point.timestampSeconds, value: point.value as number }));

        return {
          column: overlayColumnFor(column),
          data,
          color,
          displayType,
          lineWidth: column.renderMode === "price_overlay" ? 2 : 1,
        } satisfies IndicatorOverlay;
      })
      .filter((overlay): overlay is IndicatorOverlay => overlay !== null && overlay.data.length > 0);
  }, [query.data, columnsById]);

  const statuses = useMemo<LakeSeriesStatus[]>(() => {
    const byId = new Map((query.data?.series ?? []).map((entry) => [entry.id, entry]));
    return requestedIds.flatMap((id) => {
      const definition = columnsById.get(id);
      if (!definition) return [];
      const served = byId.get(id);
      return [{
        id,
        object: definition.column.object,
        column: definition.column.column,
        label: definition.column.label,
        family: definition.column.family,
        renderMode: definition.column.renderMode,
        forwardLooking: definition.column.forwardLooking,
        pointCount: served?.pointCount ?? 0,
        downsampled: served?.downsampled ?? false,
        emptyReason: served?.emptyReason ?? definition.column.unavailableReason,
      }];
    });
  }, [requestedIds, columnsById, query.data]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length >= LAKE_SERIES_LIMIT
          ? previous
          : [...previous, id],
    );
  }, []);

  const removeByOverlayColumns = useCallback(
    (columns: string[]) => {
      const dropped = new Set(columns);
      setSelectedIds((previous) =>
        previous.filter((id) => {
          const entry = columnsById.get(id);
          return entry ? !dropped.has(overlayColumnFor(entry.column)) : true;
        }),
      );
    },
    [columnsById],
  );

  return {
    catalog: catalog.data,
    catalogError: catalog.error ? (catalog.error as Error).message : null,
    isCatalogLoading: catalog.isLoading,
    selectedIds: requestedIds,
    toggle,
    clear: useCallback(() => setSelectedIds([]), []),
    removeByOverlayColumns,
    overlays,
    statuses,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    atLimit: requestedIds.length >= LAKE_SERIES_LIMIT,
  };
}

/** Everything the toolbar needs to offer the lake's columns. */
export type LakeSeriesControls = ReturnType<typeof useLakeSeries>;
