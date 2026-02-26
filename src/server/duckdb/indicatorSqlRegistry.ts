/**
 * Indicator SQL Registry — OCP-compliant map of indicator name → SQL generator.
 *
 * Add new indicators by adding entries to the registry maps.
 * No switch/case modification needed in mlFeatures.ts.
 */

import type { TechnicalIndicatorConfig } from './mlFeatures';

type SqlColumnGenerator = (params: Record<string, number>) => string[];
type FeatureNameGenerator = (params: Record<string, number>) => string[];

interface IndicatorRegistryEntry {
  sqlColumns: SqlColumnGenerator;
  featureNames: FeatureNameGenerator;
}

const INDICATOR_REGISTRY: Record<string, IndicatorRegistryEntry> = {
  rsi: {
    sqlColumns: (p) => {
      const period = p.period || 14;
      return [`100 - (100 / (1 +
          AVG(gain) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) /
          NULLIF(AVG(loss) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW), 0)
        )) AS rsi_${period}`];
    },
    featureNames: (p) => [`rsi_${p.period || 14}`],
  },

  ema: {
    sqlColumns: (p) => {
      const period = p.period || 20;
      return [`AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS ema_${period}`];
    },
    featureNames: (p) => [`ema_${p.period || 20}`],
  },

  sma: {
    sqlColumns: (p) => {
      const period = p.period || 20;
      return [`AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS sma_${period}`];
    },
    featureNames: (p) => [`sma_${p.period || 20}`],
  },

  stddev: {
    sqlColumns: (p) => {
      const period = p.period || 20;
      return [`STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS stddev_${period}`];
    },
    featureNames: (p) => [`stddev_${p.period || 20}`],
  },

  atr: {
    sqlColumns: (p) => {
      const period = p.period || 14;
      return [`AVG(true_range) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS atr_${period}`];
    },
    featureNames: (p) => [`atr_${p.period || 14}`],
  },

  bollinger: {
    sqlColumns: (p) => {
      const period = p.period || 20;
      const stdDev = p.stdDev || 2;
      return [
        `AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS bb_middle_${period}`,
        `AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) + (${stdDev} * STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)) AS bb_upper_${period}`,
        `AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - (${stdDev} * STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)) AS bb_lower_${period}`,
        `(close - (AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - (${stdDev} * STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)))) /
          NULLIF((AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) + (${stdDev} * STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW))) -
                 (AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - (${stdDev} * STDDEV_POP(close) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW))), 0) AS bb_pct_b_${period}`,
      ];
    },
    featureNames: (p) => {
      const period = p.period || 20;
      return [`bb_middle_${period}`, `bb_upper_${period}`, `bb_lower_${period}`, `bb_pct_b_${period}`];
    },
  },

  stochastic: {
    sqlColumns: (p) => {
      const kPeriod = p.kPeriod || 14;
      const dPeriod = p.dPeriod || 3;
      return [
        `(close - MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(MAX(high) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW), 0) * 100 AS stoch_k_${kPeriod}`,
        `AVG((close - MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(MAX(high) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN ${kPeriod - 1} PRECEDING AND CURRENT ROW), 0) * 100)
          OVER (ORDER BY timestamp ROWS BETWEEN ${dPeriod - 1} PRECEDING AND CURRENT ROW) AS stoch_d_${kPeriod}_${dPeriod}`,
      ];
    },
    featureNames: (p) => {
      const k = p.kPeriod || 14;
      const d = p.dPeriod || 3;
      return [`stoch_k_${k}`, `stoch_d_${k}_${d}`];
    },
  },

  cci: {
    sqlColumns: (p) => {
      const period = p.period || 20;
      return [`(typical_price - AVG(typical_price) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(0.015 * STDDEV_POP(typical_price) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW), 0) AS cci_${period}`];
    },
    featureNames: (p) => [`cci_${p.period || 20}`],
  },

  williams_r: {
    sqlColumns: (p) => {
      const period = p.period || 14;
      return [`(MAX(high) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) - close) /
          NULLIF(MAX(high) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY timestamp ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW), 0) * -100 AS williams_r_${period}`];
    },
    featureNames: (p) => [`williams_r_${p.period || 14}`],
  },

  roc: {
    sqlColumns: (p) => {
      const period = p.period || 10;
      return [`((close - LAG(close, ${period}) OVER (ORDER BY timestamp)) / NULLIF(LAG(close, ${period}) OVER (ORDER BY timestamp), 0) * 100) AS roc_${period}`];
    },
    featureNames: (p) => [`roc_${p.period || 10}`],
  },

  momentum: {
    sqlColumns: (p) => {
      const period = p.period || 10;
      return [`(close - LAG(close, ${period}) OVER (ORDER BY timestamp)) AS momentum_${period}`];
    },
    featureNames: (p) => [`momentum_${p.period || 10}`],
  },
};

/**
 * Generate SQL column expressions for a list of indicator configs.
 * Uses the registry map — add new indicators by adding entries above.
 */
export function generateIndicatorSQLColumns(indicators: TechnicalIndicatorConfig[]): string {
  const columns: string[] = [];

  for (const ind of indicators) {
    const entry = INDICATOR_REGISTRY[ind.id];
    if (entry) {
      columns.push(...entry.sqlColumns(ind.params || {}));
    }
  }

  return columns.join(',\n        ');
}

/**
 * Get feature names that will be generated for a list of indicator configs.
 */
export function getIndicatorFeatureNames(indicators: TechnicalIndicatorConfig[]): string[] {
  const features: string[] = [];

  for (const ind of indicators) {
    const entry = INDICATOR_REGISTRY[ind.id];
    if (entry) {
      features.push(...entry.featureNames(ind.params || {}));
    }
  }

  return features;
}

/** List of valid indicator IDs (derived from registry keys). */
export const VALID_INDICATORS = Object.keys(INDICATOR_REGISTRY);
