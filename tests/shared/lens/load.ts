/**
 * Test-only loaders. The production parquet -> LensSeries loader belongs to the
 * server (apps/api/lens); this file exists so the shared-compute tests can
 * read the same artifacts without depending on it.
 *
 * Every loader takes a model DIRECTORY, so the parity tests run against the
 * committed fixtures under tests/fixtures/lens/ (which cannot vanish) and, where
 * a test says so, against a real run under data/models/ (gitignored, so those
 * tests skip when the directory is absent).
 *
 *   loadLensManifest / loadLensSeries   <directory>/lens/{manifest.json, bars.parquet},
 *                                       the on-disk contract the Python builder writes.
 *   readOutOfSamplePredictions          <directory>/oos_predictions.parquet, the model's
 *                                       ORIGINAL record, read independently of the builder.
 *   readJson                            any JSON artifact (diagnostics, scoreboard, config),
 *                                       tolerating the bare NaN tokens older writers emitted.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { LENS_QUANTILE_COLUMNS, LENS_QUANTILE_LEVELS, type LensManifest, type LensSeries } from "@shared/lens/index";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(HERE, "..", "..", "..");

/** Committed fixtures (tests/fixtures/lens/<name>/). */
export const FIXTURE_ROOT = path.join(REPOSITORY_ROOT, "tests", "fixtures", "lens");

/** A daily XGBoost direction classifier (packages/ml-engine/src/xgb_classifier), lens built on the lake's bar grid. */
export const DAILY_CLASSIFIER_FIXTURE = path.join(FIXTURE_ROOT, "mnq_1d_xgboost_direction_classifier");

/** A Model Cycle run (packages/ml-engine/src/cycle), lens built from the run's own record. */
export const CYCLE_RUN_FIXTURE = path.join(FIXTURE_ROOT, "mnq_5m_xgboost_cycle_run");

/** A real model directory under data/models (gitignored). */
export function modelDirectory(modelId: string): string {
  return path.join(REPOSITORY_ROOT, "data", "models", modelId);
}

/**
 * diagnostics.json files written before the 2026-07-28 dumps_safe fix contain
 * bare NaN / Infinity tokens, which are valid Python but invalid JSON — the
 * same defect that made GET /api/training/models/:id/diagnostics return 500.
 * The server repairs this with parseJsonRelaxed(); this is the test-side
 * equivalent, replacing only bare tokens in value position.
 */
function parseJsonAllowingNonFinite<T>(text: string): T {
  return JSON.parse(text.replace(/([:[,]\s*)(NaN|-?Infinity)(?=\s*[,\]}])/g, "$1null")) as T;
}

export function readJson<T>(filePath: string): T {
  return parseJsonAllowingNonFinite<T>(readFileSync(filePath, "utf-8"));
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function readParquetRows(parquetPath: string): Promise<Array<Record<string, unknown>>> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const escaped = parquetPath.replace(/\\/g, "/").replace(/'/g, "''");
  const reader = await connection.runAndReadAll(`SELECT * FROM read_parquet('${escaped}')`);
  return reader.getRowObjects() as Array<Record<string, unknown>>;
}

/** <directory>/lens/bars.parquet -> LensSeries, exactly as types.ts documents it. */
export async function loadLensSeries(directory: string, manifest: LensManifest): Promise<LensSeries> {
  const rows = await readParquetRows(path.join(directory, "lens", "bars.parquet"));
  const length = rows.length;
  const series = emptySeries(manifest.modelId, length, manifest);
  for (let index = 0; index < length; index += 1) {
    const row = rows[index] as Record<string, unknown>;
    series.timestampSeconds[index] = toNumber(row["timestamp_seconds"]);
    series.open[index] = toNumber(row["open"]);
    series.high[index] = toNumber(row["high"]);
    series.low[index] = toNumber(row["low"]);
    series.close[index] = toNumber(row["close"]);
    series.volume[index] = toNumber(row["volume"]);
    series.probabilityUp[index] = toNumber(row["probability_up"]);
    const label = row["label"];
    series.label[index] = label === null || label === undefined ? -1 : toNumber(label);
    series.realizedReturnBasisPoints[index] = toNumber(row["realized_return_basis_points"]);
    for (let q = 0; q < LENS_QUANTILE_COLUMNS.length; q += 1) {
      const column = series.predictedQuantilesBasisPoints[q] as Float32Array;
      column[index] = toNumber(row[LENS_QUANTILE_COLUMNS[q] as string]);
    }
  }
  return series;
}

export function loadLensManifest(directory: string): LensManifest {
  return readJson<LensManifest>(path.join(directory, "lens", "manifest.json"));
}

export function directoryExists(directory: string): boolean {
  return existsSync(directory);
}

export function lensArtifactsExist(directory: string): boolean {
  const lens = path.join(directory, "lens");
  return existsSync(path.join(lens, "bars.parquet")) && existsSync(path.join(lens, "manifest.json"));
}

function emptySeries(modelId: string, length: number, manifest: LensManifest): LensSeries {
  return {
    modelId,
    length,
    timestampSeconds: new Float64Array(length),
    open: new Float64Array(length),
    high: new Float64Array(length),
    low: new Float64Array(length),
    close: new Float64Array(length),
    volume: new Float64Array(length),
    probabilityUp: new Float32Array(length),
    label: new Int8Array(length),
    realizedReturnBasisPoints: new Float32Array(length),
    predictedQuantilesBasisPoints: LENS_QUANTILE_LEVELS.map(() => new Float32Array(length).fill(Number.NaN)),
    horizonBars: manifest.horizonBars,
    cost: manifest.cost,
  };
}

// ── The model's original record, read without the builder ──────────────────

export interface OutOfSamplePredictions {
  timestampSeconds: number[];
  probabilityUp: number[];
  label: number[];
  realizedReturnBasisPoints: number[];
}

/** <directory>/oos_predictions.parquet (ts, prob_up, label, realized_return_bp) as the trainer wrote it. */
export async function readOutOfSamplePredictions(directory: string): Promise<OutOfSamplePredictions> {
  const rows = await readParquetRows(path.join(directory, "oos_predictions.parquet"));
  return {
    timestampSeconds: rows.map((row) => toNumber(row["ts"])),
    probabilityUp: rows.map((row) => toNumber(row["prob_up"])),
    label: rows.map((row) => toNumber(row["label"])),
    realizedReturnBasisPoints: rows.map((row) => toNumber(row["realized_return_bp"])),
  };
}

/** The numbers packages/ml-engine/src/xgb_classifier writes into diagnostics.json for its own evaluator run. */
export interface ClassifierDiagnostics {
  symbol: string;
  timeframe: string;
  metrics: Record<string, { value: number | null }>;
  pnl_curve: { trade_pnl_dollars: number[]; n_long: number; n_short: number };
}

export function readClassifierDiagnostics(directory: string): ClassifierDiagnostics {
  return readJson<ClassifierDiagnostics>(path.join(directory, "diagnostics.json"));
}

/** A Model Cycle run's scoreboard.json. */
export interface CycleScoreboard {
  metrics: Record<string, number | null>;
  barsEvaluated: number;
  barsScored: number;
}

export function readCycleScoreboard(directory: string): CycleScoreboard {
  return readJson<CycleScoreboard>(path.join(directory, "scoreboard.json"));
}
