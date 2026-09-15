/**
 * Model Results Service (SRP)
 *
 * Pure functions for trained-model CRUD: list, read diagnostics/convergence,
 * read assignments (disk CSV), and delete.
 * Consumed by routes/training.ts — no HTTP or Express types here.
 *
 * Caching: Diagnostics, convergence, and assignment files are immutable after
 * training completes. An LRU cache (max 100 entries) avoids redundant disk I/O.
 */

import path from "path";
import fs from "fs";
import { modelCacheGet, modelCacheSet, clearModelCache } from "../cache/model";
import { questdbHttpQuery } from "../database/questdb/httpQuery";

// Re-export clearModelCache for backward compat
export { clearModelCache } from "../cache/model";

// ─── Tolerant JSON read ──────────────────────────────────────────────────────

/**
 * Read a model artifact that may contain bare `NaN` / `Infinity` tokens.
 *
 * Python's `json.dump` emits those by default. They round-trip through Python
 * but are NOT valid JSON, so `JSON.parse` rejects the entire document — one NaN
 * metric made `/api/training/models/:id/diagnostics` return HTTP 500 (verified
 * against `data/models/xgb_baseline_post_w2c/diagnostics.json`) and made the
 * same models vanish from `listTrainedModels`, which swallows the parse error.
 *
 * `src/ml/shared/protocol.py::dumps_safe` now prevents this at the writer, but
 * artifacts already on disk cannot be rewritten — this keeps them readable.
 *
 * Non-finite values become `null`, never `0`: they mean "undefined"/"empty bin",
 * and a zero would be a real value that silently corrupts averages and charts.
 * The replacement only fires on bare tokens in value position, so the string
 * `"NaN"` inside a feature name is untouched.
 */
function parseJsonRelaxed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const repaired = text.replace(
      /(^|[\s:,\[])(-?Infinity|NaN)(?=[\s,\]}]|$)/g,
      "$1null",
    );
    return JSON.parse(repaired);
  }
}

function readJsonFile(filePath: string): unknown {
  return parseJsonRelaxed(fs.readFileSync(filePath, "utf-8"));
}

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

/** The subset of a model's diagnostics.json this module reads. Model families differ, so every field is optional. */
interface DiagnosticsFile {
  quality_score?: number;
  best_metrics?: { swing_accuracy?: number };
  metrics?: { accuracy?: number };
  model_type?: string;
  symbol?: string;
  timeframe?: string;
  n_regimes?: number;
  n_bars?: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  data?: { n_train?: number; n_val?: number; train_date_range?: string[]; val_date_range?: string[] };
  date_range?: { start: string; end: string };
  training_config?: Record<string, unknown>;
  hyperparameters?: Record<string, unknown>;
  training_time_sec?: number;
  training?: { total_time_sec?: number };
  trained_at?: string;
  evaluation?: { grade?: string };
}

export interface ModelSummary {
  id: string;
  modelType: string;
  /** Absent when the model's diagnostics.json does not record it. */
  symbol?: string;
  timeframe?: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total: number;
  n_bars_train_val: number;
  n_bars_test: number;
  quality_score: number;
  evaluation_grade: string;
  date_range: { start?: string; end?: string } | null;
  training_config?: Record<string, unknown>;
  training_time_sec?: number;
  trained_at: string;
}

/** Extract model type from versioned ID.
 *  MNQZ5_1m_primitives-discovery_20260302T000850 → primitives-discovery
 *  ES_1h_cnn-transformer_20260301T143022 → cnn-transformer */
function extractModelType(id: string): string {
  const parts = id.split("_");
  const tsPattern = /^\d{8}T\d{6}$/;
  const tsIdx = parts.findIndex(p => tsPattern.test(p));
  // Format: symbol_timeframe_modelType[_timestamp][_wN]
  // Model type is everything between index 2 and the timestamp
  if (tsIdx > 2) return parts.slice(2, tsIdx).join("_");
  if (tsIdx === -1 && parts.length > 2) return parts.slice(2).join("_");
  return "unknown";
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
      const diag = readJsonFile(diagPath) as DiagnosticsFile;
      // Map quality score from best_metrics if top-level quality_score is missing
      const quality = diag.quality_score ?? 
                     (diag.best_metrics?.swing_accuracy ? diag.best_metrics.swing_accuracy * 100 : 
                      diag.metrics?.accuracy ? diag.metrics.accuracy * 100 : 0);

      models.push({
        id: dir,
        modelType: diag.model_type || extractModelType(dir),
        symbol: diag.symbol,
        timeframe: diag.timeframe,
        n_regimes: diag.n_regimes || 0,
        n_bars: diag.n_bars || diag.n_bars_total || diag.data?.n_train || 0,
        n_bars_total: diag.n_bars_total || ((diag.data?.n_train ?? 0) + (diag.data?.n_val ?? 0)) || 0,
        n_bars_train_val: diag.n_bars_train_val || diag.data?.n_train || 0,
        n_bars_test: diag.n_bars_test || diag.data?.n_val || 0,
        quality_score: quality,
        date_range: diag.date_range || { start: diag.data?.train_date_range?.[0], end: diag.data?.val_date_range?.[1] },
        training_config: diag.training_config || diag.hyperparameters,
        training_time_sec: diag.training_time_sec || diag.training?.total_time_sec,
        trained_at: diag.trained_at || (fs.statSync(diagPath).mtime.toISOString()),
        evaluation_grade: diag.evaluation?.grade || "N/A",
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
      const _nRegimes = (diag.n_regimes as number) || 1;
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
  const cacheKey = `diagnostics:${safe}`;
  const cached = modelCacheGet<object>(cacheKey);
  if (cached) return cached;

  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  if (!fs.existsSync(diagPath)) return null;
  const raw = readJsonFile(diagPath) as Record<string, unknown>;
  const result = migrateLegacyDiagnostics(raw);
  modelCacheSet(cacheKey, result);
  return result;
}

// ─── Convergence ─────────────────────────────────────────────────────────────

export function getModelConvergence(baseDir: string, id: string): object | null {
  const safe = sanitizeModelId(id);
  const cacheKey = `convergence:${safe}`;
  const cached = modelCacheGet<object>(cacheKey);
  if (cached) return cached;

  const convPath = path.join(baseDir, safe, "convergence.json");
  if (!fs.existsSync(convPath)) return null;
  const raw = readJsonFile(convPath) as { gibbs?: unknown; log_likelihoods?: number[]; n_iterations?: number };

  let result: object;
  // New format: already has "gibbs" key with ConvergencePoint[]
  if (raw.gibbs) {
    result = raw;
  } else if (raw.log_likelihoods) {
    // Legacy format: { log_likelihoods: number[] } → convert to ConvergencePoint[]
    result = {
      gibbs: raw.log_likelihoods.map((ll: number, i: number) => ({
        iter: i + 1,
        log_likelihood: ll,
      })),
      n_iterations: raw.n_iterations || raw.log_likelihoods.length,
    };
  } else {
    result = raw;
  }

  modelCacheSet(cacheKey, result);
  return result;
}

// ─── Assignments (disk CSV) ──────────────────────────────────────────────────

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
  const limit = Math.min(Number(opts.limit) || 50000, 500000);
  const offset = Number(opts.offset) || 0;

  // Cache the full parsed row array; slice from cache on each call
  const cacheKey = `assignments:${safe}`;
  let allRows = modelCacheGet<Record<string, unknown>[]>(cacheKey);

  if (!allRows) {
    // Read assignments from disk (assignments.csv in model directory)
    const csvPath = path.join(_baseDir, safe, "assignments.csv");
    if (!fs.existsSync(csvPath)) return null;

    const csvText = fs.readFileSync(csvPath, "utf-8");
    const lines = csvText.split("\n").filter(l => l.trim());
    if (lines.length < 2) return null;

    const header = lines[0]!.split(",");
    const tsIdx = header.indexOf("ts");
    const closeIdx = header.indexOf("close");
    const regimeIdx = header.indexOf("regime");
    const labelIdx = header.indexOf("regime_label");
    const splitIdx = header.indexOf("split");
    const categoryIdx = header.indexOf("category");

    if (tsIdx < 0 || regimeIdx < 0) return null;

    allRows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(",");
      if (cols.length < Math.max(tsIdx, regimeIdx) + 1) continue;
      allRows.push({
        ts: cols[tsIdx]!,
        close: closeIdx >= 0 ? parseFloat(cols[closeIdx]!) : 0,
        regime: parseInt(cols[regimeIdx]!, 10),
        regime_label: labelIdx >= 0 ? cols[labelIdx]! : `Regime ${cols[regimeIdx]}`,
        split: splitIdx >= 0 ? cols[splitIdx]! : "train",
        category: categoryIdx >= 0 ? cols[categoryIdx]! : undefined,
      });
    }

    if (allRows.length > 0) {
      modelCacheSet(cacheKey, allRows);
    }
  }

  const totalCount = allRows.length;
  const sliced = allRows.slice(offset, offset + limit);
  return sliced.length > 0
    ? { rows: sliced, total: totalCount, limit, offset }
    : null;
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
  _opts: ShapOptions = {},
) {
  // Per-bar SHAP data was stored in QuestDB model_shap table (now dropped).
  // SHAP summary is still available in diagnostics.json under shap_summary key.
  void _baseDir; void id;
  return null;
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

  const diag = readJsonFile(diagPath) as DiagnosticsFile;
  const { symbol, date_range } = diag;
  if (!symbol || !date_range?.start || !date_range?.end) return null;

  // Query OHLCV from the lake for the model's date range.
  // `LIMIT 0, 100000` was QuestDB's offset,count spelling — DuckDB reads that
  // as a syntax error, not as an offset.
  const ohlcv = await questdbHttpQuery<{ ts: string; close: number }>(
    `SELECT timestamp as ts, close FROM ohlcv
     WHERE symbol = '${symbol}'
       AND timestamp >= '${date_range.start}'
       AND timestamp <= '${date_range.end}'
     ORDER BY timestamp ASC
     LIMIT 100000 OFFSET 0`
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

  clearModelCache(safe);
  return true;
}
