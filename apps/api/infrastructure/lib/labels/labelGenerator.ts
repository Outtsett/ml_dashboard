/**
 * Label Generator — runs a label set through its lifecycle.
 *
 * Think of it as: the foreman. A request comes in; the foreman works out its
 * part number (the recipe), checks whether that crate already exists, and if
 * not opens a ledger row and runs the job — generate the rows, enrich them to
 * the contract, validate, land, catalog — stamping the ledger at every rung.
 *
 * `generateLabels` answers immediately by default (the job continues in the
 * background and the ledger row reports progress); `wait: true` runs the job
 * inline for callers that need the result in the same call (tests, scripts).
 *
 * Contrastive generators produce index pairs, not per-bar labels; they keep
 * writing `contrastive_pairs` in SQLite and never enter the lake.
 */

import { db } from '../../database/db';
import { contrastivePairs } from '@shared/pg_schema';
import { type LabelEncoding } from '@shared/labels/contract';
import { LABEL_SQL_GENERATORS, boundByWindow, wrapWithSampleBy, type LabelGeneratorConfig, type LabelGeneratorType } from './sqlLabelGenerators';
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
import { resolveLabelSource, type LabelSource } from './labelSource';
import { computeTalibLabelRows, isTalibGenerator, talibPatternForGenerator } from './talibLabelRows';
import { landLabelSet } from './labelSetStore';
import { labelRecipe, normalizeLabelParams } from './labelRecipe';
import {
  getLabelSetById,
  getLabelSetByRecipe,
  insertLabelSet,
  updateLabelSet,
  type GeneratedLabelRow,
} from './labelRepository';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabelGenerationRequest {
  name: string;
  generatorType: LabelGeneratorType | ContrastiveGeneratorType | string;
  symbol: string;
  modelId?: number;
  params: Record<string, unknown>;
  timeframeMinutes?: number;
  /** Epoch ms. Omitted = the instrument's whole history in the chosen source. */
  startTimestamp?: number;
  endTimestamp?: number;
  /** Regenerate even when the recipe already has a set. */
  force?: boolean;
}

export interface LabelGenerationResult {
  success: boolean;
  labelSetId?: number;
  recipe?: string;
  /** The ledger's furthest rung at the moment of answering. */
  stage?: string;
  /** True when an existing set answered the request instead of a new job. */
  existing?: boolean;
  /** True when the job was started and is running in the background. */
  accepted?: boolean;
  /** Where the rows landed in the lake, e.g. `s3://derived/labels/recipe=.../table=labels/part-0.parquet`. */
  parquetPath?: string;
  sampleCount?: number;
  labelDistribution?: Record<string, number>;
  validationPassed?: boolean | null;
  preview?: Array<Record<string, unknown>>;
  error?: string;
  generationTimeMs?: number;
}

// ─── Generation ─────────────────────────────────────────────────────────────

const runningJobs = new Map<number, Promise<LabelGenerationResult>>();

/** The job for a set, when one is running in this process. */
export function labelJobFor(labelSetId: number): Promise<LabelGenerationResult> | undefined {
  return runningJobs.get(labelSetId);
}

function summaryOf(row: GeneratedLabelRow, extra: Partial<LabelGenerationResult> = {}): LabelGenerationResult {
  let distribution: Record<string, number> | undefined;
  try {
    distribution = row.labelDistribution ? (JSON.parse(row.labelDistribution) as Record<string, number>) : undefined;
  } catch {
    distribution = undefined;
  }
  let validationPassed: boolean | null = null;
  try {
    validationPassed = row.validation ? Boolean((JSON.parse(row.validation) as { passed?: boolean }).passed) : null;
  } catch {
    validationPassed = null;
  }
  return {
    success: row.status !== 'failed',
    labelSetId: row.id,
    recipe: row.recipe ?? undefined,
    stage: row.stage,
    parquetPath: row.parquetPath ?? undefined,
    sampleCount: row.sampleCount,
    labelDistribution: distribution,
    validationPassed,
    error: row.errorMessage ?? undefined,
    generationTimeMs: row.generationTimeMs ?? undefined,
    ...extra,
  };
}

export async function generateLabels(
  request: LabelGenerationRequest,
  options: { wait?: boolean } = {},
): Promise<LabelGenerationResult> {
  const startTime = Date.now();
  try {
    const timeframeMinutes = Math.max(1, Math.floor(request.timeframeMinutes || 1));
    const params = normalizeLabelParams(request.generatorType, request.params);
    const window = {
      startMs: Number.isFinite(request.startTimestamp) ? request.startTimestamp : undefined,
      endMs: Number.isFinite(request.endTimestamp) ? request.endTimestamp : undefined,
    };
    const identity = labelRecipe({
      generatorType: request.generatorType,
      symbol: request.symbol,
      timeframeMinutes,
      params,
      windowStartTimestamp: window.startMs ?? null,
      windowEndTimestamp: window.endMs ?? null,
    });

    // Idempotency: the same recipe is the same set. A landed or running set
    // answers the request; one that failed, or that never landed (a gate
    // failed), is retried in place.
    const existing = await getLabelSetByRecipe(identity.recipe);
    if (existing && !request.force) {
      const job = runningJobs.get(existing.id);
      const landed = Boolean(existing.parquetPath) && existing.landedAt !== null && existing.status === 'completed';
      const contrastiveDone = isContrastiveGenerator(existing.generatorType) && existing.status === 'completed';
      if (job || landed || contrastiveDone) {
        if (job && options.wait) return job;
        return summaryOf(existing, { existing: true, accepted: Boolean(job) });
      }
    }

    const values = {
      name: request.name,
      generatorType: request.generatorType,
      category: getCategoryForGenerator(request.generatorType),
      symbol: request.symbol.toUpperCase(),
      modelId: request.modelId || null,
      // The timeframe and window are part of what this set IS — a 1m label
      // set and a 1d one from the same params are different datasets — so they
      // ride in the config rather than being defaulted away on the way in.
      config: JSON.stringify({
        ...params,
        timeframeMinutes,
        startTimestamp: window.startMs ?? null,
        endTimestamp: window.endMs ?? null,
      }),
      recipe: identity.recipe,
      parametersHash: identity.parametersHash,
      timeframeMinutes,
      stage: 'specified' as const,
      status: 'generating',
      sampleCount: 0,
      labelDistribution: null,
      positiveCount: null,
      negativeCount: null,
      neutralCount: null,
      parquetPath: null,
      validation: null,
      validatedAt: null,
      landedAt: null,
      retiredAt: null,
      staleDetectedAt: null,
      staleReason: null,
      errorMessage: null,
      generationTimeMs: null,
    };

    let labelSetId: number;
    if (existing) {
      await updateLabelSet(existing.id, values);
      labelSetId = existing.id;
    } else {
      labelSetId = (await insertLabelSet(values)).id;
    }

    const job = runLabelJob(labelSetId, {
      request: { ...request, params, timeframeMinutes },
      window,
      startTime,
    }).finally(() => runningJobs.delete(labelSetId));
    runningJobs.set(labelSetId, job);
    // A rejected job is reported through the ledger row; the caller that did
    // not wait must not see an unhandled rejection.
    job.catch(() => undefined);

    if (options.wait) return job;
    return {
      success: true,
      labelSetId,
      recipe: identity.recipe,
      stage: 'specified',
      accepted: true,
      generationTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

// ─── The job ────────────────────────────────────────────────────────────────

interface JobContext {
  request: LabelGenerationRequest & { params: Record<string, unknown>; timeframeMinutes: number };
  window: { startMs?: number; endMs?: number };
  startTime: number;
}

async function runLabelJob(labelSetId: number, context: JobContext): Promise<LabelGenerationResult> {
  const { request, window, startTime } = context;
  try {
    if (isContrastiveGenerator(request.generatorType)) {
      return await generateContrastiveLabels(labelSetId, request, window, startTime);
    }

    const row = await getLabelSetById(labelSetId);
    if (!row) throw new Error(`Label set ${labelSetId} vanished`);

    // The SAME source resolution the preview uses, so what was previewed (the
    // front-month stitch) and what is saved are one bar series.
    const source = await resolveLabelSource(request.symbol, request.timeframeMinutes, window);
    const config: LabelGeneratorConfig = {
      symbol: request.symbol, tableName: source.tableName, timeframeMinutes: request.timeframeMinutes,
      sourceFrom: source.from, sourcePredicate: source.predicate,
    };

    let labelSQL: string | null = null;
    let rows: Array<Record<string, unknown>> | undefined;
    let skipTruncationGate = false;
    if (isTalibGenerator(request.generatorType)) {
      // A calculation, not a query — the TA-Lib worker scores the bars.
      rows = await computeTalibLabelRows({
        symbol: request.symbol,
        timeframeMinutes: request.timeframeMinutes,
        pattern: talibPatternForGenerator(request.generatorType, request.params),
        startTimestamp: window.startMs,
        endTimestamp: window.endMs,
        limit: 2_000_000,
      });
      skipTruncationGate = true;
    } else {
      labelSQL = generateLabelSQL(request.generatorType as LabelGeneratorType, request.params, config);
      if (!labelSQL) throw new Error(`Unknown generator type: ${request.generatorType}`);
      labelSQL = boundByWindow(labelSQL, window);
    }

    const landed = await landLabelSet({
      labelSetId,
      recipe: row.recipe!,
      parametersHash: row.parametersHash!,
      generatorType: request.generatorType,
      labelEncoding: labelEncodingFor(request.generatorType),
      symbol: request.symbol.toUpperCase(),
      timeframeMinutes: request.timeframeMinutes,
      params: request.params,
      window,
      sql: labelSQL,
      rows,
      source,
      config,
      skipTruncationGate,
    });

    const now = new Date();
    const stage = landed.landed ? 'cataloged' : landed.stagedRowCount > 0 ? 'generated' : 'specified';
    await updateLabelSet(labelSetId, {
      status: 'completed',
      stage,
      sampleCount: landed.rowCount,
      labelDistribution: JSON.stringify(landed.labelDistribution),
      positiveCount: landed.labelDistribution['1'] || 0,
      negativeCount: landed.labelDistribution['-1'] || 0,
      neutralCount: landed.labelDistribution['0'] || 0,
      dataStartTimestamp: landed.dataStartTimestamp,
      dataEndTimestamp: landed.dataEndTimestamp,
      parquetPath: landed.parquetPath,
      validation: JSON.stringify(landed.validation),
      validatedAt: now,
      sourceFingerprint: JSON.stringify(landed.sourceFingerprint),
      maxHorizonBars: landed.maxHorizonBars,
      purgeBars: landed.purgeBars,
      embargoBars: landed.embargoBars,
      landedAt: landed.landed ? now : null,
      generationTimeMs: Date.now() - startTime,
      errorMessage: landed.landed ? null : failingGates(landed.validation),
    });

    return {
      success: true,
      labelSetId,
      recipe: row.recipe ?? undefined,
      stage,
      parquetPath: landed.parquetPath,
      sampleCount: landed.rowCount,
      labelDistribution: landed.labelDistribution,
      validationPassed: landed.validation.passed,
      generationTimeMs: Date.now() - startTime,
      error: landed.landed ? undefined : failingGates(landed.validation) ?? undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await updateLabelSet(labelSetId, {
      status: 'failed',
      errorMessage: message,
      generationTimeMs: Date.now() - startTime,
    });
    return { success: false, labelSetId, error: message, generationTimeMs: Date.now() - startTime };
  }
}

function failingGates(validation: { passed: boolean; gates: Record<string, { passed: boolean; detail: string }> }): string | null {
  if (validation.passed) return null;
  const failed = Object.entries(validation.gates).filter(([, gate]) => !gate.passed);
  return `validation failed: ${failed.map(([name, gate]) => `${name} (${gate.detail})`).join('; ')}`;
}

// ─── Contrastive Generation ─────────────────────────────────────────────────

async function generateContrastiveLabels(
  labelSetId: number,
  request: LabelGenerationRequest & { params: Record<string, unknown>; timeframeMinutes: number },
  window: { startMs?: number; endMs?: number },
  startTime: number,
): Promise<LabelGenerationResult> {
  const windowBars = Number(request.params.windowBars ?? request.params.windowSize ?? 60);
  const config: ContrastivePairConfig = { symbol: request.symbol, windowSize: windowBars };

  // Pairs are counted in BARS at the requested timeframe: the SQL is routed
  // through the same sampled-bars CTE as every label generator. It used to
  // read the sub-minute `ohlcv` table directly, so a "60-bar window" was ~3
  // minutes of ticks.
  const source: LabelSource = await resolveLabelSource(request.symbol, request.timeframeMinutes, window);
  const cfg: LabelGeneratorConfig = {
    symbol: request.symbol, tableName: source.tableName, timeframeMinutes: request.timeframeMinutes,
    sourceFrom: source.from, sourcePredicate: source.predicate,
  };
  const throughBars = (sql: string) => boundByWindow(wrapWithSampleBy(sql.replace(/FROM ohlcv\b/g, `FROM ${source.tableName}`), cfg), window);

  let sql: string;
  const genType = request.generatorType as string;
  if (genType === 'contrastive_temporal') {
    const p = request.params;
    sql = CONTRASTIVE_SQL_GENERATORS.temporal(
      {
        positiveRadius: Number(p.positiveRadiusBars ?? p.positiveRadius ?? 5),
        negativeMinGap: Number(p.negativeMinimumGapBars ?? p.negativeMinGap ?? 20),
        samplesPerAnchor: Number(p.samplesPerAnchor ?? 4),
      } as TemporalPairParams,
      config,
    );
  } else if (genType === 'contrastive_statistical') {
    const p = request.params;
    sql = CONTRASTIVE_SQL_GENERATORS.statistical(
      {
        numRollingWindows: Number(p.rollingWindowCount ?? p.numRollingWindows ?? 20),
        alphaLevel: Number(p.alphaLevel ?? 0.05),
        correlationThreshold: Number(p.correlationThreshold ?? 0.7),
      } as StatisticalPairParams,
      config,
      false,
    );
  } else if (genType === 'contrastive_augmentation') {
    // Augmentation-based contrastive learning uses in-memory data augmentation,
    // not SQL pair generation. Fetch bar windows, apply augmentations in JS.
    const fetchSQL = throughBars(`
      SELECT close
      FROM ohlcv
      WHERE symbol = '${request.symbol}'
      ORDER BY timestamp
      LIMIT ${windowBars * 200}
    `);
    const rawRows = await queryLabels(fetchSQL);
    const closes = rawRows.map(r => Number(r.close)).filter(v => !isNaN(v));

    const windows: ContrastiveWindow[] = [];
    for (let i = 0; i <= closes.length - windowBars; i += Math.max(1, Math.floor(windowBars / 2))) {
      windows.push({ startIdx: i, endIdx: i + windowBars - 1, data: closes.slice(i, i + windowBars) });
    }

    if (windows.length < 2) {
      await updateLabelSet(labelSetId, { status: 'completed', stage: 'generated', sampleCount: 0, generationTimeMs: Date.now() - startTime });
      return { success: true, labelSetId, sampleCount: 0, preview: [], generationTimeMs: Date.now() - startTime };
    }

    const augResult = generateAugmentationPairs(windows, {
      jitterScale: Number(request.params.jitterScale ?? 0.01),
      scalingRange: (request.params.scalingRange as [number, number]) || [0.8, 1.2],
      cropRatio: Number(request.params.cropRatio ?? 0.8),
    }, Number(request.params.samplesPerAnchor ?? 4));

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

    await updateLabelSet(labelSetId, {
      status: 'completed',
      stage: 'generated',
      sampleCount: augResult.pairs.length,
      labelDistribution: JSON.stringify(augResult.stats),
      generationTimeMs: Date.now() - startTime,
    });

    return {
      success: true,
      labelSetId,
      stage: 'generated',
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

  const results = await queryLabels(throughBars(sql), 300_000);

  if (!results || results.length === 0) {
    await updateLabelSet(labelSetId, { status: 'completed', stage: 'generated', sampleCount: 0, generationTimeMs: Date.now() - startTime });
    return { success: true, labelSetId, stage: 'generated', sampleCount: 0, preview: [], generationTimeMs: Date.now() - startTime };
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

  await updateLabelSet(labelSetId, {
    status: 'completed',
    stage: 'generated',
    sampleCount: pairResult.pairs.length,
    labelDistribution: JSON.stringify(pairResult.stats),
    generationTimeMs: Date.now() - startTime,
  });

  return {
    success: true,
    labelSetId,
    stage: 'generated',
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
  // meta_label builds its own primary signal (a causal trailing-momentum rule,
  // or the named next-bar oracle used only as a leakage self-test) as a CTE, so
  // it is rendered by `buildMetaLabelSQL` rather than the registry entry, which
  // expects a caller-supplied `primary_labels` relation.
  if (generatorType === 'meta_label') {
    const rawSQL = buildMetaLabelSQL(
      params as unknown as MetaLabelParams,
      config.symbol,
      config.tableName || 'ohlcv',
    );
    return wrapWithSampleBy(rawSQL, config);
  }

  // OCP: dispatch via registry — adding a new generator = add entry to LABEL_SQL_GENERATORS
  const generator = LABEL_SQL_GENERATORS[generatorType];
  if (!generator) return null;

  const rawSQL = (generator as (p: unknown, c: LabelGeneratorConfig) => string)(params, config);
  return wrapWithSampleBy(rawSQL, config);
}

/** How a generator encodes `label`; recorded per set in the manifest. */
export function labelEncodingFor(generatorType: string): LabelEncoding {
  switch (generatorType) {
    case 'future_return':
    case 'future_volatility':
      return 'continuous';
    case 'meta_label':
    case 'multi_step':
      return 'binary_meta';
    case 'regime':
    case 'range_bucket':
      return 'class_id';
    default:
      return 'signed_direction';
  }
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
};

export function getCategoryForGenerator(generatorType: string): string {
  if (generatorType.startsWith('talib_')) return 'candle-pattern';
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

