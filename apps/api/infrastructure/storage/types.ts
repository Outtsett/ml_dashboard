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
  MlModel, FeatureSet, ModelOutput, CoherenceSnapshot, EnsembleConfig,
  Trade, MarketRegime, RegimeHistory, BrokerConfig, BacktestRun, BacktestTrade,
} from '@shared/pg_schema';

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

// ─── Observatory (ML Models / Feature Sets / Outputs / Coherence / Ensembles) ─
//
// These "Params" DTOs mirror the JSON-over-HTTP request bodies accepted by
// `apps/api/ml/observatory.router.ts` — looser than the Drizzle `Insert*`
// types because JSON-text columns (hyperparameters, metrics, features, …)
// accept either an already-serialized string or a plain object/array that the
// storage function JSON.stringify()s itself.

type JsonInput = Record<string, unknown> | unknown[] | string;

export interface CreateMlModelParams {
  name: string;
  version?: string;
  architecture: string;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  hyperparameters?: JsonInput | null;
  featureSetId?: number | null;
  trainingDataStart?: number | null;
  trainingDataEnd?: number | null;
  validationSplit?: number;
  targetColumn?: string | null;
  targetHorizon?: number | null;
  metrics?: JsonInput | null;
  status?: string;
}

export type UpdateMlModelParams = Partial<CreateMlModelParams>;

export interface CreateFeatureSetParams {
  name: string;
  description?: string | null;
  features: JsonInput;
  normalization?: JsonInput | null;
  lagPeriods?: JsonInput | null;
  technicalIndicators?: JsonInput | null;
  symbols?: JsonInput | null;
  timeframe?: string | null;
  lookbackBars?: number;
}

export interface ModelOutputParams {
  modelId: number;
  symbol: string;
  timestamp: number;
  prediction: number;
  predictionLabel?: string | null;
  confidence?: number | null;
  probabilities?: JsonInput | null;
  features?: JsonInput | null;
}

export interface CoherenceModelEntry {
  modelId: number;
  modelName: string;
  prediction: number;
  label: string | null;
  confidence: number | null;
}

export interface CoherenceDataPoint {
  timestamp: number;
  modelCount: number;
  agreementRate: number;
  avgConfidence: number;
  divergenceScore: number;
  models: CoherenceModelEntry[];
}

export interface CoherenceSnapshotParams {
  timestamp: number;
  symbol: string;
  modelCorrelations: JsonInput;
  agreementMatrix: JsonInput;
  ensembleSignal?: string | null;
  ensembleConfidence?: number | null;
  divergenceScore?: number | null;
}

export interface CreateEnsembleConfigParams {
  name: string;
  description?: string | null;
  modelIds: number[];
  weights?: Record<string, number> | null;
  aggregationMethod?: string;
  confidenceThreshold?: number;
  unanimityRequired?: number;
  status?: string;
}

export interface EnsembleSignalModelEntry {
  id: number;
  name: string;
  prediction: number;
}

export interface EnsembleSignal {
  timestamp: number;
  ensemblePrediction: number;
  ensembleLabel: 'long' | 'short' | 'neutral';
  confidence: number;
  unanimous: boolean;
  modelCount: number;
  models: EnsembleSignalModelEntry[];
}

export interface CreateTradeParams {
  symbol: string;
  side: string;
  entryTimestamp: number;
  exitTimestamp?: number | null;
  entryPrice: number;
  exitPrice?: number | null;
  quantity?: number;
  pnl?: number | null;
  pnlPct?: number | null;
  commission?: number;
  slippage?: number;
  modelId?: number | null;
  ensembleId?: number | null;
  signalConfidence?: number | null;
  regimeId?: number | null;
  notes?: string | null;
  status?: string;
}

export interface CreateMarketRegimeParams {
  name: string;
  description?: string | null;
  volatilityLevel?: string | null;
  trendDirection?: string | null;
  characteristics?: JsonInput | null;
  detectionRules?: JsonInput | null;
}

export interface RecordRegimeHistoryParams {
  regimeId: number;
  symbol: string;
  startTimestamp: number;
  endTimestamp?: number | null;
  confidence?: number | null;
  detectedBy?: string | null;
}

export interface IObservatoryStorage {
  createMlModel(data: CreateMlModelParams): Promise<MlModel>;
  getMlModels(status?: string): Promise<MlModel[]>;
  getMlModel(id: number): Promise<MlModel | undefined>;
  updateMlModel(id: number, data: UpdateMlModelParams): Promise<void>;
  createFeatureSet(data: CreateFeatureSetParams): Promise<FeatureSet>;
  getFeatureSets(): Promise<FeatureSet[]>;
  saveModelOutput(data: ModelOutputParams): Promise<ModelOutput>;
  saveModelOutputBatch(outputs: ModelOutputParams[]): Promise<void>;
  getModelOutputs(modelId: number, symbol?: string, limit?: number): Promise<ModelOutput[]>;
  getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<CoherenceDataPoint[]>;
  saveCoherenceSnapshot(data: CoherenceSnapshotParams): Promise<CoherenceSnapshot>;
  createEnsembleConfig(data: CreateEnsembleConfigParams): Promise<EnsembleConfig>;
  getEnsembleConfigs(): Promise<EnsembleConfig[]>;
  simulateEnsemble(ensembleId: number, symbol: string, startTime: number, endTime: number): Promise<EnsembleSignal[]>;
  createTrade(data: CreateTradeParams): Promise<Trade>;
  getTrades(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<Trade[]>;
  closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<Trade | null>;
  createMarketRegime(data: CreateMarketRegimeParams): Promise<MarketRegime>;
  getMarketRegimes(): Promise<MarketRegime[]>;
  recordRegimeHistory(data: RecordRegimeHistoryParams): Promise<RegimeHistory>;
}

export interface IBrokerStorage {
  getBrokerConfigs(): Promise<BrokerConfig[]>;
  getBrokerConfig(id: number): Promise<BrokerConfig | undefined>;
  getBrokerConfigByName(name: string): Promise<BrokerConfig | undefined>;
  getDefaultBrokerConfig(assetType: string): Promise<BrokerConfig | undefined>;
}

// ─── Backtesting ─────────────────────────────────────────────────────────────

export interface CreateBacktestRunParams {
  name: string;
  modelId?: number | null;
  symbol: string;
  brokerConfigId?: number | null;
  timeframe?: string;
  trainStartTimestamp?: number | null;
  trainEndTimestamp?: number | null;
  testStartTimestamp?: number | null;
  testEndTimestamp?: number | null;
  splitRatio?: number;
  initialCapital?: number;
  positionSize?: number;
  maxPositions?: number;
  stopLossTicks?: number | null;
  takeProfitTicks?: number | null;
  trailingStopTicks?: number | null;
  maxDrawdownPct?: number | null;
  status?: string;
}

export interface UpdateBacktestRunParams {
  status?: string;
  totalTrades?: number;
  winRate?: number;
  profitFactor?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  maxDrawdown?: number;
  totalReturn?: number;
  totalReturnPct?: number;
  avgWin?: number;
  avgLoss?: number;
  largestWin?: number;
  largestLoss?: number;
  avgHoldingTimeMs?: number;
  expectancy?: number;
  totalCommissions?: number;
  totalSlippage?: number;
  equityCurve?: string;
  errorMessage?: string;
  startedAt?: Date | number;
  completedAt?: Date | number;
}

export type BacktestRunWithJoins = BacktestRun & {
  brokerName: string | null;
  brokerLabel: string | null;
  modelName: string | null;
  modelArchitecture: string | null;
};

export interface CreateBacktestTradeParams {
  backtestRunId: number;
  symbol: string;
  side: string;
  entryTimestamp: number;
  exitTimestamp?: number | null;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  pnl?: number | null;
  netPnl?: number | null;
  commission?: number | null;
  slippage?: number | null;
  spreadCost?: number | null;
  entrySignal?: number | null;
  exitReason?: string | null;
  barsHeld?: number | null;
  maxFavorableExcursion?: number | null;
  maxAdverseExcursion?: number | null;
  runningPnl?: number | null;
}

export interface IBacktestStorage {
  createBacktestRun(data: CreateBacktestRunParams): Promise<BacktestRun>;
  updateBacktestRun(id: number, data: UpdateBacktestRunParams): Promise<void>;
  getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<BacktestRunWithJoins[]>;
  getBacktestRun(id: number): Promise<BacktestRunWithJoins | undefined>;
  insertBacktestTrades(trades: CreateBacktestTradeParams[]): Promise<void>;
  getBacktestTrades(backtestRunId: number, limit?: number): Promise<BacktestTrade[]>;
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

