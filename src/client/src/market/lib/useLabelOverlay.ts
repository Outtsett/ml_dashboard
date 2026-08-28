/**
 * Label overlay for the trading chart.
 *
 * Picks a label generator, previews it over the bars currently on the chart,
 * and returns markers the candle series can render. Nothing is persisted —
 * this is the read-only `/api/labels/preview` path, not label generation.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LabelMarker } from '@/market/components/types';

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

  const generators = useMemo(() => {
    const raw = generatorsQuery.data;
    if (!raw) return [];
    return Object.entries(raw).map(([id, g]) => ({ ...g, id: g.id ?? id }));
  }, [generatorsQuery.data]);

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

  const previewQuery = useQuery<LabelPreviewResponse>({
    queryKey: ['/api/labels/preview', symbol, timeframeMinutes, generatorType, params, range?.start, range?.end],
    enabled: Boolean(generatorType) && Boolean(symbol) && range !== null && paramsReady,
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
  }, [previewQuery.data]);

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

  const chartExtendsPastLabels = Boolean(
    coveredRange && range && range.end > coveredRange.end + timeframeMinutes * 60_000,
  );

  return {
    generators,
    generatorsLoading: generatorsQuery.isLoading,
    labelMarkers,
    distribution: previewQuery.data?.distribution ?? {},
    classBalanceRatio: previewQuery.data?.classBalanceRatio ?? null,
    coveredRange,
    chartExtendsPastLabels,
    isLoading: previewQuery.isFetching,
    error: previewQuery.error instanceof Error
      ? previewQuery.error.message
      : bodyError,
  };
}
