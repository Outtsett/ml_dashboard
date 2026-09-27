/**
 * Label overlay for the trading chart.
 *
 * Picks a label generator, previews it over the bars currently on the chart,
 * and returns markers the candle series can render. Nothing is persisted —
 * this is the read-only `/api/labels/preview` path, not label generation.
 */

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LabelLifecycleResponse } from '@shared/labels/contract';
import type { LabelMarker } from '@/market/components/types';
import {
  CANDLE_PATTERN_GENERATORS,
  fetchCandlePatternMarkers,
  isCandlePatternGenerator,
} from '@/market/lib/candlePatternLabels';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LabelGeneratorParam {
  id: string;
  name: string;
  type?: string;
  default?: unknown;
}

export interface LabelGenerator {
  id: string;
  name: string;
  description: string;
  category: string;
  params: LabelGeneratorParam[];
}

interface LabelPreviewResponse {
  success: boolean;
  preview?: Array<{
    timestamp: number;
    close?: number;
    label: number | null;
    /** Bars forward to the bar this label describes; see labelOutcomeOffset.ts. */
    outcomeOffset?: number;
  }>;
  count?: number;
  distribution?: Record<string, number>;
  totalLabeledSamples?: number;
  classBalanceRatio?: number;
  error?: string;
}

/** Rows of a landed set (`GET /api/labels/:id/rows`), already in the label contract. */
interface LabelSetRowsResponse {
  labelSetId: number;
  parquetPath: string;
  count: number;
  rows: Array<{
    timestamp: number;
    close?: number;
    label: number | null;
    resolution_bars?: number;
    outcome_offset?: number;
    usable?: boolean;
  }>;
}

/** Generator ids of the form `set:<labelSetId>` draw a LANDED set rather than a preview. */
export const LANDED_SET_PREFIX = 'set:';
export const LANDED_SET_CATEGORY = 'landed set';
/** Custom event the Labels page raises to draw a set on the chart. */
export const LABEL_OVERLAY_SELECT_EVENT = 'label-overlay:select';

export function landedSetIdOf(generatorType: string | null): number | null {
  if (!generatorType || !generatorType.startsWith(LANDED_SET_PREFIX)) return null;
  const id = Number(generatorType.slice(LANDED_SET_PREFIX.length));
  return Number.isFinite(id) && id > 0 ? id : null;
}

export interface LabelOverlayResult {
  generators: LabelGenerator[];
  generatorsLoading: boolean;
  labelMarkers: LabelMarker[];
  /** Class counts over the whole previewed range, not just the returned rows. */
  distribution: Record<string, number>;
  /** min(count)/max(count) across classes. Near 0 means a rare-event label. */
  classBalanceRatio: number | null;
  /**
   * Epoch-ms span the returned markers actually cover. The row cap and the
   * label table's own coverage both bite here: the chart can be showing months
   * the label source has no rows for, and without this the overlay looks empty
   * for no stated reason.
   */
  coveredRange: { start: number; end: number } | null;
  /** True when the chart extends past the newest label by more than one bar. */
  chartExtendsPastLabels: boolean;
  isLoading: boolean;
  error: string | null;
}

/** Bars the chart is currently showing — used to bound the preview query. */
export interface LabelRangeBar {
  timestamp: number | string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Row cap for a single overlay request. The chart draws at most a few thousand
 * bars, and every marker past that is a wasted row over the wire.
 */
const PREVIEW_LIMIT = 5000;

// ── Helpers ────────────────────────────────────────────────────────────────

function toMs(value: number | string): number {
  return typeof value === 'string' ? parseInt(value, 10) : value;
}

/** Inclusive [start, end] of the loaded bars, or null when there are none. */
function rangeOf(bars: LabelRangeBar[]): { start: number; end: number } | null {
  if (bars.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const bar of bars) {
    const ts = toMs(bar.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (ts < start) start = ts;
    if (ts > end) end = ts;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLabelOverlay(
  symbol: string,
  timeframeMinutes: number,
  generatorType: string | null,
  bars: LabelRangeBar[],
  /**
   * Span currently on screen, epoch ms. When present the preview is bounded to
   * it, so the row cap is spent on bars the user can actually see instead of
   * being spread across every loaded bar.
   */
  visibleRange?: { start: number; end: number } | null,
): LabelOverlayResult {
  const generatorsQuery = useQuery<Record<string, LabelGenerator>>({
    queryKey: ['/api/labels/generators'],
    queryFn: async () => {
      const res = await fetch('/api/labels/generators');
      if (!res.ok) throw new Error(`Failed to load label generators (${res.status})`);
      return res.json();
    },
    staleTime: Infinity,
  });

  // Landed sets for this symbol and timeframe join the picker as their own
  // group: a set is the rows a person validated and landed, not a preview.
  const lifecycleQuery = useQuery<LabelLifecycleResponse>({
    queryKey: ['/api/labels/lifecycle', 'overlay'],
    queryFn: async () => {
      const res = await fetch('/api/labels/lifecycle?probe=0');
      if (!res.ok) throw new Error(`Failed to load label sets (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  // The 61 candlestick patterns join the server's generators in one list. They
  // are appended locally rather than served, so the picker is fully populated
  // even while `/api/labels/generators` is still in flight.
  //
  // The server's own `candle-pattern` generators are dropped on the way past.
  // They are the retired path: five entries (`talib_candle_pattern` plus
  // engulfing, harami, haramicross, hikkake) that SELECT from the
  // `talib_candle_patterns` table, which only ever covered 1m/5m/15m over a
  // three-month window. The 61 appended here compute the same library's output
  // over whatever bars are on screen, so keeping both would list some patterns
  // twice with the duplicate reading from a narrower source.
  const generators = useMemo(() => {
    const raw = generatorsQuery.data;
    const serverSide = raw
      ? Object.entries(raw)
          .map(([id, g]) => ({ ...g, id: g.id ?? id }))
          .filter(g => g.category !== 'candle-pattern')
      : [];
    const landed: LabelGenerator[] = Object.values(lifecycleQuery.data?.lifecycle ?? {})
      .filter(l => l.symbol === symbol && l.timeframeMinutes === timeframeMinutes && l.reached.includes('landed') && l.stage !== 'retired')
      .sort((a, b) => b.labelSetId - a.labelSetId)
      .map(l => ({
        id: `${LANDED_SET_PREFIX}${l.labelSetId}`,
        name: `#${l.labelSetId} ${l.generatorType} (${l.recipe?.slice(-12) ?? 'landed'})`,
        description: `${l.rowCount.toLocaleString()} landed rows · ${l.stage}${l.staleReason ? ' · stale' : ''}`,
        category: LANDED_SET_CATEGORY,
        params: [],
      }));
    return [...serverSide, ...CANDLE_PATTERN_GENERATORS, ...landed];
  }, [generatorsQuery.data, lifecycleQuery.data, symbol, timeframeMinutes]);

  const landedSetId = landedSetIdOf(generatorType);

  const patternSelected = isCandlePatternGenerator(generatorType);

  const loadedRange = useMemo(() => rangeOf(bars), [bars]);
  // Pad the viewport by 20% each side so a small pan does not immediately fall
  // off the edge of the fetched labels.
  const range = useMemo(() => {
    if (!visibleRange) return loadedRange;
    const pad = (visibleRange.end - visibleRange.start) * 0.2;
    return { start: visibleRange.start - pad, end: visibleRange.end + pad };
  }, [visibleRange, loadedRange]);

  // Every generator declares a default per parameter. Sending `{}` instead
  // interpolates `undefined` into the generated SQL — the server answers
  // "Invalid column: undefined" for `direction`, "future_close_undefined" for
  // `triple_barrier`, and silently zero rows for the rest.
  const params = useMemo((): Record<string, unknown> => {
    const generator = generators.find(g => g.id === generatorType);
    if (!generator) return {};
    const resolved: Record<string, unknown> = {};
    for (const p of generator.params ?? []) {
      if (p.default !== undefined) resolved[p.id] = p.default;
    }
    return resolved;
  }, [generators, generatorType]);

  const paramsReady = generatorType === null || generators.length > 0;

  /**
   * Candlestick patterns take the compute path, not the label-preview path.
   *
   * `/api/charts/candle-patterns` runs TA-Lib over the bars on screen and
   * answers in ~220ms end to end. The generic `/api/labels/preview` route is a
   * different pipeline with different performance characteristics, and routing
   * patterns through it would inherit them for no benefit — a pattern needs no
   * SQL, only OHLC.
   */
  const patternQuery = useQuery({
    queryKey: ['candle-pattern-label', symbol, timeframeMinutes, generatorType, range?.start, range?.end],
    enabled: patternSelected && Boolean(symbol) && range !== null,
    queryFn: ({ signal }) =>
      fetchCandlePatternMarkers(symbol, timeframeMinutes, generatorType!, range, signal),
  });

  /** A landed set: its contract rows for the span on screen, no recomputation. */
  const landedQuery = useQuery<LabelSetRowsResponse>({
    queryKey: ['/api/labels/rows', landedSetId, range?.start, range?.end],
    enabled: landedSetId !== null && range !== null,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ from: String(Math.floor(range!.start)), to: String(Math.ceil(range!.end)), limit: String(PREVIEW_LIMIT) });
      const res = await fetch(`/api/labels/${landedSetId}/rows?${query}`, { signal });
      if (!res.ok) throw new Error(`Label set rows failed (${res.status})`);
      return res.json();
    },
  });

  const previewQuery = useQuery<LabelPreviewResponse>({
    queryKey: ['/api/labels/preview', symbol, timeframeMinutes, generatorType, params, range?.start, range?.end],
    enabled: Boolean(generatorType) && !patternSelected && landedSetId === null && Boolean(symbol) && range !== null && paramsReady,
    // The label routes share one 20-requests-a-minute limiter with generation.
    // A pan that re-keys this query on every frame spent that budget in
    // seconds; the range is debounced upstream and a settled range is served
    // from cache for half a minute.
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch('/api/labels/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generatorType,
          symbol,
          params,
          limit: PREVIEW_LIMIT,
          startTimestamp: range!.start,
          endTimestamp: range!.end,
          timeframeMinutes,
        }),
      });
      if (!res.ok) throw new Error(`Label preview failed (${res.status})`);
      return res.json();
    },
  });

  const labelMarkers = useMemo((): LabelMarker[] => {
    if (patternSelected) return patternQuery.data?.markers ?? [];
    if (landedSetId !== null) {
      return (landedQuery.data?.rows ?? [])
        .filter(r => r.label !== null && r.label !== undefined)
        .map(r => ({
          timestamp: toMs(r.timestamp),
          label: r.label,
          close: r.close,
          outcomeOffset: r.resolution_bars ?? r.outcome_offset ?? 0,
        }));
    }
    const rows = previewQuery.data?.preview;
    if (!rows) return [];
    return rows
      .filter(r => r.label !== null && r.label !== undefined)
      .map(r => ({
        timestamp: toMs(r.timestamp),
        label: r.label,
        close: r.close,
        outcomeOffset: r.outcomeOffset,
      }));
  }, [patternSelected, patternQuery.data, previewQuery.data, landedSetId, landedQuery.data]);

  /** Distribution of a landed set over the rows on screen. */
  const landedDistribution = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of landedQuery.data?.rows ?? []) {
      if (r.label === null || r.label === undefined) continue;
      out[String(r.label)] = (out[String(r.label)] ?? 0) + 1;
    }
    return out;
  }, [landedQuery.data]);

  // A `success: false` body is a 200 carrying a generator-side failure, so it
  // has to be surfaced alongside transport errors rather than instead of them.
  const bodyError = previewQuery.data && previewQuery.data.success === false
    ? previewQuery.data.error ?? 'Label preview failed'
    : null;

  const coveredRange = useMemo(() => {
    if (labelMarkers.length === 0) return null;
    let start = Infinity;
    let end = -Infinity;
    for (const m of labelMarkers) {
      if (m.timestamp < start) start = m.timestamp;
      if (m.timestamp > end) end = m.timestamp;
    }
    return { start, end };
  }, [labelMarkers]);

  /**
   * Warn only when the LABEL SOURCE runs out before the chart does.
   *
   * That is a real condition for a stored label set, which covers whatever range
   * it was generated over. It is meaningless for a computed pattern: every bar
   * on screen was scored, so a stretch with no marker is the pattern not firing,
   * not coverage running out. Reusing the warning here would fire on almost
   * every pattern — `range` is padded 20% past the viewport, so it sits beyond
   * the last firing nearly always — and would teach the user to ignore it.
   */
  const chartExtendsPastLabels = Boolean(
    !patternSelected
      && coveredRange && range && range.end > coveredRange.end + timeframeMinutes * 60_000,
  );

  // A pattern fires in one direction per bar, so its "class balance" is the
  // rarer sign over the commoner one. Reported on the same scale as a
  // generator's so the legend reads identically for both.
  const patternBalance = useMemo((): number | null => {
    const counts = Object.values(patternQuery.data?.distribution ?? {});
    if (counts.length < 2) return null;
    const max = Math.max(...counts);
    return max === 0 ? null : Math.min(...counts) / max;
  }, [patternQuery.data]);

  const activeQuery = patternSelected ? patternQuery : landedSetId !== null ? landedQuery : previewQuery;
  const landedBalance = useMemo((): number | null => {
    const counts = Object.values(landedDistribution);
    if (counts.length < 2) return null;
    const max = Math.max(...counts);
    return max === 0 ? null : Math.min(...counts) / max;
  }, [landedDistribution]);

  return {
    generators,
    generatorsLoading: generatorsQuery.isLoading,
    labelMarkers,
    distribution: patternSelected
      ? patternQuery.data?.distribution ?? {}
      : landedSetId !== null ? landedDistribution : previewQuery.data?.distribution ?? {},
    classBalanceRatio: patternSelected
      ? patternBalance
      : landedSetId !== null ? landedBalance : previewQuery.data?.classBalanceRatio ?? null,
    coveredRange,
    chartExtendsPastLabels,
    isLoading: activeQuery.isFetching,
    error: activeQuery.error instanceof Error
      ? activeQuery.error.message
      : patternSelected || landedSetId !== null ? null : bodyError,
  };
}

/**
 * Let another page (the Labels catalog) choose the overlay: it raises
 * `label-overlay:select` with `{ generatorType }` and the Market page's state
 * follows. A hook rather than shared state because the chart's selection is
 * the Market page's own, and nobody else needs to read it.
 */
export function useLabelOverlaySelectionEvents(onSelect: (generatorType: string | null) => void): void {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ generatorType?: string | null }>).detail;
      if (detail && 'generatorType' in detail) onSelect(detail.generatorType ?? null);
    };
    window.addEventListener(LABEL_OVERLAY_SELECT_EVENT, handler);
    return () => window.removeEventListener(LABEL_OVERLAY_SELECT_EVENT, handler);
  }, [onSelect]);
}
