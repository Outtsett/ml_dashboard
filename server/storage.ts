import {
  users, uploads, featureImportance, trainingSessions, lossHistory, instruments,
  newsArticles, newsSymbols, mlModels, featureSets, modelOutputs, ensembleConfigs,
  coherenceSnapshots, marketRegimes, regimeHistory, trades, brokerConfigs,
  backtestRuns, backtestTrades,
  type User, type InsertUser, type Upload, type InsertUpload,
  type FeatureImportance, type InsertFeatureImportance,
  type TrainingSession, type InsertTrainingSession, type LossHistory, type InsertLossHistory,
  type Instrument, type InsertInstrument, type NewsArticle, type InsertNewsArticle, type NewsSymbol, type InsertNewsSymbol
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, asc, sql, inArray, getTableColumns } from "drizzle-orm";

const FUTURES_SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM'];

export function getAssetType(symbol: string): 'futures' | 'forex' {
  const baseSymbol = symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
  if (FUTURES_SYMBOLS.includes(baseSymbol)) return 'futures';
  if (symbol.match(/^[A-Z]{6}$/)) return 'forex';
  return 'futures';
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Upload tracking
  createUpload(upload: InsertUpload): Promise<Upload>;
  updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void>;
  getUploads(): Promise<Upload[]>;

  // Feature importance
  saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void>;
  getFeatureImportance(modelName: string): Promise<FeatureImportance[]>;

  // Training sessions
  createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession>;
  updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void>;
  getActiveTrainingSession(): Promise<TrainingSession | undefined>;
  getTrainingSession(id: number): Promise<TrainingSession | undefined>;

  // Loss history
  addLossHistory(entry: InsertLossHistory): Promise<LossHistory>;
  getLossHistory(sessionId: number): Promise<LossHistory[]>;

  // Instrument metadata
  getInstrument(symbol: string): Promise<Instrument | undefined>;
  getAllInstruments(): Promise<Instrument[]>;
  getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]>;

  // News articles
  createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle>;
  getNewsArticles(options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date }): Promise<NewsArticle[]>;
  getNewsArticleById(id: number): Promise<NewsArticle | undefined>;
  getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined>;
  updateNewsSentiment(id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number): Promise<void>;
  getNewsBySymbol(symbol: string, limit?: number): Promise<NewsArticle[]>;
  linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void>;

  // ML Observatory methods
  createMlModel(data: any): Promise<any>;
  getMlModels(status?: string): Promise<any[]>;
  getMlModel(id: number): Promise<any | undefined>;
  updateMlModel(id: number, data: Partial<any>): Promise<void>;
  createFeatureSet(data: any): Promise<any>;
  getFeatureSets(): Promise<any[]>;
  saveModelOutput(data: any): Promise<any>;
  saveModelOutputBatch(outputs: any[]): Promise<void>;
  getModelOutputs(modelId: number, symbol?: string, limit?: number): Promise<any[]>;
  getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<any>;
  saveCoherenceSnapshot(data: any): Promise<any>;
  createEnsembleConfig(data: any): Promise<any>;
  getEnsembleConfigs(): Promise<any[]>;
  simulateEnsemble(ensembleId: number, symbol: string, startTime: number, endTime: number): Promise<any[]>;
  createTrade(data: any): Promise<any>;
  getTrades(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]>;
  closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<any>;
  createMarketRegime(data: any): Promise<any>;
  getMarketRegimes(): Promise<any[]>;
  recordRegimeHistory(data: any): Promise<any>;

  // Broker configs
  getBrokerConfigs(): Promise<any[]>;
  getBrokerConfig(id: number): Promise<any | undefined>;
  getBrokerConfigByName(name: string): Promise<any | undefined>;
  getDefaultBrokerConfig(assetType: string): Promise<any | undefined>;

  // Backtest runs
  createBacktestRun(data: any): Promise<any>;
  updateBacktestRun(id: number, data: Partial<any>): Promise<void>;
  getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]>;
  getBacktestRun(id: number): Promise<any | undefined>;

  // Backtest trades
  insertBacktestTrades(trades: any[]): Promise<void>;
  getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async createUpload(upload: InsertUpload): Promise<Upload> {
    const [result] = await db
      .insert(uploads)
      .values(upload)
      .returning();
    return result;
  }

  async updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void> {
    const updateData: any = { status };
    if (recordCount !== undefined) {
      updateData.recordCount = recordCount;
    }
    await db
      .update(uploads)
      .set(updateData)
      .where(eq(uploads.id, id));
  }

  async getUploads(): Promise<Upload[]> {
    return db
      .select()
      .from(uploads)
      .orderBy(desc(uploads.uploadedAt))
      .limit(50);
  }

  async saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void> {
    if (data.length === 0) return;
    await db.insert(featureImportance).values(data);
  }

  async getFeatureImportance(modelName: string): Promise<FeatureImportance[]> {
    return db
      .select()
      .from(featureImportance)
      .where(eq(featureImportance.modelName, modelName))
      .orderBy(desc(featureImportance.importance));
  }

  async createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession> {
    const [result] = await db
      .insert(trainingSessions)
      .values(session)
      .returning();
    return result;
  }

  async updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void> {
    await db
      .update(trainingSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(trainingSessions.id, id));
  }

  async getActiveTrainingSession(): Promise<TrainingSession | undefined> {
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.status, "running"))
      .orderBy(desc(trainingSessions.startedAt))
      .limit(1);
    return session || undefined;
  }

  async getTrainingSession(id: number): Promise<TrainingSession | undefined> {
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, id));
    return session || undefined;
  }

  async addLossHistory(entry: InsertLossHistory): Promise<LossHistory> {
    const [result] = await db
      .insert(lossHistory)
      .values(entry)
      .returning();
    return result;
  }

  async getLossHistory(sessionId: number): Promise<LossHistory[]> {
    return db
      .select()
      .from(lossHistory)
      .where(eq(lossHistory.sessionId, sessionId))
      .orderBy(asc(lossHistory.epoch));
  }

  async getInstrument(symbol: string): Promise<Instrument | undefined> {
    const normalizedSymbol = symbol.toUpperCase();
    const [instrument] = await db.select().from(instruments).where(eq(instruments.symbol, normalizedSymbol));
    return instrument || undefined;
  }

  async getAllInstruments(): Promise<Instrument[]> {
    return await db.select().from(instruments).orderBy(instruments.assetType, instruments.symbol);
  }

  async getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]> {
    return await db.select().from(instruments).where(eq(instruments.assetType, assetType)).orderBy(instruments.symbol);
  }

  async createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(newsArticles).values(article).returning();

      if (symbols && symbols.length > 0) {
        const entries = symbols.map(symbol => ({
          newsId: created.id,
          symbol: symbol.toUpperCase(),
          isPrimary: symbol.toUpperCase() === symbols[0].toUpperCase() ? 1 : 0
        }));
        await tx.insert(newsSymbols).values(entries);
      }

      return created;
    });
  }

  async getNewsArticles(options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date }): Promise<NewsArticle[]> {
    const limit = options?.limit ?? 100;

    if (options?.symbol) {
      return this.getNewsBySymbol(options.symbol, limit);
    }

    let query = db.select().from(newsArticles);

    const conditions = [];
    if (options?.source) {
      conditions.push(eq(newsArticles.source, options.source));
    }
    if (options?.startDate) {
      conditions.push(gte(newsArticles.publishedAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(newsArticles.publishedAt, options.endDate));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return await query.orderBy(desc(newsArticles.publishedAt)).limit(limit);
  }

  async getNewsArticleById(id: number): Promise<NewsArticle | undefined> {
    const [article] = await db.select().from(newsArticles).where(eq(newsArticles.id, id));
    return article || undefined;
  }

  async getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined> {
    const [article] = await db.select().from(newsArticles).where(eq(newsArticles.externalId, externalId));
    return article || undefined;
  }

  async updateNewsSentiment(id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number): Promise<void> {
    await db.update(newsArticles)
      .set({ sentimentScore, sentimentLabel, sentimentConfidence })
      .where(eq(newsArticles.id, id));
  }

  async getNewsBySymbol(symbol: string, limit: number = 50): Promise<NewsArticle[]> {
    const results = await db
      .select({ ...getTableColumns(newsArticles) })
      .from(newsArticles)
      .innerJoin(newsSymbols, eq(newsArticles.id, newsSymbols.newsId))
      .where(eq(newsSymbols.symbol, symbol.toUpperCase()))
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);
    return results;
  }

  async linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void> {
    const entries = symbols.map(symbol => ({
      newsId,
      symbol: symbol.toUpperCase(),
      isPrimary: primarySymbol && symbol.toUpperCase() === primarySymbol.toUpperCase() ? 1 : 0
    }));

    await db.insert(newsSymbols).values(entries);
  }

  // ============================================================
  // ML OBSERVATORY METHODS
  // ============================================================

  async createMlModel(data: any): Promise<any> {
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
    return result;
  }

  async getMlModels(status?: string): Promise<any[]> {
    if (status) {
      return db.select().from(mlModels).where(eq(mlModels.status, status)).orderBy(desc(mlModels.updatedAt));
    }
    return db.select().from(mlModels).orderBy(desc(mlModels.updatedAt));
  }

  async getMlModel(id: number): Promise<any | undefined> {
    const [result] = await db.select().from(mlModels).where(eq(mlModels.id, id));
    return result;
  }

  async updateMlModel(id: number, data: Partial<any>): Promise<void> {
    const allowed: Record<string, any> = {};

    if (data.name !== undefined) allowed.name = data.name;
    if (data.architecture !== undefined) allowed.architecture = data.architecture;
    if (data.status !== undefined) allowed.status = data.status;
    if (data.description !== undefined) allowed.description = data.description;
    if (data.hyperparameters !== undefined) allowed.hyperparameters = typeof data.hyperparameters === 'object' ? JSON.stringify(data.hyperparameters) : data.hyperparameters;
    if (data.metrics !== undefined) allowed.metrics = typeof data.metrics === 'object' ? JSON.stringify(data.metrics) : data.metrics;
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

  async createFeatureSet(data: any): Promise<any> {
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
    return result;
  }

  async getFeatureSets(): Promise<any[]> {
    return db.select().from(featureSets).orderBy(desc(featureSets.createdAt));
  }

  async saveModelOutput(data: any): Promise<any> {
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
    return result;
  }

  async saveModelOutputBatch(outputs: any[]): Promise<void> {
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

  async getModelOutputs(modelId: number, symbol?: string, limit: number = 1000): Promise<any[]> {
    const conditions = [eq(modelOutputs.modelId, modelId)];
    if (symbol) {
      conditions.push(eq(modelOutputs.symbol, symbol));
    }
    return db.select().from(modelOutputs)
      .where(and(...conditions))
      .orderBy(desc(modelOutputs.timestamp))
      .limit(limit);
  }

  async getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<any> {
    const results = await db
      .select({
        ...getTableColumns(modelOutputs),
        modelName: mlModels.name,
        architecture: mlModels.architecture,
      })
      .from(modelOutputs)
      .innerJoin(mlModels, eq(modelOutputs.modelId, mlModels.id))
      .where(
        and(
          eq(modelOutputs.symbol, symbol),
          gte(modelOutputs.timestamp, startTime),
          lte(modelOutputs.timestamp, endTime)
        )
      )
      .orderBy(asc(modelOutputs.timestamp), asc(modelOutputs.modelId));

    // Group by timestamp and calculate agreement
    const byTimestamp = new Map<number, any[]>();
    for (const row of results) {
      const ts = row.timestamp;
      if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
      byTimestamp.get(ts)!.push(row);
    }

    const coherenceData = [];
    for (const [timestamp, outputs] of Array.from(byTimestamp)) {
      if (outputs.length < 2) continue;

      let agreements = 0;
      let comparisons = 0;
      for (let i = 0; i < outputs.length; i++) {
        for (let j = i + 1; j < outputs.length; j++) {
          const sameDirection =
            (outputs[i].prediction > 0 && outputs[j].prediction > 0) ||
            (outputs[i].prediction < 0 && outputs[j].prediction < 0) ||
            (outputs[i].prediction === 0 && outputs[j].prediction === 0);
          if (sameDirection) agreements++;
          comparisons++;
        }
      }

      const agreementRate = comparisons > 0 ? agreements / comparisons : 0;
      const avgConfidence = outputs.reduce((sum: number, o: any) => sum + (o.confidence || 0), 0) / outputs.length;

      coherenceData.push({
        timestamp,
        modelCount: outputs.length,
        agreementRate,
        avgConfidence,
        divergenceScore: 1 - agreementRate,
        models: outputs.map((o: any) => ({
          modelId: o.modelId,
          modelName: o.modelName,
          prediction: o.prediction,
          label: o.predictionLabel,
          confidence: o.confidence
        }))
      });
    }

    return coherenceData;
  }

  async saveCoherenceSnapshot(data: any): Promise<any> {
    const [result] = await db.insert(coherenceSnapshots).values({
      timestamp: data.timestamp,
      symbol: data.symbol,
      modelCorrelations: JSON.stringify(data.modelCorrelations),
      agreementMatrix: JSON.stringify(data.agreementMatrix),
      ensembleSignal: data.ensembleSignal,
      ensembleConfidence: data.ensembleConfidence,
      divergenceScore: data.divergenceScore,
    }).returning();
    return result;
  }

  async createEnsembleConfig(data: any): Promise<any> {
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
    return result;
  }

  async getEnsembleConfigs(): Promise<any[]> {
    return db.select().from(ensembleConfigs)
      .where(eq(ensembleConfigs.status, 'active'))
      .orderBy(desc(ensembleConfigs.createdAt));
  }

  async simulateEnsemble(ensembleId: number, symbol: string, startTime: number, endTime: number): Promise<any[]> {
    const [config] = await db.select().from(ensembleConfigs).where(eq(ensembleConfigs.id, ensembleId));
    if (!config) return [];

    const modelIds = JSON.parse(config.modelIds);
    const weights = config.weights ? JSON.parse(config.weights) : null;

    const results = await db
      .select({
        ...getTableColumns(modelOutputs),
        modelName: mlModels.name,
      })
      .from(modelOutputs)
      .innerJoin(mlModels, eq(modelOutputs.modelId, mlModels.id))
      .where(
        and(
          inArray(modelOutputs.modelId, modelIds),
          eq(modelOutputs.symbol, symbol),
          gte(modelOutputs.timestamp, startTime),
          lte(modelOutputs.timestamp, endTime)
        )
      )
      .orderBy(asc(modelOutputs.timestamp));

    // Group by timestamp
    const byTimestamp = new Map<number, any[]>();
    for (const row of results) {
      const ts = row.timestamp;
      if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
      byTimestamp.get(ts)!.push(row);
    }

    // Calculate ensemble signals
    const signals = [];
    for (const [timestamp, outputs] of Array.from(byTimestamp)) {
      let signal = 0;
      let totalWeight = 0;

      for (const output of outputs) {
        const weight = weights ? (weights[output.modelId] || 1) : 1;
        signal += output.prediction * weight;
        totalWeight += weight;
      }

      const ensemblePrediction = totalWeight > 0 ? signal / totalWeight : 0;
      const avgConfidence = outputs.reduce((sum: number, o: any) => sum + (o.confidence || 0.5), 0) / outputs.length;

      let unanimous = true;
      if (config.unanimityRequired) {
        const directions = outputs.map((o: any) => Math.sign(o.prediction));
        unanimous = directions.every((d: number) => d === directions[0]);
      }

      signals.push({
        timestamp,
        ensemblePrediction,
        ensembleLabel: ensemblePrediction > 0 ? 'long' : ensemblePrediction < 0 ? 'short' : 'neutral',
        confidence: avgConfidence,
        unanimous,
        modelCount: outputs.length,
        models: outputs.map((o: any) => ({ id: o.modelId, name: o.modelName, prediction: o.prediction }))
      });
    }

    return signals;
  }

  // Trades
  async createTrade(data: any): Promise<any> {
    const [result] = await db.insert(trades).values({
      symbol: data.symbol,
      side: data.side,
      entryTimestamp: data.entryTimestamp,
      exitTimestamp: data.exitTimestamp,
      entryPrice: data.entryPrice,
      exitPrice: data.exitPrice,
      quantity: data.quantity || 1,
      pnl: data.pnl,
      pnlPct: data.pnlPct,
      commission: data.commission || 0,
      slippage: data.slippage || 0,
      modelId: data.modelId,
      ensembleId: data.ensembleId,
      signalConfidence: data.signalConfidence,
      regimeId: data.regimeId,
      notes: data.notes,
      status: data.status || 'open',
    }).returning();
    return result;
  }

  async getTrades(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]> {
    const conditions: any[] = [];

    if (options?.symbol) conditions.push(eq(trades.symbol, options.symbol));
    if (options?.modelId) conditions.push(eq(trades.modelId, options.modelId));
    if (options?.status) conditions.push(eq(trades.status, options.status));

    let query = db.select().from(trades);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return query.orderBy(desc(trades.entryTimestamp)).limit(options?.limit || 100);
  }

  async closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<any> {
    const [trade] = await db.select().from(trades).where(eq(trades.id, id));
    if (!trade) return null;

    const priceDiff = trade.side === 'long'
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;

    const pnl = priceDiff * trade.quantity - (trade.commission || 0) - (trade.slippage || 0);
    const pnlPct = priceDiff / trade.entryPrice;

    const [result] = await db.update(trades)
      .set({ exitTimestamp, exitPrice, pnl, pnlPct, status: 'closed' })
      .where(eq(trades.id, id))
      .returning();

    return result;
  }

  // Market Regimes
  async createMarketRegime(data: any): Promise<any> {
    const [result] = await db.insert(marketRegimes).values({
      name: data.name,
      description: data.description,
      volatilityLevel: data.volatilityLevel,
      trendDirection: data.trendDirection,
      characteristics: data.characteristics ? JSON.stringify(data.characteristics) : null,
      detectionRules: data.detectionRules ? JSON.stringify(data.detectionRules) : null,
    }).returning();
    return result;
  }

  async getMarketRegimes(): Promise<any[]> {
    return db.select().from(marketRegimes).orderBy(marketRegimes.name);
  }

  async recordRegimeHistory(data: any): Promise<any> {
    const [result] = await db.insert(regimeHistory).values({
      regimeId: data.regimeId,
      symbol: data.symbol,
      startTimestamp: data.startTimestamp,
      endTimestamp: data.endTimestamp,
      confidence: data.confidence,
      detectedBy: data.detectedBy,
    }).returning();
    return result;
  }

  // ============================================================
  // BROKER CONFIGS
  // ============================================================

  async getBrokerConfigs(): Promise<any[]> {
    return db.select().from(brokerConfigs).orderBy(brokerConfigs.assetType, brokerConfigs.name);
  }

  async getBrokerConfig(id: number): Promise<any | undefined> {
    const [result] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.id, id));
    return result;
  }

  async getBrokerConfigByName(name: string): Promise<any | undefined> {
    const [result] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.name, name));
    return result;
  }

  async getDefaultBrokerConfig(assetType: string): Promise<any | undefined> {
    const [result] = await db.select().from(brokerConfigs)
      .where(and(eq(brokerConfigs.assetType, assetType), eq(brokerConfigs.isDefault, 1)))
      .limit(1);
    return result;
  }

  // ============================================================
  // BACKTEST RUNS
  // ============================================================

  async createBacktestRun(data: any): Promise<any> {
    const [result] = await db.insert(backtestRuns).values({
      name: data.name,
      modelId: data.modelId,
      symbol: data.symbol,
      brokerConfigId: data.brokerConfigId,
      timeframe: data.timeframe || '1m',
      trainStartTimestamp: data.trainStartTimestamp,
      trainEndTimestamp: data.trainEndTimestamp,
      testStartTimestamp: data.testStartTimestamp,
      testEndTimestamp: data.testEndTimestamp,
      splitRatio: data.splitRatio || 0.8,
      initialCapital: data.initialCapital || 10000,
      positionSize: data.positionSize || 1,
      maxPositions: data.maxPositions || 1,
      stopLossTicks: data.stopLossTicks,
      takeProfitTicks: data.takeProfitTicks,
      trailingStopTicks: data.trailingStopTicks,
      maxDrawdownPct: data.maxDrawdownPct,
      status: 'pending',
    }).returning();
    return result;
  }

  async updateBacktestRun(id: number, data: Partial<any>): Promise<void> {
    const allowed: Record<string, any> = {};

    const fieldMap: Record<string, string> = {
      status: 'status', totalTrades: 'totalTrades', winRate: 'winRate',
      profitFactor: 'profitFactor', sharpeRatio: 'sharpeRatio', sortinoRatio: 'sortinoRatio',
      maxDrawdown: 'maxDrawdown', totalReturn: 'totalReturn', totalReturnPct: 'totalReturnPct',
      avgWin: 'avgWin', avgLoss: 'avgLoss', largestWin: 'largestWin', largestLoss: 'largestLoss',
      avgHoldingTimeMs: 'avgHoldingTimeMs', expectancy: 'expectancy',
      totalCommissions: 'totalCommissions', totalSlippage: 'totalSlippage',
      equityCurve: 'equityCurve', errorMessage: 'errorMessage',
      startedAt: 'startedAt', completedAt: 'completedAt',
    };

    for (const [jsKey, drizzleKey] of Object.entries(fieldMap)) {
      if (data[jsKey] !== undefined) {
        allowed[drizzleKey] = data[jsKey];
      }
    }

    if (Object.keys(allowed).length === 0) return;
    await db.update(backtestRuns).set(allowed).where(eq(backtestRuns.id, id));
  }

  async getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]> {
    const conditions: any[] = [];
    if (options?.symbol) conditions.push(eq(backtestRuns.symbol, options.symbol));
    if (options?.modelId) conditions.push(eq(backtestRuns.modelId, options.modelId));
    if (options?.status) conditions.push(eq(backtestRuns.status, options.status));

    let query = db.select({
      ...getTableColumns(backtestRuns),
      brokerName: brokerConfigs.name,
      brokerLabel: brokerConfigs.broker,
      modelName: mlModels.name,
      modelArchitecture: mlModels.architecture,
    })
    .from(backtestRuns)
    .leftJoin(brokerConfigs, eq(backtestRuns.brokerConfigId, brokerConfigs.id))
    .leftJoin(mlModels, eq(backtestRuns.modelId, mlModels.id));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return query.orderBy(desc(backtestRuns.createdAt)).limit(options?.limit || 50);
  }

  async getBacktestRun(id: number): Promise<any | undefined> {
    const [result] = await db.select({
      ...getTableColumns(backtestRuns),
      brokerName: brokerConfigs.name,
      brokerLabel: brokerConfigs.broker,
      modelName: mlModels.name,
      modelArchitecture: mlModels.architecture,
    })
    .from(backtestRuns)
    .leftJoin(brokerConfigs, eq(backtestRuns.brokerConfigId, brokerConfigs.id))
    .leftJoin(mlModels, eq(backtestRuns.modelId, mlModels.id))
    .where(eq(backtestRuns.id, id));

    return result;
  }

  // ============================================================
  // BACKTEST TRADES
  // ============================================================

  async insertBacktestTrades(tradeData: any[]): Promise<void> {
    if (tradeData.length === 0) return;

    const batchSize = 100;
    for (let i = 0; i < tradeData.length; i += batchSize) {
      const batch = tradeData.slice(i, i + batchSize);
      const values = batch.map(t => ({
        backtestRunId: t.backtestRunId,
        symbol: t.symbol,
        side: t.side,
        entryTimestamp: t.entryTimestamp,
        exitTimestamp: t.exitTimestamp,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        quantity: t.quantity,
        pnl: t.pnl,
        netPnl: t.netPnl,
        commission: t.commission,
        slippage: t.slippage,
        spreadCost: t.spreadCost,
        entrySignal: t.entrySignal,
        exitReason: t.exitReason,
        barsHeld: t.barsHeld,
        maxFavorableExcursion: t.maxFavorableExcursion ?? t.maxAdverseExcursion,
        runningPnl: t.runningPnl,
      }));
      await db.insert(backtestTrades).values(values);
    }
  }

  async getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]> {
    return db.select().from(backtestTrades)
      .where(eq(backtestTrades.backtestRunId, backtestRunId))
      .orderBy(asc(backtestTrades.entryTimestamp))
      .limit(limit || 10000);
  }
}

export const storage = new DatabaseStorage();
