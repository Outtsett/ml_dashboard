import { sql, type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
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
  pid: integer("pid"),
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
  /** The persisted label set the run trained on (lineage; the set's `consumed` stage). */
  labelSetId: integer("label_set_id").references((): AnySQLiteColumn => generatedLabels.id, { onDelete: 'set null' }),
}, (table) => ({
  modelTypeIdx: index("ts_model_type_idx").on(table.modelType),
  symbolIdx: index("ts_symbol_idx").on(table.symbol),
  statusIdx: index("ts_status_idx").on(table.status),
  versionedModelIdIdx: index("ts_versioned_model_id_idx").on(table.versionedModelId),
  walkForwardGroupIdx: index("ts_wf_group_idx").on(table.walkForwardGroupId),
  labelSetIdIdx: index("ts_label_set_id_idx").on(table.labelSetId),
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

// Per-iteration training metrics — convergence curves that survive restarts.
//
// SUPERSEDED (2026-07-28) by `run_metrics` at the bottom of this file. Kept
// verbatim, unwritten, and not migrated:
//   * It has never had an insert call site, so there is no data to move.
//   * Its identity is `session_id INTEGER` → `training_sessions.id`, which
//     cannot express the (experiment_id, run_id, trial_idx, fold_idx) identity
//     the provenance design requires. Re-keying it means making a NOT NULL
//     column nullable — a rebuild of an existing table, not an additive
//     change, and stage 1 must be purely additive.
// Its *purpose* — durable per-iteration metrics — is now `run_metrics`'.
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

// Model state snapshots — full model state captured every N iterations for live visualization
export const modelStateSnapshots = sqliteTable("model_state_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  iteration: integer("iteration").notNull(),
  snapshot: text("snapshot").notNull(),  // JSON string
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  sessionIterationIdx: index("mss_session_iteration_idx").on(table.sessionId, table.iteration),
  sessionIdx: index("mss_session_idx").on(table.sessionId),
}));

export const insertModelStateSnapshotSchema = createInsertSchema(modelStateSnapshots).omit({ id: true, createdAt: true });
export type InsertModelStateSnapshot = z.infer<typeof insertModelStateSnapshotSchema>;
export type ModelStateSnapshot = typeof modelStateSnapshots.$inferSelect;

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
  // ── Lifecycle (2026-09-26; contract in src/shared/labels/contract.ts) ──
  /** `<generator>_<SYMBOL>_<timeframe>_<hash12>`; unique, so the same request finds its set. */
  recipe: text("recipe"),
  /** SHA-256 of the canonical identity (generator, symbol, timeframe, parameters, window, contract version). */
  parametersHash: text("parameters_hash"),
  timeframeMinutes: integer("timeframe_minutes").notNull().default(1),
  /** The furthest rung reached; CHECK retrofitted by enforce-sqlite-invariants.ts. */
  stage: text("stage").notNull().default("specified"),
  validation: text("validation"), // JSON LabelValidationReport
  validatedAt: integer("validated_at", { mode: "timestamp_ms" }),
  sourceFingerprint: text("source_fingerprint"), // JSON LabelSourceFingerprint
  maxHorizonBars: integer("max_horizon_bars"),
  purgeBars: integer("purge_bars"),
  embargoBars: integer("embargo_bars"),
  landedAt: integer("landed_at", { mode: "timestamp_ms" }),
  retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
  staleDetectedAt: integer("stale_detected_at", { mode: "timestamp_ms" }),
  staleReason: text("stale_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelIdIdx: index("generated_labels_model_id_idx").on(table.modelId),
  generatorTypeIdx: index("generated_labels_generator_type_idx").on(table.generatorType),
  symbolIdx: index("generated_labels_symbol_idx").on(table.symbol),
  statusIdx: index("generated_labels_status_idx").on(table.status),
  // SQLite treats every NULL as distinct, so rows written before recipes existed coexist.
  recipeIdx: uniqueIndex("generated_labels_recipe_idx").on(table.recipe),
  stageIdx: index("generated_labels_stage_idx").on(table.stage),
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

  /** Per-step intermediate values reported during training (JSON: [{step, value}, ...]).
   *  Populated for nested-HPO drivers that emit `hpo-trial-intermediate` events
   *  so the dashboard can draw pruning curves. */
  intermediateValues: text("intermediate_values"),

  /** Walk-forward fold index for nested HPO; null for flat HPO. */
  foldIndex: integer("fold_index"),

  modelPath: text("model_path"),
  trainedModelId: text("trained_model_id"),

  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  sessionIdIdx: index("hpo_t_session_id_idx").on(table.sessionId),
  sessionTrialIdx: index("hpo_t_session_trial_idx").on(table.sessionId, table.trialId),
  statusIdx: index("hpo_t_status_idx").on(table.status),
  scoreIdx: index("hpo_t_score_idx").on(table.score),
  foldIdx: index("hpo_t_fold_idx").on(table.foldIndex),
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
  timeSpentMs: integer("time_spent_ms").notNull().default(0),
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

// ─── Section-level progress (tracks which sections within a lesson have been viewed) ───
export const curriculumSectionProgress = sqliteTable("curriculum_section_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: text("lesson_id").notNull(),
  sectionIndex: integer("section_index").notNull(),
  viewedAt: integer("viewed_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  uniqueSection: index("csp_unique_idx").on(table.userId, table.lessonId, table.sectionIndex),
  userLessonIdx: index("csp_user_lesson_idx").on(table.userId, table.lessonId),
}));

export const insertCurriculumSectionProgressSchema = createInsertSchema(curriculumSectionProgress).omit({ id: true });
export type InsertCurriculumSectionProgress = z.infer<typeof insertCurriculumSectionProgressSchema>;
export type CurriculumSectionProgress = typeof curriculumSectionProgress.$inferSelect;

// ─── Bookmarks & notes ──────────────────────────────────────────
export const curriculumBookmarks = sqliteTable("curriculum_bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: text("lesson_id").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  uniqueBookmark: index("cb_unique_idx").on(table.userId, table.lessonId),
  userIdx: index("cb_user_idx").on(table.userId),
}));

export const insertCurriculumBookmarkSchema = createInsertSchema(curriculumBookmarks).omit({ id: true, updatedAt: true });
export type InsertCurriculumBookmark = z.infer<typeof insertCurriculumBookmarkSchema>;
export type CurriculumBookmark = typeof curriculumBookmarks.$inferSelect;

// ============================================================
// MODEL CHECKPOINTS — self-describing diagnostics storage
// ============================================================

/**
 * Stores model checkpoints with their self-describing diagnostics JSON.
 * Each checkpoint represents a trained model snapshot with full metric declarations.
 * The diagnostics column contains a SelfDescribingDiagnostics JSON blob that the
 * dashboard renders dynamically — different models produce different metric sets.
 */
export const modelCheckpoints = sqliteTable("model_checkpoints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Versioned model ID: {symbol}_{timeframe}_{modelType}_{timestamp} */
  modelId: text("model_id").notNull().unique(),
  /** Model architecture type (e.g., "cnn-transformer", "primitives-discovery", "xgboost") */
  modelType: text("model_type").notNull(),
  /** Trading symbol */
  symbol: text("symbol").notNull(),
  /** Timeframe */
  timeframe: text("timeframe").notNull(),
  /** Full self-describing diagnostics JSON (SelfDescribingDiagnostics schema) */
  diagnosticsJson: text("diagnostics_json").notNull(),
  /** Filesystem path to checkpoint file (.pt, .pkl, .joblib, etc.) */
  checkpointPath: text("checkpoint_path").notNull(),
  /** Filesystem path to diagnostics.json on disk */
  diagnosticsPath: text("diagnostics_path"),
  /** Primary quality metric value for quick sorting (e.g., profit_factor, accuracy) */
  primaryMetric: real("primary_metric"),
  /** Name of the primary metric (e.g., "profit_factor", "sharpe_ratio") */
  primaryMetricName: text("primary_metric_name"),
  /** Total parameter count */
  paramCount: integer("param_count"),
  /** Training duration in seconds */
  trainingDurationSec: real("training_duration_sec"),
  /** Number of training bars */
  nBarsTrain: integer("n_bars_train"),
  /** Number of validation bars */
  nBarsVal: integer("n_bars_val"),
  /** Whether this is the active/deployed checkpoint for its symbol+timeframe */
  isActive: integer("is_active").notNull().default(0),
  /** FK to training session that produced this checkpoint */
  sessionId: integer("session_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelTypeIdx: index("mc_model_type_idx").on(table.modelType),
  symbolIdx: index("mc_symbol_idx").on(table.symbol),
  symbolTimeframeIdx: index("mc_symbol_tf_idx").on(table.symbol, table.timeframe),
  activeIdx: index("mc_active_idx").on(table.isActive),
  primaryMetricIdx: index("mc_primary_metric_idx").on(table.primaryMetric),
  createdAtIdx: index("mc_created_at_idx").on(table.createdAt),
}));

export const insertModelCheckpointSchema = createInsertSchema(modelCheckpoints).omit({ id: true, createdAt: true });
export type InsertModelCheckpoint = z.infer<typeof insertModelCheckpointSchema>;
export type ModelCheckpoint = typeof modelCheckpoints.$inferSelect;

// ============================================================
// PREDICTION LOG — per-bar predictions for backtesting + live
// ============================================================

/**
 * SQLite prediction log for offline analysis.
 * QuestDB prediction_log (created in questdb/tables.ts) handles the hot path
 * for live streaming predictions. This table stores finalized results for
 * dashboard queries and backtesting analysis.
 */
export const predictionLog = sqliteTable("prediction_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** FK to model checkpoint */
  checkpointId: integer("checkpoint_id").notNull(),
  /** Model ID string for quick filtering without join */
  modelId: text("model_id").notNull(),
  /** Trading symbol */
  symbol: text("symbol").notNull(),
  /** Bar timestamp (epoch ms) */
  barTimestamp: integer("bar_timestamp").notNull(),
  /** Predicted class (0=SL, 1=timeout, 2=TP for triple barrier) */
  predictedClass: integer("predicted_class").notNull(),
  /** Actual class (filled after barrier resolution, null if pending) */
  actualClass: integer("actual_class"),
  /** Confidence/probability of predicted class */
  confidence: real("confidence"),
  /** Full probability vector as JSON array */
  probabilities: text("probabilities"),
  /** Realized return at barrier exit (null if pending) */
  realizedReturn: real("realized_return"),
  /** Number of bars until barrier hit (null if pending) */
  exitBars: integer("exit_bars"),
  /** Which barrier was hit: "tp", "sl", "timeout" (null if pending) */
  barrierHit: text("barrier_hit"),
  /** Walk-forward fold index (for OOS tracking) */
  foldIndex: integer("fold_index"),
  /** "train", "val", or "oos" */
  splitType: text("split_type").notNull().default("oos"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  modelIdIdx: index("pl_model_id_idx").on(table.modelId),
  symbolTimestampIdx: index("pl_symbol_ts_idx").on(table.symbol, table.barTimestamp),
  checkpointIdx: index("pl_checkpoint_idx").on(table.checkpointId),
  splitIdx: index("pl_split_idx").on(table.splitType),
  predictedClassIdx: index("pl_predicted_class_idx").on(table.predictedClass),
}));

export const insertPredictionLogSchema = createInsertSchema(predictionLog).omit({ id: true, createdAt: true });
export type InsertPredictionLog = z.infer<typeof insertPredictionLogSchema>;
export type PredictionLog = typeof predictionLog.$inferSelect;

// ============================================================
// MODEL REGISTRY — version lineage, deployments, promotion gates
// ============================================================
//
// Mirrors `migrations/0002_model_registry.sql` (W7.a, parallel work item).
// Column types match the raw SQL exactly:
//   - text columns for ISO-8601 timestamps (CURRENT_TIMESTAMP defaults)
//   - JSON-shaped TEXT columns use Drizzle `mode: 'json'` + `$type<T>()`
//   - SQLite check constraints on enums live in raw SQL only
//     (Drizzle SQLite has no native CHECK helper — TS enum on `text({ enum: ... })`
//     narrows insert/select types but does NOT emit DDL constraints)

/** Promotion lifecycle states for a trained model version. */
export type ModelVersionStatus = 'candidate' | 'shadow' | 'paper' | 'live' | 'retired';

/** Deployment runtime modes. */
export type DeploymentMode = 'shadow' | 'paper' | 'live';

/** Deployment runtime status. */
export type DeploymentStatus = 'running' | 'paused' | 'stopped' | 'failed';

/** Comparator operators for promotion gate thresholds. */
export type GateComparator = '>=' | '<=' | '>' | '<' | '==' | '!=';

/** Triple-barrier / direction / range / regression label config payload. */
export interface LabelConfig {
  kind: string;            // 'triple_barrier' | 'direction' | 'range_class' | 'regression' | ...
  horizon?: number;
  tpTicks?: number;
  slTicks?: number;
  nBuckets?: number;
  bucketWidthPts?: number;
  flatThresholdPts?: number;
  [key: string]: unknown;  // forward-compatible — generators may add fields
}

/** Walk-forward validation configuration captured at training time. */
export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  purgeBars: number;
  embargoBars: number;
  anchored?: boolean;
  nFolds?: number;
}

/** Headline + per-fold + cost-adjusted metrics produced by evaluation. */
export interface MetricsSummary {
  headline: { name: string; value: number };
  perFold?: Array<Record<string, number>>;
  costAdjSharpe?: number;
  profitFactor?: number;
  winRate?: number;
  maxDrawdown?: number;
  ece?: number;
  bootstrapCi?: { lower: number; upper: number; alpha: number };
  [key: string]: unknown;
}

export const modelVersions = sqliteTable("model_versions", {
  versionId: integer("version_id").primaryKey({ autoIncrement: true }),
  catalogId: text("catalog_id").notNull(),
  runnerKey: text("runner_key").notNull(),
  status: text("status", { enum: ['candidate', 'shadow', 'paper', 'live', 'retired'] }).notNull(),
  dataHash: text("data_hash").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  dateRangeStart: text("date_range_start").notNull(),
  dateRangeEnd: text("date_range_end").notNull(),
  featurePipeline: text("feature_pipeline").notNull(),
  labelConfig: text("label_config", { mode: "json" }).$type<LabelConfig>().notNull(),
  hyperparameters: text("hyperparameters", { mode: "json" }).$type<Record<string, number | string | boolean | null>>().notNull(),
  walkForwardConfig: text("walk_forward_config", { mode: "json" }).$type<WalkForwardConfig>(),
  hpoStudyId: text("hpo_study_id"),
  modelArtifactPath: text("model_artifact_path").notNull().unique(),
  diagnosticsPath: text("diagnostics_path").notNull(),
  metricsSummary: text("metrics_summary", { mode: "json" }).$type<MetricsSummary>().notNull(),
  trainedAt: text("trained_at").notNull(),
  promotedAt: text("promoted_at"),
  retiredAt: text("retired_at"),
  // Self-referential FK: ON DELETE SET NULL preserves children, breaks lineage link.
  // AnySQLiteColumn cast is required for the forward-reference closure.
  parentVersionId: integer("parent_version_id").references((): AnySQLiteColumn => modelVersions.versionId, { onDelete: 'set null' }),
  notes: text("notes", { mode: "json" }).$type<Array<{ ts: string; author: string; text: string }>>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  statusIdx: index("idx_model_versions_status").on(table.status),
  catalogIdx: index("idx_model_versions_catalog").on(table.catalogId),
  symbolTfIdx: index("idx_model_versions_symbol_tf").on(table.symbol, table.timeframe),
  dataHashIdx: index("idx_model_versions_data_hash").on(table.dataHash),
  trainedAtIdx: index("idx_model_versions_trained_at").on(table.trainedAt),
}));

export const insertModelVersionSchema = createInsertSchema(modelVersions).omit({ versionId: true, createdAt: true, updatedAt: true });
export type InsertModelVersion = InferInsertModel<typeof modelVersions>;
export type ModelVersion = InferSelectModel<typeof modelVersions>;

export const deployments = sqliteTable("deployments", {
  deploymentId: integer("deployment_id").primaryKey({ autoIncrement: true }),
  // ON DELETE RESTRICT: cannot delete a model version that has deployment history.
  versionId: integer("version_id").notNull().references(() => modelVersions.versionId, { onDelete: 'restrict' }),
  mode: text("mode", { enum: ['shadow', 'paper', 'live'] }).notNull(),
  status: text("status", { enum: ['running', 'paused', 'stopped', 'failed'] }).notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  startedAt: text("started_at").notNull(),
  stoppedAt: text("stopped_at"),
  predictionsEmitted: integer("predictions_emitted").notNull().default(0),
  paperPnl: real("paper_pnl"),
  lastPredictionAt: text("last_prediction_at"),
  lastError: text("last_error"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  versionIdx: index("idx_deployments_version").on(table.versionId),
  statusIdx: index("idx_deployments_status").on(table.status),
  symbolTfModeIdx: index("idx_deployments_symbol_tf_mode").on(table.symbol, table.timeframe, table.mode),
  // NOTE: The "one live per (symbol, timeframe)" invariant is enforced by a
  // PARTIAL UNIQUE INDEX (`WHERE status='running' AND mode='live'`) declared
  // ONLY in raw SQL at `migrations/0002_model_registry.sql`. Drizzle SQLite
  // has no API for partial indexes — do NOT re-declare here. The deployment
  // route handler (W7 be-api) must also re-query before insert as a runtime
  // assertion belt-and-suspenders, since drizzle-kit push would silently
  // drop an unrecognized partial index if it were attempted here.
}));

export const insertDeploymentSchema = createInsertSchema(deployments).omit({ deploymentId: true, createdAt: true });
export type InsertDeployment = InferInsertModel<typeof deployments>;
export type Deployment = InferSelectModel<typeof deployments>;

export const promotionGates = sqliteTable("promotion_gates", {
  gateId: integer("gate_id").primaryKey({ autoIncrement: true }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  metric: text("metric").notNull(),
  comparator: text("comparator", { enum: ['>=', '<=', '>', '<', '==', '!='] }).notNull(),
  threshold: real("threshold").notNull(),
  enforced: integer("enforced", { mode: "boolean" }).notNull().default(true),
  description: text("description"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  transitionIdx: index("idx_promotion_gates_transition").on(table.fromStatus, table.toStatus),
}));

export const insertPromotionGateSchema = createInsertSchema(promotionGates).omit({ gateId: true, createdAt: true });
export type InsertPromotionGate = InferInsertModel<typeof promotionGates>;
export type PromotionGate = InferSelectModel<typeof promotionGates>;

// ============================================================
// AGENT RUNS — Claude Agent SDK dispatch queue + history (W8)
// ============================================================
//
// Mirrors `migrations/0003_agent_runs.sql` (W8.a, parallel work item).
// Column types match the raw SQL exactly:
//   - text columns for ISO-8601 timestamps
//   - JSON-shaped TEXT columns use Drizzle `mode: 'json'` + `$type<T>()`
//   - SQLite check constraints on enums live in raw SQL only
//     (Drizzle SQLite has no native CHECK helper — TS enum on `text({ enum: ... })`
//     narrows insert/select types but does NOT emit DDL constraints)
//
// On server boot, any rows with status IN ('queued','running') get marked
// 'failed' with error='server restart' to clear stale in-flight state.

/** The four ML Studio Workshop specialist agents. */
export type AgentId = 'feature-curator' | 'arch-designer' | 'hpo-strategist' | 'eval-reviewer';

/** Lifecycle states for a single agent dispatch. */
export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Severity levels for agent findings. */
export type AgentFindingSeverity = 'info' | 'warning' | 'error';

/** Action kinds an agent can propose for the user to apply with one click. */
export type AgentProposedActionKind =
  | 'set-feature-pipeline'
  | 'set-hyperparameter'
  | 'add-experiment'
  | 'set-search-space'
  | 'apply-template-edit';

/** A generated source file in an agent-proposed template diff. Mirrors
 *  the client-side `GeneratedFile` shape (kept inline to avoid a
 *  shared->client import — `src/shared/` must stay client-free). */
export interface AgentReportDiffFile {
  path: string;
  language: 'python' | 'json';
  content: string;
}

/** A single quantified observation surfaced by an agent. */
export interface AgentFinding {
  severity: AgentFindingSeverity;
  category: string;  // 'leakage' | 'overfit' | 'regime' | 'calibration' | ...
  message: string;
  evidence: {
    metric: string;
    value: number;
    threshold?: number;
    reference?: string;
  };
}

/** A one-click action the user can apply from the agent report. */
export interface AgentProposedAction {
  kind: AgentProposedActionKind;
  label: string;
  payload: Record<string, unknown>;
}

/** Structured agent response contract — mirrors frontend §8.2. */
export interface AgentReport {
  agentId: AgentId;
  status: 'ok' | 'error';
  summary: string;
  body: string;  // markdown
  findings: AgentFinding[];
  proposedActions: AgentProposedAction[];
  /** arch-designer only: a proposed template-edit diff against the
   *  currently-previewed generated code, with rationale. */
  diff?: {
    files: AgentReportDiffFile[];
    rationale: string;
  };
}

/** Token usage accounting from the Claude Agent SDK call. */
export interface AgentTokenUsage {
  input: number;
  output: number;
  cached: number;
}

export const agentRuns = sqliteTable("agent_runs", {
  runId: text("run_id").primaryKey(),
  agentId: text("agent_id", { enum: ['feature-curator', 'arch-designer', 'hpo-strategist', 'eval-reviewer'] }).notNull(),
  status: text("status", { enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] }).notNull(),
  contextBlob: text("context_blob").notNull(),
  contextBlobHash: text("context_blob_hash").notNull(),
  requestedAt: text("requested_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  output: text("output", { mode: "json" }).$type<AgentReport>(),
  error: text("error"),
  cancelledReason: text("cancelled_reason"),
  durationMs: integer("duration_ms"),
  tokenUsage: text("token_usage", { mode: "json" }).$type<AgentTokenUsage>(),
}, (table) => ({
  agentStatusIdx: index("idx_agent_runs_agent_status").on(table.agentId, table.status),
  requestedAtIdx: index("idx_agent_runs_requested_at").on(table.requestedAt),
  contextHashIdx: index("idx_agent_runs_context_hash").on(table.contextBlobHash),
}));

export const insertAgentRunSchema = createInsertSchema(agentRuns);
export type InsertAgentRun = InferInsertModel<typeof agentRuns>;
export type AgentRun = InferSelectModel<typeof agentRuns>;

// ============================================================
// RUN PROVENANCE — experiments / runs / manifests / metrics
// ============================================================
//
// Mirrors `migrations/0005_run_provenance.sql`. Written by
// `src/server/training/provenance.ts`; nothing reads these tables yet
// (stage 1 of the provenance redesign is deliberately write-only).
//
// Identity hierarchy:
//   catalog_id     stable catalog slug — no timestamp, no symbol
//   experiment_id  "exp_" + ULID (Universally Unique Lexicographically
//                  Sortable Identifier), minted by the Node orchestrator
//   run_id         "run_" + ULID, minted by the orchestrator BEFORE spawn
//   trial_idx /    integer COORDINATES (not identifiers) supplied by Python
//   fold_idx
//
// Logical identity is (experiment_id, trial_idx, fold_idx); physical identity
// is run_id. That absorbs both HPO execution modes with no schema change: an
// in-process Optuna study is one run carrying N trial coordinates, while a
// subprocess-per-trial driver is N runs sharing one experiment_id.
//
// `legacy_model_id` is `versioning.ts::generateVersionedModelId` output —
// deliberately NON-unique (it has second resolution and collides) and
// deliberately still the artifact directory name, so none of the existing
// `data/models/*` directories move or become unreachable.

/** Lifecycle of a single run. `crashed` = the process exited without ever
 *  reporting a terminal state; the exit code is recorded alongside. */
export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'crashed' | 'stopped';

/** Lifecycle of an experiment — the container for every run of one action. */
export type ExperimentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export const experiments = sqliteTable("experiments", {
  experimentId: text("experiment_id").primaryKey(),
  catalogId: text("catalog_id").notNull(),
  runnerKey: text("runner_key").notNull(),
  name: text("name"),
  // Nullable: an experiment is not required to be about one instrument. The
  // current QuestDB OHLCV path always sets both; a generic dataset will not.
  symbol: text("symbol"),
  timeframe: text("timeframe"),
  status: text("status", { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
  runCount: integer("run_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finalizedAt: text("finalized_at"),
}, (table) => ({
  catalogIdx: index("idx_experiments_catalog").on(table.catalogId),
  statusIdx: index("idx_experiments_status").on(table.status),
  createdAtIdx: index("idx_experiments_created_at").on(table.createdAt),
}));

export const insertExperimentSchema = createInsertSchema(experiments);
export type InsertExperiment = InferInsertModel<typeof experiments>;
export type Experiment = InferSelectModel<typeof experiments>;

export const runs = sqliteTable("runs", {
  runId: text("run_id").primaryKey(),
  // ON DELETE CASCADE would delete provenance; RESTRICT keeps the append-only
  // invariant enforced at the database level.
  experimentId: text("experiment_id").notNull().references(() => experiments.experimentId, { onDelete: 'restrict' }),
  catalogId: text("catalog_id").notNull(),
  runnerKey: text("runner_key").notNull(),
  legacyModelId: text("legacy_model_id").notNull(),
  trialIdx: integer("trial_idx"),
  foldIdx: integer("fold_idx"),
  status: text("status", { enum: ['starting', 'running', 'completed', 'failed', 'crashed', 'stopped'] }).notNull(),
  configHash: text("config_hash").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  /** Repo-relative path to `data/runs/<experiment_id>/<run_id>/manifest.json`. */
  manifestPath: text("manifest_path").notNull(),
  /** Repo-relative artifact directory — stays under `data/models/`. */
  artifactDir: text("artifact_dir").notNull(),
  /** Link to the legacy `training_sessions` row, when one exists. */
  trainingSessionId: integer("training_session_id"),
  pid: integer("pid"),
  exitCode: integer("exit_code"),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  heartbeatAt: text("heartbeat_at"),
  finishedAt: text("finished_at"),
}, (table) => ({
  experimentIdx: index("idx_runs_experiment").on(table.experimentId),
  statusIdx: index("idx_runs_status").on(table.status),
  legacyModelIdx: index("idx_runs_legacy_model_id").on(table.legacyModelId),
  configHashIdx: index("idx_runs_config_hash").on(table.configHash),
  coordinateIdx: index("idx_runs_coordinates").on(table.experimentId, table.trialIdx, table.foldIdx),
  heartbeatIdx: index("idx_runs_heartbeat").on(table.heartbeatAt),
}));

export const insertRunSchema = createInsertSchema(runs);
export type InsertRun = InferInsertModel<typeof runs>;
export type Run = InferSelectModel<typeof runs>;

/** Full run manifest (design plan §2.4). Server writes the skeleton before
 *  spawn; Python appends what only it knows. Extra keys are expected — the
 *  index signature is the contract, not a fallback. */
export interface RunManifestDocument {
  identity: {
    manifest_version: number;
    catalog_id: string;
    experiment_id: string;
    run_id: string;
    trial_idx: number | null;
    fold_idx: number | null;
    legacy_model_id: string;
    runner_key: string;
    artifact_dir: string;
  };
  created_at: string;
  config: Record<string, unknown>;
  config_hash: string;
  manifest_hash?: string;
  [key: string]: unknown;
}

export const runManifests = sqliteTable("run_manifests", {
  /** sha256(canonical JSON of the manifest, excluding this field), 16 chars. */
  manifestHash: text("manifest_hash").primaryKey(),
  manifestVersion: integer("manifest_version").notNull(),
  runId: text("run_id").notNull(),
  experimentId: text("experiment_id").notNull(),
  manifestPath: text("manifest_path").notNull(),
  manifest: text("manifest", { mode: "json" }).$type<RunManifestDocument>().notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  runIdx: index("idx_run_manifests_run").on(table.runId),
  experimentIdx: index("idx_run_manifests_experiment").on(table.experimentId),
}));

export const insertRunManifestSchema = createInsertSchema(runManifests);
export type InsertRunManifest = InferInsertModel<typeof runManifests>;
export type RunManifestRow = InferSelectModel<typeof runManifests>;

/**
 * Durable per-iteration metrics — the table that finally gives the never-written
 * `training_metrics` table's purpose a real home, keyed by the provenance
 * identity instead of an integer session id.
 *
 * Not written yet: the parser-side inserts are stage 2 of the migration. The
 * table ships in stage 1 so the schema is in place before anything depends on
 * it, and so the migration file that creates it is a single additive step.
 */
export const runMetrics = sqliteTable("run_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  experimentId: text("experiment_id").notNull(),
  trialIdx: integer("trial_idx"),
  foldIdx: integer("fold_idx"),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value"),
  iteration: integer("iteration"),
  total: integer("total"),
  /** Per-process envelope counter — a gap proves a dropped stdout line. */
  seq: integer("seq"),
  /** Envelope `ts`: RFC3339 UTC with millisecond precision. */
  ts: text("ts"),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  runMetricIdx: index("idx_run_metrics_run_metric").on(table.runId, table.metricName, table.iteration),
  runIdx: index("idx_run_metrics_run").on(table.runId),
  experimentIdx: index("idx_run_metrics_experiment").on(table.experimentId, table.metricName),
}));

export const insertRunMetricSchema = createInsertSchema(runMetrics).omit({ id: true, recordedAt: true });
export type InsertRunMetric = InferInsertModel<typeof runMetrics>;
export type RunMetric = InferSelectModel<typeof runMetrics>;

// ============================================================
// ML STUDIO — SERVER-SIDE "WHERE I LEFT OFF"
// ============================================================

/**
 * The ML Studio Workshop pipeline blob, as the client persists it.
 *
 * The authoritative shape lives in `src/client/src/ml/MLStudioContext.tsx`
 * (`MLStudioPipeline`). It is NOT imported here on purpose: `@shared/schema`
 * is loaded by the server and by drizzle-kit, and neither may pull a .tsx
 * client module into its graph. The index signature is the contract — the
 * server stores the document whole and never reaches inside it, so a client
 * that adds a stage or a field needs no schema change.
 *
 * The few keys named below are the ones the server DOES read, to denormalise
 * the list columns that make a resume picker cheap (no JSON parse per row).
 */
export interface MlStudioPipelineDocument {
  symbol?: string;
  timeframe?: string;
  activeStage?: string;
  experiments?: unknown[];
  [key: string]: unknown;
}

/**
 * Server-side ML Studio pipeline state — one row per (user, symbol, timeframe).
 *
 * Why its own table rather than a `user_preferences` key: the Workshop state is
 * a six-stage document with an experiments ledger, a composition config and the
 * Stage-5/6 selections, and it is keyed by the pair the client already keys its
 * localStorage by. A scalar key/value row gives no natural key, no per-pair
 * listing, and no place to hang the revision counter that makes a two-device
 * write detectable.
 *
 * `userId` is a plain column with NO foreign key to `users.id`. The connection
 * runs `PRAGMA foreign_keys = ON` (see infrastructure/database/db.ts) and the
 * `users` table is empty — a reference would make every insert fail until an
 * auth flow exists. `"local"` is the single-operator default, and the column is
 * already in the unique key, so adding real users later is a backfill, not a
 * schema change.
 */
export const mlStudioPipelineStates = sqliteTable("ml_studio_pipeline_states", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().default("local"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  /** Client payload version — mirrors the `mlstudio:pipeline:v2:` key suffix. */
  schemaVersion: integer("schema_version").notNull().default(2),
  /** Denormalised from the document so a resume list needs no JSON parse. */
  activeStage: text("active_stage"),
  experimentCount: integer("experiment_count").notNull().default(0),
  /** Size of the stored document in bytes — the growth signal for the ledger. */
  stateByteCount: integer("state_byte_count").notNull().default(0),
  pipelineState: text("pipeline_state", { mode: "json" })
    .$type<MlStudioPipelineDocument>()
    .notNull(),
  /** Monotonic per-row counter, bumped server-side on every accepted write. A
   *  client that holds a lower revision is looking at a stale device's copy. */
  clientRevision: integer("client_revision").notNull().default(0),
  /** Opaque id of the browser/tab that wrote last — names the other device. */
  updatedByClientId: text("updated_by_client_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => ({
  pairIdx: uniqueIndex("idx_ml_studio_pipeline_states_pair").on(table.userId, table.symbol, table.timeframe),
  recentIdx: index("idx_ml_studio_pipeline_states_recent").on(table.userId, table.updatedAt),
}));

export const insertMlStudioPipelineStateSchema = createInsertSchema(mlStudioPipelineStates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMlStudioPipelineState = InferInsertModel<typeof mlStudioPipelineStates>;
export type MlStudioPipelineState = InferSelectModel<typeof mlStudioPipelineStates>;
