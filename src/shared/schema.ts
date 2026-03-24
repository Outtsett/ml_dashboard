import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import crypto from "crypto";

// Standard symbol validation regex - use across all databases
export const SYMBOL_REGEX = /^[A-Z][A-Z0-9_\-\/]{0,19}$/;
export function validateSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().trim();
  if (!SYMBOL_REGEX.test(normalized)) {
    throw new Error(`Invalid symbol format: ${symbol}. Must start with letter, contain only A-Z, 0-9, _, -, /`);
  }
  return normalized;
}

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Upload tracking
export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  symbol: text("symbol").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  status: text("status").notNull().default("processing"),
});

export const insertUploadSchema = createInsertSchema(uploads).omit({ id: true, uploadedAt: true });
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploads.$inferSelect;

// Feature importance for ML models
export const featureImportance = sqliteTable("feature_importance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelName: text("model_name").notNull(),
  featureName: text("feature_name").notNull(),
  importance: real("importance").notNull(),
  category: text("category"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const insertFeatureImportanceSchema = createInsertSchema(featureImportance).omit({ id: true, updatedAt: true });
export type InsertFeatureImportance = z.infer<typeof insertFeatureImportanceSchema>;
export type FeatureImportance = typeof featureImportance.$inferSelect;

// Training session tracking — persists across server restarts
export const trainingSessions = sqliteTable("training_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // ── Original columns (unchanged) ──
  modelName: text("model_name").notNull(),
  status: text("status").notNull().default("running"), // running, paused, completed, failed, stopped
  currentEpoch: integer("current_epoch").notNull().default(0),
  maxEpochs: integer("max_epochs").notNull(),
  currentLoss: real("current_loss"),
  currentValLoss: real("current_val_loss"),
  learningRate: real("learning_rate").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),

  // ── Phase 1: Training Analytics columns ──
  modelType: text("model_type"),
  symbol: text("symbol"),
  timeframe: text("timeframe"),
  versionedModelId: text("versioned_model_id"),
  hyperparameters: text("hyperparameters"),
  featureCategories: text("feature_categories"),
  trainDateStart: integer("train_date_start"),
  trainDateEnd: integer("train_date_end"),
  testDateStart: integer("test_date_start"),
  testDateEnd: integer("test_date_end"),
  totalBars: integer("total_bars"),
  totalFeatures: integer("total_features"),
  modelPath: text("model_path"),
  diagnostics: text("diagnostics"),
  qualityScore: real("quality_score"),
  evaluationGrade: text("evaluation_grade"),
  walkForwardGroupId: text("walk_forward_group_id"),
  windowIndex: integer("window_index"),
  errorMessage: text("error_message"),
  elapsedSec: real("elapsed_sec"),
  resourcePeakMemoryMb: real("resource_peak_memory_mb"),
  resourceAvgCpuPct: real("resource_avg_cpu_pct"),
}, (table) => ({
  modelTypeIdx: index("ts_model_type_idx").on(table.modelType),
  symbolIdx: index("ts_symbol_idx").on(table.symbol),
  statusIdx: index("ts_status_idx").on(table.status),
  versionedModelIdIdx: index("ts_versioned_model_id_idx").on(table.versionedModelId),
  walkForwardGroupIdx: index("ts_wf_group_idx").on(table.walkForwardGroupId),
}));

export const insertTrainingSessionSchema = createInsertSchema(trainingSessions).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertTrainingSession = z.infer<typeof insertTrainingSessionSchema>;
export type TrainingSession = typeof trainingSessions.$inferSelect;

// Loss history for 3D surface visualization
export const lossHistory = sqliteTable("loss_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  epoch: integer("epoch").notNull(),
  loss: real("loss").notNull(),
  valLoss: real("val_loss").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionEpochIdx: index("session_epoch_idx").on(table.sessionId, table.epoch),
}));

export const insertLossHistorySchema = createInsertSchema(lossHistory).omit({ id: true, timestamp: true });
export type InsertLossHistory = z.infer<typeof insertLossHistorySchema>;
export type LossHistory = typeof lossHistory.$inferSelect;

// Per-iteration training metrics — convergence curves that survive restarts
export const trainingMetrics = sqliteTable("training_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  iteration: integer("iteration").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionMetricIdx: index("tm_session_metric_idx").on(table.sessionId, table.metricName, table.iteration),
  sessionIdx: index("tm_session_idx").on(table.sessionId),
}));

export const insertTrainingMetricSchema = createInsertSchema(trainingMetrics).omit({ id: true, timestamp: true });
export type InsertTrainingMetric = z.infer<typeof insertTrainingMetricSchema>;
export type TrainingMetric = typeof trainingMetrics.$inferSelect;

// Statistical evaluation results — per-test pass/fail with p-values
export const evaluationResults = sqliteTable("evaluation_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  stage: text("stage").notNull(),
  testName: text("test_name").notNull(),
  testValue: real("test_value"),
  testPassed: integer("test_passed"),
  pValue: real("p_value"),
  details: text("details"),
  computedAt: integer("computed_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionStageIdx: index("er_session_stage_idx").on(table.sessionId, table.stage, table.testName),
  sessionIdx: index("er_session_idx").on(table.sessionId),
}));

export const insertEvaluationResultSchema = createInsertSchema(evaluationResults).omit({ id: true, computedAt: true });
export type InsertEvaluationResult = z.infer<typeof insertEvaluationResultSchema>;
export type EvaluationResult = typeof evaluationResults.$inferSelect;

// Instrument metadata - tick/pip sizes, contract specs
export const instruments = sqliteTable("instruments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  assetType: text("asset_type").notNull(), // 'futures' or 'forex'
  exchange: text("exchange"), // 'CME', 'CBOT', etc.
  tickSize: real("tick_size").notNull(),
  tickValue: real("tick_value").notNull(),
  pointValue: real("point_value").notNull(),
  contractSize: real("contract_size").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  marginRequirement: real("margin_requirement"),
  tradingHours: text("trading_hours"),
  decimalPlaces: integer("decimal_places").notNull().default(2),
  pipSize: real("pip_size"),
  contractMonths: text("contract_months"), // JSON string, e.g. '["H","M","U","Z"]'
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  symbolIdx: index("instruments_symbol_idx").on(table.symbol),
  assetTypeIdx: index("instruments_asset_type_idx").on(table.assetType),
}));

export const insertInstrumentSchema = createInsertSchema(instruments).omit({ id: true, createdAt: true });
export type InsertInstrument = z.infer<typeof insertInstrumentSchema>;
export type Instrument = typeof instruments.$inferSelect;

// News articles with sentiment analysis
export const newsArticles = sqliteTable("news_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content"),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  sentimentScore: real("sentiment_score"),
  sentimentLabel: text("sentiment_label"),
  sentimentConfidence: real("sentiment_confidence"),
  relevanceScore: real("relevance_score"),
  category: text("category"),
  externalId: text("external_id"),
}, (table) => ({
  publishedAtIdx: index("news_published_at_idx").on(table.publishedAt),
  sourceIdx: index("news_source_idx").on(table.source),
  sentimentIdx: index("news_sentiment_idx").on(table.sentimentScore),
  externalIdIdx: index("news_external_id_idx").on(table.externalId),
}));

export const insertNewsArticleSchema = createInsertSchema(newsArticles).omit({ id: true, fetchedAt: true });
export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticles.$inferSelect;

// Many-to-many: News articles linked to symbols
export const newsSymbols = sqliteTable("news_symbols", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  newsId: integer("news_id").notNull().references(() => newsArticles.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  isPrimary: integer("is_primary").notNull().default(0),
}, (table) => ({
  newsIdIdx: index("news_symbols_news_id_idx").on(table.newsId),
  symbolIdx: index("news_symbols_symbol_idx").on(table.symbol),
  newsSymbolIdx: index("news_symbols_composite_idx").on(table.newsId, table.symbol),
}));

export const insertNewsSymbolSchema = createInsertSchema(newsSymbols).omit({ id: true });
export type InsertNewsSymbol = z.infer<typeof insertNewsSymbolSchema>;
export type NewsSymbol = typeof newsSymbols.$inferSelect;

// ============================================================
// ML OBSERVATORY SCHEMA
// ============================================================

// ML Model Registry - track all trained models
export const mlModels = sqliteTable("ml_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  architecture: text("architecture").notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  description: text("description"),
  hyperparameters: text("hyperparameters"), // JSON string
  featureSetId: integer("feature_set_id"),
  trainingDataStart: integer("training_data_start"),
  trainingDataEnd: integer("training_data_end"),
  validationSplit: real("validation_split").default(0.2),
  targetColumn: text("target_column"),
  targetHorizon: integer("target_horizon"),
  metrics: text("metrics"), // JSON string
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  nameVersionIdx: index("ml_models_name_version_idx").on(table.name, table.version),
  architectureIdx: index("ml_models_architecture_idx").on(table.architecture),
  categoryIdx: index("ml_models_category_idx").on(table.category),
  subcategoryIdx: index("ml_models_subcategory_idx").on(table.subcategory),
  statusIdx: index("ml_models_status_idx").on(table.status),
}));

export const insertMlModelSchema = createInsertSchema(mlModels).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMlModel = z.infer<typeof insertMlModelSchema>;
export type MlModel = typeof mlModels.$inferSelect;

// Feature Sets - define input feature configurations
export const featureSets = sqliteTable("feature_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  features: text("features").notNull(), // JSON array
  normalization: text("normalization"), // JSON
  lagPeriods: text("lag_periods"), // JSON array
  technicalIndicators: text("technical_indicators"), // JSON
  symbols: text("symbols"), // JSON array
  timeframe: text("timeframe"),
  lookbackBars: integer("lookback_bars").default(100),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  nameIdx: index("feature_sets_name_idx").on(table.name),
}));

export const insertFeatureSetSchema = createInsertSchema(featureSets).omit({ id: true, createdAt: true });
export type InsertFeatureSet = z.infer<typeof insertFeatureSetSchema>;
export type FeatureSet = typeof featureSets.$inferSelect;

// Model Outputs - store predictions for coherence analysis
export const modelOutputs = sqliteTable("model_outputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelId: integer("model_id").notNull().references(() => mlModels.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  timestamp: integer("timestamp").notNull(), // epoch ms
  prediction: real("prediction").notNull(),
  predictionLabel: text("prediction_label"),
  confidence: real("confidence"),
  probabilities: text("probabilities"), // JSON
  features: text("features"), // JSON
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelIdIdx: index("model_outputs_model_id_idx").on(table.modelId),
  symbolTimestampIdx: index("model_outputs_symbol_ts_idx").on(table.symbol, table.timestamp),
  timestampIdx: index("model_outputs_timestamp_idx").on(table.timestamp),
}));

export const insertModelOutputSchema = createInsertSchema(modelOutputs).omit({ id: true, createdAt: true });
export type InsertModelOutput = z.infer<typeof insertModelOutputSchema>;
export type ModelOutput = typeof modelOutputs.$inferSelect;

// Ensemble Configurations - define how models work together
export const ensembleConfigs = sqliteTable("ensemble_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  modelIds: text("model_ids").notNull(), // JSON array
  weights: text("weights"), // JSON
  aggregationMethod: text("aggregation_method").notNull().default("vote"),
  confidenceThreshold: real("confidence_threshold").default(0.5),
  unanimityRequired: integer("unanimity_required").default(0),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  nameIdx: index("ensemble_configs_name_idx").on(table.name),
  statusIdx: index("ensemble_configs_status_idx").on(table.status),
}));

export const insertEnsembleConfigSchema = createInsertSchema(ensembleConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnsembleConfig = z.infer<typeof insertEnsembleConfigSchema>;
export type EnsembleConfig = typeof ensembleConfigs.$inferSelect;

// Market Regimes - clustering of market conditions
export const marketRegimes = sqliteTable("market_regimes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  volatilityLevel: text("volatility_level"),
  trendDirection: text("trend_direction"),
  characteristics: text("characteristics"), // JSON
  detectionRules: text("detection_rules"), // JSON
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  nameIdx: index("market_regimes_name_idx").on(table.name),
}));

export const insertMarketRegimeSchema = createInsertSchema(marketRegimes).omit({ id: true, createdAt: true });
export type InsertMarketRegime = z.infer<typeof insertMarketRegimeSchema>;
export type MarketRegime = typeof marketRegimes.$inferSelect;

// Regime History - track what regime was active when
export const regimeHistory = sqliteTable("regime_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  regimeId: integer("regime_id").notNull().references(() => marketRegimes.id),
  symbol: text("symbol").notNull(),
  startTimestamp: integer("start_timestamp").notNull(), // epoch ms
  endTimestamp: integer("end_timestamp"), // epoch ms
  confidence: real("confidence"),
  detectedBy: text("detected_by"),
}, (table) => ({
  regimeIdIdx: index("regime_history_regime_id_idx").on(table.regimeId),
  symbolIdx: index("regime_history_symbol_idx").on(table.symbol),
  timestampIdx: index("regime_history_timestamp_idx").on(table.startTimestamp),
}));

export const insertRegimeHistorySchema = createInsertSchema(regimeHistory).omit({ id: true });
export type InsertRegimeHistory = z.infer<typeof insertRegimeHistorySchema>;
export type RegimeHistory = typeof regimeHistory.$inferSelect;

// Trades - tracking actual or simulated trades for P&L analysis
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entryTimestamp: integer("entry_timestamp").notNull(), // epoch ms
  exitTimestamp: integer("exit_timestamp"), // epoch ms
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull().default(1),
  pnl: real("pnl"),
  pnlPct: real("pnl_pct"),
  commission: real("commission").default(0),
  slippage: real("slippage").default(0),
  modelId: integer("model_id"),
  ensembleId: integer("ensemble_id"),
  signalConfidence: real("signal_confidence"),
  regimeId: integer("regime_id"),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  symbolIdx: index("trades_symbol_idx").on(table.symbol),
  entryTimestampIdx: index("trades_entry_ts_idx").on(table.entryTimestamp),
  modelIdIdx: index("trades_model_id_idx").on(table.modelId),
  statusIdx: index("trades_status_idx").on(table.status),
}));

export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

// Model Coherence Snapshots - pre-computed coherence metrics for visualization
export const coherenceSnapshots = sqliteTable("coherence_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp").notNull(), // epoch ms
  symbol: text("symbol").notNull(),
  modelCorrelations: text("model_correlations").notNull(), // JSON
  agreementMatrix: text("agreement_matrix").notNull(), // JSON
  ensembleSignal: text("ensemble_signal"),
  ensembleConfidence: real("ensemble_confidence"),
  divergenceScore: real("divergence_score"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  timestampIdx: index("coherence_snapshots_ts_idx").on(table.timestamp),
  symbolIdx: index("coherence_snapshots_symbol_idx").on(table.symbol),
}));

export const insertCoherenceSnapshotSchema = createInsertSchema(coherenceSnapshots).omit({ id: true, createdAt: true });
export type InsertCoherenceSnapshot = z.infer<typeof insertCoherenceSnapshotSchema>;
export type CoherenceSnapshot = typeof coherenceSnapshots.$inferSelect;

// ============================================================
// LABEL GENERATION TRACKING
// ============================================================

export const generatedLabels = sqliteTable("generated_labels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelId: integer("model_id").references(() => mlModels.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  generatorType: text("generator_type").notNull(),
  category: text("category").notNull(),
  symbol: text("symbol").notNull(),
  config: text("config").notNull(), // JSON
  sampleCount: integer("sample_count").notNull().default(0),
  positiveCount: integer("positive_count"),
  negativeCount: integer("negative_count"),
  neutralCount: integer("neutral_count"),
  labelDistribution: text("label_distribution"), // JSON
  dataStartTimestamp: integer("data_start_timestamp"), // epoch ms
  dataEndTimestamp: integer("data_end_timestamp"), // epoch ms
  parquetPath: text("parquet_path"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  generationTimeMs: integer("generation_time_ms"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelIdIdx: index("generated_labels_model_id_idx").on(table.modelId),
  generatorTypeIdx: index("generated_labels_generator_type_idx").on(table.generatorType),
  symbolIdx: index("generated_labels_symbol_idx").on(table.symbol),
  statusIdx: index("generated_labels_status_idx").on(table.status),
}));

export const insertGeneratedLabelsSchema = createInsertSchema(generatedLabels).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
export type InsertGeneratedLabels = z.infer<typeof insertGeneratedLabelsSchema>;
export type GeneratedLabels = typeof generatedLabels.$inferSelect;

// Contrastive Pairs - pre-generated positive/negative pairs for self-supervised learning
export const contrastivePairs = sqliteTable("contrastive_pairs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  labelSetId: integer("label_set_id").notNull().references(() => generatedLabels.id, { onDelete: 'cascade' }),
  anchorIdx: integer("anchor_idx").notNull(),
  positiveIdx: integer("positive_idx").notNull(),
  negativeIdx: integer("negative_idx").notNull(),
  pairType: text("pair_type").notNull(),
  similarity: real("similarity"),
}, (table) => ({
  labelSetIdIdx: index("contrastive_pairs_label_set_id_idx").on(table.labelSetId),
}));

export const insertContrastivePairSchema = createInsertSchema(contrastivePairs).omit({ id: true });
export type InsertContrastivePair = z.infer<typeof insertContrastivePairSchema>;
export type ContrastivePairRecord = typeof contrastivePairs.$inferSelect;

// ============================================================
// BROKER CONFIGURATIONS
// ============================================================

export const brokerConfigs = sqliteTable("broker_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  broker: text("broker").notNull(),
  assetType: text("asset_type").notNull(),
  commissionType: text("commission_type").notNull(),
  commissionPerLot: real("commission_per_lot").default(0),
  commissionPerSide: real("commission_per_side").default(0),
  commissionPerRoundTurn: real("commission_per_round_turn").default(0),
  spreadType: text("spread_type").notNull().default("variable"),
  typicalSpreadPips: real("typical_spread_pips").default(0),
  slippageModel: text("slippage_model").notNull().default("fixed"),
  slippageTicks: real("slippage_ticks").default(0),
  marginType: text("margin_type").notNull().default("fixed"),
  defaultMargin: real("default_margin"),
  config: text("config"), // JSON
  isDefault: integer("is_default").default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  nameIdx: index("broker_configs_name_idx").on(table.name),
  assetTypeIdx: index("broker_configs_asset_type_idx").on(table.assetType),
}));

export const insertBrokerConfigSchema = createInsertSchema(brokerConfigs).omit({ id: true, createdAt: true });
export type InsertBrokerConfig = z.infer<typeof insertBrokerConfigSchema>;
export type BrokerConfig = typeof brokerConfigs.$inferSelect;

// ============================================================
// STRATEGIES
// ============================================================

export const strategies = sqliteTable("strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'ml_prediction' | 'momentum' | 'indicator' | 'hybrid'
  description: text("description"),
  config: text("config").notNull(), // JSON of full StrategyDefinition
  modelId: integer("model_id").references(() => mlModels.id, { onDelete: 'set null' }),
  symbol: text("symbol"),
  isDefault: integer("is_default").default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  typeIdx: index("strategies_type_idx").on(table.type),
  symbolIdx: index("strategies_symbol_idx").on(table.symbol),
}));

export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

// ============================================================
// BACKTESTING
// ============================================================

export const backtestRuns = sqliteTable("backtest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  modelId: integer("model_id").references(() => mlModels.id, { onDelete: 'set null' }),
  symbol: text("symbol").notNull(),
  brokerConfigId: integer("broker_config_id").references(() => brokerConfigs.id),
  timeframe: text("timeframe").notNull().default("1m"),

  trainStartTimestamp: integer("train_start_timestamp"),
  trainEndTimestamp: integer("train_end_timestamp"),
  testStartTimestamp: integer("test_start_timestamp"),
  testEndTimestamp: integer("test_end_timestamp"),
  splitRatio: real("split_ratio").default(0.8),

  initialCapital: real("initial_capital").notNull().default(10000),
  positionSize: real("position_size").notNull().default(1),
  maxPositions: integer("max_positions").notNull().default(1),

  stopLossTicks: real("stop_loss_ticks"),
  takeProfitTicks: real("take_profit_ticks"),
  trailingStopTicks: real("trailing_stop_ticks"),
  maxDrawdownPct: real("max_drawdown_pct"),

  signalSource: text("signal_source"), // 'model' | 'momentum' | 'indicator' | 'hybrid'
  strategyConfig: text("strategy_config"), // JSON of StrategyDefinition
  walkForwardGroupId: text("walk_forward_group_id"), // groups WF windows
  walkForwardWindowIndex: integer("walk_forward_window_index"),
  totalSpreadCost: real("total_spread_cost"),
  calmarRatio: real("calmar_ratio"),

  status: text("status").notNull().default("pending"),
  totalTrades: integer("total_trades"),
  winRate: real("win_rate"),
  profitFactor: real("profit_factor"),
  sharpeRatio: real("sharpe_ratio"),
  sortinoRatio: real("sortino_ratio"),
  maxDrawdown: real("max_drawdown"),
  totalReturn: real("total_return"),
  totalReturnPct: real("total_return_pct"),
  avgWin: real("avg_win"),
  avgLoss: real("avg_loss"),
  largestWin: real("largest_win"),
  largestLoss: real("largest_loss"),
  avgHoldingTimeMs: real("avg_holding_time_ms"),
  expectancy: real("expectancy"),
  totalCommissions: real("total_commissions"),
  totalSlippage: real("total_slippage"),
  equityCurve: text("equity_curve"), // JSON

  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelIdIdx: index("backtest_runs_model_id_idx").on(table.modelId),
  symbolIdx: index("backtest_runs_symbol_idx").on(table.symbol),
  statusIdx: index("backtest_runs_status_idx").on(table.status),
}));

export const insertBacktestRunSchema = createInsertSchema(backtestRuns).omit({ id: true, createdAt: true });
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type BacktestRun = typeof backtestRuns.$inferSelect;

// Backtest trades — individual trades within a backtest run
export const backtestTrades = sqliteTable("backtest_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  backtestRunId: integer("backtest_run_id").notNull().references(() => backtestRuns.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entryTimestamp: integer("entry_timestamp").notNull(), // epoch ms
  exitTimestamp: integer("exit_timestamp"), // epoch ms
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull().default(1),
  pnl: real("pnl"),
  netPnl: real("net_pnl"),
  commission: real("commission").default(0),
  slippage: real("slippage").default(0),
  spreadCost: real("spread_cost").default(0),
  entrySignal: real("entry_signal"),
  exitReason: text("exit_reason"),
  barsHeld: integer("bars_held"),
  maxFavorableExcursion: real("max_favorable_excursion"),
  maxAdverseExcursion: real("max_adverse_excursion"),
  runningPnl: real("running_pnl"),
}, (table) => ({
  backtestRunIdIdx: index("backtest_trades_run_id_idx").on(table.backtestRunId),
  entryTimestampIdx: index("backtest_trades_entry_ts_idx").on(table.entryTimestamp),
}));

export const insertBacktestTradeSchema = createInsertSchema(backtestTrades).omit({ id: true });
export type InsertBacktestTrade = z.infer<typeof insertBacktestTradeSchema>;
export type BacktestTrade = typeof backtestTrades.$inferSelect;

// ============================================================
// FILE INGESTION TRACKING
// ============================================================

export const ingestedFiles = sqliteTable("ingested_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filePath: text("file_path").notNull().unique(),
  fileHash: text("file_hash"),
  fileSize: integer("file_size"),
  rowCount: integer("row_count"),
  symbol: text("symbol"),
  tsMin: integer("ts_min", { mode: "timestamp_ms" }),
  tsMax: integer("ts_max", { mode: "timestamp_ms" }),
  ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  filePathIdx: index("ingested_files_file_path_idx").on(table.filePath),
  symbolIdx: index("ingested_files_symbol_idx").on(table.symbol),
}));

export const insertIngestedFileSchema = createInsertSchema(ingestedFiles).omit({ id: true, ingestedAt: true });
export type InsertIngestedFile = z.infer<typeof insertIngestedFileSchema>;
export type IngestedFile = typeof ingestedFiles.$inferSelect;

// ============================================================
// EVENT STORE
// ============================================================

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  streamId: text("stream_id").notNull(),
  streamPosition: integer("stream_position").notNull(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  data: text("data").notNull(),
  metadata: text("metadata").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  streamPositionUnique: index("events_stream_position_unique").on(table.streamId, table.streamPosition),
  streamIdx: index("idx_events_stream").on(table.streamId, table.streamPosition),
  typeIdx: index("idx_events_type").on(table.type),
  createdIdx: index("idx_events_created").on(table.createdAt),
}));

export type EventRow = typeof events.$inferSelect;

// ============================================================
// HPO (HYPERPARAMETER OPTIMIZATION) SCHEMA
// ============================================================

export const hpoSessions = sqliteTable("hpo_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique(),
  modelType: text("model_type").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),

  status: text("status").notNull().default("pending"),

  optimizerType: text("optimizer_type").notNull(),
  optimizerConfig: text("optimizer_config").notNull(),
  objectiveMetric: text("objective_metric").notNull(),
  objectiveDirection: text("objective_direction").notNull().default("minimize"),
  searchSpace: text("search_space").notNull(),
  fixedHyperparameters: text("fixed_hyperparameters"),

  totalTrials: integer("total_trials").notNull().default(0),
  completedTrials: integer("completed_trials").notNull().default(0),
  prunedTrials: integer("pruned_trials").notNull().default(0),
  failedTrials: integer("failed_trials").notNull().default(0),

  bestTrialId: integer("best_trial_id"),
  bestScore: real("best_score"),
  bestParams: text("best_params"),

  wandbEnabled: integer("wandb_enabled").notNull().default(0),
  wandbProject: text("wandb_project"),
  wandbRunId: text("wandb_run_id"),

  dateRangeStart: text("date_range_start"),
  dateRangeEnd: text("date_range_end"),
  maxBars: integer("max_bars"),
  featureCategories: text("feature_categories"),

  errorMessage: text("error_message"),

  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  elapsedSec: real("elapsed_sec"),
}, (table) => ({
  sessionIdIdx: index("hpo_s_session_id_idx").on(table.sessionId),
  modelTypeIdx: index("hpo_s_model_type_idx").on(table.modelType),
  symbolIdx: index("hpo_s_symbol_idx").on(table.symbol),
  statusIdx: index("hpo_s_status_idx").on(table.status),
  optimizerTypeIdx: index("hpo_s_optimizer_type_idx").on(table.optimizerType),
}));

export const insertHpoSessionSchema = createInsertSchema(hpoSessions).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertHpoSession = z.infer<typeof insertHpoSessionSchema>;
export type HpoSession = typeof hpoSessions.$inferSelect;

export const hpoTrials = sqliteTable("hpo_trials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  trialId: integer("trial_id").notNull(),

  status: text("status").notNull().default("running"),

  params: text("params").notNull(),
  score: real("score"),
  metrics: text("metrics"),

  pruned: integer("pruned").notNull().default(0),
  prunedAtStep: integer("pruned_at_step"),
  error: text("error"),

  durationSec: real("duration_sec"),
  iterationHistory: text("iteration_history"),

  modelPath: text("model_path"),
  trainedModelId: text("trained_model_id"),

  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  sessionIdIdx: index("hpo_t_session_id_idx").on(table.sessionId),
  sessionTrialIdx: index("hpo_t_session_trial_idx").on(table.sessionId, table.trialId),
  statusIdx: index("hpo_t_status_idx").on(table.status),
  scoreIdx: index("hpo_t_score_idx").on(table.score),
}));

export const insertHpoTrialSchema = createInsertSchema(hpoTrials).omit({ id: true, startedAt: true });
export type InsertHpoTrial = z.infer<typeof insertHpoTrialSchema>;
export type HpoTrial = typeof hpoTrials.$inferSelect;

export const hpoSearchSpaces = sqliteTable("hpo_search_spaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  modelType: text("model_type").notNull(),
  searchSpace: text("search_space").notNull(),
  optimizerType: text("optimizer_type"),
  optimizerConfig: text("optimizer_config"),

  timesUsed: integer("times_used").notNull().default(0),
  bestScoreEver: real("best_score_ever"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelTypeIdx: index("hpo_ss_model_type_idx").on(table.modelType),
  nameIdx: index("hpo_ss_name_idx").on(table.name),
}));

export const insertHpoSearchSpaceSchema = createInsertSchema(hpoSearchSpaces).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHpoSearchSpace = z.infer<typeof insertHpoSearchSpaceSchema>;
export type HpoSearchSpace = typeof hpoSearchSpaces.$inferSelect;

// User preferences — key/value store for UI and app settings
export const userPreferences = sqliteTable("user_preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(), // JSON-encoded value
  category: text("category").notNull().default("general"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const insertUserPreferenceSchema = createInsertSchema(userPreferences).omit({ id: true });
export type UserPreference = typeof userPreferences.$inferSelect;

// MotiveWave file state tracking — persists incremental ingest progress across restarts
export const mwFileStates = sqliteTable("mw_file_states", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filePath: text("file_path").notNull().unique(),
  fileSize: integer("file_size").notNull(),
  lastModified: real("last_modified").notNull(),
  rowsImported: integer("rows_imported").notNull().default(0),
  symbol: text("symbol"),
  timeframe: text("timeframe"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export type MwFileState = typeof mwFileStates.$inferSelect;

// ============================================================
// CURRICULUM & EDUCATION
// ============================================================

export const curriculumProgress = sqliteTable("curriculum_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  moduleId: text("module_id").notNull(),
  lessonId: text("lesson_id").notNull(),
  status: text("status").notNull().default("not_started"), // not_started, in_progress, completed
  score: real("score"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  userModuleIdx: index("cp_user_module_idx").on(table.userId, table.moduleId),
  userLessonIdx: index("cp_user_lesson_idx").on(table.userId, table.lessonId),
  uniqueProgress: index("cp_unique_idx").on(table.userId, table.moduleId, table.lessonId),
}));

export const insertCurriculumProgressSchema = createInsertSchema(curriculumProgress).omit({ id: true, updatedAt: true });
export type InsertCurriculumProgress = z.infer<typeof insertCurriculumProgressSchema>;
export type CurriculumProgress = typeof curriculumProgress.$inferSelect;
