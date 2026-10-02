/** The Analytics page's one request: every layer for a symbol, timeframe, window and horizon. */

import { useQuery } from "@tanstack/react-query";
import type { AnalyticsResponse } from "@shared/analytics/types";

import { EntityType } from "@/shared/contexts/EntityContext";
export interface AnalyticsRequest {
  symbol: string;
  timeframe: string;
  bars: number;
  horizon: number;
  entityType?: EntityType;
  entityId?: string;
}

async function fetchAnalytics(request: AnalyticsRequest, signal: AbortSignal): Promise<AnalyticsResponse> {
  const query = new URLSearchParams({
    symbol: request.symbol,
    timeframe: request.timeframe,
    bars: String(request.bars),
    horizon: String(request.horizon),
  });
  if (request.entityType && request.entityId) {
    query.append("entity_type", request.entityType);
    query.append("entity_id", request.entityId);
  }
  const response = await fetch(`/api/analytics?${query}`, { signal });
  const body = (await response.json().catch(() => ({}))) as AnalyticsResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `analytics request failed (${response.status})`);
  return body;
}

export function useAnalytics(request: AnalyticsRequest) {
  return useQuery({
    queryKey: ["analytics", request.symbol, request.timeframe, request.bars, request.horizon, request.entityType, request.entityId],
    queryFn: ({ signal }) => fetchAnalytics(request, signal),
    staleTime: 5 * 60_000,
    enabled: Boolean(request.symbol),
  });
}
