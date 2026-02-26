import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { runQuery, PARQUET_DIR } from "./analyticsCore";
import {
  generateIndicatorSQLColumns,
  getIndicatorFeatureNames,
  VALID_INDICATORS,
} from './indicatorSqlRegistry';

// Re-export for backward compat
export { generateIndicatorSQLColumns, getIndicatorFeatureNames, VALID_INDICATORS } from './indicatorSqlRegistry';

export interface TechnicalIndicatorConfig {
  id: string;
  params?: Record<string, number>;
}

export interface MLFeatureConfig {
  lagPeriods: number[];
  smaWindows: number[];
  targetHorizon: number;
  indicators?: TechnicalIndicatorConfig[];
}

export const DEFAULT_ML_CONFIG: MLFeatureConfig = {
  lagPeriods: [1, 2, 3, 5, 10, 20],
  smaWindows: [5, 10, 20, 50],
  targetHorizon: 5,
  indicators: [
    { id: 'rsi', params: { period: 14 } },
    { id: 'rsi', params: { period: 7 } },
    { id: 'atr', params: { period: 14 } },
    { id: 'bollinger', params: { period: 20, stdDev: 2 } },
    { id: 'stochastic', params: { kPeriod: 14, dPeriod: 3 } },
    { id: 'roc', params: { period: 10 } },
    { id: 'momentum', params: { period: 10 } },
    { id: 'williams_r', params: { period: 14 } }
  ]
};

export const VALID_TIMEFRAMES = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
type ValidTimeframe = typeof VALID_TIMEFRAMES[number];

export function validateTimeframe(tf: string): ValidTimeframe {
  if (!VALID_TIMEFRAMES.includes(tf as ValidTimeframe)) {
    throw new Error(`Invalid timeframe: ${tf}. Must be one of: ${VALID_TIMEFRAMES.join(', ')}`);
  }
  return tf as ValidTimeframe;
}

export function validateMLConfig(config: Partial<MLFeatureConfig>): MLFeatureConfig {
  const cfg = { ...DEFAULT_ML_CONFIG };

  if (config.lagPeriods) {
    if (!Array.isArray(config.lagPeriods) || config.lagPeriods.some(n => !Number.isInteger(n) || n < 1 || n > 100)) {
      throw new Error('lagPeriods must be an array of integers between 1 and 100');
    }
    cfg.lagPeriods = config.lagPeriods.slice(0, 20);
  }

  if (config.smaWindows) {
    if (!Array.isArray(config.smaWindows) || config.smaWindows.some(n => !Number.isInteger(n) || n < 2 || n > 200)) {
      throw new Error('smaWindows must be an array of integers between 2 and 200');
    }
    cfg.smaWindows = config.smaWindows.slice(0, 10);
  }

  if (config.targetHorizon !== undefined) {
    if (!Number.isInteger(config.targetHorizon) || config.targetHorizon < 1 || config.targetHorizon > 100) {
      throw new Error('targetHorizon must be an integer between 1 and 100');
    }
    cfg.targetHorizon = config.targetHorizon;
  }

  if (config.indicators !== undefined) {
    if (!Array.isArray(config.indicators)) {
      throw new Error('indicators must be an array');
    }
    cfg.indicators = config.indicators.filter(ind => {
      if (!ind.id || !VALID_INDICATORS.includes(ind.id)) {
        console.warn(`[DuckDB] Skipping unknown indicator: ${ind.id}`);
        return false;
      }
      return true;
    }).slice(0, 20);
  }

  return cfg;
}

export async function generateMLFeatures(
  symbol: string,
  timeframe: string = "1m",
  config: Partial<MLFeatureConfig> = {}
): Promise<{ path: string; rowCount: number; features: string[] }> {
  const safeSymbol = validateSymbol(symbol);
  const safeTimeframe = validateTimeframe(timeframe);
  const cfg = validateMLConfig(config);

  const inputPath = path.join(PARQUET_DIR, `${safeSymbol}_${safeTimeframe}.parquet`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Parquet file not found: ${inputPath}. Run export first.`);
  }

  const outputPath = path.join(PARQUET_DIR, `${safeSymbol}_${timeframe}_features.parquet`);

  const lagColumns = cfg.lagPeriods.map(p =>
    `LAG(close, ${p}) OVER w AS close_lag_${p},
     LAG(volume, ${p}) OVER w AS volume_lag_${p},
     (close - LAG(close, ${p}) OVER w) / NULLIF(LAG(close, ${p}) OVER w, 0) AS return_${p}`
  ).join(',\n     ');

  const smaColumns = cfg.smaWindows.map(w =>
    `AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${w-1} PRECEDING AND CURRENT ROW) AS sma_${w}`
  ).join(',\n     ');

  const volatilityColumns = `
    STDDEV(close) OVER (ORDER BY timestamp ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS volatility_20,
    MAX(high) OVER (ORDER BY timestamp ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) -
    MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS range_20
  `;

  const targetColumns = `
    LEAD(close, ${cfg.targetHorizon}) OVER w AS target_close,
    (LEAD(close, ${cfg.targetHorizon}) OVER w - close) / NULLIF(close, 0) AS target_return,
    CASE WHEN LEAD(close, ${cfg.targetHorizon}) OVER w > close THEN 1 ELSE 0 END AS target_direction
  `;

  const indicatorColumns = generateIndicatorSQLColumns(cfg.indicators || []);
  const indicatorFeatures = getIndicatorFeatureNames(cfg.indicators || []);

  const sql = `
    COPY (
      WITH base_data AS (
        SELECT
          timestamp,
          open, high, low, close, volume,
          (high + low + close) / 3.0 AS typical_price,
          close - LAG(close) OVER w AS price_change,
          CASE WHEN close > LAG(close) OVER w THEN close - LAG(close) OVER w ELSE 0 END AS gain,
          CASE WHEN close < LAG(close) OVER w THEN LAG(close) OVER w - close ELSE 0 END AS loss,
          GREATEST(
            high - low,
            ABS(high - LAG(close) OVER w),
            ABS(low - LAG(close) OVER w)
          ) AS true_range
        FROM read_parquet('${inputPath}')
        WINDOW w AS (ORDER BY timestamp)
      )
      SELECT
        timestamp,
        open, high, low, close, volume,
        -- Price returns
        (close - open) / NULLIF(open, 0) AS intrabar_return,
        (high - low) / NULLIF(low, 0) AS bar_range_pct,
        -- Lagged features
        ${lagColumns},
        -- Moving averages
        ${smaColumns},
        -- Volatility
        ${volatilityColumns},
        -- Volume features
        volume / NULLIF(AVG(volume) OVER (ORDER BY timestamp ROWS BETWEEN 19 PRECEDING AND CURRENT ROW), 0) AS relative_volume,
        -- Time features (timestamp is in milliseconds)
        EXTRACT(HOUR FROM epoch_ms(timestamp::BIGINT)) AS hour,
        EXTRACT(DOW FROM epoch_ms(timestamp::BIGINT)) AS day_of_week,
        -- Technical indicators
        ${indicatorColumns.length > 0 ? indicatorColumns : '1 AS _placeholder'}
        ${indicatorColumns.length > 0 ? ',' : ''}
        -- Target variables
        ${targetColumns}
      FROM base_data
      WINDOW w AS (ORDER BY timestamp)
      ORDER BY timestamp
    ) TO '${outputPath}' (FORMAT PARQUET)
  `;

  await runQuery(sql);

  const countResult = await runQuery(`SELECT COUNT(*) as cnt FROM read_parquet('${outputPath}')`);
  const rowCount = Number(countResult[0]?.cnt || 0);

  const featureList = [
    'intrabar_return', 'bar_range_pct',
    ...cfg.lagPeriods.flatMap(p => [`close_lag_${p}`, `volume_lag_${p}`, `return_${p}`]),
    ...cfg.smaWindows.map(w => `sma_${w}`),
    'volatility_20', 'range_20', 'relative_volume',
    'hour', 'day_of_week',
    ...indicatorFeatures,
    'target_close', 'target_return', 'target_direction'
  ];

  console.log(`[DuckDB] Generated ${featureList.length} ML features (${indicatorFeatures.length} indicators) for ${safeSymbol} (${timeframe}): ${rowCount} rows`);

  return { path: outputPath, rowCount, features: featureList };
}

export async function getMLFeaturesPreview(
  symbol: string,
  timeframe: string = "1m",
  limit: number = 100
): Promise<any[]> {
  const safeSymbol = validateSymbol(symbol);
  const featuresPath = path.join(PARQUET_DIR, `${safeSymbol}_${timeframe}_features.parquet`);

  if (!fs.existsSync(featuresPath)) {
    throw new Error(`ML features file not found. Run generateMLFeatures first.`);
  }

  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);

  const sql = `
    SELECT * FROM read_parquet('${featuresPath}')
    WHERE target_direction IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT ${safeLimit}
  `;

  const results = await runQuery(sql);
  return results.map(row => {
    const converted: any = {};
    for (const key in row) {
      converted[key] = typeof row[key] === 'bigint' ? Number(row[key]) : row[key];
    }
    return converted;
  });
}

export async function getAvailableParquetFiles(): Promise<{
  symbol: string;
  timeframe: string;
  type: 'raw' | 'features';
  path: string;
  sizeBytes: number;
}[]> {
  const files: any[] = [];

  if (!fs.existsSync(PARQUET_DIR)) {
    return files;
  }

  const entries = fs.readdirSync(PARQUET_DIR);

  for (const entry of entries) {
    if (entry.endsWith('.parquet')) {
      const fullPath = path.join(PARQUET_DIR, entry);
      const stats = fs.statSync(fullPath);

      const match = entry.match(/^([A-Z0-9]+)_([0-9a-z]+)(_features)?\.parquet$/);
      if (match) {
        files.push({
          symbol: match[1],
          timeframe: match[2],
          type: match[3] ? 'features' : 'raw',
          path: fullPath,
          sizeBytes: stats.size
        });
      }
    }
  }

  return files;
}
