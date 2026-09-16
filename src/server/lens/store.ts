/**
 * Model Lens — parquet store.
 *
 * Loads data/models/<id>/lens/{bars,attribution}.parquet into the columnar
 * LensSeries / LensAttributionSeries shapes the shared compute (src/shared/lens)
 * operates on. Uses ITS OWN dedicated in-memory DuckDB instance — never the
 * process-wide lake connection in
 * src/server/infrastructure/database/questdb/connection.ts, which is scoped to
 * s3 parquet under the lake serving snapshot and has the wrong lifecycle for a
 * small pair of local per-model files.
 *
 * Cache: LRU by model identity — modelId + (bars mtime|size) +
 * (attribution mtime|size, or "none") + manifest.builtAtIso — capped at 4
 * models resident at once. This is transient bar/attribution data, not the
 * manifest itself, so a rebuild invalidates it immediately (see
 * evictLensModel, called by the build endpoint).
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { stat } from "fs/promises";
import path from "path";
import { Logger } from "@nestjs/common";
import {
  LENS_QUANTILE_COLUMNS,
  type LensAttributionSeries,
  type LensFeatureFamilyKey,
  type LensManifest,
  type LensSeries,
} from "@shared/lens";

const logger = new Logger("LensStore");

export class LensStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LensStoreError";
  }
}

export interface LoadedLensModel {
  /** modelId|bars:<mtime>|<size>|attribution:<mtime>|<size or "none">|builtAt:<iso> */
  identityKey: string;
  series: LensSeries;
  attribution: LensAttributionSeries | null;
}

// ─── LRU cache (Map preserves insertion order; re-inserting on hit = LRU) ────

const MAX_CACHED_MODELS = 4;
const cache = new Map<string, LoadedLensModel>();

function lruTouch(key: string, value: LoadedLensModel): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHED_MODELS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop every cached entry for a model — call after a (re)build. */
export function evictLensModel(modelId: string): void {
  const prefix = `${modelId}|`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Exposed for tests. */
export function clearLensStoreCache(): void {
  cache.clear();
}

// ─── Dedicated DuckDB instance ───────────────────────────────────────────────

let instancePromise: Promise<DuckDBInstance> | null = null;

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(":memory:").catch((error: unknown) => {
      instancePromise = null;
      throw error;
    });
  }
  return instancePromise;
}

async function withConnection<T>(fn: (con: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await getInstance();
  const con = await instance.connect();
  try {
    return await fn(con);
  } finally {
    con.closeSync();
  }
}

/** Exposed for tests that need a clean instance between fixture files. */
export function resetLensDuckDBInstance(): void {
  instancePromise = null;
}

// ─── Value coercion (DuckDB INT64 columns arrive as bigint in JS) ───────────

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return NaN;
  return Number(value as string);
}

function floatColumn(raw: readonly unknown[] | undefined, length: number): Float64Array {
  const out = new Float64Array(length);
  if (!raw) {
    out.fill(NaN);
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    const v = raw[i];
    out[i] = v === null || v === undefined ? NaN : toNumber(v);
  }
  return out;
}

function float32Column(raw: readonly unknown[] | undefined, length: number): Float32Array {
  const out = new Float32Array(length);
  if (!raw) {
    out.fill(NaN);
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    const v = raw[i];
    out[i] = v === null || v === undefined ? NaN : toNumber(v);
  }
  return out;
}

/** -1 encodes "no label", matching the LensSeries.label contract. */
function labelColumn(raw: readonly unknown[] | undefined, length: number): Int8Array {
  const out = new Int8Array(length).fill(-1);
  if (!raw) return out;
  for (let i = 0; i < length; i += 1) {
    const v = raw[i];
    if (v === null || v === undefined) continue;
    const n = toNumber(v);
    out[i] = n === 1 ? 1 : n === 0 ? 0 : -1;
  }
  return out;
}

function sqlLiteral(p: string): string {
  return p.replace(/'/g, "''");
}

// ─── bars.parquet -> LensSeries ──────────────────────────────────────────────

const BAR_COLUMNS = [
  "row_index",
  "timestamp_seconds",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "probability_up",
  "label",
  "realized_return_basis_points",
  ...LENS_QUANTILE_COLUMNS,
] as const;

async function loadSeries(modelId: string, barsPath: string, manifest: LensManifest): Promise<LensSeries> {
  return withConnection(async (con) => {
    const literal = sqlLiteral(barsPath);

    // row_index must be exactly 0..n-1 — count(DISTINCT) === count() AND the
    // range [0, n-1] together rule out both duplicates and gaps.
    const shapeReader = await con.runAndReadAll(
      "SELECT count(*)::BIGINT AS n, count(DISTINCT row_index)::BIGINT AS distinct_n, " +
        `min(row_index)::BIGINT AS lo, max(row_index)::BIGINT AS hi FROM read_parquet('${literal}')`,
    );
    const shapeRow = shapeReader.getRowObjectsJS()[0] as Record<string, unknown> | undefined;
    const n = toNumber(shapeRow?.n);
    if (!Number.isFinite(n) || n <= 0) {
      throw new LensStoreError(`bars.parquet for '${modelId}' is empty`);
    }
    const distinctN = toNumber(shapeRow?.distinct_n);
    const lo = toNumber(shapeRow?.lo);
    const hi = toNumber(shapeRow?.hi);
    if (distinctN !== n || lo !== 0 || hi !== n - 1) {
      throw new LensStoreError(
        `bars.parquet for '${modelId}' has non-contiguous row_index ` +
          `(count ${n}, distinct ${distinctN}, range [${lo}, ${hi}]); expected exactly 0..${n - 1}`,
      );
    }

    const columnList = BAR_COLUMNS.map((c) => `"${c}"`).join(", ");
    const reader = await con.runAndReadAll(`SELECT ${columnList} FROM read_parquet('${literal}') ORDER BY row_index`);
    const cols = reader.getColumnsObjectJS();
    const length = n;

    const predictedQuantilesBasisPoints = LENS_QUANTILE_COLUMNS.map((name) =>
      float32Column(cols[name] as unknown[] | undefined, length),
    );

    const series: LensSeries = {
      modelId,
      length,
      timestampSeconds: floatColumn(cols.timestamp_seconds as unknown[] | undefined, length),
      open: floatColumn(cols.open as unknown[] | undefined, length),
      high: floatColumn(cols.high as unknown[] | undefined, length),
      low: floatColumn(cols.low as unknown[] | undefined, length),
      close: floatColumn(cols.close as unknown[] | undefined, length),
      volume: floatColumn(cols.volume as unknown[] | undefined, length),
      probabilityUp: float32Column(cols.probability_up as unknown[] | undefined, length),
      label: labelColumn(cols.label as unknown[] | undefined, length),
      realizedReturnBasisPoints: float32Column(cols.realized_return_basis_points as unknown[] | undefined, length),
      predictedQuantilesBasisPoints,
      horizonBars: manifest.horizonBars,
      cost: manifest.cost,
    };
    return series;
  });
}

// ─── attribution.parquet (long form) -> LensAttributionSeries (pivoted) ─────

/** Feature order comes from the manifest's family list, not parquet grouping
 *  order — that keeps the builder, server and UI legend agreeing on order. */
function canonicalFeatureOrder(manifest: LensManifest): { names: string[]; families: LensFeatureFamilyKey[] } {
  const names: string[] = [];
  const families: LensFeatureFamilyKey[] = [];
  for (const family of manifest.attribution.families ?? []) {
    for (const feature of family.features) {
      names.push(feature);
      families.push(family.family);
    }
  }
  return { names, families };
}

async function loadAttribution(
  modelId: string,
  attributionPath: string,
  manifest: LensManifest,
  seriesLength: number,
): Promise<LensAttributionSeries | null> {
  const { names, families } = canonicalFeatureOrder(manifest);
  if (names.length === 0) return null;

  return withConnection(async (con) => {
    const literal = sqlLiteral(attributionPath);
    const reader = await con.runAndReadAll(
      `SELECT row_index, feature_name, shap_value, feature_value FROM read_parquet('${literal}') ` +
        "ORDER BY feature_name, row_index",
    );
    const cols = reader.getColumnsObjectJS();
    const rowIdxCol = (cols.row_index ?? []) as unknown[];
    const featureNameCol = (cols.feature_name ?? []) as unknown[];
    const shapCol = (cols.shap_value ?? []) as unknown[];
    const valueCol = (cols.feature_value ?? []) as unknown[];

    const indexOf = new Map(names.map((name, i) => [name, i]));
    const shap = names.map(() => {
      const a = new Float32Array(seriesLength);
      a.fill(NaN);
      return a;
    });
    const value = names.map(() => {
      const a = new Float32Array(seriesLength);
      a.fill(NaN);
      return a;
    });

    let skippedUnknownFeatures = 0;
    for (let i = 0; i < rowIdxCol.length; i += 1) {
      const featureName = String(featureNameCol[i]);
      const featureIndex = indexOf.get(featureName);
      if (featureIndex === undefined) {
        skippedUnknownFeatures += 1;
        continue;
      }
      const row = toNumber(rowIdxCol[i]);
      if (!Number.isFinite(row) || row < 0 || row >= seriesLength) continue;
      (shap[featureIndex] as Float32Array)[row] = toNumber(shapCol[i]);
      (value[featureIndex] as Float32Array)[row] = toNumber(valueCol[i]);
    }
    if (skippedUnknownFeatures > 0) {
      logger.warn(
        `attribution.parquet for '${modelId}' carries ${skippedUnknownFeatures} row(s) for a feature name not ` +
          "listed in manifest.attribution.families — skipped",
      );
    }
    return { featureNames: names, featureFamilies: families, shap, value };
  });
}

// ─── Public entry point ──────────────────────────────────────────────────────

async function fileIdentity(p: string): Promise<string | null> {
  try {
    const st = await stat(p);
    return `${st.mtimeMs}|${st.size}`;
  } catch {
    return null;
  }
}

export async function loadLensModel(
  modelId: string,
  lensDir: string,
  manifest: LensManifest,
): Promise<LoadedLensModel> {
  const barsPath = path.join(lensDir, "bars.parquet");
  const attributionPath = path.join(lensDir, "attribution.parquet");

  const barsIdentity = await fileIdentity(barsPath);
  if (!barsIdentity) {
    throw new LensStoreError(`bars.parquet is missing for '${modelId}' at ${barsPath}`);
  }
  const attributionIdentity = manifest.attribution.available ? await fileIdentity(attributionPath) : null;

  const identityKey =
    `${modelId}|bars:${barsIdentity}|attribution:${attributionIdentity ?? "none"}|builtAt:${manifest.builtAtIso}`;

  const cached = cache.get(identityKey);
  if (cached) {
    lruTouch(identityKey, cached);
    return cached;
  }

  const series = await loadSeries(modelId, barsPath, manifest);
  const attribution =
    manifest.attribution.available && attributionIdentity
      ? await loadAttribution(modelId, attributionPath, manifest, series.length)
      : null;

  const loaded: LoadedLensModel = { identityKey, series, attribution };
  lruTouch(identityKey, loaded);
  return loaded;
}
