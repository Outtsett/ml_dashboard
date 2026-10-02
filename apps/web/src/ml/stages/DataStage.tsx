/**
 * DataStage — Stage 1 of the ML Studio pipeline.
 *
 * P4: two server queries via `GET /api/training/data-preview`:
 *   - boundsQuery: always-on, no date filter — gives the symbol+timeframe's
 *     true coverage (firstTs..lastTs, totalBars). Used to constrain the date
 *     pickers' min/max so the user can't pick out-of-range dates.
 *   - rangeQuery: only fires when the user has set a date range — reports
 *     totals + nulls + coverage WITHIN that window.
 *
 * If `state.dateRange` is null we display boundsQuery (full coverage).
 * If set, we display rangeQuery (windowed counts) but still surface bounds
 * as the date input min/max + "Available" hint.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { useChartOHLCV } from "@/market/lib/useChartOHLCV";
import { fetchArray } from "@/infrastructure/api/fetch_array";
import { useMLStudio, type Timeframe } from "../MLStudioContext";
import { minutesOfStudioTimeframe } from "../StudioSelectionSync";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";

interface DataPreview {
  symbol: string;
  timeframe: string;
  table: string;
  totalBars: number;
  firstTs: string | null;
  lastTs: string | null;
  spanDays: number | null;
  nullCount: number;
  ohlcAnyNullCount: number;
  zeroVolumeCount: number;
  expectedBars: number | null;
  coverageRatio: number | null;
  dateRange: { start: string; end: string } | null;
}

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

const TF_TO_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

interface InstrumentRow {
  id: number;
  symbol: string;
  name: string;
  assetType: string;
}

export function DataStage() {
  const { state, dispatch } = useMLStudio();
  // The pair is the dashboard's, not this page's: the pickers below write it
  // there, and `StudioSelectionSync` carries it into the pipeline.
  const { setSymbol, setTimeframeMinutes } = useSymbolContext();

  const { data: instruments = [] } = useQuery<InstrumentRow[]>({
    queryKey: ["/api/instruments"],
    queryFn: () => fetchArray<InstrumentRow>("/api/instruments"),
  });

  const symbols = useMemo(
    () =>
      instruments
        .filter((i) => i.assetType === "futures" || i.assetType === "forex")
        .map((i) => i.symbol)
        .sort(),
    [instruments],
  );

  // ── Bounds query — always-on, no date filter. Source of truth for the
  // symbol+timeframe's true coverage. Used to constrain the date pickers.
  const { data: bounds, isFetching: boundsFetching, error: boundsError } = useQuery<DataPreview>({
    queryKey: ["/api/training/data-preview", state.symbol, state.timeframe, "__bounds__"],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol: state.symbol, timeframe: state.timeframe });
      const res = await fetch(`/api/training/data-preview?${params.toString()}`);
      if (!res.ok) throw new Error(`data-preview (bounds) failed: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    enabled: state.symbol.length > 0 && state.timeframe.length > 0,
  });

  const minDate = bounds?.firstTs ? bounds.firstTs.slice(0, 10) : undefined;
  const maxDate = bounds?.lastTs ? bounds.lastTs.slice(0, 10) : undefined;
  const hasBounds = bounds != null && bounds.totalBars > 0 && minDate != null && maxDate != null;

  // ── Auto-clear out-of-range date selection when symbol/timeframe changes.
  // Prevents stale ranges (e.g. picked 2025-01..2025-12 for MNQ 1m, then
  // switched to a symbol with 2020..2022 coverage) from confusing the preview.
  useEffect(() => {
    if (!hasBounds || !state.dateRange) return;
    const userStart = state.dateRange.start;
    const userEnd = state.dateRange.end;
    const fullyOutside =
      (userEnd && userEnd < minDate!) || (userStart && userStart > maxDate!);
    if (fullyOutside) {
      dispatch({ type: "setDateRange", dateRange: null });
    }
  }, [hasBounds, minDate, maxDate, state.dateRange, dispatch]);

  // ── Range query — only when the user has actually set a window. Otherwise
  // we fall back to displaying boundsQuery as the "full range" preview.
  const rangeEnabled =
    !!(state.dateRange?.start && state.dateRange?.end) &&
    state.symbol.length > 0 &&
    state.timeframe.length > 0;
  const { data: rangePreview, isFetching: rangeFetching, error: rangeError } = useQuery<DataPreview>({
    queryKey: [
      "/api/training/data-preview",
      state.symbol,
      state.timeframe,
      state.dateRange?.start ?? "",
      state.dateRange?.end ?? "",
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol: state.symbol,
        timeframe: state.timeframe,
        start: state.dateRange!.start,
        end: state.dateRange!.end,
      });
      const res = await fetch(`/api/training/data-preview?${params.toString()}`);
      if (!res.ok) throw new Error(`data-preview (range) failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    enabled: rangeEnabled,
  });

  // The displayed preview is the windowed query when a range is set, else bounds.
  const serverPreview: DataPreview | undefined = rangeEnabled ? rangePreview : bounds;
  const previewFetching = rangeEnabled ? rangeFetching : boundsFetching;
  const previewError = rangeEnabled ? rangeError : boundsError;

  // Client-side fallback for the first paint and as a sanity check.
  const { chartData } = useChartOHLCV(state.symbol, TF_TO_MINUTES[state.timeframe]);
  const clientBars = chartData?.length ?? 0;
  const clientFirstTs = chartData?.[0]?.timestamp != null ? new Date(chartData[0].timestamp).toISOString() : null;
  const clientLastTs = chartData?.[chartData.length - 1]?.timestamp != null ? new Date(chartData[chartData.length - 1]!.timestamp).toISOString() : null;

  const totalBars = serverPreview?.totalBars ?? clientBars;
  const firstTs = serverPreview?.firstTs ?? clientFirstTs;
  const lastTs = serverPreview?.lastTs ?? clientLastTs;
  const nullCount = serverPreview?.nullCount ?? 0;
  const coverageRatio = serverPreview?.coverageRatio ?? null;
  const spanDays = serverPreview?.spanDays ?? null;

  // Publish to MLStudio context so downstream gates open. Only publish once we have
  // authoritative server data (or the chart fallback if lake is unavailable).
  useEffect(() => {
    if (totalBars > 0 && firstTs && lastTs) {
      dispatch({
        type: "setDataPreview",
        preview: { totalBars, firstTs, lastTs, nullCount },
      });
    }
  }, [totalBars, firstTs, lastTs, nullCount, dispatch]);

  // ── Date-range integrity flags (highlight when user picks something off).
  const userStart = state.dateRange?.start ?? null;
  const userEnd = state.dateRange?.end ?? null;
  const startOutOfBounds = hasBounds && userStart != null && (userStart < minDate! || userStart > maxDate!);
  const endOutOfBounds = hasBounds && userEnd != null && (userEnd < minDate! || userEnd > maxDate!);
  const startAfterEnd = userStart != null && userEnd != null && userStart > userEnd;
  const dateRangeIssue = startOutOfBounds || endOutOfBounds || startAfterEnd;

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-display font-bold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" /> Stage 1 — Data
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Pick the instrument, timeframe, and date range that will feed every downstream stage.
            A symbol or timeframe change invalidates the feature and label previews.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Symbol</label>
          <Select
            value={state.symbol}
            onValueChange={setSymbol}
          >
            <SelectTrigger className="h-8 rounded-lg glass border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {symbols.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Timeframe</label>
          <Select
            value={state.timeframe}
            onValueChange={(t) => setTimeframeMinutes(minutesOfStudioTimeframe(t as Timeframe))}
          >
            <SelectTrigger className="h-8 rounded-lg glass border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Date range</label>
            {state.dateRange != null && (
              <button
                type="button"
                onClick={() => dispatch({ type: "setDateRange", dateRange: null })}
                className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
                title="Clear range — use full available coverage"
              >
                <RotateCcw className="h-3 w-3" /> Full range
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              min={minDate}
              max={maxDate}
              value={userStart ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "setDateRange",
                  dateRange: e.target.value
                    ? { start: e.target.value, end: userEnd ?? "" }
                    : null,
                })
              }
              className={`h-10 rounded-xl glass border-white/10 ${startOutOfBounds ? "border-[hsl(var(--data-neg)/0.4)]" : ""}`}
              disabled={!hasBounds}
            />
            <Input
              type="date"
              min={minDate}
              max={maxDate}
              value={userEnd ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "setDateRange",
                  dateRange: e.target.value
                    ? { start: userStart ?? "", end: e.target.value }
                    : null,
                })
              }
              className={`h-10 rounded-xl glass border-white/10 ${endOutOfBounds ? "border-[hsl(var(--data-neg)/0.4)]" : ""}`}
              disabled={!hasBounds}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            {boundsFetching && !bounds ? (
              "Loading available range…"
            ) : hasBounds ? (
              <>
                Available: <span className="font-mono text-foreground/80">{minDate}</span> →{" "}
                <span className="font-mono text-foreground/80">{maxDate}</span>{" "}
                <span className="text-muted-foreground/50">
                  ({bounds!.totalBars.toLocaleString()} bars · {bounds!.spanDays?.toLocaleString() ?? "?"} d)
                </span>
              </>
            ) : (
              <span className="text-amber-400/70">No data for {state.symbol} {state.timeframe} in lake.</span>
            )}
          </p>
          {dateRangeIssue && (
            <p className="text-[10px] text-[hsl(var(--data-neg))]">
              {startAfterEnd
                ? "Start date is after end date."
                : `Selected dates are outside the available range (${minDate} → ${maxDate}).`}
            </p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PreviewStat
          label={rangeEnabled ? "Bars in range" : "Total bars"}
          value={previewFetching && !serverPreview ? "…" : totalBars.toLocaleString()}
          hint={
            serverPreview
              ? rangeEnabled && bounds
                ? `${((totalBars / Math.max(1, bounds.totalBars)) * 100).toFixed(1)}% of full coverage`
                : `via ${serverPreview.table}`
              : "client estimate"
          }
        />
        <PreviewStat
          label="Span"
          value={spanDays != null ? `${spanDays.toLocaleString()} d` : firstTs && lastTs ? `${firstTs.slice(0, 10)} → ${lastTs.slice(0, 10)}` : "—"}
          hint={firstTs && lastTs ? `${firstTs.slice(0, 10)} → ${lastTs.slice(0, 10)}` : undefined}
        />
        <PreviewStat
          label="Null bars"
          value={previewFetching && !serverPreview ? "…" : nullCount.toLocaleString()}
          hint={serverPreview && serverPreview.ohlcAnyNullCount > nullCount ? `${serverPreview.ohlcAnyNullCount} OHLC any-null` : undefined}
          tone={nullCount > 0 ? "warn" : "ok"}
        />
        <PreviewStat
          label="Coverage"
          value={coverageRatio != null ? `${(coverageRatio * 100).toFixed(1)}%` : "—"}
          hint={serverPreview?.expectedBars != null ? `expected ${serverPreview.expectedBars.toLocaleString()}` : undefined}
          tone={coverageRatio != null ? (coverageRatio >= 0.9 ? "ok" : coverageRatio >= 0.7 ? "warn" : "bad") : undefined}
        />
      </section>

      {previewError && (
        <div className="rounded-xl border border-[hsl(var(--data-neg)/0.2)] bg-[hsl(var(--data-neg)/0.05)] px-4 py-3 text-sm text-[hsl(var(--data-neg))]">
          Server preview failed: {(previewError as Error).message}. Falling back to chart cache estimate.
        </div>
      )}

      {serverPreview && serverPreview.zeroVolumeCount > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          {serverPreview.zeroVolumeCount.toLocaleString()} bars have zero volume — usually pre-market / holidays. Consider filtering in the trainer.
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/5 p-4">
        <div>
          <p className="text-xs text-muted-foreground">
            Want the chart? Open the <span className="text-foreground font-medium">Market Data</span> tab — ML Studio does not duplicate it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl border-primary/30 text-primary hover:bg-primary/10"
          onClick={() => {
            window.location.hash = "";
            window.history.pushState(null, "", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        >
          Open chart →
        </Button>
      </div>
    </div>
  );
}

function PreviewStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok" ? "text-[hsl(var(--data-pos))]"
    : tone === "warn" ? "text-amber-300"
    : tone === "bad" ? "text-[hsl(var(--data-neg))]"
    : "text-foreground";
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={`font-mono text-sm ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/60 mt-1 truncate" title={hint}>{hint}</div>}
    </div>
  );
}

