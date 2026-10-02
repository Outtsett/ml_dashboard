/**
 * Data hooks behind the analytics panel.
 *
 *   useLensRecordBars   every bar of the record, GET /api/lens/models/:id/bars paged 5,000 rows at a
 *                       time (the endpoint's cap), so the row-level analytics (threshold search,
 *                       deciles, the latest prediction) see the whole record and not one window.
 *   useLensChartLink    PUT /api/chart/overlays and DELETE /api/chart/overlays/:source — the Market
 *                       chart link (apps/api/market/chartLink.router.ts), then GET /api/chart/context
 *                       to say whether the chart currently shows the model's symbol and timeframe.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { LensChartOverlaySet } from "@shared/lens/analytics";
import { LENS_MAX_WINDOW_BARS, lensParamsToSearch, type LensBar, type LensBarWindow, type LensEvaluationParams } from "@shared/lens/types";

/** Largest record the analytics load in full (12 pages). */
export const LENS_RECORD_MAXIMUM_BARS = 60_000;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export interface LensRecordBars {
  bars: LensBar[] | null;
  /** Why `bars` is null, in plain words. */
  reason: string | null;
}

export function useLensRecordBars(modelId: string, params: LensEvaluationParams, barCount: number): LensRecordBars {
  const tooLarge = barCount > LENS_RECORD_MAXIMUM_BARS;
  const query = useQuery({
    queryKey: ["lens", "record-bars", modelId, params, barCount],
    queryFn: async ({ signal }) => {
      const bars: LensBar[] = [];
      for (let start = 0; start < barCount; start += LENS_MAX_WINDOW_BARS) {
        const end = Math.min(barCount - 1, start + LENS_MAX_WINDOW_BARS - 1);
        const search = lensParamsToSearch(params, { startRowIndex: start, endRowIndex: end, maxBars: LENS_MAX_WINDOW_BARS });
        const response = await fetch(`/api/lens/models/${encodeURIComponent(modelId)}/bars?${search}`, { signal });
        const window = await readJson<LensBarWindow>(response);
        bars.push(...window.bars);
      }
      return bars;
    },
    enabled: barCount > 0 && !tooLarge,
    staleTime: Infinity,
  });
  let reason: string | null = null;
  if (tooLarge) reason = `the record holds ${barCount.toLocaleString("en-US")} bars and the analytics load at most ${LENS_RECORD_MAXIMUM_BARS.toLocaleString("en-US")}`;
  else if (query.error) reason = `the record's bars failed to load: ${query.error.message}`;
  else if (!query.data) reason = "loading every bar of the record…";
  return { bars: query.data ?? null, reason };
}

interface ChartContextReply {
  symbol: string;
  timeframe: string;
}

async function describeChart(set: LensChartOverlaySet): Promise<string> {
  const response = await fetch("/api/chart/context");
  if (response.status === 404) {
    return `Sent to the Market chart as ${set.source}. The chart has not published what it shows yet; the drawing appears when it shows ${set.symbol} ${set.timeframe}.`;
  }
  const context = await readJson<ChartContextReply>(response);
  return context.symbol === set.symbol && context.timeframe === set.timeframe
    ? `Drawn on the Market chart (${set.symbol} ${set.timeframe}) as ${set.source}.`
    : `Sent to the Market chart as ${set.source}. The chart shows ${context.symbol} ${context.timeframe}; the drawing appears when it shows ${set.symbol} ${set.timeframe}.`;
}

export function useLensChartLink() {
  const show = useMutation({
    mutationFn: async (set: LensChartOverlaySet) => {
      await readJson(await fetch("/api/chart/overlays", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(set) }));
      return describeChart(set);
    },
  });
  const clear = useMutation({
    mutationFn: async (source: string) => {
      const reply = await readJson<{ removed: boolean }>(await fetch(`/api/chart/overlays/${encodeURIComponent(source)}`, { method: "DELETE" }));
      return reply.removed ? `Removed ${source} from the Market chart.` : `${source} was not on the Market chart.`;
    },
  });
  return { show, clear };
}
