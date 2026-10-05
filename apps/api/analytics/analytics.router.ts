/**
 * The Analytics page: descriptive, diagnostic, predictive and prescriptive
 * layers for one symbol and timeframe, computed from the lake in one request.
 *
 * Routes (mounted under /api):
 *   GET /analytics?symbol=&timeframe=&bars=&horizon=
 *
 * The inputs are loaded by ./sources (bars, FinBERT-scored news, Model Cycle
 * runs, the cost model) and the layers computed by packages/shared/src/analytics.
 * Responses are cached for five minutes per request.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { TIMEFRAME_SECONDS } from "../market/bucketing";
import { analyse, pickRun } from "@shared/analytics/compute";
import type {
  AnalyticsBar,
  AnalyticsCost,
  AnalyticsNewsItem,
  AnalyticsResponse,
  ModelRunDetail,
  ModelRunSummary,
} from "@shared/analytics/types";
import * as lake from "./sources";

const logger = new Logger("AnalyticsRoutes");

/** The timeframes the chart offers; the analytics read the same views. */
const ANALYTICS_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

const Query = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_.\-]{1,32}$/),
  timeframe: z.string().refine((value) => ANALYTICS_TIMEFRAMES.has(value), "unknown timeframe"),
  bars: z.coerce.number().int().min(500).max(100_000).default(20_000),
  horizon: z.coerce.number().int().min(1).max(500).default(12),
  entity_type: z.enum(["model", "study"]).optional(),
  entity_id: z.string().optional(),
});

export interface AnalyticsSources {
  loadBars(symbol: string, timeframe: string, timeframeMinutes: number, limit: number): Promise<AnalyticsBar[]>;
  loadNews(symbol: string, assetClass: "futures" | "forex", fromStamp: number, toStamp: number): Promise<AnalyticsNewsItem[]>;
  loadRuns(symbol: string, timeframe: string): Promise<ModelRunSummary[]>;
  loadRunDetail(run: ModelRunSummary): Promise<ModelRunDetail | null>;
  loadCost(symbol: string): AnalyticsCost | null;
  assetClassOf(symbol: string): "futures" | "forex";
}

export function createAnalyticsRouter(sources: AnalyticsSources = lake, now: () => number = Date.now): Router {
  const router = Router();
  const cache = new LRUCache<string, AnalyticsResponse>({ max: 50, ttl: 5 * 60_000 });

  router.get("/analytics", queryRateLimiter, async (request: Request, response: Response) => {
    // A cold read (futures stitching, every news file) can pass the 30 s app default.
    request.setTimeout(120_000);
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" });
      return;
    }
    const { symbol, timeframe, bars: limit, horizon, entity_type, entity_id } = parsed.data;
    const key = `${symbol}|${timeframe}|${limit}|${horizon}|${entity_type ?? 'all'}|${entity_id ?? 'all'}`;
    const hit = cache.get(key);
    if (hit) {
      response.json(hit);
      return;
    }
    try {
      const minutes = (TIMEFRAME_SECONDS.get(timeframe) as number) / 60;
      const assetClass = sources.assetClassOf(symbol);
      const cost = sources.loadCost(symbol);
      const notes: string[] = [];

      let [bars, runs] = await Promise.all([
        sources.loadBars(symbol, timeframe, minutes, limit),
        sources.loadRuns(symbol, timeframe).catch((error: unknown) => {
          notes.push(`Model Cycle runs could not be read: ${String(error)}`);
          return [] as ModelRunSummary[];
        }),
      ]);
      
      // Strict entity isolation
      if (entity_type === 'model' && entity_id) {
        runs = runs.filter(r => r.modelId === entity_id || r.recipe === entity_id);
      }
      if (bars.length < 200) {
        response.status(404).json({ error: `Only ${bars.length} ${timeframe} bars for ${symbol}: too few to analyse.` });
        return;
      }
      const first = (bars[0] as AnalyticsBar).timestamp;
      const last = (bars[bars.length - 1] as AnalyticsBar).timestamp;

      // The most recent finished run, plus the best run for each goal.
      const finished = runs.filter((run) => run.netProfitUsd !== null);
      const chosen = new Map<string, ModelRunSummary>();
      if (finished[0]) chosen.set(finished[0].recipe, finished[0]);
      for (const goal of ["profit", "win_rate", "risk"] as const) {
        const picked = pickRun(runs, goal);
        if (picked) chosen.set(picked.run.recipe, picked.run);
      }
      const [news, detailList] = await Promise.all([
        sources.loadNews(symbol, assetClass, first, last + minutes * 60_000).catch((error: unknown) => {
          notes.push(`News could not be read: ${String(error)}`);
          return [] as AnalyticsNewsItem[];
        }),
        Promise.all(
          [...chosen.values()].map((run) =>
            sources.loadRunDetail(run).catch((error: unknown) => {
              notes.push(`Run ${run.modelId} could not be read: ${String(error)}`);
              return null;
            }),
          ),
        ),
      ]);
      const details = new Map<string, ModelRunDetail>();
      for (const detail of detailList) if (detail) details.set(detail.run.recipe, detail);
      const latestDetail = finished[0] ? details.get(finished[0].recipe) ?? null : null;

      const ageDays = (now() - last) / 86_400_000;
      if (ageDays > 4) {
        notes.push(
          `The lake's newest ${timeframe} bar for ${symbol} is ${new Date(last).toISOString().slice(0, 16).replace("T", " ")} (${Math.round(ageDays)} days ago): ` +
            "\"now\", the state and the recommendation on this page are as of that bar.",
        );
      }
      if (news.length === 0) notes.push("No FinBERT-scored news for this symbol inside the window.");
      if (runs.length === 0) notes.push(`No Model Cycle run on ${symbol} at ${timeframe} yet: the model sections are empty.`);

      const layers = analyse({ bars, news, runs, details, latestDetail, cost, assetClass, horizon });
      const body: AnalyticsResponse = {
        symbol,
        timeframe,
        assetClass,
        clock: assetClass === "futures" ? "Pacific wall clock (as the lake stamps futures)" : "UTC",
        cost,
        ...layers,
        notes,
      };
      cache.set(key, body);
      response.set("Cache-Control", "private, max-age=60");
      response.json(body);
    } catch (error) {
      logger.error(`analytics ${symbol} ${timeframe}: ${String(error)}`);
      response.status(500).json({ error: (error as Error).message ?? String(error) });
    }
  });

  return router;
}

export default createAnalyticsRouter();
