/**
 * SQL Label Generators - barrel export and registry
 */

export type { LabelGeneratorConfig } from './helpers';
export { DEFAULT_CONFIG, partitionClause, orderClause, windowOver, rowsBetween } from './helpers';

export type { DirectionParams, TripleBarrierParams, NPMMParams, VolatilityAdaptiveParams, TrendScanningParams, MetaLabelParams } from './supervisedGenerators';
export {
  generateDirectionLabelsSQL,
  generateTripleBarrierLabelsSQL,
  generateNPMMLabelsSQL,
  generateVolatilityAdaptiveLabelsSQL,
  generateTrendScanningLabelsSQL,
  generateMetaLabelsSQL,
} from './supervisedGenerators';

export type { FutureReturnParams, FutureVolatilityParams, MarketRegimeParams, SignalParams, MultiStepParams } from './targetGenerators';
export {
  generateFutureReturnLabelsSQL,
  generateFutureVolatilityLabelsSQL,
  generateMarketRegimeLabelsSQL,
  generateSignalLabelsSQL,
  generateMultiStepLabelsSQL,
} from './targetGenerators';

export type { PseudoConfidenceParams, ConsistencyPerturbationParams } from './semiSupervisedGenerators';
export {
  generatePseudoConfidenceLabelsSQL,
  generateConsistencyPerturbationLabelsSQL,
} from './semiSupervisedGenerators';

// Import functions for building registry
import {
  generateDirectionLabelsSQL,
  generateTripleBarrierLabelsSQL,
  generateNPMMLabelsSQL,
  generateVolatilityAdaptiveLabelsSQL,
  generateTrendScanningLabelsSQL,
  generateMetaLabelsSQL,
} from './supervisedGenerators';
import {
  generateFutureReturnLabelsSQL,
  generateFutureVolatilityLabelsSQL,
  generateMarketRegimeLabelsSQL,
  generateSignalLabelsSQL,
  generateMultiStepLabelsSQL,
} from './targetGenerators';
import {
  generatePseudoConfidenceLabelsSQL,
  generateConsistencyPerturbationLabelsSQL,
} from './semiSupervisedGenerators';

export const LABEL_SQL_GENERATORS = {
  direction: generateDirectionLabelsSQL,
  triple_barrier: generateTripleBarrierLabelsSQL,
  npmm: generateNPMMLabelsSQL,
  volatility_adaptive: generateVolatilityAdaptiveLabelsSQL,
  trend_scanning: generateTrendScanningLabelsSQL,
  meta_label: generateMetaLabelsSQL,
  future_return: generateFutureReturnLabelsSQL,
  future_volatility: generateFutureVolatilityLabelsSQL,
  regime: generateMarketRegimeLabelsSQL,
  signal: generateSignalLabelsSQL,
  multi_step: generateMultiStepLabelsSQL,
  pseudo_confidence: generatePseudoConfidenceLabelsSQL,
  consistency_perturbation: generateConsistencyPerturbationLabelsSQL,
} as const;

export type LabelGeneratorType = keyof typeof LABEL_SQL_GENERATORS;
