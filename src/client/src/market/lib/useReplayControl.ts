/**
 * useReplayControl — starts the server-side bar stream backing LiveQuoteStrip
 * and the chart's forming-bar animation.
 *
 * The stream is built (questdbLiveSource / questdbReplaySource behind
 * POST /api/market/replay/start) but nothing in the client ever called it, so
 * every chart sat on a permanently-empty quote strip. Mode is chosen from
 * GET /status's liveFeed.writing rather than defaulting to 'live' outright —
 * QuestDBLiveSource polls and emits only when new rows appear, so starting
 * 'live' against a feed nothing is writing to would connect successfully and
 * then sit silent forever, which is worse than the honest 'replay' fallback.
 */

import { useCallback, useState } from "react";

interface ReplayStatus {
  running: boolean;
  liveFeed?: { writing?: boolean };
}

export function useReplayControl() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (symbol: string, timeframe: string) => {
    setStarting(true);
    setError(null);
    try {
      const statusRes = await fetch("/api/market/replay/status");
      const status: ReplayStatus = statusRes.ok ? await statusRes.json() : { running: false };

      if (status.running) return; // another tab/session already started it

      const mode = status.liveFeed?.writing ? "live" : "replay";
      const res = await fetch("/api/market/replay/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `Failed to start feed (HTTP ${res.status})`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }, []);

  return { starting, error, start };
}
