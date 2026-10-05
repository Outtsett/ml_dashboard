/**
 * Lake columns for the price-vs-variable regression tab.
 *
 * The tab reads its bars (and so its Y axis) from /api/charts/ohlcv, exactly as
 * the Market chart does. These two routes supply the lake half: which columns
 * can stand on the X axis for the current symbol, and their values on the
 * chart's own buckets for the window the bars cover. The series catalog is the
 * allowlist — a request names catalog ids, never SQL.
 *
 * Routes (mounted under /api/charts):
 *   GET /regression/variables?symbol=&timeframe=
 *   GET /regression/columns?ids=&symbol=&timeframe=&from=&to=   (epoch seconds)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import { queryLake as queryLake } from "../infrastructure/database/lake";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { CATALOG_MISSING_MESSAGE, loadSeriesCatalog, onSeriesCatalogReload } from "./seriesCatalog";
import { MAX_WINDOW_SECONDS, TIMEFRAME_SECONDS } from "./bucketing";
import { eligibleVariables, objectColumnsSql } from "./regressionQuery";
import {
  REGRESSION_MAX_COLUMNS,
  REGRESSION_MAX_ROWS,
  type RegressionColumnsResponse,
  type RegressionObjectBlock,
  type RegressionVariablesResponse,
} from "@shared/regression/types";
import type { SeriesColumn, SeriesObject } from "@shared/series/types";

const router = Router();
const logger = new Logger("RegressionRoutes");

const SYMBOL_PATTERN = /^[A-Za-z0-9_.\-]{1,32}$/;
const timeframeField = z.string().refine((value) => TIMEFRAME_SECONDS.has(value), "unknown timeframe");

const VariablesQuery = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  timeframe: timeframeField,
});

const ColumnsQuery = z.object({
  ids: z.string().min(1).max(8000),
  symbol: z.string().regex(SYMBOL_PATTERN),
  timeframe: timeframeField,
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(1),
});

const blockCache = new LRUCache<string, RegressionObjectBlock>({ max: 200, ttl: 5 * 60_000 });
onSeriesCatalogReload(() => blockCache.clear());

router.get("/regression/variables", queryRateLimiter, async (request: Request, response: Response) => {
  const parsed = VariablesQuery.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" });
    return;
  }
  const { symbol, timeframe } = parsed.data;
  try {
    const { catalog } = await loadSeriesCatalog();
    const eligibility = eligibleVariables(catalog.objects, symbol, TIMEFRAME_SECONDS.get(timeframe) as number);
    const payload: RegressionVariablesResponse = {
      symbol,
      timeframe,
      variables: eligibility.variables,
      excludedCount: eligibility.excludedCount,
      excludedReasons: eligibility.excludedReasons as Record<string, number>,
    };
    response.set("Cache-Control", "private, max-age=60");
    response.json(payload);
  } catch (error) {
    logger.error(`regression variables unavailable: ${(error as Error).message}`);
    response.status(503).json({ error: CATALOG_MISSING_MESSAGE });
  }
});

router.get("/regression/columns", queryRateLimiter, async (request: Request, response: Response) => {
  const parsed = ColumnsQuery.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" });
    return;
  }
  const { ids, symbol, timeframe, from, to } = parsed.data;
  if (to <= from) {
    response.status(400).json({ error: "the window ends before it starts" });
    return;
  }
  if (to - from > MAX_WINDOW_SECONDS) {
    response.status(400).json({ error: "the window is wider than 20 years" });
    return;
  }
  const requested = [...new Set(ids.split(",").map((value) => value.trim()).filter(Boolean))];
  if (requested.length > REGRESSION_MAX_COLUMNS) {
    response.status(400).json({ error: `at most ${REGRESSION_MAX_COLUMNS} columns per request` });
    return;
  }

  let catalogObjects: SeriesObject[];
  let columnIndex: Map<string, { object: SeriesObject; column: SeriesColumn }>;
  try {
    const index = await loadSeriesCatalog();
    catalogObjects = index.catalog.objects;
    columnIndex = index.columns;
  } catch {
    response.status(503).json({ error: CATALOG_MISSING_MESSAGE });
    return;
  }

  const timeframeSeconds = TIMEFRAME_SECONDS.get(timeframe) as number;
  const eligible = new Set(eligibleVariables(catalogObjects, symbol, timeframeSeconds).variables.map((entry) => entry.id));
  const failures: RegressionColumnsResponse["failures"] = [];
  const byObject = new Map<string, { object: SeriesObject; columns: SeriesColumn[] }>();
  for (const id of requested) {
    const entry = columnIndex.get(id);
    if (!entry) {
      failures.push({ id, reason: "not in the series catalog" });
      continue;
    }
    if (!eligible.has(id)) {
      failures.push({ id, reason: `not an X variable for ${symbol} at ${timeframe}` });
      continue;
    }
    const group = byObject.get(entry.object.object) ?? { object: entry.object, columns: [] };
    group.columns.push(entry.column);
    byObject.set(entry.object.object, group);
  }

  const window = { symbol, timeframeSeconds, fromSeconds: from, toSeconds: to, maxRows: REGRESSION_MAX_ROWS };
  const blocks = await Promise.all(
    [...byObject.values()].map(async ({ object, columns }): Promise<RegressionObjectBlock> => {
      const cacheKey = [object.object, columns.map((column) => column.id).join(","), symbol, timeframe, from, to].join("|");
      const cached = blockCache.get(cacheKey);
      if (cached) return cached;
      const sql = objectColumnsSql(object, columns, window);
      if (!sql) {
        return {
          object: object.object,
          bucketSeconds: [],
          columns: columns.map((column) => ({
            id: column.id,
            values: [],
            emptyReason: `${object.object} holds no rows in this window`,
          })),
        };
      }
      try {
        const rows = await queryLake<Record<string, number | bigint | null>>(sql, 20_000);
        rows.reverse(); // newest-first LIMIT, returned oldest-first
        const block: RegressionObjectBlock = {
          object: object.object,
          bucketSeconds: rows.map((row) => Number(row.bucket_seconds)),
          columns: columns.map((column, index) => {
            const values = rows.map((row) => {
              const value = row[`c${index}`];
              if (value === null || value === undefined) return null;
              const numeric = Number(value);
              return Number.isFinite(numeric) ? numeric : null;
            });
            const present = values.some((value) => value !== null);
            return present
              ? { id: column.id, values }
              : { id: column.id, values, emptyReason: `${column.column} is empty for ${symbol} in this window` };
          }),
        };
        blockCache.set(cacheKey, block);
        return block;
      } catch (error) {
        logger.warn(`regression columns for ${object.object} failed: ${(error as Error).message}`);
        return {
          object: object.object,
          bucketSeconds: [],
          columns: columns.map((column) => ({ id: column.id, values: [], emptyReason: (error as Error).message })),
        };
      }
    }),
  );

  const payload: RegressionColumnsResponse = { symbol, timeframe, fromSeconds: from, toSeconds: to, blocks, failures };
  response.json(payload);
});

export default router;
