/**
 * The Analytics page's inputs, read from the lake.
 *
 *   bars   — the chart's own series, the newest `limit` bars before the
 *            symbol's last bar; futures roots front-month stitched and
 *            ratio back-adjusted at each roll, so a roll is not a move.
 *   news   — s3://curated/news_articles joined to FinBERT scores in
 *            s3://curated/news_sentiment, at the time each article was
 *            KNOWN (a GDELT row: its 15-minute bucket + 15 minutes,
 *            docs/finbert.md), re-stamped onto the bars' clock.
 *   runs   — derived_model_cycle_runs_runs for the symbol and timeframe, and for chosen runs
 *            their trade segments, calibration bins, net result by hour and last
 *            prediction.
 *   cost   — src/config/cost_model.json (futures roots only).
 *
 * SQL is built from validated identifiers only (the router's symbol pattern and
 * recipes read back from the runs table and re-checked here).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getFrontMonthAnchor,
  getOHLCVSampleBy,
  getStitchedOHLCV,
  queryQuestDB,
  queryQuestDBFast,
} from "../infrastructure/database/questdb";
import { normalizeTimestamp } from "../infrastructure/lib/normalize";
import { isFuturesRoot } from "../infrastructure/lib/futures";
import type {
  AnalyticsBar,
  AnalyticsCost,
  AnalyticsNewsItem,
  ModelRunDetail,
  ModelRunSummary,
  ModelSegmentRow,
} from "../../shared/analytics/types";

const RECIPE_PATTERN = /^[A-Za-z0-9_.\-]{1,160}$/;
const FINBERT_MODEL = "ProsusAI/finbert";
const view = (table: string) => `derived_model_cycle_runs_${table}`;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function rows<T>(sql: string, timeoutMs = 60_000): Promise<T[]> {
  try {
    return await queryQuestDB<T>(sql, timeoutMs);
  } catch (error) {
    // A view with no manifest line yet (no Model Cycle run landed) reads as no rows.
    const message = String(error);
    if (message.includes("does not exist") || message.includes("not found") || message.includes("No files found")) return [];
    throw error;
  }
}

// ── cost ───────────────────────────────────────────────────────────────────

interface CostEntry {
  tick_size: number;
  point_value: number;
  total_round_trip: number;
  total_round_trip_points: number;
  source?: string;
}

let costModel: Record<string, CostEntry> | null = null;

export function loadCost(symbol: string): AnalyticsCost | null {
  if (costModel === null) {
    try {
      costModel = JSON.parse(readFileSync(path.resolve(process.cwd(), "src/config/cost_model.json"), "utf8")) as Record<string, CostEntry>;
    } catch {
      costModel = {};
    }
  }
  const entry = costModel[symbol.toUpperCase()];
  if (!entry) return null;
  return {
    pointValueUsd: entry.point_value,
    roundTripCostUsd: entry.total_round_trip,
    roundTripCostPoints: entry.total_round_trip_points,
    tickSize: entry.tick_size,
    source: entry.source ?? "src/config/cost_model.json",
  };
}

export function assetClassOf(symbol: string): "futures" | "forex" {
  return isFuturesRoot(symbol) ? "futures" : "forex";
}

// ── bars ───────────────────────────────────────────────────────────────────

export async function loadBars(symbol: string, timeframe: string, timeframeMinutes: number, limit: number): Promise<AnalyticsBar[]> {
  let anchor: number | null = null;
  if (isFuturesRoot(symbol)) anchor = await getFrontMonthAnchor(symbol);
  if (anchor === null) {
    const safe = symbol.replace(/'/g, "''");
    const [row] = await queryQuestDBFast<{ latest: unknown }>(`SELECT max(timestamp) AS latest FROM ohlcv WHERE symbol = '${safe}'`);
    anchor = row?.latest ? normalizeTimestamp(row.latest) : null;
  }
  if (anchor === null || !Number.isFinite(anchor)) return [];
  // Three times the span the bars cover reaches past nights and weekends (the chart route's rule).
  const start = Math.max(0, anchor - limit * timeframeMinutes * 3 * 60_000);
  // A futures root is ratio back-adjusted at every roll: raw spliced prices
  // turn the calendar spread into a move (MNQZ5 -> MNQH6 read as +0.98%, z 38).
  const raw = isFuturesRoot(symbol)
    ? await getStitchedOHLCV(symbol, timeframe, start, undefined, limit, "ratio")
    : await getOHLCVSampleBy(symbol, timeframe, start, undefined, limit, true);
  const bars = raw
    .map((bar) => ({
      timestamp: normalizeTimestamp(bar.timestamp),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume) || 0,
    }))
    .filter((bar) => Number.isFinite(bar.timestamp) && bar.close > 0);
  bars.sort((a, b) => a.timestamp - b.timestamp);
  return bars;
}

// ── news ───────────────────────────────────────────────────────────────────

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** A true-UTC instant as the lake stamps futures: Pacific wall-clock digits read as UTC. */
export function toPacificStamp(utcMs: number): number {
  const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    utcMs % 1000,
  );
}

/** The inverse, for bounds: a stamped Pacific instant back to true UTC (within the hour of a DST change). */
function fromPacificStamp(stampedMs: number): number {
  const guess = stampedMs + 8 * 3_600_000;
  return guess - (toPacificStamp(guess) - stampedMs);
}

export async function loadNews(
  symbol: string,
  assetClass: "futures" | "forex",
  fromStamp: number,
  toStamp: number,
): Promise<AnalyticsNewsItem[]> {
  const root = symbol.toUpperCase().replace(/'/g, "''");
  const fromUtc = assetClass === "futures" ? fromPacificStamp(fromStamp) : fromStamp;
  const toUtc = assetClass === "futures" ? fromPacificStamp(toStamp) : toStamp;
  const list = await rows<{ article_id: string; title: string; seen_ms: unknown; score: unknown }>(
    `WITH articles AS (
       SELECT article_id, any_value(title) AS title,
              -- the time the article was known: GDELT stamps its 15-minute crawl bucket
              min(CASE WHEN vendor = 'gdelt' THEN seen_ts + INTERVAL 15 MINUTE ELSE seen_ts END) AS seen_ts
       FROM read_parquet('s3://curated/news_articles/**/*.parquet', hive_partitioning = true, union_by_name = true)
       WHERE root = '${root}'
         AND seen_ts >= to_timestamp(${Math.floor(fromUtc / 1000)})
         AND seen_ts <= to_timestamp(${Math.ceil(toUtc / 1000)})
       GROUP BY article_id
     ),
     scores AS (
       SELECT article_id, avg(score) AS score
       FROM read_parquet('s3://curated/news_sentiment/**/*.parquet', hive_partitioning = true, union_by_name = true)
       WHERE model = '${FINBERT_MODEL}' AND article_id IN (SELECT article_id FROM articles)
       GROUP BY article_id
     )
     SELECT a.article_id, a.title, epoch_ms(a.seen_ts) AS seen_ms, s.score
     FROM articles a LEFT JOIN scores s USING (article_id)
     ORDER BY seen_ms`,
    90_000,
  );
  return list
    .map((row) => {
      const utc = num(row.seen_ms) ?? 0;
      return {
        articleId: String(row.article_id),
        title: String(row.title ?? ""),
        seenAt: assetClass === "futures" ? toPacificStamp(utc) : utc,
        score: num(row.score),
      };
    })
    .sort((a, b) => a.seenAt - b.seenAt);
}

// ── Model Cycle runs ───────────────────────────────────────────────────────

interface RunRow {
  model_id: string;
  recipe: string;
  status: string;
  timeframe: string;
  model_key: string;
  model_label: string | null;
  started_at_timestamp: unknown;
  final_metrics: string | null;
}

/** The Model Cycle runs on this symbol at this timeframe: a 5m model says nothing about 1h bars. */
export async function loadRuns(symbol: string, timeframe: string): Promise<ModelRunSummary[]> {
  const safe = symbol.toUpperCase().replace(/'/g, "''");
  const safeTimeframe = timeframe.replace(/[^0-9a-z]/gi, "");
  const list = await rows<RunRow>(
    `SELECT model_id, recipe, status, timeframe, model_key, model_label, started_at_timestamp, final_metrics
     FROM ${view("runs")} WHERE upper(symbol) = '${safe}' AND timeframe = '${safeTimeframe}'
     ORDER BY started_at_timestamp DESC NULLS LAST LIMIT 60`,
  );
  return list.map((run) => {
    let metrics: Record<string, unknown> = {};
    try {
      metrics = run.final_metrics ? (JSON.parse(run.final_metrics) as Record<string, unknown>) : {};
    } catch {
      metrics = {};
    }
    const started = num(run.started_at_timestamp);
    return {
      modelId: run.model_id,
      recipe: run.recipe,
      modelLabel: run.model_label || run.model_key,
      timeframe: run.timeframe,
      status: run.status,
      startedAt: started === null ? null : started * 1000,
      netProfitUsd: num(metrics.net_profit_usd),
      winRate: num(metrics.win_rate),
      accuracy: num(metrics.accuracy),
      sharpeRatio: num(metrics.sharpe_ratio),
      maximumDrawdownUsd: num(metrics.maximum_drawdown_usd),
      tradeCount: num(metrics.trade_count),
    };
  });
}

export async function loadRunDetail(run: ModelRunSummary): Promise<ModelRunDetail | null> {
  if (!RECIPE_PATTERN.test(run.recipe)) return null;
  const recipe = run.recipe;
  const [segmentRows, calibrationRows, hourRows, lastRows] = await Promise.all([
    rows<{ segment_kind: string; segment_value: string; metric_name: string; metric_value: unknown }>(
      `SELECT segment_kind, segment_value, metric_name, metric_value FROM ${view("trading_metrics")}
       WHERE recipe = '${recipe}' AND scope = 'run'
         AND segment_kind IN ('side', 'exit_reason', 'entry_confidence')
         AND metric_name IN ('trade_count', 'win_rate', 'expectancy_usd', 'trade_net_profit_usd')`,
    ),
    rows<{ probability_lower: unknown; probability_upper: unknown; scored_bar_count: unknown; mean_probability_up: unknown; observed_up_fraction: unknown }>(
      `SELECT probability_lower, probability_upper, scored_bar_count, mean_probability_up, observed_up_fraction
       FROM ${view("calibration_bins")} WHERE recipe = '${recipe}' AND scope = 'run' ORDER BY bin_number`,
    ),
    rows<{ hour: unknown; net: unknown; exposed: unknown }>(
      `SELECT hour(to_timestamp(timestamp)) AS hour, sum(bar_net_profit_usd) AS net, sum(CAST(exposed AS INTEGER)) AS exposed
       FROM ${view("predictions")} WHERE recipe = '${recipe}' GROUP BY 1 ORDER BY 1`,
    ),
    rows<{ timestamp: unknown; probability_up: unknown }>(
      `SELECT timestamp, probability_up FROM ${view("predictions")}
       WHERE recipe = '${recipe}' AND probability_up IS NOT NULL ORDER BY timestamp DESC LIMIT 1`,
    ),
  ]);

  const segments = new Map<string, ModelSegmentRow>();
  for (const row of segmentRows) {
    const key = `${row.segment_kind}|${row.segment_value}`;
    const segment = segments.get(key) ?? {
      segmentKind: row.segment_kind as ModelSegmentRow["segmentKind"],
      segmentValue: row.segment_value,
      tradeCount: null,
      winRate: null,
      expectancyUsd: null,
      netProfitUsd: null,
    };
    const value = num(row.metric_value);
    if (row.metric_name === "trade_count") segment.tradeCount = value;
    else if (row.metric_name === "win_rate") segment.winRate = value;
    else if (row.metric_name === "expectancy_usd") segment.expectancyUsd = value;
    else if (row.metric_name === "trade_net_profit_usd") segment.netProfitUsd = value;
    segments.set(key, segment);
  }
  const last = lastRows[0];
  return {
    run,
    segments: [...segments.values()],
    calibration: calibrationRows.map((row) => ({
      probabilityLower: num(row.probability_lower) ?? 0,
      probabilityUpper: num(row.probability_upper) ?? 1,
      scoredBarCount: num(row.scored_bar_count) ?? 0,
      meanProbabilityUp: num(row.mean_probability_up),
      observedUpFraction: num(row.observed_up_fraction),
    })),
    hours: hourRows.map((row) => ({ hour: num(row.hour) ?? 0, netProfitUsd: num(row.net) ?? 0, exposedBarCount: num(row.exposed) ?? 0 })),
    lastPrediction:
      last && num(last.probability_up) !== null
        ? { timestamp: (num(last.timestamp) ?? 0) * 1000, probabilityUp: num(last.probability_up) as number }
        : null,
  };
}
