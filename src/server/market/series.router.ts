/**
 * Lake series — every column in the lake, served as something the chart can draw.
 *
 * The catalog (src/config/series_catalog.json, built by
 * scripts/build_series_catalog.py) is the allowlist: a request names catalog
 * ids, and only the object/column pairs that appear there ever reach SQL. No
 * query text comes from the browser.
 *
 * Values are bucketed to the chart's own timeframe rather than decimated, so a
 * one-second column under a five-minute chart is aggregated the way the candle
 * itself is — volume sums, a state takes the last value in the bucket, a flag
 * fires if it fired anywhere inside it. When the object's grain already equals
 * the chart's timeframe each bucket holds exactly one row and the value is
 * exact.
 *
 * Routes (mounted under /api/charts):
 *   GET /series/catalog          -> every object and column, with how to draw it
 *   GET /series?ids=&symbol=&... -> the values for a window
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import { queryQuestDB as queryLake } from "../infrastructure/database/questdb";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import {
  SERIES_MAX_COLUMNS,
  SERIES_MAX_MARKERS,
  SERIES_MAX_POINTS,
  type SeriesCatalog,
  type SeriesColumn,
  type SeriesObject,
  type SeriesPoint,
  type SeriesResponse,
} from "../../shared/series/types";

const router = Router();
const logger = new Logger("SeriesRoutes");

const CATALOG_PATH = path.join(process.cwd(), "src", "config", "series_catalog.json");

/** Seconds per chart timeframe. The chart only ever asks for one of these. */
const TIMEFRAME_SECONDS: Record<string, number> = {
  "1s": 1, "5s": 5, "15s": 15, "30s": 30,
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800,
};

const QuerySchema = z.object({
  ids: z.string().min(1).max(2000),
  symbol: z.string().regex(/^[A-Za-z0-9_.\-]{1,32}$/),
  timeframe: z.string().refine((value) => value in TIMEFRAME_SECONDS, "unknown timeframe"),
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(1),
  maxPoints: z.coerce.number().int().min(10).max(SERIES_MAX_POINTS).default(2000),
});

interface CatalogIndex {
  catalog: SeriesCatalog;
  objects: Map<string, SeriesObject>;
  columns: Map<string, { object: SeriesObject; column: SeriesColumn }>;
}

let catalogPromise: Promise<CatalogIndex> | null = null;

async function loadCatalog(): Promise<CatalogIndex> {
  if (!catalogPromise) {
    catalogPromise = readFile(CATALOG_PATH, "utf8")
      .then((text) => {
        const catalog = JSON.parse(text) as SeriesCatalog;
        const objects = new Map<string, SeriesObject>();
        const columns = new Map<string, { object: SeriesObject; column: SeriesColumn }>();
        for (const object of catalog.objects) {
          objects.set(object.object, object);
          for (const column of object.columns) columns.set(column.id, { object, column });
        }
        logger.log(
          `series catalog: ${catalog.objectCount} objects, ${catalog.columnCount} columns, ` +
            `${catalog.chartableColumnCount} chartable (generated ${catalog.generatedAtIso})`,
        );
        return { catalog, objects, columns };
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * How a bucket collapses several rows into one value.
 *
 * Levels and states take the value at the end of the bucket, exactly as a
 * candle takes its close. Volume adds up. A flag is on if it was on anywhere
 * inside the bucket, because a flag that fired is a fact about the bucket.
 */
function bucketExpression(column: SeriesColumn, timestampColumn: string): string {
  const name = quote(column.column);
  const ts = quote(timestampColumn);
  const numeric = column.duckdbType.toUpperCase() === "BOOLEAN" ? `CAST(${name} AS INTEGER)` : name;

  if (column.family === "volume" && column.valueShape === "positive_magnitude") {
    return `sum(${numeric})`;
  }
  if (column.valueShape === "binary") return `max(${numeric})`;
  return `arg_max(${numeric}, ${ts}) FILTER (WHERE ${name} IS NOT NULL)`;
}

const seriesCache = new LRUCache<string, SeriesResponse["series"][number]>({
  max: 400,
  ttl: 5 * 60_000,
});

interface WindowRequest {
  symbol: string;
  timeframeSeconds: number;
  fromSeconds: number;
  toSeconds: number;
  maxPoints: number;
}

async function fetchOneSeries(
  entry: { object: SeriesObject; column: SeriesColumn },
  window: WindowRequest,
): Promise<SeriesResponse["series"][number]> {
  const { object, column } = entry;
  const base = {
    id: column.id,
    object: object.object,
    column: column.column,
    family: column.family,
    renderMode: column.renderMode,
    referenceLines: column.referenceLines,
    forwardLooking: column.forwardLooking,
  };

  if (column.unavailableReason) {
    return { ...base, downsampled: false, pointCount: 0, points: [], emptyReason: column.unavailableReason };
  }

  const cacheKey = [
    column.id, window.symbol, window.timeframeSeconds, window.fromSeconds, window.toSeconds, window.maxPoints,
  ].join("|");
  const cached = seriesCache.get(cacheKey);
  if (cached) return cached;

  const ts = quote(object.timestampColumn);
  const filters = [
    `${ts} >= to_timestamp(${window.fromSeconds})`,
    `${ts} < to_timestamp(${window.toSeconds})`,
  ];
  if (object.symbolColumn) filters.push(`${quote(object.symbolColumn)} = ${literal(window.symbol)}`);

  const bucketSeconds = window.timeframeSeconds;

  let sql: string;
  if (column.renderMode === "markers" || object.grain === "per_event") {
    // An event keeps its own timestamp — bucketing an event moves it. A flag
    // marks only the bars where it actually fired; a bar where it did not fire
    // is not an event and must not be marked.
    const markerFilters = [...filters, `${quote(column.column)} IS NOT NULL`];
    if (column.valueShape === "binary") {
      markerFilters.push(`CAST(${quote(column.column)} AS DOUBLE) <> 0`);
    }
    // Evenly thinned across the window rather than truncated at the start, so
    // a capped marker column still describes the whole window.
    const markerLimit = Math.min(window.maxPoints, SERIES_MAX_MARKERS);
    sql =
      `WITH fired AS (` +
      `SELECT ${ts} AS event_time, CAST(${quote(column.column)} AS DOUBLE) AS value ` +
      `FROM ${quote(object.object)} WHERE ${markerFilters.join(" AND ")}` +
      `), numbered AS (` +
      `SELECT event_time, value, row_number() OVER (ORDER BY event_time) AS position, ` +
      `count(*) OVER () AS bucket_count FROM fired` +
      `) SELECT epoch(event_time)::BIGINT AS bucket_seconds, value, bucket_count ` +
      `FROM numbered WHERE bucket_count <= ${markerLimit} ` +
      `OR position % CAST(ceil(bucket_count::DOUBLE / ${markerLimit}) AS BIGINT) = 0 ` +
      `ORDER BY bucket_seconds`;
  } else {
    // Bucket at the chart's own timeframe, then thin by ROW COUNT if there are
    // still too many to draw.
    //
    // Widening the bucket by clock span was wrong here: MNQ's loaded bars cover
    // a hundred calendar days but hold about eleven days of actual minutes, so
    // span-based widening produced half-hour buckets and turned a moving
    // average into a dozen straight segments across the candles. Thinning by
    // the number of buckets that actually exist keeps every value a real
    // measured value, and keeps a gap a gap.
    sql =
      `WITH bucketed AS (` +
      `SELECT time_bucket(INTERVAL '${bucketSeconds} seconds', ${ts}) AS bucket, ` +
      `${bucketExpression(column, object.timestampColumn)} AS value ` +
      `FROM ${quote(object.object)} WHERE ${filters.join(" AND ")} GROUP BY 1` +
      `), numbered AS (` +
      `SELECT bucket, value, row_number() OVER (ORDER BY bucket) AS position, ` +
      `count(*) OVER () AS bucket_count FROM bucketed` +
      `) SELECT epoch(bucket)::BIGINT AS bucket_seconds, CAST(value AS DOUBLE) AS value, ` +
      `bucket_count ` +
      `FROM numbered WHERE bucket_count <= ${window.maxPoints} ` +
      `OR position % CAST(ceil(bucket_count::DOUBLE / ${window.maxPoints}) AS BIGINT) = 0 ` +
      `ORDER BY bucket_seconds`;
  }

  const rows = await queryLake<{
    bucket_seconds: number | bigint;
    value: number | null;
    bucket_count?: number | bigint;
  }>(sql, 20_000);
  // How many buckets existed before thinning — so "bucketed" is a fact, not a guess.
  const bucketCount = Number(rows[0]?.bucket_count ?? rows.length);
  const points: SeriesPoint[] = rows.map((row) => ({
    timestampSeconds: Number(row.bucket_seconds),
    // An unknown stays null. It is never rendered as zero.
    value: row.value === null || row.value === undefined || !Number.isFinite(Number(row.value))
      ? null
      : Number(row.value),
  }));

  const result: SeriesResponse["series"][number] = {
    ...base,
    downsampled: bucketCount > points.length,
    pointCount: points.length,
    points,
    ...(points.length === 0
      ? {
          emptyReason:
            object.symbolColumn && !object.symbols.includes(window.symbol)
              ? `${object.object} carries no rows for ${window.symbol}.`
              : `No rows in this window. ${object.object} covers ${coverageSentence(object)}.`,
        }
      : {}),
  };

  seriesCache.set(cacheKey, result);
  return result;
}

function coverageSentence(object: SeriesObject): string {
  const format = (seconds: number | null) =>
    seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "an unknown date";
  return `${format(object.firstTimestampSeconds)} to ${format(object.lastTimestampSeconds)}`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/series/catalog", async (_request: Request, response: Response) => {
  try {
    const { catalog } = await loadCatalog();
    response.set("Cache-Control", "public, max-age=300");
    response.json(catalog);
  } catch (error) {
    logger.error(`series catalog unavailable: ${(error as Error).message}`);
    response.status(503).json({
      error:
        "The series catalog has not been built. Run: uv run python scripts/build_series_catalog.py",
    });
  }
});

router.get("/series", queryRateLimiter, async (request: Request, response: Response) => {
  const parsed = QuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" });
    return;
  }
  const { ids, symbol, timeframe, from, to, maxPoints } = parsed.data;
  if (to <= from) {
    response.status(400).json({ error: "the window ends before it starts" });
    return;
  }

  let index: CatalogIndex;
  try {
    index = await loadCatalog();
  } catch {
    response.status(503).json({
      error: "The series catalog has not been built. Run: uv run python scripts/build_series_catalog.py",
    });
    return;
  }

  const requested = ids.split(",").map((value) => value.trim()).filter(Boolean);
  if (requested.length > SERIES_MAX_COLUMNS) {
    response.status(400).json({ error: `at most ${SERIES_MAX_COLUMNS} series per request` });
    return;
  }

  const entries = requested.map((id) => index.columns.get(id)).filter(Boolean) as Array<{
    object: SeriesObject;
    column: SeriesColumn;
  }>;
  const unknown = requested.filter((id) => !index.columns.has(id));
  if (unknown.length) {
    response.status(404).json({ error: `unknown series: ${unknown.join(", ")}` });
    return;
  }

  const window: WindowRequest = {
    symbol,
    timeframeSeconds: TIMEFRAME_SECONDS[timeframe] ?? 60,
    fromSeconds: from,
    toSeconds: to,
    maxPoints,
  };

  try {
    const series = await Promise.all(
      entries.map(async (entry) => {
        try {
          return await fetchOneSeries(entry, window);
        } catch (error) {
          logger.warn(`series ${entry.column.id} failed: ${(error as Error).message}`);
          return {
            id: entry.column.id,
            object: entry.object.object,
            column: entry.column.column,
            family: entry.column.family,
            renderMode: entry.column.renderMode,
            referenceLines: entry.column.referenceLines,
            forwardLooking: entry.column.forwardLooking,
            downsampled: false,
            pointCount: 0,
            points: [],
            emptyReason: (error as Error).message,
          };
        }
      }),
    );
    const payload: SeriesResponse = { symbol, timeframe, series };
    response.json(payload);
  } catch (error) {
    logger.error(`series query failed: ${(error as Error).message}`);
    response.status(500).json({ error: (error as Error).message });
  }
});

export default router;
