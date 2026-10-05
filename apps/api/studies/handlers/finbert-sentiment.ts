/**
 * FinBERT news sentiment: what every model reads. Replaced
 * notebooks/finbert_sentiment.py.
 *
 * Reads the curated news contracts (`s3://curated/news_articles`, `news_sentiment`,
 * `news_coverage`) inline the way analytics/sources.ts does, plus today's
 * spool (`data/live/spool/curated/<dataset>/day=*.parquet`, the hub's rows not
 * yet written to the lake; `LAKE_NEWS_SPOOL` adds more directories, as in
 * `lake.sentiment`). Two reference tables only Python knew are landed by
 * packages/ml-engine/src/studies/finbert_sentiment/build.py: `derived_study_finbert_sentiment_roots`
 * (the instrument-root dropdown) and `..._query_roots` (which GDELT query
 * reaches which root, so a coverage span counts only for roots it searched).
 *
 * The server does the routing collapse (syndication, weights, GDELT +15 min)
 * with the ported `collapseRows`; the page computes the nine columns on its
 * own bar grid from the returned stories with the same shared module, so a
 * grid or half-life change needs no round trip.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import {
  COVERAGE_MERGE_GAP_SECONDS, LOOKBACK_BEFORE_FIRST_BAR_DAYS, MODEL, collapseRows, mergeSpans, sourceReaches,
  type FinbertBody, type NewsRoute, type RouteRow,
} from "@shared/studies/finbert-sentiment";

const ROOTS_VIEW = "derived_study_finbert_sentiment_roots";
const QUERY_ROOTS_VIEW = "derived_study_finbert_sentiment_query_roots";
const QUERY_ROOTS_PARQUET = "s3://derived/study_finbert_sentiment/recipe=*/table=query_roots/**/*.parquet";

const DATASETS = ["news_articles", "news_sentiment", "news_coverage"] as const;
type NewsDataset = (typeof DATASETS)[number];

const LAKE_SOURCE: Record<NewsDataset, string> = {
  news_articles: "read_parquet('s3://curated/news_articles/**/*.parquet', hive_partitioning = true, union_by_name = true)",
  news_sentiment: "read_parquet('s3://curated/news_sentiment/**/*.parquet', hive_partitioning = true, union_by_name = true)",
  news_coverage: "read_parquet('s3://curated/news_coverage/**/*.parquet', hive_partitioning = true, union_by_name = true)",
};

const HEADLINE_CAP = 20_000;
const ROUTE_CAP = 1_000;
const STORY_CAP = 20_000;
const DAY_SECONDS = 86_400;
const MAXIMUM_WINDOW_DAYS = 366;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(`${value}T00:00:00Z`)), "not a calendar date");

const QUERY = z.object({
  root: z.string().regex(/^[A-Za-z0-9]{1,12}$/).default("MNQ").transform((value) => value.toUpperCase()),
  start: DATE.optional(),
  end: DATE.optional(),
});

export type FinbertQuery = z.infer<typeof QUERY>;

export interface FinbertOptions {
  /** Directories holding `<dataset>/day=*.parquet` spool files. Default: the hub's spool plus LAKE_NEWS_SPOOL. */
  spoolDirs?: () => string[];
}

function defaultSpoolDirs(): string[] {
  const extra = (process.env.LAKE_NEWS_SPOOL ?? "").split(path.delimiter).filter(Boolean);
  return [path.resolve(process.cwd(), "data", "live", "spool", "curated"), ...extra];
}

function spoolFiles(dirs: readonly string[], dataset: NewsDataset): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const folder = path.join(dir, dataset);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith("day=") && name.endsWith(".parquet")) files.push(path.join(folder, name).replace(/\\/g, "/"));
    }
  }
  return files;
}

interface Source {
  expression: string;
  spool: boolean;
}

function sourcesOf(dirs: readonly string[], dataset: NewsDataset): Source[] {
  const sources: Source[] = [{ expression: LAKE_SOURCE[dataset], spool: false }];
  const files = spoolFiles(dirs, dataset);
  if (files.length > 0) sources.push({ expression: `read_parquet([${files.map(text).join(", ")}], union_by_name = true)`, spool: true });
  return sources;
}

/** A dataset that holds no files yet is "no news yet"; anything else is an error. */
async function tolerant<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/No files found|does not exist|Table with name/i.test(message)) return [];
    throw error;
  }
}

function epochSeconds(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 1000;
}

function isoDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

interface RouteQueryRow {
  article_id: string;
  vendor: string | null;
  tier: string | null;
  relevance: number | null;
  direction: number | null;
  title: string | null;
  seen_epoch: number;
  score: number;
}

async function loadRoutes(context: StudyContext, dirs: readonly string[], root: string, lo: number, hi: number): Promise<RouteRow[]> {
  const articleSources = sourcesOf(dirs, "news_articles");
  // `direction` joined the contract on 2026-09-28: files before it carry none, and
  // DuckDB will not invent a column no file has, so it reads as NULL (= +1).
  const parts: string[] = [];
  for (const source of articleSources) {
    let columns: string[];
    if (source.spool) {
      columns = ["direction"];
    } else {
      const described = await tolerant(() => context.lake.query<{ column_name: string }>(`DESCRIBE SELECT * FROM ${source.expression}`));
      if (described.length === 0) continue;
      columns = described.map((row) => String(row.column_name));
    }
    const direction = columns.includes("direction") ? "direction" : "CAST(NULL AS TINYINT)";
    parts.push(
      `SELECT article_id, vendor, tier, relevance, ${direction} AS direction, title, epoch(seen_ts) AS seen_epoch FROM ${source.expression} ` +
        `WHERE root = ${text(root)} AND seen_ts >= to_timestamp(${num(lo)}) AND seen_ts < to_timestamp(${num(hi)})`,
    );
  }
  if (parts.length === 0) return [];
  const scoreParts = sourcesOf(dirs, "news_sentiment").map(
    (source, rank) =>
      `SELECT article_id, score, ${rank} AS source_rank FROM ${source.expression} ` +
      `WHERE model = ${text(MODEL)} AND score IS NOT NULL AND article_id IN (SELECT article_id FROM routes)`,
  );
  // Scores are looked up across every source for just the articles found: a
  // backfilled article in the lake may have been scored today, its score still in the spool.
  const sql =
    `WITH routes AS (${parts.join(" UNION ALL BY NAME ")}), ` +
    `scores AS (SELECT article_id, arg_min(score, source_rank) AS score FROM (${scoreParts.join(" UNION ALL ")}) GROUP BY article_id) ` +
    `SELECT r.article_id, r.vendor, r.tier, r.relevance, r.direction, r.title, r.seen_epoch, s.score ` +
    `FROM routes r JOIN scores s USING (article_id) WHERE r.relevance IS NOT NULL ORDER BY r.seen_epoch, r.article_id`;
  const rows = await tolerant(() => context.lake.query<RouteQueryRow>(sql, 90_000));
  return rows.map((row) => ({
    articleId: String(row.article_id),
    vendor: row.vendor === null ? null : String(row.vendor),
    tier: row.tier === null ? null : String(row.tier),
    relevance: Number(row.relevance),
    direction: row.direction === null ? null : Number(row.direction),
    title: row.title === null ? null : String(row.title),
    seenEpoch: Number(row.seen_epoch),
    score: Number(row.score),
  }));
}

/** The GDELT query tags whose search reaches `root`; null when the reference table cannot be read at all. */
async function loadQueryTags(context: StudyContext, root: string): Promise<Set<string> | null> {
  const served = await context.lake.hasView(QUERY_ROOTS_VIEW);
  const source = served ? ident(QUERY_ROOTS_VIEW) : `read_parquet(${text(QUERY_ROOTS_PARQUET)}, hive_partitioning = true)`;
  try {
    const rows = await context.lake.query<{ query_tag: string }>(`SELECT DISTINCT query_tag FROM ${source} WHERE instrument_root = ${text(root)}`);
    return new Set(rows.map((row) => String(row.query_tag)));
  } catch {
    return null;
  }
}

async function loadCoverage(context: StudyContext, dirs: readonly string[], root: string, lo: number, hi: number): Promise<Array<[number, number]>> {
  const tags = await loadQueryTags(context, root);
  if (tags === null) {
    context.notes.push(
      "The GDELT query reference (derived_study_finbert_sentiment_query_roots) could not be read, so GDELT coverage spans are left out and the coverage flag counts only the feeds.",
    );
  }
  const queryRoots = new Map<string, Set<string>>();
  for (const tag of tags ?? []) queryRoots.set(tag, new Set([root]));
  const parts = sourcesOf(dirs, "news_coverage").map(
    (source) =>
      `SELECT vendor, source, epoch(start_ts) AS start_epoch, epoch(end_ts) AS end_epoch FROM ${source.expression} ` +
      `WHERE end_ts >= to_timestamp(${num(lo)}) AND start_ts < to_timestamp(${num(hi)})`,
  );
  const rows = await tolerant(() =>
    context.lake.query<{ vendor: string; source: string; start_epoch: number | null; end_epoch: number | null }>(parts.join(" UNION ALL BY NAME ")),
  );
  const spans: Array<[number, number]> = [];
  for (const row of rows) {
    if (row.start_epoch === null || row.end_epoch === null) continue;
    if (sourceReaches(String(row.vendor), String(row.source), root, queryRoots)) spans.push([Number(row.start_epoch), Number(row.end_epoch)]);
  }
  return mergeSpans(spans, COVERAGE_MERGE_GAP_SECONDS);
}

async function loadRoots(context: StudyContext, dirs: readonly string[]): Promise<string[]> {
  if (await context.lake.hasView(ROOTS_VIEW)) {
    const rows = await context.lake.query<{ instrument_root: string }>(`SELECT instrument_root FROM ${ident(ROOTS_VIEW)}`);
    if (rows.length > 0) return rows.map((row) => String(row.instrument_root));
  }
  context.notes.push(`Not in the lake yet: ${ROOTS_VIEW}. The root list below is read from the articles instead. Land it with packages/ml-engine/src/studies/finbert_sentiment/build.py, then refresh the derived views.`);
  const distinct: Set<string> = new Set();
  for (const source of sourcesOf(dirs, "news_articles")) {
    const rows = await tolerant(() => context.lake.query<{ root: string }>(`SELECT DISTINCT root FROM ${source.expression} WHERE root IS NOT NULL AND root <> 'UNROUTED'`));
    for (const row of rows) distinct.add(String(row.root));
  }
  return [...distinct].sort();
}

function toRoute(row: RouteRow): NewsRoute {
  return {
    articleId: row.articleId,
    vendor: row.vendor ?? "",
    tier: row.tier ?? "",
    relevance: row.relevance,
    direction: Number(row.direction ?? 0) || 1,
    title: row.title ?? "",
    seenMs: Math.round(row.seenEpoch * 1000),
    score: row.score,
  };
}

export function createHandler(options: FinbertOptions = {}): StudyHandler<typeof QUERY, FinbertBody> {
  const spoolDirs = options.spoolDirs ?? defaultSpoolDirs;
  return {
    slug: "finbert-sentiment",
    datasets: [ROOTS_VIEW, QUERY_ROOTS_VIEW],
    query: QUERY,
    cacheSeconds: 120,
    async run(query, context) {
      const dirs = spoolDirs();
      const todayStart = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
      const endDay = query.end ? epochSeconds(query.end) : todayStart;
      let startDay = query.start ? epochSeconds(query.start) : endDay - 3 * DAY_SECONDS;
      if (startDay > endDay) {
        context.notes.push("The window's start was after its end, so it starts on its end day.");
        startDay = endDay;
      }
      if (endDay - startDay > (MAXIMUM_WINDOW_DAYS - 1) * DAY_SECONDS) {
        startDay = endDay - (MAXIMUM_WINDOW_DAYS - 1) * DAY_SECONDS;
        context.notes.push(`The window is capped at ${MAXIMUM_WINDOW_DAYS} days: it now starts ${isoDate(startDay)}.`);
      }
      const windowStart = startDay;
      const windowEnd = endDay + DAY_SECONDS;
      // lake.sentiment.load_stream reads [start - 45 days, end + 1 minute).
      const lo = windowStart - LOOKBACK_BEFORE_FIRST_BAR_DAYS * DAY_SECONDS;
      const hi = windowEnd + 60;

      const roots = await loadRoots(context, dirs);
      const [rows, coverage] = await Promise.all([loadRoutes(context, dirs, query.root, lo, hi), loadCoverage(context, dirs, query.root, lo, hi)]);

      let stories = collapseRows(rows);
      if (stories.length > STORY_CAP) {
        stories = stories.slice(stories.length - STORY_CAP);
        context.notes.push(`Only the newest ${STORY_CAP.toLocaleString("en-US")} headlines feed the decayed sums (the window is very large).`);
      }

      const inWindow = rows.filter((row) => row.seenEpoch >= windowStart && row.seenEpoch < windowEnd).map(toRoute);
      const seen = new Set<string>();
      const distinct: NewsRoute[] = [];
      for (const route of inWindow) {
        if (seen.has(route.articleId)) continue;
        seen.add(route.articleId);
        distinct.push(route);
      }
      const routesNewestFirst = [...inWindow].reverse();
      if (rows.length === 0) context.notes.push(`No scored headlines routed to ${query.root} in the lake or today's spool for this window.`);

      return {
        root: query.root,
        roots,
        windowStartMs: windowStart * 1000,
        windowEndMs: windowEnd * 1000,
        lookbackDays: LOOKBACK_BEFORE_FIRST_BAR_DAYS,
        distinctHeadlineCount: distinct.length,
        routeCount: inWindow.length,
        headlines: distinct.slice(0, HEADLINE_CAP),
        routes: routesNewestFirst.slice(0, ROUTE_CAP),
        stories,
        coverage,
        truncated: { headlines: distinct.length > HEADLINE_CAP, routes: routesNewestFirst.length > ROUTE_CAP },
      };
    },
  };
}

const handler = createHandler();

export default handler;
