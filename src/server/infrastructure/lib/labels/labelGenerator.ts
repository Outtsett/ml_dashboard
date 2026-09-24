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
  wrapWithSampleBy,
  type LabelGeneratorType,
  type LabelGeneratorConfig,
} from './sqlLabelGenerators';
import {
  CONTRASTIVE_SQL_GENERATORS,
  type ContrastiveGeneratorType,
  type ContrastivePairConfig,
  type ContrastiveWindow,
  type TemporalPairParams,
  type StatisticalPairParams,
  generateContrastivePairsFromSQL,
  generateAugmentationPairs,
} from './contrastivePairs';
import { queryLabels, buildMetaLabelSQL } from './labelHelpers';
import type { MetaLabelParams } from './sqlLabelGenerators';
import { resolveLabelSource } from './labelSource';
import { computeTalibLabelRows, isTalibGenerator, talibPatternForGenerator } from './talibLabelRows';
import { persistLabelSet } from './labelSetStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabelGenerationRequest {
  name: string;
  generatorType: LabelGeneratorType | ContrastiveGeneratorType;
  symbol: string;
  modelId?: number;
  params: Record<string, unknown>;
  timeframeMinutes?: number;
  /** Epoch ms. Omitted = the instrument's whole history in the chosen source. */
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface LabelGenerationResult {
  success: boolean;
  labelSetId?: number;
  /** Where the rows landed in the lake, e.g. `s3://derived/recipe=dashboard_label_sets/...`. */
  parquetPath?: string;
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
      // The timeframe and window are part of what this set IS — a 1m label
      // set and a 1d one from the same params are different datasets — so they
      // ride in the config rather than being defaulted away on the way in.
      config: JSON.stringify({
        ...request.params,
        timeframeMinutes: request.timeframeMinutes || 1,
        startTimestamp: request.startTimestamp ?? null,
        endTimestamp: request.endTimestamp ?? null,
      }),
      status: 'generating',
    }).returning();

    const labelSetId = labelRecord!.id;

    try {
      if (isContrastiveGenerator(request.generatorType)) {
        return await generateContrastiveLabels(labelSetId, request, startTime);
      }

      const timeframeMinutes = request.timeframeMinutes || 1;
      const window = { startMs: request.startTimestamp, endMs: request.endTimestamp };

      let results: Array<Record<string, unknown>>;
      let labelSQL: string | null = null;

      if (isTalibGenerator(request.generatorType)) {
        // A calculation, not a query — the TA-Lib worker scores the bars.
        results = await computeTalibLabelRows({
          symbol: request.symbol,
          timeframeMinutes,
          pattern: talibPatternForGenerator(request.generatorType, request.params ?? {}),
          startTimestamp: request.startTimestamp,
          endTimestamp: request.endTimestamp,
          limit: 2_000_000,
        });
      } else {
        // The SAME source resolution the preview uses. This path used to fall
        // back to `ohlcv WHERE symbol = 'MNQ'`, so what was previewed (the
        // front-month stitch) and what was saved (the pre-stitched continuous
        // series) were different bar series for the same request.
        const source = await resolveLabelSource(request.symbol, timeframeMinutes, window);
        const cfg = {
          symbol: request.symbol, tableName: source.tableName, timeframeMinutes,
          sourceFrom: source.from, sourcePredicate: source.predicate,
        };
        if (request.generatorType === 'meta_label') {
          const rawSQL = buildMetaLabelSQL(
            request.params as unknown as MetaLabelParams,
            request.symbol,
            source.tableName,
          );
          labelSQL = wrapWithSampleBy(rawSQL, cfg);
        } else {
          labelSQL = generateLabelSQL(request.generatorType as LabelGeneratorType, request.params, cfg);
        }
        if (!labelSQL) {
          throw new Error(`Unknown generator type: ${request.generatorType}`);
        }
        labelSQL = boundByWindow(labelSQL, window);
        // A whole-history set is a bigger query than a preview; the deadline is
        // wider but still a deadline, so a runaway set fails the row rather
        // than holding the engine for everyone else.
        results = await queryLabels(labelSQL, 120_000);
      }

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

      // The rows themselves. Until now only these summary columns survived:
      // the full result was sliced to 100 rows for the HTTP response and
      // dropped, so a "generated" label set could not be read back by anything
      // — not the chart, not a notebook, not a training run.
      const { parquetPath, rowCount } = await persistLabelSet({
        labelSetId,
        generatorType: request.generatorType,
        symbol: request.symbol,
        timeframeMinutes,
        params: request.params ?? {},
        window,
        sql: labelSQL,
        rows: labelSQL ? undefined : results,
        distribution: labelDistribution,
        dataStartTimestamp,
        dataEndTimestamp,
      });

      await db.update(generatedLabels)
        .set({
          status: 'completed',
          sampleCount: rowCount,
          labelDistribution: JSON.stringify(labelDistribution),
          positiveCount: labelDistribution['1'] || 0,
          negativeCount: labelDistribution['-1'] || 0,
          neutralCount: labelDistribution['0'] || 0,
          dataStartTimestamp,
          dataEndTimestamp,
          parquetPath,
          generationTimeMs: Date.now() - startTime,
          updatedAt: new Date(),
        })
        .where(eq(generatedLabels.id, labelSetId));

      return {
        success: true,
        labelSetId,
        parquetPath,
        sampleCount: rowCount,
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
    const rawSQL = LABEL_SQL_GENERATORS.meta_label(
      {
        ...(params as unknown as MetaLabelParams),
        primarySignalColumn: (params as unknown as MetaLabelParams).primarySignalColumn || 'label',
      },
      config,
      (params as { primaryLabelsTable?: string }).primaryLabelsTable || 'primary_labels'
    );
    return wrapWithSampleBy(rawSQL, config);
  }

  // OCP: dispatch via registry — adding a new generator = add entry to LABEL_SQL_GENERATORS
  const generator = LABEL_SQL_GENERATORS[generatorType];
  if (!generator) return null;

  const rawSQL = (generator as (p: unknown, c: LabelGeneratorConfig) => string)(params, config);
  return wrapWithSampleBy(rawSQL, config);
}

/**
 * Push the window into every instrument predicate of the generated SQL.
 *
 * Identical to what the preview does, and for the same reason: the window
 * functions (LEAD/LAG/MAX OVER) block predicate pushdown, so an outer WHERE
 * would label all of history first and filter second.
 */
function boundByWindow(sql: string, window: { startMs?: number; endMs?: number }): string {
  const filters: string[] = [];
  if (Number.isFinite(window.startMs)) filters.push(`timestamp >= '${new Date(window.startMs!).toISOString()}'`);
  if (Number.isFinite(window.endMs)) filters.push(`timestamp <= '${new Date(window.endMs!).toISOString()}'`);
  if (filters.length === 0) return sql;
  return sql.replace(/(WHERE\s+(?:\w+\.)?symbol\s*=\s*'[^']*')/gi, `$1 AND ${filters.join(' AND ')}`);
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
  next_close_direction: 'classification',
  range_bucket: 'classification',
  structural: 'classification',
  talib_candle_pattern: 'candle-pattern',
  talib_engulfing: 'candle-pattern',
  talib_harami: 'candle-pattern',
  talib_haramicross: 'candle-pattern',
  talib_hikkake: 'candle-pattern',
  talib_belthold: 'candle-pattern',
  talib_marubozu: 'candle-pattern',
  talib_3outside: 'candle-pattern',
  talib_3inside: 'candle-pattern',
  talib_hammer: 'candle-pattern',
  talib_invertedhammer: 'candle-pattern',
  talib_hangingman: 'candle-pattern',
  talib_shootingstar: 'candle-pattern',
  talib_morningstar: 'candle-pattern',
  talib_eveningstar: 'candle-pattern',
  talib_advanceblock: 'candle-pattern',
  talib_darkcloudcover: 'candle-pattern',
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
