/**
 * Indicator Compute Dispatcher — bridges ActiveIndicator instances to the
 * existing overlayCalculators and subchartCalculators math functions.
 */

import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import { getIndicatorDefinition } from "@/market/lib/indicator_registry";
import { computeOverlay, type OverlayPoint } from "@/market/lib/overlay_calculators";
import { computeSubchart, type IndicatorPoint } from "@/market/lib/subchart_calculators";

// Modularized category compute functions
import {
  buildOverlapColumnName, getOverlapOutputColumnMap,
  isSpecialized as isOverlapSpecialized, computeSpecialized as computeOverlapSpecialized
} from '@/market/lib/overlap/compute';
import {
  buildMomentumColumnName, getMomentumOutputColumnMap,
  isSpecialized as isMomentumSpecialized, computeSpecialized as computeMomentumSpecialized
} from '@/market/lib/momentum/compute';
import {
  buildTrendColumnName, getTrendOutputColumnMap,
  isSpecialized as isTrendSpecialized, computeSpecialized as computeTrendSpecialized
} from '@/market/lib/trend/compute';
import {
  buildVolatilityColumnName, getVolatilityOutputColumnMap,
  isSpecialized as isVolatilitySpecialized, computeSpecialized as computeVolatilitySpecialized
} from '@/market/lib/volatility/compute';
import {
  buildVolumeColumnName, getVolumeOutputColumnMap,
  isSpecialized as isVolumeSpecialized, computeSpecialized as computeVolumeSpecialized
} from '@/market/lib/volume/compute';
import {
  buildStatisticsColumnName, getStatisticsOutputColumnMap,
  isSpecialized as isStatisticsSpecialized, computeSpecialized as computeStatisticsSpecialized
} from '@/market/lib/statistics/compute';
import {
  buildCycleColumnName, getCycleOutputColumnMap,
  isSpecialized as isCycleSpecialized, computeSpecialized as computeCycleSpecialized
} from '@/market/lib/cycle/compute';
import {
  buildPerformanceColumnName, getPerformanceOutputColumnMap,
  isSpecialized as isPerformanceSpecialized, computeSpecialized as computePerformanceSpecialized
} from '@/market/lib/performance/compute';

export interface ComputedOutput {
  outputKey: string;
  label: string;
  data: { time: number; value: number }[];
  style: 'line' | 'histogram';
}

export interface ComputedIndicator {
  instanceId: string;
  indicatorId: string;
  displayType: 'overlay' | 'subchart';
  outputs: ComputedOutput[];
}

export interface OHLCVBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Build the column name that the existing calculators expect.
 * Dispatches to category-specific logic.
 */
function buildColumnName(indicatorId: string, params: Record<string, number>, category: string): string | string[] {
  switch (category) {
    case 'overlap': return buildOverlapColumnName(indicatorId, params);
    case 'momentum': return buildMomentumColumnName(indicatorId, params);
    case 'trend': return buildTrendColumnName(indicatorId, params);
    case 'volatility': return buildVolatilityColumnName(indicatorId, params);
    case 'volume': return buildVolumeColumnName(indicatorId, params);
    case 'statistics': return buildStatisticsColumnName(indicatorId, params);
    case 'cycle': return buildCycleColumnName(indicatorId, params);
    case 'performance': return buildPerformanceColumnName(indicatorId, params);
    default: return indicatorId.toUpperCase();
  }
}

/**
 * Map indicator output keys to column name patterns.
 * Dispatches to category-specific logic.
 */
function getOutputColumnMap(indicatorId: string, params: Record<string, number>, category: string): Record<string, string> {
  switch (category) {
    case 'overlap': return getOverlapOutputColumnMap(indicatorId, params);
    case 'momentum': return getMomentumOutputColumnMap(indicatorId, params);
    case 'trend': return getTrendOutputColumnMap(indicatorId, params);
    case 'volatility': return getVolatilityOutputColumnMap(indicatorId, params);
    case 'volume': return getVolumeOutputColumnMap(indicatorId, params);
    case 'statistics': return getStatisticsOutputColumnMap(indicatorId, params);
    case 'cycle': return getCycleOutputColumnMap(indicatorId, params);
    case 'performance': return getPerformanceOutputColumnMap(indicatorId, params);
    default: return {};
  }
}

/**
 * Compute a single indicator instance.
 */
export function computeIndicator(
  indicator: ActiveIndicator,
  bars: OHLCVBar[],
): ComputedIndicator | null {
  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def) return null;

  // Use Bar interface expected by calculators
  const calcBars = bars.map(b => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));

  // ── 1. Specialized Direct Calculators (Client-Side implementation) ─────────
  // Dispatch to modularized category compute functions
  
  let specializedResult: ComputedIndicator | null = null;
  
  switch (def.category) {
    case 'overlap':
      if (isOverlapSpecialized(indicator.indicatorId)) {
        specializedResult = computeOverlapSpecialized(indicator, calcBars);
      }
      break;
    case 'momentum':
      if (isMomentumSpecialized(indicator.indicatorId)) {
        specializedResult = computeMomentumSpecialized(indicator, calcBars);
      }
      break;
    case 'trend':
      if (isTrendSpecialized(indicator.indicatorId)) {
        specializedResult = computeTrendSpecialized(indicator, calcBars);
      }
      break;
    case 'volatility':
      if (isVolatilitySpecialized(indicator.indicatorId)) {
        specializedResult = computeVolatilitySpecialized(indicator, calcBars);
      }
      break;
    case 'volume':
      if (isVolumeSpecialized(indicator.indicatorId)) {
        specializedResult = computeVolumeSpecialized(indicator, calcBars);
      }
      break;
    case 'statistics':
      if (isStatisticsSpecialized(indicator.indicatorId)) {
        specializedResult = computeStatisticsSpecialized(indicator, calcBars);
      }
      break;
    case 'cycle':
      if (isCycleSpecialized(indicator.indicatorId)) {
        specializedResult = computeCycleSpecialized(indicator, calcBars);
      }
      break;
    case 'performance':
      if (isPerformanceSpecialized(indicator.indicatorId)) {
        specializedResult = computePerformanceSpecialized(indicator, calcBars);
      }
      break;
  }

  if (specializedResult) return specializedResult;

  // ── 2. Legacy TA-Lib Compute (Backend-Driven) ──────────────────────────────
  // These indicators rely on pre-computed columns from the TA-Lib backend.

  const columns = buildColumnName(indicator.indicatorId, indicator.params, def.category);
  const isMultiOutput = Array.isArray(columns);
  const outputMap = getOutputColumnMap(indicator.indicatorId, indicator.params, def.category);

  const outputs: ComputedOutput[] = [];

  if (isMultiOutput) {
    for (const output of def.outputs) {
      const colName = outputMap[output.key];
      if (!colName) continue;

      let data: { time: number; value: number }[] | null = null;
      if (def.renderType === 'overlay') {
        data = computeOverlay(colName, bars);
      } else {
        data = computeSubchart(colName, bars);
      }

      if (data && data.length > 0) {
        outputs.push({
          outputKey: output.key,
          label: output.label,
          data,
          style: output.style,
        });
      }
    }
  } else {
    let data: OverlayPoint[] | IndicatorPoint[] | null = null;
    if (def.renderType === 'overlay') {
      data = computeOverlay(columns as string, bars);
    } else {
      data = computeSubchart(columns as string, bars);
    }

    if (data && data.length > 0) {
      outputs.push({
        outputKey: def.outputs[0]?.key ?? 'value',
        label: def.outputs[0]?.label ?? def.name,
        data,
        style: def.outputs[0]?.style ?? 'line',
      });
    }
  }

  if (outputs.length === 0) return null;

  return {
    instanceId: indicator.instanceId,
    indicatorId: indicator.indicatorId,
    displayType: def.renderType,
    outputs,
  };
}

/**
 * Compute all active indicators against OHLCV bars.
 */
export function computeAllIndicators(
  indicators: ActiveIndicator[],
  bars: OHLCVBar[],
): ComputedIndicator[] {
  const results: ComputedIndicator[] = [];
  for (const ind of indicators) {
    if (!ind.visible) continue;
    const computed = computeIndicator(ind, bars);
    if (computed) results.push(computed);
  }
  return results;
}
