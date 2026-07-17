/**
 * InputWindowChart — the REAL bars an architecture's input window spans.
 *
 * HONESTY CONTRACT (mirrors NeuralCanvas):
 *   - Every candle is a real bar from `GET /api/charts/ohlcv`. Nothing here is
 *     generated, simulated or randomised. A failed fetch or an empty result
 *     renders an explicit error/empty state naming the symbol + timeframe — it
 *     NEVER falls back to synthetic bars.
 *   - No prediction, score, signal, entry or marker is drawn on these candles.
 *     No trained model exists to produce one. The chart shows the SHAPE and
 *     SIZE of the input window, nothing else.
 *   - Data does not flow from this chart into the network below it. The only
 *     link is the bar COUNT, taken from the `window_size` hyperparameter.
 *
 * Deliberately NOT built on market/TradingChart: that component needs replay
 * state, indicator overlays, trade/prediction markers and UnifiedDashboardContext,
 * none of which exist on this page. It does reuse `forexPipInfo` and
 * `dedupByTime` from market/chartConfig rather than restating them.
 *
 * lightweight-charts cannot read `hsl(var(--token))`, so tokens are resolved
 * through getComputedStyle on mount and re-resolved when the theme flips —
 * the same approach NeuralCanvas uses. No colour is hardcoded.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { chartApi } from "@/infrastructure/api/api_service";
import { QUERY_KEYS } from "@/shared/utils/types";
import { forexPipInfo, dedupByTime } from "@/market/components/chartConfig";
import { minutesToApiKey, minutesToLabel } from "@/market/lib/timeframes";
import { cn } from "@/shared/utils/utils";
import type { OHLCVBar } from "@shared/ohlcv";

// ── Symbols ────────────────────────────────────────────────────────────────

interface SymbolRow {
  symbol: string;
  asset_class: string;
}

function isSymbolRow(v: unknown): v is SymbolRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.symbol === "string" && typeof r.asset_class === "string";
}

/**
 * The forex pairs actually present in the dataset, from `/api/charts/symbols`.
 * Filtered to FOREX: the futures side of the same endpoint is ~886 per-contract
 * and continuous-spread symbols, which is not a picker.
 */
export function useForexSymbols() {
  return useQuery<string[]>({
    queryKey: [...QUERY_KEYS.chartSymbols, "forex"],
    queryFn: async () => {
      const rows = await chartApi.getSymbols();
      return rows
        .filter(isSymbolRow)
        .filter((r) => r.asset_class === "FOREX")
        .map((r) => r.symbol)
        .sort();
    },
    staleTime: 30 * 60 * 1000,
  });
}

// ── Bars ───────────────────────────────────────────────────────────────────

function isOhlcvBar(v: unknown): v is OHLCVBar {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.timestamp === "number" &&
    typeof r.open === "number" &&
    typeof r.high === "number" &&
    typeof r.low === "number" &&
    typeof r.close === "number"
  );
}

/**
 * The last `limit` real bars for (symbol, timeframe). Asks the API for ascending
 * order and sorts ascending again defensively — lightweight-charts rejects
 * out-of-order time values outright.
 */
export function useInputWindowBars(
  symbol: string,
  timeframeMinutes: number,
  limit: number,
) {
  const apiTimeframe = useMemo(
    () => minutesToApiKey(timeframeMinutes),
    [timeframeMinutes],
  );

  return useQuery<OHLCVBar[]>({
    queryKey: [
      ...QUERY_KEYS.chartOhlcv(symbol, apiTimeframe),
      "arch-input-window",
      limit,
    ],
    queryFn: async ({ signal }) => {
      const raw = await chartApi.getOhlcv(
        {
          symbol,
          timeframe: apiTimeframe,
          limit: String(limit),
          order: "asc",
        },
        signal,
      );
      if (!Array.isArray(raw)) {
        throw new Error("OHLCV endpoint did not return an array of bars");
      }
      const bars = raw.filter(isOhlcvBar);
      // Verified against the live endpoint: `limit` selects the MOST RECENT N
      // bars and `order` only sets the sort direction, so `order=asc` already
      // returns the newest N ascending — which is the window a model consumes.
      // Re-sorting is a defensive guard (lightweight-charts rejects
      // out-of-order times outright); the tail slice guards a future API that
      // over-returns.
      bars.sort((a, b) => a.timestamp - b.timestamp);
      return bars.slice(-limit);
    },
    staleTime: 10 * 60 * 1000,
  });
}

// ── Palette ────────────────────────────────────────────────────────────────

interface CandlePalette {
  up: string;
  down: string;
  text: string;
  grid: string;
  border: string;
}

/** Resolve `--token` (an unitless HSL triplet like "152 60% 45%") to a css color. */
function resolveToken(root: HTMLElement, token: string, alpha = 1): string {
  const raw = getComputedStyle(root).getPropertyValue(token).trim();
  if (!raw) return alpha < 1 ? `hsl(0 0% 50% / ${alpha})` : "hsl(0 0% 50%)";
  return alpha < 1 ? `hsl(${raw} / ${alpha})` : `hsl(${raw})`;
}

function readPalette(root: HTMLElement): CandlePalette {
  return {
    up: resolveToken(root, "--data-pos"),
    down: resolveToken(root, "--data-neg"),
    text: resolveToken(root, "--muted-foreground"),
    grid: resolveToken(root, "--border", 0.35),
    border: resolveToken(root, "--border"),
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export interface InputWindowChartProps {
  symbol: string;
  /** Timeframe in minutes, matching market/lib/timeframes. */
  timeframeMinutes: number;
  /** Bars to show — the model's `window_size` when `linked`, else a fixed count. */
  limit: number;
  /**
   * True when `limit` is the architecture's real `window_size` hyperparameter.
   * False when the architecture exposes no such HP — the caption then says the
   * chart is NOT linked rather than implying a link that does not exist.
   */
  linked: boolean;
  className?: string;
  /**
   * Fires with the number of bars ACTUALLY returned (null while loading/on
   * error) — not the requested `limit`. The alignment check must compare the
   * model's window against real data, so a short feed surfaces as a mismatch
   * instead of being masked by the request.
   */
  onBarCount?: (count: number | null) => void;
  /**
   * Fires with each visible bar as { x, close }: the REAL pixel x from the
   * chart's own time scale (so the network's input tape sits beneath its candle)
   * and the bar's REAL close price (so real values, not invented ones, enter the
   * network). Bars scrolled out of view are omitted rather than guessed at.
   */
  onBarNodes?: (nodes: { x: number; close: number }[]) => void;
}

export function InputWindowChart({
  symbol,
  timeframeMinutes,
  limit,
  linked,
  className,
  onBarCount,
  onBarNodes,
}: InputWindowChartProps) {
  const query = useInputWindowBars(symbol, timeframeMinutes, limit);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const decimals = forexPipInfo[symbol.toUpperCase()]?.decimals ?? 5;
  const minMove = forexPipInfo[symbol.toUpperCase()]?.pipValue ?? 0.0001;
  const tfLabel = minutesToLabel(timeframeMinutes);

  // Memoised: `query.data ?? []` would mint a new array identity on every
  // render while the query is in flight, re-firing the setData effect on each
  // of the transport bar's animation re-renders.
  const queryData = query.data;
  const bars = useMemo(() => queryData ?? [], [queryData]);
  const hasBars = bars.length > 0;

  // Report the REAL bar count upward (null while loading / on error) so the
  // alignment check compares the model's window against what actually arrived,
  // never against what was merely requested.
  const settled = query.isSuccess;
  const onBarCountRef = useRef(onBarCount);
  onBarCountRef.current = onBarCount;
  useEffect(() => {
    onBarCountRef.current?.(settled ? bars.length : null);
  }, [settled, bars.length]);

  const onBarNodesRef = useRef(onBarNodes);
  onBarNodesRef.current = onBarNodes;
  /** Lets the create-once chart effect re-emit without depending on `bars`. */
  const emitBarXsRef = useRef<(() => void) | null>(null);

  /** Publish each visible bar as { x (page-space pixel), close (real price) }. */
  const emitBarXs = useCallback(() => {
    const cb = onBarNodesRef.current;
    if (!cb) return;
    const chart = chartRef.current;
    if (!chart || bars.length === 0) {
      cb([]);
      return;
    }
    const ts = chart.timeScale();
    // timeToCoordinate is CHART-LOCAL, but the consumer is a different element
    // with its own margins — this component is inset by m-2. Emit in PAGE space
    // so the consumer can subtract its own left edge and land exactly under the
    // candle, instead of being silently offset by whatever insets differ.
    const originX = containerRef.current?.getBoundingClientRect().left ?? 0;
    const nodes: { x: number; close: number }[] = [];
    for (const b of bars) {
      const x = ts.timeToCoordinate(
        Math.floor(b.timestamp / 1000) as UTCTimestamp,
      );
      // Bars scrolled outside the visible range return null — drop them rather
      // than guessing a position for something the chart is not drawing.
      if (x != null) nodes.push({ x: (x as number) + originX, close: b.close });
    }
    cb(nodes);
  }, [bars]);
  emitBarXsRef.current = emitBarXs;

  // ── Create chart once; tear it down on unmount ──────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applyPalette = (chart: IChartApi, series: ISeriesApi<"Candlestick">) => {
      const p = readPalette(document.documentElement);
      chart.applyOptions({
        layout: { textColor: p.text },
        grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
        rightPriceScale: { borderColor: p.border },
        timeScale: { borderColor: p.border },
      });
      series.applyOptions({
        upColor: p.up,
        downColor: p.down,
        borderUpColor: p.up,
        borderDownColor: p.down,
        wickUpColor: p.up,
        wickDownColor: p.down,
      });
    };

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision: decimals, minMove },
    });
    seriesRef.current = series;
    applyPalette(chart, series);

    // Theme flip → re-resolve tokens (canvas cannot track css vars itself).
    const themeObserver = new MutationObserver(() => applyPalette(chart, series));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      // Width change moves every bar's pixel — the tape below must follow.
      emitBarXsRef.current?.();
    });
    resizeObserver.observe(el);

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [decimals, minMove]);

  // ── Push real bars into the series ──────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const candles: CandlestickData<UTCTimestamp>[] = bars.map((b) => ({
      time: Math.floor(b.timestamp / 1000) as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    series.setData(dedupByTime(candles));
    chartRef.current?.timeScale().fitContent();
    emitBarXs();
  }, [bars, emitBarXs]);

  // ── Publish each bar's REAL pixel x, so the network's input tape can sit
  //    directly under its candle.
  //
  //    Read from the chart's own timeScale rather than spacing nodes evenly:
  //    lightweight-charts owns its right price-scale margin and bar spacing, so
  //    an even spread would look aligned while being consistently off. Re-emits
  //    on resize and on any visible-range change, since both move the pixels.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const handler = () => emitBarXs();
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try {
        ts.unsubscribeVisibleLogicalRangeChange(handler);
      } catch {
        // Chart already disposed by its own cleanup — nothing to detach.
      }
    };
  }, [emitBarXs]);

  const errorMessage =
    query.error instanceof Error ? query.error.message : "unknown error";

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col rounded-md border border-white/10 bg-white/[0.02]",
        className,
      )}
      data-testid="arch-input-window-chart"
    >
      {/* Direction legend. lightweight-charts encodes candle direction by fill
          colour alone, so the meaning of each fill is spelled out in text here
          rather than left to colour perception. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-1 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-[1px]"
            style={{ background: "hsl(var(--data-pos))" }}
          />
          up bar — close ≥ open
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-[1px]"
            style={{ background: "hsl(var(--data-neg))" }}
          />
          down bar — close &lt; open
        </span>
      </div>

      {/* Sized to leave the neuron canvas its floor: this page's vertical budget
          is fixed (PageShell fillHeight), and at 188px the chart starved the
          network to ~160px. The canvas carries a min-height and the view scrolls
          rather than crushing either pane. */}
      <div className="relative h-[132px] w-full">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Explicit non-data states — never a synthetic fallback. */}
        {query.isLoading && (
          <Overlay>{`Loading ${symbol} ${tfLabel} bars…`}</Overlay>
        )}
        {query.error != null && (
          <Overlay>
            {`No bars drawn — ${symbol} ${tfLabel} request failed: ${errorMessage}`}
          </Overlay>
        )}
        {!query.isLoading && query.error == null && !hasBars && (
          <Overlay>
            {`No ${symbol} ${tfLabel} bars exist in this dataset — nothing to draw.`}
          </Overlay>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[10px] leading-tight text-muted-foreground">
        {hasBars ? (
          <>
            Real {symbol} {tfLabel} bars —{" "}
            {linked
              ? `the ${bars.length}-bar input window this architecture consumes (window_size).`
              : `the last ${bars.length} bars. This architecture exposes no window_size hyperparameter, so the count is a fixed default and is NOT linked to the model.`}{" "}
            No model is running on this data: nothing here is predicted, scored or
            traded, and no data flows from this chart into the network below.
          </>
        ) : (
          <>
            Candles come only from real bars returned by /api/charts/ohlcv. When
            none are returned, nothing is drawn — no substitute or simulated
            series is ever shown.
          </>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/60 px-6 text-center text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}
