/**
 * Indicator Registry — defines ALL available TA-Lib indicators as configurable entities.
 *
 * This is the single source of truth for indicator metadata.
 */

import { OVERLAP_INDICATORS } from '@/market/lib/overlap/registry';
import { MOMENTUM_INDICATORS } from '@/market/lib/momentum/registry';
import { TREND_INDICATORS } from '@/market/lib/trend/registry';
import { VOLATILITY_INDICATORS } from '@/market/lib/volatility/registry';
import { VOLUME_INDICATORS } from '@/market/lib/volume/registry';
import { STATISTICS_INDICATORS } from '@/market/lib/statistics/registry';
import { CYCLE_INDICATORS } from '@/market/lib/cycle/registry';
import { PERFORMANCE_INDICATORS } from '@/market/lib/performance/registry';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndicatorParam {
  key: string;
  label: string;
  type: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
}

export type IndicatorCategory = 'momentum' | 'trend' | 'volatility' | 'volume' | 'overlap' | 'statistics' | 'cycle' | 'performance';

export interface IndicatorOutput {
  key: string;
  label: string;
  style: 'line' | 'histogram';
}

export interface ReferenceLine {
  value: number;
  color: string;
  dash?: number[];
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  fullName: string;
  category: IndicatorCategory;
  renderType: 'overlay' | 'subchart';
  params: IndicatorParam[];
  outputs: IndicatorOutput[];
  referenceLines?: ReferenceLine[];
}

// ─── Indicator Definitions ───────────────────────────────────────────────────

export const INDICATOR_REGISTRY: IndicatorDefinition[] = [
  ...OVERLAP_INDICATORS,
  ...MOMENTUM_INDICATORS,
  ...TREND_INDICATORS,
  ...VOLATILITY_INDICATORS,
  ...VOLUME_INDICATORS,
  ...STATISTICS_INDICATORS,
  ...CYCLE_INDICATORS,
  ...PERFORMANCE_INDICATORS,
];

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

const REGISTRY_MAP = new Map<string, IndicatorDefinition>();
for (const def of INDICATOR_REGISTRY) {
  REGISTRY_MAP.set(def.id, def);
}

export function getIndicatorDefinition(id: string): IndicatorDefinition | undefined {
  return REGISTRY_MAP.get(id);
}

export function getIndicatorsByCategory(category: IndicatorCategory): IndicatorDefinition[] {
  return INDICATOR_REGISTRY.filter(d => d.category === category);
}

/** All categories in display order */
export const CATEGORY_ORDER: IndicatorCategory[] = [
  'overlap', 'momentum', 'trend', 'volatility', 'volume', 'statistics', 'cycle', 'performance',
];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  overlap: 'Overlap',
  momentum: 'Momentum',
  trend: 'Trend',
  volatility: 'Volatility',
  volume: 'Volume',
  statistics: 'Statistics',
  cycle: 'Cycle',
  performance: 'Performance',
};
