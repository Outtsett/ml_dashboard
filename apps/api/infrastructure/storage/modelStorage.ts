/**
 * Storage — ML Models, Feature Sets, Model Outputs, Coherence, Ensembles
 */

import {
  mlModels, featureSets, modelOutputs, coherenceSnapshots, ensembleConfigs,
  type MlModel, type FeatureSet, type ModelOutput, type CoherenceSnapshot, type EnsembleConfig,
} from '@shared/pg_schema';
import { db } from '../database/db';
import { eq, and, gte, lte, desc, asc, inArray, getTableColumns } from 'drizzle-orm';
import type {
  CreateMlModelParams, UpdateMlModelParams, CreateFeatureSetParams, ModelOutputParams,
  CoherenceDataPoint, CoherenceSnapshotParams, CreateEnsembleConfigParams, EnsembleSignal,
} from './types';

// ── ML Models ───────────────────────────────────────────────

export async function createMlModel(data: CreateMlModelParams): Promise<MlModel> {
  const [result] = await db.insert(mlModels).values({
    name: data.name,
    version: data.version || '1.0.0',
    architecture: data.architecture,
    category: data.category,
    subcategory: data.subcategory,
    description: data.description,
    hyperparameters: data.hyperparameters ? JSON.stringify(data.hyperparameters) : null,
    featureSetId: data.featureSetId,
    trainingDataStart: data.trainingDataStart,
    trainingDataEnd: data.trainingDataEnd,
    validationSplit: data.validationSplit || 0.2,
    targetColumn: data.targetColumn,
    targetHorizon: data.targetHorizon,
    metrics: data.metrics ? JSON.stringify(data.metrics) : null,
    status: data.status || 'draft',
  }).returning();
  return result!;
}

export async function getMlModels(status?: string): Promise<MlModel[]> {
  if (status) {
    return db.select().from(mlModels).where(eq(mlModels.status, status)).orderBy(desc(mlModels.updatedAt));
  }
  return db.select().from(mlModels).orderBy(desc(mlModels.updatedAt));
}

export async function getMlModel(id: number): Promise<MlModel | undefined> {
  const [result] = await db.select().from(mlModels).where(eq(mlModels.id, id));
  return result;
}

export async function updateMlModel(id: number, data: UpdateMlModelParams): Promise<void> {
  const allowed: Record<string, unknown> = {};

  if (data.name !== undefined) allowed.name = data.name;
  if (data.architecture !== undefined) allowed.architecture = data.architecture;
  if (data.status !== undefined) allowed.status = data.status;
  if (data.description !== undefined) allowed.description = data.description;
  if (data.hyperparameters !== undefined) {
    allowed.hyperparameters = typeof data.hyperparameters === 'object'
      ? JSON.stringify(data.hyperparameters) : data.hyperparameters;
  }
  if (data.metrics !== undefined) {
    allowed.metrics = typeof data.metrics === 'object'
      ? JSON.stringify(data.metrics) : data.metrics;
  }
  if (data.version !== undefined) allowed.version = data.version;
  if (data.featureSetId !== undefined) allowed.featureSetId = data.featureSetId;
  if (data.category !== undefined) allowed.category = data.category;
  if (data.subcategory !== undefined) allowed.subcategory = data.subcategory;
  if (data.targetColumn !== undefined) allowed.targetColumn = data.targetColumn;
  if (data.targetHorizon !== undefined) allowed.targetHorizon = data.targetHorizon;
  if (data.validationSplit !== undefined) allowed.validationSplit = data.validationSplit;
  if (data.trainingDataStart !== undefined) allowed.trainingDataStart = data.trainingDataStart;
  if (data.trainingDataEnd !== undefined) allowed.trainingDataEnd = data.trainingDataEnd;

  if (Object.keys(allowed).length === 0) return;
  allowed.updatedAt = new Date();
  await db.update(mlModels).set(allowed).where(eq(mlModels.id, id));
}

// ── Feature Sets ────────────────────────────────────────────

export async function createFeatureSet(data: CreateFeatureSetParams): Promise<FeatureSet> {
  const [result] = await db.insert(featureSets).values({
    name: data.name,
    description: data.description,
    features: JSON.stringify(data.features),
    normalization: data.normalization ? JSON.stringify(data.normalization) : null,
    lagPeriods: data.lagPeriods ? JSON.stringify(data.lagPeriods) : null,
    technicalIndicators: data.technicalIndicators ? JSON.stringify(data.technicalIndicators) : null,
    symbols: data.symbols ? JSON.stringify(data.symbols) : null,
    timeframe: data.timeframe,
    lookbackBars: data.lookbackBars || 100,
  }).returning();
  return result!;
}

export async function getFeatureSets(): Promise<FeatureSet[]> {
  return db.select().from(featureSets).orderBy(desc(featureSets.createdAt));
}

// ── Model Outputs ───────────────────────────────────────────

export async function saveModelOutput(data: ModelOutputParams): Promise<ModelOutput> {
  const [result] = await db.insert(modelOutputs).values({
    modelId: data.modelId,
    symbol: data.symbol,
    timestamp: data.timestamp,
    prediction: data.prediction,
    predictionLabel: data.predictionLabel,
    confidence: data.confidence,
    probabilities: data.probabilities ? JSON.stringify(data.probabilities) : null,
    features: data.features ? JSON.stringify(data.features) : null,
  }).returning();
  return result!;
}

export async function saveModelOutputBatch(outputs: ModelOutputParams[]): Promise<void> {
  if (outputs.length === 0) return;
  const batchSize = 100;
  for (let i = 0; i < outputs.length; i += batchSize) {
    const batch = outputs.slice(i, i + batchSize);
    const values = batch.map(o => ({
      modelId: o.modelId,
      symbol: o.symbol,
      timestamp: o.timestamp,
      prediction: o.prediction,
      predictionLabel: o.predictionLabel,
      confidence: o.confidence,
      probabilities: o.probabilities ? JSON.stringify(o.probabilities) : null,
      features: o.features ? JSON.stringify(o.features) : null,
    }));
    await db.insert(modelOutputs).values(values);
  }
}

export async function getModelOutputs(modelId: number, symbol?: string, limit: number = 1000): Promise<ModelOutput[]> {
  const conditions = [eq(modelOutputs.modelId, modelId)];
  if (symbol) conditions.push(eq(modelOutputs.symbol, symbol));
  return db.select().from(modelOutputs)
    .where(and(...conditions))
    .orderBy(desc(modelOutputs.timestamp))
    .limit(limit);
}

// ── Coherence ───────────────────────────────────────────────

export async function getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<CoherenceDataPoint[]> {
  const results = await db.select({
    ...getTableColumns(modelOutputs),
    modelName: mlModels.name,
    architecture: mlModels.architecture,
  })
  .from(modelOutputs)
  .innerJoin(mlModels, eq(modelOutputs.modelId, mlModels.id))
  .where(and(
    eq(modelOutputs.symbol, symbol),
    gte(modelOutputs.timestamp, startTime),
    lte(modelOutputs.timestamp, endTime),
  ))
  .orderBy(asc(modelOutputs.timestamp), asc(modelOutputs.modelId));

  type CoherenceRow = (typeof results)[number];

  // Group by timestamp and calculate agreement
  const byTimestamp = new Map<number, CoherenceRow[]>();
  for (const row of results) {
    const ts = row.timestamp;
    if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
    byTimestamp.get(ts)!.push(row);
  }

  const coherenceData: CoherenceDataPoint[] = [];
  for (const [timestamp, outputs] of Array.from(byTimestamp)) {
    if (outputs.length < 2) continue;
    let agreements = 0;
    let comparisons = 0;
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        const sameDirection =
          (outputs[i]!.prediction > 0 && outputs[j]!.prediction > 0) ||
          (outputs[i]!.prediction < 0 && outputs[j]!.prediction < 0) ||
          (outputs[i]!.prediction === 0 && outputs[j]!.prediction === 0);
        if (sameDirection) agreements++;
        comparisons++;
      }
    }
    const agreementRate = comparisons > 0 ? agreements / comparisons : 0;
    const avgConfidence = outputs.reduce((sum, o) => sum + (o.confidence || 0), 0) / outputs.length;
    coherenceData.push({
      timestamp,
      modelCount: outputs.length,
      agreementRate,
      avgConfidence,
      divergenceScore: 1 - agreementRate,
      models: outputs.map((o) => ({
        modelId: o.modelId, modelName: o.modelName,
        prediction: o.prediction, label: o.predictionLabel, confidence: o.confidence,
      })),
    });
  }
  return coherenceData;
}

export async function saveCoherenceSnapshot(data: CoherenceSnapshotParams): Promise<CoherenceSnapshot> {
  const [result] = await db.insert(coherenceSnapshots).values({
    timestamp: data.timestamp,
    symbol: data.symbol,
    modelCorrelations: JSON.stringify(data.modelCorrelations),
    agreementMatrix: JSON.stringify(data.agreementMatrix),
    ensembleSignal: data.ensembleSignal,
    ensembleConfidence: data.ensembleConfidence,
    divergenceScore: data.divergenceScore,
  }).returning();
  return result!;
}

// ── Ensemble Configs ────────────────────────────────────────

export async function createEnsembleConfig(data: CreateEnsembleConfigParams): Promise<EnsembleConfig> {
  const [result] = await db.insert(ensembleConfigs).values({
    name: data.name,
    description: data.description,
    modelIds: JSON.stringify(data.modelIds),
    weights: data.weights ? JSON.stringify(data.weights) : null,
    aggregationMethod: data.aggregationMethod || 'vote',
    confidenceThreshold: data.confidenceThreshold || 0.5,
    unanimityRequired: data.unanimityRequired || 0,
    status: data.status || 'active',
  }).returning();
  return result!;
}

export async function getEnsembleConfigs(): Promise<EnsembleConfig[]> {
  return db.select().from(ensembleConfigs)
    .where(eq(ensembleConfigs.status, 'active'))
    .orderBy(desc(ensembleConfigs.createdAt));
}

export async function simulateEnsemble(
  ensembleId: number, symbol: string, startTime: number, endTime: number,
): Promise<EnsembleSignal[]> {
  const [config] = await db.select().from(ensembleConfigs).where(eq(ensembleConfigs.id, ensembleId));
  if (!config) return [];

  const modelIds = JSON.parse(config.modelIds) as number[];
  const weights = config.weights ? (JSON.parse(config.weights) as Record<number, number>) : null;

  const results = await db.select({
    ...getTableColumns(modelOutputs),
    modelName: mlModels.name,
  })
  .from(modelOutputs)
  .innerJoin(mlModels, eq(modelOutputs.modelId, mlModels.id))
  .where(and(
    inArray(modelOutputs.modelId, modelIds),
    eq(modelOutputs.symbol, symbol),
    gte(modelOutputs.timestamp, startTime),
    lte(modelOutputs.timestamp, endTime),
  ))
  .orderBy(asc(modelOutputs.timestamp));

  type SimulateRow = (typeof results)[number];

  const byTimestamp = new Map<number, SimulateRow[]>();
  for (const row of results) {
    const ts = row.timestamp;
    if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
    byTimestamp.get(ts)!.push(row);
  }

  const signals: EnsembleSignal[] = [];
  for (const [timestamp, outputs] of Array.from(byTimestamp)) {
    let signal = 0;
    let totalWeight = 0;
    for (const output of outputs) {
      const weight = weights ? (weights[output.modelId] || 1) : 1;
      signal += output.prediction * weight;
      totalWeight += weight;
    }
    const ensemblePrediction = totalWeight > 0 ? signal / totalWeight : 0;
    const avgConfidence = outputs.reduce((sum, o) => sum + (o.confidence || 0.5), 0) / outputs.length;
    let unanimous = true;
    if (config.unanimityRequired) {
      const directions = outputs.map((o) => Math.sign(o.prediction));
      unanimous = directions.every((d) => d === directions[0]);
    }
    signals.push({
      timestamp,
      ensemblePrediction,
      ensembleLabel: ensemblePrediction > 0 ? 'long' : ensemblePrediction < 0 ? 'short' : 'neutral',
      confidence: avgConfidence,
      unanimous,
      modelCount: outputs.length,
      models: outputs.map((o) => ({ id: o.modelId, name: o.modelName, prediction: o.prediction })),
    });
  }
  return signals;
}

