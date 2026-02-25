/**
 * Label Service Core
 *
 * Main label generation, preview, and management logic.
 * Contrastive pair generation is included here as it's tightly coupled
 * with the main generation flow.
 */

import { db } from '../../db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
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

// ============================================================================
// TYPES
// ============================================================================

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

export interface LabelPreviewRequest {
  generatorType: LabelGeneratorType;
  symbol: string;
  params: Record<string, unknown>;
  limit?: number;
  startTimestamp?: number; // Optional: filter data to this range
  endTimestamp?: number;   // Optional: for matching visible chart data
  timeframeMinutes?: number; // Optional: aggregate to chart timeframe (default 1)
}

// ============================================================================
// LABEL GENERATION
// ============================================================================

export async function generateLabels(
  request: LabelGenerationRequest
): Promise<LabelGenerationResult> {
  const startTime = Date.now();

  try {
    // Create pending record
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
      // Load OHLCV data into DuckDB first
      await loadOHLCVIntoDuckDB({ symbol: request.symbol, limit: 100000 });

      // Check if this is a contrastive generator
      if (isContrastiveGenerator(request.generatorType)) {
        return await generateContrastiveLabels(labelSetId, request, startTime);
      }

      // Generate SQL and execute on DuckDB
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

      // Calculate label distribution
      const labelDistribution = calculateLabelDistribution(results);

      // Get timestamp range
      const timestamps = results
        .map((r: Record<string, unknown>) => r.timestamp)
        .filter((t: unknown): t is number => typeof t === 'number');
      const dataStartTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
      const dataEndTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;

      // Update record with results
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
      // Update record with error
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

// ============================================================================
// CONTRASTIVE LABEL GENERATION
// ============================================================================

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
      false // single-asset mode
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

  // Store pairs in database (batch insert)
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

// ============================================================================
// PREVIEW (without storing)
// ============================================================================

export async function previewLabels(
  request: LabelPreviewRequest
): Promise<{ success: boolean; preview?: Array<Record<string, unknown>>; count?: number; error?: string; generatorType?: string }> {
  try {
    // Handle contrastive generators — they produce pair indices, not per-bar labels.
    // Fall back to direction labels for chart preview.
    const isContrastive = ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(request.generatorType);
    if (isContrastive) {
      return {
        success: true,
        preview: [],
        count: 0,
        generatorType: request.generatorType,
        error: 'Contrastive generators produce sample pairs, not per-bar labels. Use the full generation flow to create contrastive pairs.',
      };
    }

    // Load OHLCV data into DuckDB first
    await loadOHLCVIntoDuckDB({
      symbol: request.symbol,
      limit: 10000,
      startTimestamp: request.startTimestamp,
      endTimestamp: request.endTimestamp,
      timeframeMinutes: request.timeframeMinutes,
    });

    // For meta_label: generate primary direction labels first so the JOIN has data
    if (request.generatorType === 'meta_label') {
      const directionSQL = LABEL_SQL_GENERATORS.direction(
        { horizon: 1, threshold: 0, numClasses: 2 },
        { symbol: request.symbol }
      );
      try {
        await queryDuckDB('DROP TABLE IF EXISTS primary_labels');
        await queryDuckDB(`CREATE TABLE primary_labels AS ${directionSQL}`);
      } catch (e) {
        console.warn('[LabelService] Failed to generate primary labels for meta_label preview:', e);
      }
    }

    const labelSQL = generateLabelSQL(
      request.generatorType,
      request.params,
      { symbol: request.symbol }
    );

    if (!labelSQL) {
      return { success: false, error: `Unknown generator type: ${request.generatorType}` };
    }

    // Add ORDER BY DESC and LIMIT for preview to match chart's most recent data view
    const limit = request.limit || 500;
    const limitedSQL = `
      WITH label_data AS (${labelSQL})
      SELECT * FROM label_data
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    const results = await queryDuckDB(limitedSQL);

    // Sort results ascending for proper chart marker order (oldest to newest)
    const sortedResults = (results || []).sort((a: any, b: any) =>
      Number(a.timestamp) - Number(b.timestamp)
    );

    // Post-process: normalize labels for chart rendering
    const normalizedResults = normalizeLabelsForPreview(request.generatorType, sortedResults);

    return {
      success: true,
      preview: normalizedResults,
      count: normalizedResults.length,
      generatorType: request.generatorType,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// LABEL SET MANAGEMENT
// ============================================================================

export async function getLabelSets(filters?: {
  symbol?: string;
  generatorType?: string;
  modelId?: number;
  status?: string;
  limit?: number;
}) {
  let query = db.select().from(generatedLabels).orderBy(desc(generatedLabels.createdAt));

  // Note: For proper filtering, we'd need to build conditions dynamically
  // This is a simplified version
  const results = await query.limit(filters?.limit || 50);

  return results.filter(r => {
    if (filters?.symbol && r.symbol !== filters.symbol) return false;
    if (filters?.generatorType && r.generatorType !== filters.generatorType) return false;
    if (filters?.modelId && r.modelId !== filters.modelId) return false;
    if (filters?.status && r.status !== filters.status) return false;
    return true;
  });
}

export async function getLabelSetById(id: number) {
  const results = await db.select().from(generatedLabels).where(eq(generatedLabels.id, id));
  return results[0] || null;
}

export async function getContrastivePairsForLabelSet(labelSetId: number, limit: number = 1000) {
  return db.select()
    .from(contrastivePairs)
    .where(eq(contrastivePairs.labelSetId, labelSetId))
    .limit(limit);
}

export async function deleteLabelSet(id: number) {
  await db.delete(generatedLabels).where(eq(generatedLabels.id, id));
  return { success: true };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function generateLabelSQL(
  generatorType: LabelGeneratorType,
  params: Record<string, unknown>,
  config: LabelGeneratorConfig
): string | null {
  switch (generatorType) {
    case 'direction':
      return LABEL_SQL_GENERATORS.direction(
        params as unknown as DirectionParams,
        config
      );
    case 'triple_barrier':
      return LABEL_SQL_GENERATORS.triple_barrier(
        params as unknown as TripleBarrierParams,
        config
      );
    case 'npmm':
      return LABEL_SQL_GENERATORS.npmm(
        params as unknown as NPMMParams,
        config
      );
    case 'volatility_adaptive':
      return LABEL_SQL_GENERATORS.volatility_adaptive(
        params as unknown as VolatilityAdaptiveParams,
        config
      );
    case 'trend_scanning':
      return LABEL_SQL_GENERATORS.trend_scanning(
        params as unknown as TrendScanningParams,
        config
      );
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
      return LABEL_SQL_GENERATORS.future_return(
        params as unknown as FutureReturnParams,
        config
      );
    case 'future_volatility':
      return LABEL_SQL_GENERATORS.future_volatility(
        params as unknown as FutureVolatilityParams,
        config
      );
    case 'regime':
      return LABEL_SQL_GENERATORS.regime(
        params as unknown as MarketRegimeParams,
        config
      );
    case 'signal':
      return LABEL_SQL_GENERATORS.signal(
        params as unknown as SignalParams,
        config
      );
    case 'multi_step':
      return LABEL_SQL_GENERATORS.multi_step(
        params as unknown as MultiStepParams,
        config
      );
    case 'pseudo_confidence':
      return LABEL_SQL_GENERATORS.pseudo_confidence(
        params as unknown as PseudoConfidenceParams,
        config
      );
    case 'consistency_perturbation':
      return LABEL_SQL_GENERATORS.consistency_perturbation(
        params as unknown as ConsistencyPerturbationParams,
        config
      );
    default:
      return null;
  }
}

function getCategoryForGenerator(generatorType: string): string {
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

  return 'classification'; // default
}

function isContrastiveGenerator(generatorType: string): boolean {
  return ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(generatorType);
}

function calculateLabelDistribution(results: Array<Record<string, unknown>>): Record<string, number> {
  const distribution: Record<string, number> = {};

  for (const row of results) {
    const label = row.label;
    if (label === undefined || label === null) continue;
    const labelStr = String(label);
    distribution[labelStr] = (distribution[labelStr] || 0) + 1;
  }

  return distribution;
}

/**
 * Normalize label values for chart rendering.
 * All generators should output { timestamp, close, label } where label is -1, 0, or 1.
 * Generators that produce other values are mapped to this standard.
 */
function normalizeLabelsForPreview(
  generatorType: string,
  results: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!results || results.length === 0) return results;

  const regressionGenerators = ['future_return', 'future_volatility'];
  const multiClassGenerators = ['regime'];

  if (regressionGenerators.includes(generatorType)) {
    // Convert continuous regression targets to classification labels for chart
    if (generatorType === 'future_volatility') {
      // Volatility is always positive — bin into high(1) / medium(0) / low(-1)
      // using percentile-based thresholds from the data
      const values = results
        .map(r => Number(r.label))
        .filter(v => !isNaN(v) && v !== null);
      if (values.length === 0) return results;
      values.sort((a, b) => a - b);
      const p33 = values[Math.floor(values.length * 0.33)];
      const p66 = values[Math.floor(values.length * 0.66)];
      return results.map(row => {
        const rawLabel = Number(row.label);
        if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
          return { ...row, label: null };
        }
        let normalizedLabel: number;
        if (rawLabel >= p66!) normalizedLabel = 1;       // High vol
        else if (rawLabel <= p33!) normalizedLabel = -1;  // Low vol
        else normalizedLabel = 0;                        // Medium vol
        return { ...row, label: normalizedLabel, rawLabel };
      });
    }
    // future_return: sign of the return
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      let normalizedLabel: number;
      if (rawLabel > 0) normalizedLabel = 1;
      else if (rawLabel < 0) normalizedLabel = -1;
      else normalizedLabel = 0;
      return { ...row, label: normalizedLabel, rawLabel };
    });
  }

  if (multiClassGenerators.includes(generatorType)) {
    // Regime labels: 0,1,2,3 → map to chart-compatible values
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      const regimeName = row.regime_name as string | undefined;
      let normalizedLabel: number;
      if (regimeName) {
        // Use regime_name for more accurate mapping
        if (regimeName.includes('down') || regimeName === 'bearish') normalizedLabel = -1;
        else if (regimeName.includes('up') || regimeName === 'bullish') normalizedLabel = 1;
        else normalizedLabel = 0; // sideways, low_vol_down etc
      } else {
        // Fallback: map numeric labels
        if (rawLabel === 0) normalizedLabel = -1;
        else if (rawLabel === 1) normalizedLabel = 1;
        else if (rawLabel === 2) normalizedLabel = -1;
        else normalizedLabel = 1;
      }
      return { ...row, label: normalizedLabel, rawLabel, regimeName };
    });
  }

  // For multi_step: label is already 0 or 1, map 0 → -1 (sell) for chart
  if (generatorType === 'multi_step') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  // For pseudo_confidence: filter out null labels (low confidence samples)
  if (generatorType === 'pseudo_confidence') {
    return results.filter(row => row.label !== null && row.label !== undefined);
  }

  // For meta_label: 0→-1 (don't trade), 1→1 (trade) mapping for chart
  if (generatorType === 'meta_label') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  // Default: return as-is (direction, signal, triple_barrier, npmm,
  // volatility_adaptive, trend_scanning, consistency_perturbation already use -1/0/1)
  return results;
}

// ============================================================================
// EXPORT
// ============================================================================

export const labelService = {
  generateLabels,
  previewLabels,
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
};
