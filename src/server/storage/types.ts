/**
 * Storage — Types & Interfaces (ISP-compliant)
 *
 * Split into domain-specific sub-interfaces so consumers depend
 * only on the methods they use. Composed into IStorage for backward compat.
 */

import type {
  User, InsertUser, Upload, InsertUpload,
  FeatureImportance, InsertFeatureImportance,
  TrainingSession, InsertTrainingSession, LossHistory, InsertLossHistory,
  Instrument, NewsArticle, InsertNewsArticle,
} from '@shared/schema';

// ─── Asset Type Helper ──────────────────────────────────────────────────────

const FUTURES_SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM'];

export function getAssetType(symbol: string): 'futures' | 'forex' {
  const baseSymbol = symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
  if (FUTURES_SYMBOLS.includes(baseSymbol)) return 'futures';
  if (symbol.match(/^[A-Z]{6}$/)) return 'forex';
  return 'futures';
}

// ─── Domain Sub-Interfaces ──────────────────────────────────────────────────

export interface IUserStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export interface IUploadStorage {
  createUpload(upload: InsertUpload): Promise<Upload>;
  updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void>;
  getUploads(): Promise<Upload[]>;
}

export interface IFeatureStorage {
  saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void>;
  getFeatureImportance(modelName: string): Promise<FeatureImportance[]>;
}

export interface ITrainingStorage {
  createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession>;
  updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void>;
  getActiveTrainingSession(): Promise<TrainingSession | undefined>;
  getTrainingSession(id: number): Promise<TrainingSession | undefined>;
  addLossHistory(entry: InsertLossHistory): Promise<LossHistory>;
  getLossHistory(sessionId: number): Promise<LossHistory[]>;
}

export interface IInstrumentStorage {
  getInstrument(symbol: string): Promise<Instrument | undefined>;
  getAllInstruments(): Promise<Instrument[]>;
  getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]>;
}

export interface INewsStorage {
  createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle>;
  getNewsArticles(options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date }): Promise<NewsArticle[]>;
  getNewsArticleById(id: number): Promise<NewsArticle | undefined>;
  getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined>;
  updateNewsSentiment(id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number): Promise<void>;
  getNewsBySymbol(symbol: string, limit?: number): Promise<NewsArticle[]>;
  linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void>;
}

export interface IObservatoryStorage {
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
}

export interface IBrokerStorage {
  getBrokerConfigs(): Promise<any[]>;
  getBrokerConfig(id: number): Promise<any | undefined>;
  getBrokerConfigByName(name: string): Promise<any | undefined>;
  getDefaultBrokerConfig(assetType: string): Promise<any | undefined>;
}

export interface IBacktestStorage {
  createBacktestRun(data: any): Promise<any>;
  updateBacktestRun(id: number, data: Partial<any>): Promise<void>;
  getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]>;
  getBacktestRun(id: number): Promise<any | undefined>;
  insertBacktestTrades(trades: any[]): Promise<void>;
  getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]>;
}

// ─── Composed Interface (backward compat) ───────────────────────────────────

export interface IStorage extends
  IUserStorage,
  IUploadStorage,
  IFeatureStorage,
  ITrainingStorage,
  IInstrumentStorage,
  INewsStorage,
  IObservatoryStorage,
  IBrokerStorage,
  IBacktestStorage {}
