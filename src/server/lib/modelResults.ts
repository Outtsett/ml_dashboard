/**
 * Model Results Service (SRP)
 *
 * Pure functions for trained-model CRUD: list, read diagnostics/convergence,
 * read assignments (QuestDB model_regimes table), and delete.
 * Consumed by routes/training.ts — no HTTP or Express types here.
 */

import path from "path";
import fs from "fs";
import { questdbHttpQuery } from "../database/questdb/httpQuery";

// ─── Security ────────────────────────────────────────────────────────────────

/** Strict allowlist: alphanumeric + underscore + hyphen, max 128 chars.
 *  Used in SQL string interpolation — no quotes or metacharacters possible. */
const MODEL_ID_RE = /^[a-zA-Z0-9_\-]+$/;
const MODEL_ID_MAX_LEN = 128;

export function sanitizeModelId(id: string): string {
  const trimmed = String(id).trim();
  if (!trimmed || trimmed.length > MODEL_ID_MAX_LEN || trimmed.includes("..") || !MODEL_ID_RE.test(trimmed)) {
    throw new Error(`Invalid model ID: ${JSON.stringify(trimmed.slice(0, 40))}`);
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

/** Convert legacy regime_profiles dict → regime_stats array for backward compat */
function migrateLegacyDiagnostics(diag: Record<string, unknown>): Record<string, unknown> {
  // Already new format
  if (diag.regime_stats) return diag;

  // Convert regime_profiles dict → regime_stats array
  if (diag.regime_profiles && typeof diag.regime_profiles === "object") {
    const profiles = diag.regime_profiles as Record<string, Record<string, unknown>>;
    const nBarsTotal = (diag.n_bars_total || diag.n_bars || 1) as number;
    diag.regime_stats = Object.entries(profiles).map(([id, p]) => ({
      regime_id: Number(id),
      count: (p.count as number) || 0,
      pct: (p.pct as number) || 0,
      avg_return: (p.mean_return as number) || 0,
      avg_return_pct: ((p.mean_return as number) || 0) * 100,
      avg_volatility: (p.volatility as number) || 0,
      avg_range: 0,
      avg_atr_ratio: 1,
      avg_duration: 0,
      max_duration: 0,
      label: (p.label as string) || `Regime ${id}`,
      nickname: (p.label as string) || `Regime ${id}`,
      volatility_state: "normal",
      bar_character: "normal",
      characteristics: {},
    }));
    // Estimate durations from bar counts if possible
    const stats = diag.regime_stats as Array<Record<string, unknown>>;
    for (const s of stats) {
      const count = s.count as number;
      const nRegimes = (diag.n_regimes as number) || 1;
      // Rough avg duration: total bars per regime / estimated number of visits
      const estVisits = Math.max(1, nBarsTotal / (count > 0 ? nBarsTotal / count : 1) / 10);
      s.avg_duration = Math.round(count / estVisits * 10) / 10;
      s.max_duration = Math.round((s.avg_duration as number) * 3);
    }
  }

  // Convert features_used → feature_names
  if (diag.features_used && !diag.feature_names) {
    diag.feature_names = diag.features_used;
  }

  // Add convergence_summary if missing (from convergence.json data if available)
  if (!diag.convergence_summary) {
    diag.convergence_summary = {
      n_iterations: (diag.training_config as Record<string, unknown>)?.gibbs_iter || 0,
      final_log_likelihood: 0,
      final_active_states: (diag.n_regimes as number) || 0,
    };
  }

  // Add empty transitions array from transition_matrix
  if (!diag.transitions && diag.transition_matrix) {
    const matrix = diag.transition_matrix as number[][];
    const nRegimes = (diag.n_regimes as number) || matrix.length;
    const transitions: Array<{ from: number; to: number; probability: number }> = [];
    for (let i = 0; i < Math.min(nRegimes, matrix.length); i++) {
      for (let j = 0; j < Math.min(nRegimes, (matrix[i]?.length || 0)); j++) {
        const prob = matrix[i]![j]!;
        if (prob >= 0.01) {
          transitions.push({ from: i, to: j, probability: Math.round(prob * 10000) / 10000 });
        }
      }
    }
    diag.transitions = transitions;
  }

  return diag;
}

export function getModelDiagnostics(baseDir: string, id: string): object | null {
  const safe = sanitizeModelId(id);
  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  if (!fs.existsSync(diagPath)) return null;
  const raw = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
  return migrateLegacyDiagnostics(raw);
}

// ─── Convergence ─────────────────────────────────────────────────────────────

export function getModelConvergence(baseDir: string, id: string): object | null {
  const safe = sanitizeModelId(id);
  const convPath = path.join(baseDir, safe, "convergence.json");
  if (!fs.existsSync(convPath)) return null;
  const raw = JSON.parse(fs.readFileSync(convPath, "utf-8"));

  // New format: already has "gibbs" key with ConvergencePoint[]
  if (raw.gibbs) return raw;

  // Legacy format: { log_likelihoods: number[] } → convert to ConvergencePoint[]
  if (raw.log_likelihoods) {
    return {
      gibbs: (raw.log_likelihoods as number[]).map((ll: number, i: number) => ({
        iter: i + 1,
        log_likelihood: ll,
      })),
      n_iterations: raw.n_iterations || raw.log_likelihoods.length,
    };
  }

  return raw;
}

// ─── Assignments (QuestDB model_regimes table) ──────────────────────────────

export interface AssignmentsOptions {
  limit?: number;
  offset?: number;
}

export async function getModelAssignments(
  _baseDir: string,
  id: string,
  opts: AssignmentsOptions = {},
) {
  const safe = sanitizeModelId(id);
  const limit = Math.min(Number(opts.limit) || 50000, 100000);
  const offset = Number(opts.offset) || 0;

  const rows = await questdbHttpQuery<Record<string, unknown>>(
    `SELECT ts, close, regime, regime_label, split
     FROM model_regimes
     WHERE model_id = '${safe}'
     ORDER BY ts ASC
     LIMIT ${offset}, ${limit}`
  );

  if (rows.length === 0) return null;

  const total = await questdbHttpQuery<{ cnt: number }>(
    `SELECT count() as cnt FROM model_regimes WHERE model_id = '${safe}'`
  );

  return { rows, total: Number(total[0]?.cnt ?? rows.length), limit, offset };
}

// ─── SHAP Values ─────────────────────────────────────────────────────────────

export interface ShapOptions {
  regime?: number;
  limit?: number;
  offset?: number;
}

export async function getModelShap(
  _baseDir: string,
  id: string,
  opts: ShapOptions = {},
) {
  const safe = sanitizeModelId(id);
  const limit = Math.min(Number(opts.limit) || 50000, 100000);
  const offset = Number(opts.offset) || 0;
  const regimeFilter = opts.regime !== undefined
    ? ` AND regime = ${Math.floor(Number(opts.regime))}`
    : "";

  const rows = await questdbHttpQuery<Record<string, unknown>>(
    `SELECT * FROM model_shap
     WHERE model_id = '${safe}'${regimeFilter}
     ORDER BY ts ASC
     LIMIT ${offset}, ${limit}`
  );

  if (rows.length === 0) return null;

  const total = await questdbHttpQuery<{ cnt: number }>(
    `SELECT count() as cnt FROM model_shap WHERE model_id = '${safe}'${regimeFilter}`
  );

  return { rows, total: Number(total[0]?.cnt ?? rows.length), limit, offset };
}

// ─── Benchmarks ─────────────────────────────────────────────────────────

export interface BenchmarkResult {
  buyAndHold: { cumulative: number[]; totalReturn: number };
  smaCrossover: { cumulative: number[]; totalReturn: number; signals: number[] };
  dates: string[];
}

/** Compute buy-and-hold and SMA crossover benchmarks for a model's date range. */
export async function getModelBenchmarks(
  baseDir: string,
  id: string,
): Promise<BenchmarkResult | null> {
  const safe = sanitizeModelId(id);
  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  if (!fs.existsSync(diagPath)) return null;

  const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
  const { symbol, date_range } = diag;
  if (!symbol || !date_range?.start || !date_range?.end) return null;

  // Query OHLCV from QuestDB for the model's date range
  const ohlcv = await questdbHttpQuery<{ ts: string; close: number }>(
    `SELECT timestamp as ts, close FROM ohlcv
     WHERE symbol = '${symbol}'
       AND timestamp >= '${date_range.start}'
       AND timestamp <= '${date_range.end}'
     ORDER BY timestamp ASC
     LIMIT 0, 100000`
  );

  if (ohlcv.length < 200) return null;

  const closes = ohlcv.map(r => r.close);
  const buyAndHold = computeBuyAndHold(closes);
  const smaCrossover = computeSMACrossover(closes, 50, 200);

  return { buyAndHold, smaCrossover, dates: ohlcv.map(r => r.ts) };
}

function computeBuyAndHold(closes: number[]): { cumulative: number[]; totalReturn: number } {
  const cumulative: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const logRet = Math.log(closes[i]! / Math.max(closes[i - 1]!, 1e-10));
    cumulative.push(cumulative[i - 1]! + logRet);
  }
  return { cumulative, totalReturn: cumulative[cumulative.length - 1]! };
}

function computeSMACrossover(
  closes: number[], shortWindow: number, longWindow: number,
): { cumulative: number[]; totalReturn: number; signals: number[] } {
  const smaShort = sma(closes, shortWindow);
  const smaLong = sma(closes, longWindow);

  // Positions: +1 when short > long, -1 otherwise, 0 during warmup
  const signals: number[] = closes.map((_, i) => {
    if (i < longWindow - 1 || smaShort[i] === null || smaLong[i] === null) return 0;
    return smaShort[i]! > smaLong[i]! ? 1 : -1;
  });

  // Cumulative returns with position
  const cumulative: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const logRet = Math.log(closes[i]! / Math.max(closes[i - 1]!, 1e-10));
    cumulative.push(cumulative[i - 1]! + signals[i]! * logRet);
  }

  return { cumulative, totalReturn: cumulative[cumulative.length - 1]!, signals };
}

function sma(data: number[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i]!;
    if (i >= window) sum -= data[i - window]!;
    if (i >= window - 1) result[i] = sum / window;
  }
  return result;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteModel(baseDir: string, id: string): Promise<boolean> {
  const safe = sanitizeModelId(id);
  const modelDir = path.join(baseDir, safe);
  if (!fs.existsSync(modelDir)) return false;

  const files = fs.readdirSync(modelDir);
  for (const file of files) {
    fs.unlinkSync(path.join(modelDir, file));
  }
  fs.rmdirSync(modelDir);

  // Clean up QuestDB rows (fire-and-forget — disk deletion is the primary action)
  try {
    await questdbHttpQuery(`DELETE FROM model_regimes WHERE model_id = '${safe}'`);
    await questdbHttpQuery(`DELETE FROM model_shap WHERE model_id = '${safe}'`);
  } catch (err) {
    console.warn(`[modelResults] Failed to delete QuestDB rows for ${safe}:`, err);
  }

  return true;
}
