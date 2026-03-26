/**
 * SQL Label Generators - barrel export and registry
 */

export type { LabelGeneratorConfig } from './helpers';
export { DEFAULT_CONFIG, partitionClause, orderClause, windowOver, rowsBetween, minutesToSampleBy, wrapWithSampleBy } from './helpers';

export type { DirectionParams } from './direction';
export type { TripleBarrierParams } from './tripleBarrier';
export type { NPMMParams } from './npmm';
export type { VolatilityAdaptiveParams } from './volatilityAdaptive';
export type { TrendScanningParams } from './trendScanning';
export type { MetaLabelParams } from './metaLabel';

export { generateDirectionLabelsSQL } from './direction';
export { generateTripleBarrierLabelsSQL } from './tripleBarrier';
export { generateNPMMLabelsSQL } from './npmm';
export { generateVolatilityAdaptiveLabelsSQL } from './volatilityAdaptive';
export { generateTrendScanningLabelsSQL } from './trendScanning';
export { generateMetaLabelsSQL } from './metaLabel';

export type { FutureReturnParams } from './futureReturn';
export type { FutureVolatilityParams } from './futureVolatility';
export type { MarketRegimeParams } from './marketRegime';
export type { SignalParams } from './signal';
export type { MultiStepParams } from './multiStep';

export { generateFutureReturnLabelsSQL } from './futureReturn';
export { generateFutureVolatilityLabelsSQL } from './futureVolatility';
export { generateMarketRegimeLabelsSQL } from './marketRegime';
export { generateSignalLabelsSQL } from './signal';
export { generateMultiStepLabelsSQL } from './multiStep';

export type { PseudoConfidenceParams, ConsistencyPerturbationParams } from './semiSupervisedGenerators';
export {
  generatePseudoConfidenceLabelsSQL,
  generateConsistencyPerturbationLabelsSQL,
} from './semiSupervisedGenerators';

// Import functions for building registry
import { generateDirectionLabelsSQL } from './direction';
import { generateTripleBarrierLabelsSQL } from './tripleBarrier';
import { generateNPMMLabelsSQL } from './npmm';
import { generateVolatilityAdaptiveLabelsSQL } from './volatilityAdaptive';
import { generateTrendScanningLabelsSQL } from './trendScanning';
import { generateMetaLabelsSQL } from './metaLabel';
import { generateFutureReturnLabelsSQL } from './futureReturn';
import { generateFutureVolatilityLabelsSQL } from './futureVolatility';
import { generateMarketRegimeLabelsSQL } from './marketRegime';
import { generateSignalLabelsSQL } from './signal';
import { generateMultiStepLabelsSQL } from './multiStep';
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
