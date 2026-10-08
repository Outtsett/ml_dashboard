/**
 * Feature Over-Indication & Multicollinearity Diagnostic Hook
 *
 * In quantitative machine learning and feature engineering, indicator saturation
 * occurs when an excessive number of collinear technical features are layered
 * onto price data. Stacking redundant features (e.g., 3 Momentum oscillators or
 * multiple moving averages) inflates dimensionality without providing incremental
 * alpha, causing severe multicollinearity, increased variance, and degraded
 * out-of-sample model generalization.
 *
 * This hook analyzes the active indicator feature set in real time to calculate:
 * 1. Category Clustering & Saturation Index (0 - 100%)
 * 2. Effective Orthogonal Degrees of Freedom
 * 3. Specific Multicollinearity & Redundancy Warnings
 */

import { useMemo } from 'react';
import type { ActiveIndicator } from './useActiveIndicators';
import { getIndicatorDefinition, type IndicatorCategory } from './indicator_registry';

export type SaturationLevel = 'balanced' | 'moderate' | 'over-indicated';

export interface CategoryBreakdown {
  category: IndicatorCategory;
  label: string;
  count: number;
  indicatorNames: string[];
}

export interface FeatureOverIndicationResult {
  /** Total active indicator features */
  totalCount: number;
  /** Categorical distribution breakdown */
  categories: CategoryBreakdown[];
  /** Quantitative saturation score from 0 (parsimonious) to 100 (heavily over-indicated) */
  saturationScore: number;
  /** Qualitative feature health tier */
  saturationLevel: SaturationLevel;
  /** Estimated effective orthogonal feature dimensions */
  effectiveDegreesOfFreedom: number;
  /** Category-specific collinearity warnings */
  redundancyAlerts: string[];
  /** Actionable feature engineering recommendations */
  recommendations: string[];
  /** Is the feature set flagged as over-indicated? */
  isOverIndicated: boolean;
}

const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  overlap: 'Price Overlap / Trend',
  trend: 'Trend Strength',
  momentum: 'Momentum / Velocity',
  volatility: 'Volatility Bands',
  volume: 'Volume / Flow',
  statistics: 'Statistical Moments',
  cycle: 'Spectral / Cycle',
  performance: 'Performance / Return',
};

export function calculateFeatureOverIndication(
  activeIndicators: ActiveIndicator[],
): FeatureOverIndicationResult {
  const visibleIndicators = activeIndicators.filter((ind) => ind.visible);
  const totalCount = visibleIndicators.length;

  // Group active indicators by functional quantitative category
  const catMap = new Map<IndicatorCategory, string[]>();
  for (const ind of visibleIndicators) {
    const def = getIndicatorDefinition(ind.indicatorId);
    const cat = def?.category ?? 'trend';
    const name = def?.fullName || def?.name || ind.indicatorId;
    const list = catMap.get(cat) ?? [];
    list.push(name);
    catMap.set(cat, list);
  }

  const categories: CategoryBreakdown[] = Array.from(catMap.entries()).map(
    ([cat, names]) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] || cat,
      count: names.length,
      indicatorNames: names,
    }),
  ).sort((a, b) => b.count - a.count);

  if (totalCount === 0) {
    return {
      totalCount: 0,
      categories: [],
      saturationScore: 0,
      saturationLevel: 'balanced',
      effectiveDegreesOfFreedom: 0,
      redundancyAlerts: [],
      recommendations: [
        'No indicators active. Add 1-3 orthogonal features (e.g. 1 Trend, 1 Momentum, 1 Volatility) to begin feature analysis.',
      ],
      isOverIndicated: false,
    };
  }

  // ── Compute Clustering Penalty & Effective Degrees of Freedom ──
  let clusteringPenalty = 0;
  let effectiveDegreesOfFreedom = 0;
  const redundancyAlerts: string[] = [];
  const recommendations: string[] = [];

  for (const cat of categories) {
    effectiveDegreesOfFreedom += Math.sqrt(cat.count);

    if (cat.count > 1) {
      // Non-linear penalty for feature clustering inside the same category
      const excess = cat.count - 1;
      clusteringPenalty += Math.pow(excess, 1.4);

      if (cat.count >= 3) {
        redundancyAlerts.push(
          `Severe ${cat.label} redundancy: ${cat.count} features active (${cat.indicatorNames.join(', ')}). High multicollinearity risks model degradation.`,
        );
        recommendations.push(
          `Prune ${cat.count - 1} indicators from "${cat.label}" to avoid redundant signals.`,
        );
      } else if (cat.count === 2) {
        redundancyAlerts.push(
          `Moderate ${cat.label} overlap: 2 features active (${cat.indicatorNames.join(', ')}).`,
        );
      }
    }
  }

  // Indicator Saturation Index calculation
  // Base load: 35 points for up to 5 indicators (7 pts per indicator)
  // Clustering penalty: +18 points per clustering penalty unit
  const baseLoad = Math.min(45, (totalCount / 6) * 45);
  const clusterLoad = Math.min(55, clusteringPenalty * 18);
  const saturationScore = Math.min(100, Math.round(baseLoad + clusterLoad));

  let saturationLevel: SaturationLevel = 'balanced';
  if (saturationScore >= 66 || totalCount >= 6 || clusteringPenalty >= 3.0) {
    saturationLevel = 'over-indicated';
  } else if (saturationScore >= 35 || totalCount >= 4 || clusteringPenalty >= 1.0) {
    saturationLevel = 'moderate';
  }

  const isOverIndicated = saturationLevel === 'over-indicated';

  if (totalCount > 6 && !recommendations.some(r => r.includes('overall feature count'))) {
    recommendations.unshift(
      `High feature density (${totalCount} active). Consider reducing total indicators to 3-5 to prevent over-fitting.`,
    );
  }

  if (categories.length === 1 && totalCount >= 2) {
    recommendations.push(
      'Monoculture feature set: all active indicators are in a single category. Diversify across orthogonal domains (e.g., Volatility or Volume).',
    );
  }

  return {
    totalCount,
    categories,
    saturationScore,
    saturationLevel,
    effectiveDegreesOfFreedom: Math.round(effectiveDegreesOfFreedom * 10) / 10,
    redundancyAlerts,
    recommendations,
    isOverIndicated,
  };
}

export function useFeatureOverIndication(
  activeIndicators: ActiveIndicator[],
): FeatureOverIndicationResult {
  return useMemo(() => calculateFeatureOverIndication(activeIndicators), [activeIndicators]);
}

