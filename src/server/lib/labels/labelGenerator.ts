/**
 * Label Generator — creates and persists label sets from SQL generators.
 *
 * Handles both standard supervised labels and contrastive pair generation.
 */

import { db } from '../../database/db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  LABEL_SQL_GENERATORS,
  type LabelGeneratorType,
  type LabelGeneratorConfig,
} from './sqlLabelGenerators';
import {
  CONTRASTIVE_SQL_GENERATORS,
  type ContrastiveGeneratorType,
  type ContrastivePairConfig,
  type ContrastiveWindow,
  type AugmentationPairParams,
  type TemporalPairParams,
  type StatisticalPairParams,
  generateContrastivePairsFromSQL,
  generateAugmentationPairs,
} from './contrastivePairs';
import { queryLabels, buildMetaLabelSQL } from './labelHelpers';
import type { MetaLabelParams } from './sqlLabelGenerators';

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
      if (isContrastiveGenerator(request.generatorType)) {
        return await generateContrastiveLabels(labelSetId, request, startTime);
      }

      // For meta_label, build combined SQL with direction labels as CTE
      let labelSQL: string | null;
      if (request.generatorType === 'meta_label') {
        labelSQL = buildMetaLabelSQL(
          request.params as unknown as MetaLabelParams,
          request.symbol,
        );
      } else {
        labelSQL = generateLabelSQL(
          request.generatorType as LabelGeneratorType,
          request.params,
          { symbol: request.symbol }
        );
      }

      if (!labelSQL) {
        throw new Error(`Unknown generator type: ${request.generatorType}`);
      }

      const results = await queryLabels(labelSQL);

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
  } else if (genType === 'contrastive_augmentation') {
    // Augmentation-based contrastive learning uses in-memory data augmentation,
    // not SQL pair generation. Fetch OHLCV windows, apply augmentations in JS.
    const windowSize = (request.params.windowSize as number) || 60;
    const fetchSQL = `
      SELECT close
      FROM ohlcv
      WHERE symbol = '${request.symbol}'
      ORDER BY timestamp
      LIMIT ${windowSize * 200}
    `;
    const rawRows = await queryLabels(fetchSQL);
    const closes = rawRows.map(r => Number(r.close)).filter(v => !isNaN(v));

    // Build sliding windows
    const windows: ContrastiveWindow[] = [];
    for (let i = 0; i <= closes.length - windowSize; i += Math.max(1, Math.floor(windowSize / 2))) {
      windows.push({ startIdx: i, endIdx: i + windowSize - 1, data: closes.slice(i, i + windowSize) });
    }

    if (windows.length < 2) {
      await db.update(generatedLabels)
        .set({ status: 'completed', sampleCount: 0, generationTimeMs: Date.now() - startTime, updatedAt: new Date() })
        .where(eq(generatedLabels.id, labelSetId));
      return { success: true, labelSetId, sampleCount: 0, preview: [], generationTimeMs: Date.now() - startTime };
    }

    const augResult = generateAugmentationPairs(windows, {
      jitterScale: (request.params.jitterScale as number) || 0.01,
      scalingRange: (request.params.scalingRange as [number, number]) || [0.8, 1.2],
      cropRatio: (request.params.cropRatio as number) || 0.8,
    }, (request.params.samplesPerAnchor as number) || 4);

    // Store as contrastive pairs (anchorIdx=window start, negativeIdx=negative window start)
    if (augResult.pairs.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < augResult.pairs.length; i += batchSize) {
        const batch = augResult.pairs.slice(i, i + batchSize);
        await db.insert(contrastivePairs).values(
          batch.map(p => ({
            labelSetId,
            anchorIdx: p.anchor.startIdx,
            positiveIdx: p.anchor.startIdx, // positive is augmented version of anchor
            negativeIdx: p.negativeIdx,
            pairType: 'augmentation',
          }))
        );
      }
    }

    await db.update(generatedLabels)
      .set({
        status: 'completed',
        sampleCount: augResult.pairs.length,
        labelDistribution: JSON.stringify(augResult.stats),
        generationTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(generatedLabels.id, labelSetId));

    return {
      success: true,
      labelSetId,
      sampleCount: augResult.pairs.length,
      labelDistribution: augResult.stats as unknown as Record<string, number>,
      preview: augResult.pairs.slice(0, 100).map(p => ({
        anchor_start: p.anchor.startIdx,
        augmentation: p.positive.augmentationType,
        negative_start: p.negativeIdx,
      })),
      generationTimeMs: Date.now() - startTime,
    };
  } else {
    throw new Error(`Unknown contrastive generator: ${genType}`);
  }

  const results = await queryLabels(sql);

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
  // Special case: meta_label needs a primary labels CTE reference
  if (generatorType === 'meta_label') {
    return LABEL_SQL_GENERATORS.meta_label(
      {
        ...(params as unknown as MetaLabelParams),
        primarySignalColumn: (params as unknown as MetaLabelParams).primarySignalColumn || 'label',
      },
      config,
      (params as { primaryLabelsTable?: string }).primaryLabelsTable || 'primary_labels'
    );
  }

  // OCP: dispatch via registry — adding a new generator = add entry to LABEL_SQL_GENERATORS
  const generator = LABEL_SQL_GENERATORS[generatorType];
  if (!generator) return null;

  return (generator as (p: unknown, c: LabelGeneratorConfig) => string)(params, config);
}

// ─── Generator Category Map (OCP: add new generator = add entry here) ────────

const GENERATOR_CATEGORIES: Record<string, string> = {
  direction: 'classification',
  triple_barrier: 'classification',
  npmm: 'classification',
  volatility_adaptive: 'classification',
  trend_scanning: 'classification',
  meta_label: 'classification',
  signal: 'classification',
  regime: 'classification',
  pseudo_confidence: 'semi-supervised',
  consistency_perturbation: 'semi-supervised',
  future_return: 'regression',
  future_volatility: 'regression',
  multi_step: 'sequence',
  contrastive_temporal: 'contrastive',
  contrastive_augmentation: 'contrastive',
  contrastive_statistical: 'contrastive',
};

export function getCategoryForGenerator(generatorType: string): string {
  return GENERATOR_CATEGORIES[generatorType] ?? 'classification';
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
