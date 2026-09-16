/**
 * Column profiles — every column as a picture, not just a row of numbers.
 *
 * One request returns, for each column of a lake object: the eight numbers
 * (mean, median, standard deviation, skewness, kurtosis, 25th and 75th
 * percentiles, minimum, maximum), how much of it is null, a fixed-width
 * histogram of its distribution, and a line through time.
 *
 * Scoped to one symbol on purpose. An unscoped profile of `bars` reads 882
 * million rows — measured at about forty seconds for a single column. Scoped to
 * the most recent rows for one symbol the whole object answers in about a
 * second. The response says exactly which rows were measured, so nothing here
 * can be read as a claim about the whole table.
 *
 *   GET /api/stores/profile/lake/:name?symbol=MNQ&sampleRows=50000
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import { queryQuestDB as queryLake } from "../infrastructure/database/questdb";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { columnsFor, literal, quote } from "./stores.router";
import { loadSeriesCatalog } from "../market/seriesCatalog";

const router = Router();
const logger = new Logger("ProfileRoutes");

const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$/;

const ParamsSchema = z.object({
  store: z.literal("lake"),
  name: z.string().regex(SAFE_NAME),
});

const QuerySchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_.\-]{1,32}$/).optional(),
  sampleRows: z.coerce.number().int().min(1000).max(200_000).default(50_000),
});

const HISTOGRAM_BINS = 24;
const SPARKLINE_BUCKETS = 60;

const profileCache = new LRUCache<string, object>({ max: 32, ttl: 10 * 60_000 });

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

router.get("/stores/profile/:store/:name", queryRateLimiter, async (request: Request, response: Response) => {
  const parameters = ParamsSchema.safeParse(request.params);
  const query = QuerySchema.safeParse(request.query);
  if (!parameters.success) {
    response.status(400).json({
      error: "Column profiles are measured in DuckDB, so only lake objects have them.",
    });
    return;
  }
  if (!query.success) {
    response.status(400).json({ error: query.error.issues[0]?.message ?? "bad request" });
    return;
  }

  const objectName = parameters.data.name;
  const cacheKey = `${objectName}|${query.data.symbol ?? ""}|${query.data.sampleRows}`;
  const cached = profileCache.get(cacheKey);
  if (cached) {
    response.json(cached);
    return;
  }

  try {
    const columns = await columnsFor("lake", objectName);
    if (columns.length === 0) {
      response.status(404).json({ error: `No object named ${objectName} in the lake.` });
      return;
    }

    // The catalog knows which columns read bars that had not happened yet. A
    // profile that showed a forward return looking like any other column would
    // invite someone to treat it as a feature.
    const forwardLooking = new Set<string>();
    try {
      const { objects } = await loadSeriesCatalog();
      for (const column of objects.get(objectName)?.columns ?? []) {
        if (column.forwardLooking) forwardLooking.add(column.column);
      }
    } catch {
      // No catalog yet — the profile still stands, it just cannot label these.
    }

    const columnNames = columns.map((column) => column.name);
    const timestampColumn = columnNames.includes("timestamp")
      ? "timestamp"
      : columnNames.includes("ts")
        ? "ts"
        : null;
    const symbolColumn = columnNames.includes("symbol")
      ? "symbol"
      : columnNames.includes("pair")
        ? "pair"
        : null;

    const filters: string[] = [];
    if (symbolColumn && query.data.symbol) {
      filters.push(`${quote(symbolColumn)} = ${literal(query.data.symbol, false)}`);
    }
    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const orderClause = timestampColumn ? ` ORDER BY ${quote(timestampColumn)} DESC` : "";
    const sampleSql =
      `SELECT * FROM ${quote(objectName)}${whereClause}${orderClause} LIMIT ${query.data.sampleRows}`;

    // Each query opens its own DuckDB connection, so a TEMP VIEW would not
    // survive to the next pass — the sample is inlined instead.
    const sample = `(${sampleSql}) AS sample`;

    // ── Pass one: the eight numbers, every column in a single scan ──────────
    const statExpressions: string[] = ["count(*) AS total_rows"];
    for (const column of columns) {
      const key = quote(column.name);
      statExpressions.push(`count(${key}) AS ${quote(`${column.name}__nonnull`)}`);
      statExpressions.push(`approx_count_distinct(${key}) AS ${quote(`${column.name}__distinct`)}`);
      if (!column.numeric) continue;
      statExpressions.push(`min(${key}) AS ${quote(`${column.name}__min`)}`);
      statExpressions.push(`max(${key}) AS ${quote(`${column.name}__max`)}`);
      statExpressions.push(`avg(${key}) AS ${quote(`${column.name}__mean`)}`);
      statExpressions.push(`stddev_samp(${key}) AS ${quote(`${column.name}__std`)}`);
      statExpressions.push(`skewness(${key}) AS ${quote(`${column.name}__skewness`)}`);
      statExpressions.push(`kurtosis(${key}) AS ${quote(`${column.name}__kurtosis`)}`);
      statExpressions.push(`quantile_cont(${key}, 0.25) AS ${quote(`${column.name}__p25`)}`);
      statExpressions.push(`quantile_cont(${key}, 0.5) AS ${quote(`${column.name}__median`)}`);
      statExpressions.push(`quantile_cont(${key}, 0.75) AS ${quote(`${column.name}__p75`)}`);
    }
    const [stats] = await queryLake<Record<string, unknown>>(
      `SELECT ${statExpressions.join(", ")} FROM ${sample}`,
      60_000,
    );
    const totalRows = Number(stats?.total_rows ?? 0);

    // ── Pass two: a fixed-width histogram per numeric column with a spread ──
    const histogramColumns = columns.filter((column) => {
      if (!column.numeric) return false;
      const minimum = numberOrNull(stats?.[`${column.name}__min`]);
      const maximum = numberOrNull(stats?.[`${column.name}__max`]);
      return minimum !== null && maximum !== null && maximum > minimum;
    });
    const histogramCounts = new Map<string, number[]>();
    if (histogramColumns.length) {
      const expressions = histogramColumns.map((column) => {
        const minimum = numberOrNull(stats?.[`${column.name}__min`])!;
        const maximum = numberOrNull(stats?.[`${column.name}__max`])!;
        const key = quote(column.name);
        const buckets = Array.from({ length: HISTOGRAM_BINS }, (_, index) => {
          const low = minimum + ((maximum - minimum) * index) / HISTOGRAM_BINS;
          const high = minimum + ((maximum - minimum) * (index + 1)) / HISTOGRAM_BINS;
          // The last bin closes on the maximum so the largest value is counted.
          const upper = index === HISTOGRAM_BINS - 1 ? `${key} <= ${high}` : `${key} < ${high}`;
          return `count(*) FILTER (WHERE ${key} >= ${low} AND ${upper})`;
        });
        return `[${buckets.join(", ")}] AS ${quote(`${column.name}__histogram`)}`;
      });
      const [row] = await queryLake<Record<string, unknown>>(
        `SELECT ${expressions.join(", ")} FROM ${sample}`,
        60_000,
      );
      for (const column of histogramColumns) {
        const raw = row?.[`${column.name}__histogram`];
        histogramCounts.set(column.name, Array.isArray(raw) ? raw.map(Number) : []);
      }
    }

    // ── Pass three: one line through time, shared axis for every column ─────
    let sparklineTimestampsSeconds: number[] = [];
    const sparklines = new Map<string, Array<number | null>>();
    const numericColumns = columns.filter((column) => column.numeric);
    if (timestampColumn && numericColumns.length) {
      const [bounds] = await queryLake<{ lo: unknown; hi: unknown }>(
        `SELECT epoch(min(${quote(timestampColumn)})) AS lo, ` +
          `epoch(max(${quote(timestampColumn)})) AS hi FROM ${sample}`,
      );
      const low = numberOrNull(bounds?.lo);
      const high = numberOrNull(bounds?.hi);
      if (low !== null && high !== null && high > low) {
        const bucketSeconds = Math.max(1, Math.floor((high - low) / SPARKLINE_BUCKETS));
        const expressions = numericColumns.map(
          (column) => `avg(${quote(column.name)}) AS ${quote(column.name)}`,
        );
        const rows = await queryLake<Record<string, unknown>>(
          `SELECT epoch(time_bucket(INTERVAL '${bucketSeconds} seconds', ${quote(timestampColumn)}))::BIGINT ` +
            `AS bucket_seconds, ${expressions.join(", ")} FROM ${sample} ` +
            `GROUP BY 1 ORDER BY 1 LIMIT ${SPARKLINE_BUCKETS * 2}`,
          60_000,
        );
        sparklineTimestampsSeconds = rows.map((row) => Number(row.bucket_seconds));
        for (const column of numericColumns) {
          sparklines.set(column.name, rows.map((row) => numberOrNull(row[column.name])));
        }
      }
    }

    const profiled = columns.map((column) => {
      const nonNull = Number(stats?.[`${column.name}__nonnull`] ?? 0);
      const minimum = numberOrNull(stats?.[`${column.name}__min`]);
      const maximum = numberOrNull(stats?.[`${column.name}__max`]);
      const counts = histogramCounts.get(column.name) ?? [];
      const histogram =
        minimum !== null && maximum !== null && counts.length === HISTOGRAM_BINS
          ? counts.map((count, index) => ({
              start: minimum + ((maximum - minimum) * index) / HISTOGRAM_BINS,
              end: minimum + ((maximum - minimum) * (index + 1)) / HISTOGRAM_BINS,
              count,
            }))
          : [];

      return {
        name: column.name,
        type: column.type,
        numeric: column.numeric,
        forwardLooking: forwardLooking.has(column.name),
        nonNullCount: nonNull,
        nullFraction: totalRows ? 1 - nonNull / totalRows : null,
        distinctApproximate: Number(stats?.[`${column.name}__distinct`] ?? 0),
        minimum,
        maximum,
        mean: numberOrNull(stats?.[`${column.name}__mean`]),
        median: numberOrNull(stats?.[`${column.name}__median`]),
        standardDeviation: numberOrNull(stats?.[`${column.name}__std`]),
        // Too small a sample for the moment to mean anything reports null
        // rather than being left out of the row.
        skewness: totalRows >= 3 ? numberOrNull(stats?.[`${column.name}__skewness`]) : null,
        kurtosis: totalRows >= 4 ? numberOrNull(stats?.[`${column.name}__kurtosis`]) : null,
        percentile25: numberOrNull(stats?.[`${column.name}__p25`]),
        percentile75: numberOrNull(stats?.[`${column.name}__p75`]),
        histogram,
        sparkline: sparklines.get(column.name) ?? [],
      };
    });

    const payload = {
      store: "lake" as const,
      name: objectName,
      symbol: query.data.symbol ?? null,
      symbolColumn,
      timestampColumn,
      sampleRows: totalRows,
      sampleDescription:
        `the most recent ${query.data.sampleRows.toLocaleString()} rows` +
        (query.data.symbol && symbolColumn ? ` for ${query.data.symbol}` : "") +
        (timestampColumn ? "" : " (no time column, so the table's own row order)"),
      sparklineTimestampsSeconds,
      columns: profiled,
    };
    profileCache.set(cacheKey, payload);
    response.json(payload);
  } catch (error) {
    logger.error(`profile ${objectName} failed: ${(error as Error).message}`);
    response.status(500).json({ error: (error as Error).message });
  }
});

export default router;
