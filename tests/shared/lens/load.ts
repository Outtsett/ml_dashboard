/**
 * Test-only loaders. The production parquet -> LensSeries loader belongs to the
 * server (src/server/lens); this file exists so the shared-compute tests can
 * read the same artifacts without depending on it.
 *
 * Two loaders:
 *   loadLensSeries            reads data/models/<id>/lens/bars.parquet, the
 *                             on-disk contract written by the Python builder.
 *   reconstructFromPredictions reads the model's ORIGINAL artifacts
 *                             (oos_predictions.parquet + diagnostics.json) and
 *                             rebuilds the close series from them, so parity can
 *                             be checked even before the builder has run. See
 *                             the header on that function for why it is exact.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  LENS_BUILDER_VERSION,
  LENS_QUANTILE_COLUMNS,
  LENS_QUANTILE_LEVELS,
  type LensManifest,
  type LensSeries,
} from "@shared/lens/index";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(HERE, "..", "..", "..");

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

/** data/models/<id>/lens/bars.parquet -> LensSeries, exactly as types.ts documents it. */
export async function loadLensSeries(modelId: string, manifest: LensManifest): Promise<LensSeries> {
  const barsPath = path.join(modelDirectory(modelId), "lens", "bars.parquet");
  const rows = await readParquetRows(barsPath);
  const length = rows.length;
  const series = emptySeries(modelId, length, manifest);
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

export function loadLensManifest(modelId: string): LensManifest {
  const manifestPath = path.join(modelDirectory(modelId), "lens", "manifest.json");
  return parseJsonAllowingNonFinite<LensManifest>(readFileSync(manifestPath, "utf-8"));
}

/**
 * Whether this checkout carries the model at all. `data/` is gitignored, so a
 * fresh clone (or CI) has no model directories — which is a different thing
 * from a model whose lens was never built.
 */
export function modelDataExists(modelId: string): boolean {
  return existsSync(modelDirectory(modelId));
}

export function lensArtifactsExist(modelId: string): boolean {
  const directory = path.join(modelDirectory(modelId), "lens");
  return existsSync(path.join(directory, "bars.parquet")) && existsSync(path.join(directory, "manifest.json"));
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

// ── Reconstruction from the model's original artifacts ──────────────────────

export interface ReconstructedModel {
  series: LensSeries;
  manifest: LensManifest;
  /**
   * Largest disagreement, in index points, between the close price implied by
   * each of the model's own trades and the reconstructed series. It is the
   * residual of an over-determined system, so a small number is evidence the
   * reconstruction is the real price series and not an artefact.
   */
  maximumSeedDisagreementPoints: number;
  referenceTradeNetUsd: number[];
}

/**
 * Rebuild the close series the model's evaluator actually saw, from artifacts
 * that already exist on disk.
 *
 * oos_predictions.parquet carries realized_return_bp[i] = ln(close[i+H]/close[i])
 * * 10_000, which pins every RATIO within a residue class of i modulo H but
 * leaves H unknown scale factors. diagnostics.json carries the net dollars of
 * each of the model's own trades, and net = (close[exit] - close[entry]) *
 * direction * pointValue - roundTripCost, so each trade pins the absolute price
 * level at its own entry row. With 264 trades and 5 unknowns the system is
 * heavily over-determined: `maximumSeedDisagreementPoints` reports how far the
 * worst of those 264 independent anchors lands from the reconstruction, and
 * prices are snapped to the instrument's tick at every chained step.
 */
export async function reconstructFromPredictions(modelId: string): Promise<ReconstructedModel> {
  const directory = modelDirectory(modelId);
  const rows = await readParquetRows(path.join(directory, "oos_predictions.parquet"));
  const checkpoint = parseJsonAllowingNonFinite<{
    params: { label_horizon_bars: number; pnl_threshold: number };
  }>(readFileSync(path.join(directory, "checkpoint.json"), "utf-8"));
  const diagnostics = parseJsonAllowingNonFinite<{
    symbol: string;
    timeframe: string;
    metrics: Record<string, { value: number }>;
    pnl_curve: { trade_pnl_dollars: number[]; n_long: number; n_short: number };
  }>(readFileSync(path.join(directory, "diagnostics.json"), "utf-8"));
  const costModel = parseJsonAllowingNonFinite<
    Record<string, { total_round_trip_points: number; point_value: number; tick_size: number }>
  >(readFileSync(path.join(REPOSITORY_ROOT, "src", "config", "cost_model.json"), "utf-8"));
  const symbol = diagnostics.symbol;
  const cost = costModel[symbol] as { total_round_trip_points: number; point_value: number; tick_size: number };

  const length = rows.length;
  const horizon = checkpoint.params.label_horizon_bars;
  const threshold = checkpoint.params.pnl_threshold;
  const pointValue = cost.point_value;
  const tick = cost.tick_size;
  const roundTripUsd = cost.total_round_trip_points * pointValue;

  const timestamps = new Float64Array(length);
  const probability = new Float32Array(length);
  const label = new Int8Array(length);
  const realized = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const row = rows[index] as Record<string, unknown>;
    timestamps[index] = toNumber(row["ts"]);
    probability[index] = toNumber(row["prob_up"]);
    const labelValue = row["label"];
    label[index] = labelValue === null || labelValue === undefined ? -1 : toNumber(labelValue);
    realized[index] = toNumber(row["realized_return_bp"]);
  }

  // Replay the evaluator's own entry rule to recover which rows it traded.
  const entries: Array<{ row: number; direction: 1 | -1 }> = [];
  let lastExit = -1;
  for (let index = 0; index < length - horizon; index += 1) {
    if (index < lastExit) continue;
    const value = probability[index] as number;
    let direction: 1 | -1;
    if (value >= threshold) direction = 1;
    else if (value <= 1 - threshold) direction = -1;
    else continue;
    entries.push({ row: index, direction });
    lastExit = index + horizon;
  }

  const referenceTradeNetUsd = diagnostics.pnl_curve.trade_pnl_dollars;
  if (entries.length !== referenceTradeNetUsd.length) {
    throw new Error(
      `reconstruct: replayed ${entries.length} entries but diagnostics.json carries ${referenceTradeNetUsd.length} trades`,
    );
  }

  // Each trade anchors the absolute price level at its entry row.
  const anchors = new Map<number, number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as { row: number; direction: 1 | -1 };
    const net = referenceTradeNetUsd[index] as number;
    const signedMove = (net + roundTripUsd) / pointValue; // (exit - entry) * direction
    const ratio = Math.expm1((realized[entry.row] as number) / 1e4);
    if (ratio === 0 || !Number.isFinite(ratio)) continue;
    anchors.set(entry.row, (signedMove * entry.direction) / ratio);
  }

  const close = new Float64Array(length).fill(Number.NaN);
  const snap = (price: number) => Math.round(price / tick) * tick;
  for (let residue = 0; residue < horizon; residue += 1) {
    let anchorRow = -1;
    for (const row of anchors.keys()) {
      if (row % horizon === residue && (anchorRow === -1 || row < anchorRow)) anchorRow = row;
    }
    if (anchorRow === -1) throw new Error(`reconstruct: no anchor for rows ${residue} modulo ${horizon}`);
    close[anchorRow] = snap(anchors.get(anchorRow) as number);
    let row = anchorRow;
    while (row + horizon < length && Number.isFinite(realized[row] as number)) {
      const next = snap((close[row] as number) * Math.exp((realized[row] as number) / 1e4));
      close[row + horizon] = next;
      row += horizon;
    }
    row = anchorRow;
    while (row - horizon >= 0) {
      const previous = snap((close[row] as number) / Math.exp((realized[row - horizon] as number) / 1e4));
      close[row - horizon] = previous;
      row -= horizon;
    }
  }

  let maximumSeedDisagreementPoints = 0;
  for (const [row, implied] of anchors) {
    const difference = Math.abs((close[row] as number) - implied);
    if (difference > maximumSeedDisagreementPoints) maximumSeedDisagreementPoints = difference;
  }

  const manifest: LensManifest = {
    modelId,
    builderVersion: LENS_BUILDER_VERSION,
    builtAtIso: new Date(0).toISOString(),
    sourceSchema: "probability_parquet",
    sourceFiles: [],
    symbol,
    timeframe: diagnostics.timeframe,
    barSeconds: 60,
    horizonBars: horizon,
    horizonSource: "checkpoint.json params.label_horizon_bars",
    labelDefinition: "1 when the forward log return over the horizon cleared the label threshold, else 0",
    defaultThreshold: threshold,
    cost: {
      roundTripPoints: cost.total_round_trip_points,
      pointValueUsd: pointValue,
      tickSize: tick,
      source: "src/config/cost_model.json MNQ",
    },
    barCount: length,
    firstTimestampSeconds: timestamps[0] as number,
    lastTimestampSeconds: timestamps[length - 1] as number,
    interval: {
      method: "not reconstructed in this test fixture",
      binCount: 0,
      recalibrationStepBars: 0,
      historyBars: 0,
      minimumBinObservations: 0,
      quantiles: [...LENS_QUANTILE_LEVELS],
      coveredBarCount: 0,
    },
    attribution: { available: false, reason: "attribution is not part of this reconstructed fixture" },
    reference: {
      tradeCount: diagnostics.metrics["n_trades"]?.value ?? null,
      cumulativeNetUsd: diagnostics.metrics["cum_pnl_dollars"]?.value ?? null,
      longCount: diagnostics.pnl_curve.n_long,
      shortCount: diagnostics.pnl_curve.n_short,
      hitRateAtHalf: diagnostics.metrics["hit_rate_50"]?.value ?? null,
      areaUnderCurve: diagnostics.metrics["auc"]?.value ?? null,
    },
    verification: [],
    notes: [
      "Close prices reconstructed from realized_return_bp ratios anchored on the model's own trade profit and loss.",
    ],
  };

  const series: LensSeries = {
    modelId,
    length,
    timestampSeconds: timestamps,
    open: close.slice(),
    high: close.slice(),
    low: close.slice(),
    close,
    volume: new Float64Array(length).fill(Number.NaN),
    probabilityUp: probability,
    label,
    realizedReturnBasisPoints: realized,
    predictedQuantilesBasisPoints: LENS_QUANTILE_LEVELS.map(() => new Float32Array(length).fill(Number.NaN)),
    horizonBars: horizon,
    cost: manifest.cost,
  };

  return { series, manifest, maximumSeedDisagreementPoints, referenceTradeNetUsd };
}
