/**
 * SQL Label Generators - barrel export and registry
 */

export type { LabelGeneratorConfig } from './helpers';
export { DEFAULT_CONFIG, partitionClause, orderClause, windowOver, rowsBetween, minutesToSampleBy, minutesToInterval, wrapWithSampleBy } from './helpers';

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

export type { NextCloseDirectionParams } from './nextCloseDirection';
export type { RangeBucketParams } from './rangeBucket';
export type { StructuralParams } from './structural';
export type { TalibCandlePatternParams } from './talibCandlePattern';

export { generateNextCloseDirectionLabelsSQL } from './nextCloseDirection';
export { generateRangeBucketLabelsSQL } from './rangeBucket';
export { generateStructuralLabelsSQL } from './structural';
export { generateTalibCandlePatternLabelsSQL, TALIB_PATTERN_TABLE, timeframeLabel } from './talibCandlePattern';

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
import { generateNextCloseDirectionLabelsSQL } from './nextCloseDirection';
import { generateRangeBucketLabelsSQL } from './rangeBucket';
import { generateStructuralLabelsSQL } from './structural';
import { generateTalibCandlePatternLabelsSQL } from './talibCandlePattern';
import type { LabelGeneratorConfig } from './helpers';


/**
 * One generator id per pattern, all binding the same SQL builder.
 *
 * The overlay resolves generator params from their declared DEFAULTS -- there is
 * no per-param editor in the label selector (`useLabelOverlay.ts`) -- so a single
 * `talib_candle_pattern` entry with a `pattern` dropdown would always resolve to
 * its default and no individual pattern would ever be selectable. Giving each
 * pattern its own id makes the selector itself the picker, with no new UI.
 */
const TALIB_PATTERN_IDS = [
  'engulfing',
  'harami',
  'haramicross',
  'hikkake',
  'belthold',
  'marubozu',
  '3outside',
  '3inside',
  'hammer',
  'invertedhammer',
  'hangingman',
  'shootingstar',
  'morningstar',
  'eveningstar',
  'advanceblock',
  'darkcloudcover',
] as const;

const talibPatternGenerators = Object.fromEntries(
  TALIB_PATTERN_IDS.map(name => [
    `talib_${name}`,
    (params: Record<string, unknown>, config: LabelGeneratorConfig) =>
      generateTalibCandlePatternLabelsSQL({ ...params, pattern: name }, config),
  ]),
) as Record<string, (params: never, config: LabelGeneratorConfig) => string>;

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
  next_close_direction: generateNextCloseDirectionLabelsSQL,
  range_bucket: generateRangeBucketLabelsSQL,
  structural: generateStructuralLabelsSQL,
  talib_candle_pattern: generateTalibCandlePatternLabelsSQL,
  ...talibPatternGenerators,
} as const;

export type LabelGeneratorType = keyof typeof LABEL_SQL_GENERATORS;
