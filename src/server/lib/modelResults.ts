/**
 * Model Results Service (SRP)
 *
 * Pure functions for trained-model CRUD: list, read diagnostics/convergence,
 * read assignments (parquet + OHLCV join), and delete.
 * Consumed by routes/training.ts — no HTTP or Express types here.
 */

import path from "path";
import fs from "fs";
import { questdbMarketQuery } from "./questdbMarketQuery";

// ─── Security ────────────────────────────────────────────────────────────────

const MODEL_ID_RE = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeModelId(id: string): string {
  const trimmed = String(id).trim();
  if (!trimmed || trimmed.includes("..") || !MODEL_ID_RE.test(trimmed)) {
    throw new Error(`Invalid model ID: ${JSON.stringify(trimmed)}`);
  }
  return trimmed;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelSummary {
  id: string;
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total: number;
  n_bars_train_val: number;
  n_bars_test: number;
  quality_score: number;
  date_range: { start: string; end: string } | null;
  training_config: Record<string, unknown>;
  training_time_sec: number;
  trained_at: string;
}

// ─── List ────────────────────────────────────────────────────────────────────

export function listTrainedModels(baseDir: string): ModelSummary[] {
  if (!fs.existsSync(baseDir)) return [];

  const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const models: ModelSummary[] = [];
  for (const dir of dirs) {
    const diagPath = path.join(baseDir, dir, "diagnostics.json");
    if (!fs.existsSync(diagPath)) continue;
    try {
      const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
      models.push({
        id: dir,
        symbol: diag.symbol,
        timeframe: diag.timeframe,
        n_regimes: diag.n_regimes,
        n_bars: diag.n_bars || diag.n_bars_total,
        n_bars_total: diag.n_bars_total,
        n_bars_train_val: diag.n_bars_train_val,
        n_bars_test: diag.n_bars_test,
        quality_score: diag.quality_score,
        date_range: diag.date_range,
        training_config: diag.training_config,
        training_time_sec: diag.training_time_sec,
        trained_at: diag.trained_at,
      });
    } catch { /* skip corrupted */ }
  }

  models.sort((a, b) => (b.trained_at || "").localeCompare(a.trained_at || ""));
  return models;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export function getModelDiagnostics(baseDir: string, id: string): object | null {
  const safe = sanitizeModelId(id);
  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  if (!fs.existsSync(diagPath)) return null;
  return JSON.parse(fs.readFileSync(diagPath, "utf-8"));
}

// ─── Convergence ─────────────────────────────────────────────────────────────

export function getModelConvergence(baseDir: string, id: string): object | null {
  const safe = sanitizeModelId(id);
  const convPath = path.join(baseDir, safe, "convergence.json");
  if (!fs.existsSync(convPath)) return null;
  return JSON.parse(fs.readFileSync(convPath, "utf-8"));
}

// ─── Assignments (parquet + OHLCV join) ──────────────────────────────────────

const TF_MAP: Record<string, string> = {
  "1m": "1 MINUTE", "5m": "5 MINUTES", "15m": "15 MINUTES",
  "30m": "30 MINUTES", "1h": "1 HOUR", "1H": "1 HOUR",
  "4h": "4 HOURS", "4H": "4 HOURS",
  "1d": "1 DAY", "1D": "1 DAY", "1w": "7 DAYS", "1W": "7 DAYS",
};

export interface AssignmentsOptions {
  limit?: number;
  offset?: number;
}

export async function getModelAssignments(
  baseDir: string,
  id: string,
  opts: AssignmentsOptions = {},
) {
  const safe = sanitizeModelId(id);
  const parquetPath = path.join(baseDir, safe, "regimes.parquet");
  if (!fs.existsSync(parquetPath)) return null;

  const forwardPath = parquetPath.replace(/\\/g, "/");
  const limit = Math.min(Number(opts.limit) || 50000, 100000);
  const offset = Number(opts.offset) || 0;

  // Read diagnostics for symbol + timeframe (needed for OHLCV join)
  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  let symbol: string | null = null;
  let timeframe: string | null = null;
  if (fs.existsSync(diagPath)) {
    try {
      const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
      symbol = diag.symbol || null;
      timeframe = diag.timeframe || null;
    } catch { /* ignore */ }
  }

  const interval = timeframe ? TF_MAP[timeframe] || "30 MINUTES" : "30 MINUTES";

  let rows: Record<string, unknown>[];
  if (symbol) {
    const isRoot = symbol.length <= 3 && /^[A-Za-z]+$/.test(symbol);
    const symbolFilter = isRoot
      ? `symbol ~ '^${symbol}[FGHJKMNQUVXZ][0-9]{1,2}$'`
      : `symbol = '${symbol}'`;

    const ohlcvCte = `agg AS (
           SELECT time_bucket(INTERVAL '${interval}', ts) AS bucket_ts,
                  FIRST(open ORDER BY ts) AS open, MAX(high) AS high,
                  MIN(low) AS low, LAST(close ORDER BY ts) AS close,
                  CAST(SUM(volume) AS DOUBLE) AS volume
           FROM ohlcv
           WHERE ${symbolFilter}
           GROUP BY bucket_ts
         )`;

    rows = await questdbMarketQuery<Record<string, unknown>>(
      `WITH ${ohlcvCte}
       SELECT r.ts,
              CAST(COALESCE(a.open,  r.close) AS DOUBLE) as open,
              CAST(COALESCE(a.high,  r.close) AS DOUBLE) as high,
              CAST(COALESCE(a.low,   r.close) AS DOUBLE) as low,
              CAST(r.close AS DOUBLE) as close,
              CAST(COALESCE(a.volume, 0) AS DOUBLE) as volume,
              CAST(r.regime AS INTEGER) as regime,
              r.regime_label,
              r.split
       FROM read_parquet('${forwardPath}') r
       LEFT JOIN agg a ON a.bucket_ts = r.ts
       ORDER BY r.ts ASC LIMIT ${limit} OFFSET ${offset}`
    );
  } else {
    rows = await questdbMarketQuery<Record<string, unknown>>(
      `SELECT ts, CAST(close AS DOUBLE) as close, CAST(regime AS INTEGER) as regime, regime_label, split
       FROM read_parquet('${forwardPath}') ORDER BY ts ASC LIMIT ${limit} OFFSET ${offset}`
    );
  }

  const total = await questdbMarketQuery<{ cnt: number }>(
    `SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM read_parquet('${forwardPath}')`
  );

  return { rows, total: total[0]?.cnt || rows.length, limit, offset };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export function deleteModel(baseDir: string, id: string): boolean {
  const safe = sanitizeModelId(id);
  const modelDir = path.join(baseDir, safe);
  if (!fs.existsSync(modelDir)) return false;

  const files = fs.readdirSync(modelDir);
  for (const file of files) {
    fs.unlinkSync(path.join(modelDir, file));
  }
  fs.rmdirSync(modelDir);
  return true;
}
