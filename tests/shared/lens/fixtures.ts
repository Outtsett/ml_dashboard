/** Small hand-built LensSeries / LensManifest fixtures for the unit tests. */

import {
  LENS_BUILDER_VERSION,
  LENS_QUANTILE_LEVELS,
  type LensManifest,
  type LensSeries,
} from "@shared/lens/index";

export interface SeriesOptions {
  close: number[];
  probabilityUp: number[];
  label?: Array<0 | 1 | null>;
  realizedReturnBasisPoints?: Array<number | null>;
  /** quantiles[quantileIndex][rowIndex]; null means warmup. */
  quantilesBasisPoints?: Array<Array<number | null>>;
  horizonBars?: number;
  roundTripPoints?: number;
  pointValueUsd?: number;
  tickSize?: number;
  startTimestampSeconds?: number;
  barSeconds?: number;
  modelId?: string;
}

export function makeSeries(options: SeriesOptions): LensSeries {
  const length = options.close.length;
  const barSeconds = options.barSeconds ?? 60;
  const start = options.startTimestampSeconds ?? 1_600_000_000;
  const timestampSeconds = new Float64Array(length);
  for (let index = 0; index < length; index += 1) timestampSeconds[index] = start + index * barSeconds;

  const close = Float64Array.from(options.close);
  const label = new Int8Array(length).fill(-1);
  if (options.label) {
    for (let index = 0; index < length; index += 1) {
      const value = options.label[index];
      label[index] = value === null || value === undefined ? -1 : value;
    }
  }
  const realized = new Float32Array(length).fill(Number.NaN);
  if (options.realizedReturnBasisPoints) {
    for (let index = 0; index < length; index += 1) {
      const value = options.realizedReturnBasisPoints[index];
      realized[index] = value === null || value === undefined ? Number.NaN : value;
    }
  }
  const quantiles = LENS_QUANTILE_LEVELS.map((_, quantileIndex) => {
    const column = new Float32Array(length).fill(Number.NaN);
    const source = options.quantilesBasisPoints?.[quantileIndex];
    if (source) {
      for (let index = 0; index < length; index += 1) {
        const value = source[index];
        column[index] = value === null || value === undefined ? Number.NaN : value;
      }
    }
    return column;
  });

  return {
    modelId: options.modelId ?? "fixture",
    length,
    timestampSeconds,
    open: close.slice(),
    high: close.slice(),
    low: close.slice(),
    close,
    volume: new Float64Array(length).fill(Number.NaN),
    probabilityUp: Float32Array.from(options.probabilityUp),
    label,
    realizedReturnBasisPoints: realized,
    predictedQuantilesBasisPoints: quantiles,
    horizonBars: options.horizonBars ?? 2,
    cost: {
      roundTripPoints: options.roundTripPoints ?? 2,
      pointValueUsd: options.pointValueUsd ?? 1,
      tickSize: options.tickSize ?? 0.25,
      source: "fixture",
    },
  };
}

export function makeManifest(series: LensSeries, overrides: Partial<LensManifest> = {}): LensManifest {
  return {
    modelId: series.modelId,
    builderVersion: LENS_BUILDER_VERSION,
    builtAtIso: new Date(0).toISOString(),
    sourceSchema: "probability_parquet",
    sourceFiles: [],
    symbol: "FIXTURE",
    timeframe: "1m",
    barSeconds: 60,
    horizonBars: series.horizonBars,
    horizonSource: "fixture",
    labelDefinition: "fixture",
    defaultThreshold: 0.6,
    cost: series.cost,
    barCount: series.length,
    firstTimestampSeconds: series.timestampSeconds[0] ?? 0,
    lastTimestampSeconds: series.timestampSeconds[series.length - 1] ?? 0,
    interval: {
      method: "fixture",
      binCount: 0,
      recalibrationStepBars: 0,
      historyBars: 0,
      minimumBinObservations: 0,
      quantiles: [...LENS_QUANTILE_LEVELS],
      coveredBarCount: 0,
    },
    attribution: { available: false, reason: "fixture has no attribution" },
    reference: {
      tradeCount: null,
      cumulativeNetUsd: null,
      longCount: null,
      shortCount: null,
      hitRateAtHalf: null,
      areaUnderCurve: null,
    },
    verification: [],
    notes: [],
    ...overrides,
  };
}
