/**
 * Label Generator — creates and persists label sets from SQL generators.
 *
 * Handles both standard supervised labels and contrastive pair generation.
 */

import { db } from '../../db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  LABEL_SQL_GENERATORS,
  type LabelGeneratorType,
  type LabelGeneratorConfig,
  type DirectionParams,
  type TripleBarrierParams,
  type NPMMParams,
  type VolatilityAdaptiveParams,
  type TrendScanningParams,
  type MetaLabelParams,
  type FutureReturnParams,
  type FutureVolatilityParams,
  type MarketRegimeParams,
  type SignalParams,
  type MultiStepParams,
  type PseudoConfidenceParams,
  type ConsistencyPerturbationParams,
} from './sqlLabelGenerators';
import {
  CONTRASTIVE_SQL_GENERATORS,
  type ContrastiveGeneratorType,
  type ContrastivePairConfig,
  type TemporalPairParams,
  type StatisticalPairParams,
  generateContrastivePairsFromSQL,
} from './contrastivePairs';
import { queryDuckDB, loadOHLCVIntoDuckDB } from './labelHelpers';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabelGenerationRequest {
  name: string;
  generatorType: LabelGeneratorType | ContrastiveGeneratorType;
  symbol: string;
  modelId?: number;
  params: Record<string, unknown>;
}

export interface LabelGenerationResult {
  success: boolean;
  labelSetId?: number;
  sampleCount?: number;
  labelDistribution?: Record<string, number>;
  preview?: Array<Record<string, unknown>>;
  error?: string;
  generationTimeMs?: number;
}

// ─── Generation ─────────────────────────────────────────────────────────────

export async function generateLabels(
  request: LabelGenerationRequest
): Promise<LabelGenerationResult> {
  const startTime = Date.now();

  try {
    const [labelRecord] = await db.insert(generatedLabels).values({
      name: request.name,
      generatorType: request.generatorType,
      category: getCategoryForGenerator(request.generatorType),
      symbol: request.symbol,
      modelId: request.modelId || null,
      config: JSON.stringify(request.params),
      status: 'generating',
    }).returning();

    const labelSetId = labelRecord!.id;

    try {
      await loadOHLCVIntoDuckDB({ symbol: request.symbol, limit: 100000 });

      if (isContrastiveGenerator(request.generatorType)) {
        return await generateContrastiveLabels(labelSetId, request, startTime);
      }

      const labelSQL = generateLabelSQL(
        request.generatorType as LabelGeneratorType,
        request.params,
        { symbol: request.symbol }
      );

      if (!labelSQL) {
        throw new Error(`Unknown generator type: ${request.generatorType}`);
      }

      const results = await queryDuckDB(labelSQL);

      if (!results || results.length === 0) {
        await db.update(generatedLabels)
          .set({
            status: 'completed',
            sampleCount: 0,
            generationTimeMs: Date.now() - startTime,
            updatedAt: new Date(),
          })
          .where(eq(generatedLabels.id, labelSetId));

        return {
          success: true,
          labelSetId,
          sampleCount: 0,
          labelDistribution: {},
          preview: [],
          generationTimeMs: Date.now() - startTime,
        };
      }

      const labelDistribution = calculateLabelDistribution(results);

      const timestamps = results
        .map((r: Record<string, unknown>) => r.timestamp)
        .filter((t: unknown): t is number => typeof t === 'number');
      const dataStartTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
      const dataEndTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;

      await db.update(generatedLabels)
        .set({
          status: 'completed',
          sampleCount: results.length,
          labelDistribution: JSON.stringify(labelDistribution),
          positiveCount: labelDistribution['1'] || 0,
          negativeCount: labelDistribution['-1'] || 0,
          neutralCount: labelDistribution['0'] || 0,
          dataStartTimestamp,
          dataEndTimestamp,
          generationTimeMs: Date.now() - startTime,
          updatedAt: new Date(),
        })
        .where(eq(generatedLabels.id, labelSetId));

      return {
        success: true,
        labelSetId,
        sampleCount: results.length,
        labelDistribution,
        preview: results.slice(0, 100),
        generationTimeMs: Date.now() - startTime,
      };

    } catch (error) {
      await db.update(generatedLabels)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          generationTimeMs: Date.now() - startTime,
          updatedAt: new Date(),
        })
        .where(eq(generatedLabels.id, labelSetId));

      throw error;
    }

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// ─── Contrastive Generation ─────────────────────────────────────────────────

async function generateContrastiveLabels(
  labelSetId: number,
  request: LabelGenerationRequest,
  startTime: number
): Promise<LabelGenerationResult> {
  const config: ContrastivePairConfig = {
    symbol: request.symbol,
    windowSize: (request.params.windowSize as number) || 60,
  };

  let sql: string;
  const genType = request.generatorType as string;
  if (genType === 'contrastive_temporal') {
    sql = CONTRASTIVE_SQL_GENERATORS.temporal(
      request.params as unknown as TemporalPairParams,
      config
    );
  } else if (genType === 'contrastive_statistical') {
    sql = CONTRASTIVE_SQL_GENERATORS.statistical(
      request.params as unknown as StatisticalPairParams,
      config,
      false
    );
  } else {
    throw new Error(`Unknown contrastive generator: ${genType}`);
  }

  const results = await queryDuckDB(sql);

  if (!results || results.length === 0) {
    await db.update(generatedLabels)
      .set({
        status: 'completed',
        sampleCount: 0,
        generationTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(generatedLabels.id, labelSetId));

    return {
      success: true,
      labelSetId,
      sampleCount: 0,
      preview: [],
      generationTimeMs: Date.now() - startTime,
    };
  }

  const pairResult = generateContrastivePairsFromSQL(results as Array<{
    anchor_idx: number;
    positive_idx: number;
    negative_idx: number;
    pair_type: string;
  }>);

  if (pairResult.pairs.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < pairResult.pairs.length; i += batchSize) {
      const batch = pairResult.pairs.slice(i, i + batchSize);
      await db.insert(contrastivePairs).values(
        batch.map(p => ({
          labelSetId,
          anchorIdx: p.anchorIdx,
          positiveIdx: p.positiveIdx,
          negativeIdx: p.negativeIdx,
          pairType: p.pairType,
        }))
      );
    }
  }

  await db.update(generatedLabels)
    .set({
      status: 'completed',
      sampleCount: pairResult.pairs.length,
      labelDistribution: JSON.stringify(pairResult.stats),
      generationTimeMs: Date.now() - startTime,
      updatedAt: new Date(),
    })
    .where(eq(generatedLabels.id, labelSetId));

  return {
    success: true,
    labelSetId,
    sampleCount: pairResult.pairs.length,
    labelDistribution: pairResult.stats as unknown as Record<string, number>,
    preview: pairResult.pairs.slice(0, 100) as unknown as Array<Record<string, unknown>>,
    generationTimeMs: Date.now() - startTime,
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

export function generateLabelSQL(
  generatorType: LabelGeneratorType,
  params: Record<string, unknown>,
  config: LabelGeneratorConfig
): string | null {
  switch (generatorType) {
    case 'direction':
      return LABEL_SQL_GENERATORS.direction(params as unknown as DirectionParams, config);
    case 'triple_barrier':
      return LABEL_SQL_GENERATORS.triple_barrier(params as unknown as TripleBarrierParams, config);
    case 'npmm':
      return LABEL_SQL_GENERATORS.npmm(params as unknown as NPMMParams, config);
    case 'volatility_adaptive':
      return LABEL_SQL_GENERATORS.volatility_adaptive(params as unknown as VolatilityAdaptiveParams, config);
    case 'trend_scanning':
      return LABEL_SQL_GENERATORS.trend_scanning(params as unknown as TrendScanningParams, config);
    case 'meta_label':
      return LABEL_SQL_GENERATORS.meta_label(
        {
          ...(params as unknown as MetaLabelParams),
          primarySignalColumn: (params as unknown as MetaLabelParams).primarySignalColumn || 'label',
        },
        config,
        (params as { primaryLabelsTable?: string }).primaryLabelsTable || 'primary_labels'
      );
    case 'future_return':
      return LABEL_SQL_GENERATORS.future_return(params as unknown as FutureReturnParams, config);
    case 'future_volatility':
      return LABEL_SQL_GENERATORS.future_volatility(params as unknown as FutureVolatilityParams, config);
    case 'regime':
      return LABEL_SQL_GENERATORS.regime(params as unknown as MarketRegimeParams, config);
    case 'signal':
      return LABEL_SQL_GENERATORS.signal(params as unknown as SignalParams, config);
    case 'multi_step':
      return LABEL_SQL_GENERATORS.multi_step(params as unknown as MultiStepParams, config);
    case 'pseudo_confidence':
      return LABEL_SQL_GENERATORS.pseudo_confidence(params as unknown as PseudoConfidenceParams, config);
    case 'consistency_perturbation':
      return LABEL_SQL_GENERATORS.consistency_perturbation(params as unknown as ConsistencyPerturbationParams, config);
    default:
      return null;
  }
}

export function getCategoryForGenerator(generatorType: string): string {
  const classificationGenerators = ['direction', 'triple_barrier', 'npmm', 'volatility_adaptive', 'trend_scanning', 'meta_label', 'signal', 'regime', 'pseudo_confidence', 'consistency_perturbation'];
  const regressionGenerators = ['future_return', 'future_volatility'];
  const sequenceGenerators = ['multi_step'];
  const contrastiveGenerators = ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'];
  const semiSupervisedGenerators = ['pseudo_confidence', 'consistency_perturbation'];

  if (classificationGenerators.includes(generatorType)) return 'classification';
  if (regressionGenerators.includes(generatorType)) return 'regression';
  if (sequenceGenerators.includes(generatorType)) return 'sequence';
  if (contrastiveGenerators.includes(generatorType)) return 'contrastive';
  if (semiSupervisedGenerators.includes(generatorType)) return 'semi-supervised';

  return 'classification';
}

export function isContrastiveGenerator(generatorType: string): boolean {
  return ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(generatorType);
}

export function calculateLabelDistribution(results: Array<Record<string, unknown>>): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const row of results) {
    const label = row.label;
    if (label === undefined || label === null) continue;
    const labelStr = String(label);
    distribution[labelStr] = (distribution[labelStr] || 0) + 1;
  }
  return distribution;
}
