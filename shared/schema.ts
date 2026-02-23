import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, doublePrecision, serial, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Standard symbol validation regex - use across all databases
export const SYMBOL_REGEX = /^[A-Z][A-Z0-9_\-\/]{0,19}$/;
export function validateSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().trim();
  if (!SYMBOL_REGEX.test(normalized)) {
    throw new Error(`Invalid symbol format: ${symbol}. Must start with letter, contain only A-Z, 0-9, _, -, /`);
  }
  return normalized;
}

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// OHLCV Market Data - 1-second tick data
export const ohlcvData = pgTable("ohlcv_data", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
}, (table) => ({
  timestampIdx: index("timestamp_idx").on(table.timestamp),
  symbolIdx: index("symbol_idx").on(table.symbol),
  symbolTimestampIdx: index("symbol_timestamp_idx").on(table.symbol, table.timestamp),
}));

export const insertOhlcvSchema = createInsertSchema(ohlcvData).omit({ id: true });
export type InsertOhlcv = z.infer<typeof insertOhlcvSchema>;
export type Ohlcv = typeof ohlcvData.$inferSelect;

// Upload tracking
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  symbol: text("symbol").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  status: text("status").notNull().default("processing"),
});

export const insertUploadSchema = createInsertSchema(uploads).omit({ id: true, uploadedAt: true });
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploads.$inferSelect;

// Feature importance for ML models
export const featureImportance = pgTable("feature_importance", {
  id: serial("id").primaryKey(),
  modelName: text("model_name").notNull(),
  featureName: text("feature_name").notNull(),
  importance: doublePrecision("importance").notNull(),
  category: text("category"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFeatureImportanceSchema = createInsertSchema(featureImportance).omit({ id: true, updatedAt: true });
export type InsertFeatureImportance = z.infer<typeof insertFeatureImportanceSchema>;
export type FeatureImportance = typeof featureImportance.$inferSelect;

// Training session tracking for live loss surface updates
export const trainingSessions = pgTable("training_sessions", {
  id: serial("id").primaryKey(),
  modelName: text("model_name").notNull(),
  status: text("status").notNull().default("running"), // running, paused, completed, failed
  currentEpoch: integer("current_epoch").notNull().default(0),
  maxEpochs: integer("max_epochs").notNull(),
  currentLoss: doublePrecision("current_loss"),
  currentValLoss: doublePrecision("current_val_loss"),
  learningRate: doublePrecision("learning_rate").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTrainingSessionSchema = createInsertSchema(trainingSessions).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertTrainingSession = z.infer<typeof insertTrainingSessionSchema>;
export type TrainingSession = typeof trainingSessions.$inferSelect;

// Loss history for 3D surface visualization
export const lossHistory = pgTable("loss_history", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  epoch: integer("epoch").notNull(),
  loss: doublePrecision("loss").notNull(),
  valLoss: doublePrecision("val_loss").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  sessionEpochIdx: index("session_epoch_idx").on(table.sessionId, table.epoch),
}));

export const insertLossHistorySchema = createInsertSchema(lossHistory).omit({ id: true, timestamp: true });
export type InsertLossHistory = z.infer<typeof insertLossHistorySchema>;
export type LossHistory = typeof lossHistory.$inferSelect;

// Instrument metadata - tick/pip sizes, contract specs
export const instruments = pgTable("instruments", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  assetType: text("asset_type").notNull(), // 'futures' or 'forex'
  exchange: text("exchange"), // 'CME', 'CBOT', etc.
  tickSize: doublePrecision("tick_size").notNull(), // Minimum price movement (0.25 for ES, 0.0001 for EURUSD)
  tickValue: doublePrecision("tick_value").notNull(), // Dollar value per tick ($12.50 for ES, $10 for EURUSD standard lot)
  pointValue: doublePrecision("point_value").notNull(), // Dollar value per full point ($50 for ES, $100000 for EURUSD)
  contractSize: doublePrecision("contract_size").notNull().default(1), // 1 for futures, 100000 for forex standard lot
  currency: text("currency").notNull().default("USD"),
  marginRequirement: doublePrecision("margin_requirement"), // Initial margin if known
  tradingHours: text("trading_hours"), // e.g., "Sun 6pm - Fri 5pm ET"
  decimalPlaces: integer("decimal_places").notNull().default(2), // Display precision
  pipSize: doublePrecision("pip_size"),             // NULL for futures, 0.0001 for most forex, 0.01 for JPY pairs
  contractMonths: text("contract_months").array(),  // NULL for forex, ['H','M','U','Z'] for quarterly futures
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  symbolIdx: index("instruments_symbol_idx").on(table.symbol),
  assetTypeIdx: index("instruments_asset_type_idx").on(table.assetType),
}));

export const insertInstrumentSchema = createInsertSchema(instruments).omit({ id: true, createdAt: true });
export type InsertInstrument = z.infer<typeof insertInstrumentSchema>;
export type Instrument = typeof instruments.$inferSelect;

// News articles with sentiment analysis
export const newsArticles = pgTable("news_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content"),
  source: text("source").notNull(), // 'yahoo_finance', 'alpha_vantage', 'reuters', etc.
  sourceUrl: text("source_url"),
  publishedAt: timestamp("published_at").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  sentimentScore: doublePrecision("sentiment_score"), // -1.0 (bearish) to 1.0 (bullish)
  sentimentLabel: text("sentiment_label"), // 'bullish', 'bearish', 'neutral'
  sentimentConfidence: doublePrecision("sentiment_confidence"), // 0.0 to 1.0
  relevanceScore: doublePrecision("relevance_score"), // 0.0 to 1.0 - how relevant to trading
  category: text("category"), // 'earnings', 'economic', 'geopolitical', 'technical', etc.
  externalId: text("external_id"), // Unique ID from source to prevent duplicates
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
export const newsSymbols = pgTable("news_symbols", {
  id: serial("id").primaryKey(),
  newsId: integer("news_id").notNull().references(() => newsArticles.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  isPrimary: integer("is_primary").notNull().default(0), // 1 if this is the main symbol for the article
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
export const mlModels = pgTable("ml_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  architecture: text("architecture").notNull(), // 'lstm', 'transformer', 'xgboost', 'random_forest', etc.
  category: text("category"), // 'supervised', 'unsupervised', 'self-supervised', 'semi-supervised'
  subcategory: text("subcategory"), // 'classification', 'regression', 'clustering', 'anomaly-detection', etc.
  description: text("description"),
  hyperparameters: text("hyperparameters"), // JSON string of hyperparams
  featureSetId: integer("feature_set_id"),
  trainingDataStart: bigint("training_data_start", { mode: "number" }),
  trainingDataEnd: bigint("training_data_end", { mode: "number" }),
  validationSplit: doublePrecision("validation_split").default(0.2),
  targetColumn: text("target_column"), // What we're predicting
  targetHorizon: integer("target_horizon"), // Prediction horizon in bars
  metrics: text("metrics"), // JSON: category-specific metrics (see shared/mlTaxonomy.ts)
  status: text("status").notNull().default("draft"), // 'draft', 'training', 'active', 'retired'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
export const featureSets = pgTable("feature_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  features: text("features").notNull(), // JSON array of feature names
  normalization: text("normalization"), // JSON: { method, params per feature }
  lagPeriods: text("lag_periods"), // JSON array of lag periods used
  technicalIndicators: text("technical_indicators"), // JSON: { sma: [20,50], rsi: 14, etc. }
  symbols: text("symbols"), // JSON array of symbols this feature set applies to
  timeframe: text("timeframe"), // '1s', '1m', '5m', '1h', '1d'
  lookbackBars: integer("lookback_bars").default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("feature_sets_name_idx").on(table.name),
}));

export const insertFeatureSetSchema = createInsertSchema(featureSets).omit({ id: true, createdAt: true });
export type InsertFeatureSet = z.infer<typeof insertFeatureSetSchema>;
export type FeatureSet = typeof featureSets.$inferSelect;

// Model Outputs - store predictions with embeddings for coherence analysis
// Note: embedding column uses pgvector extension (vector type)
export const modelOutputs = pgTable("model_outputs", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").notNull().references(() => mlModels.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  prediction: doublePrecision("prediction").notNull(), // Main prediction value
  predictionLabel: text("prediction_label"), // 'long', 'short', 'neutral', 'up', 'down'
  confidence: doublePrecision("confidence"), // 0.0 to 1.0
  probabilities: text("probabilities"), // JSON: { up: 0.6, down: 0.3, neutral: 0.1 }
  features: text("features"), // JSON snapshot of input features
  // Note: embedding stored separately for pgvector queries
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  modelIdIdx: index("model_outputs_model_id_idx").on(table.modelId),
  symbolTimestampIdx: index("model_outputs_symbol_ts_idx").on(table.symbol, table.timestamp),
  timestampIdx: index("model_outputs_timestamp_idx").on(table.timestamp),
}));

export const insertModelOutputSchema = createInsertSchema(modelOutputs).omit({ id: true, createdAt: true });
export type InsertModelOutput = z.infer<typeof insertModelOutputSchema>;
export type ModelOutput = typeof modelOutputs.$inferSelect;

// Model Output Embeddings - separate table for pgvector (vector type not in drizzle core)
// Will be created via raw SQL for pgvector support
export const modelOutputEmbeddings = pgTable("model_output_embeddings", {
  id: serial("id").primaryKey(),
  outputId: integer("output_id").notNull().references(() => modelOutputs.id, { onDelete: 'cascade' }),
  embeddingDim: integer("embedding_dim").notNull(), // Dimension of the embedding (e.g., 128, 256)
  // embedding column created via SQL: ALTER TABLE ADD COLUMN embedding vector(256)
}, (table) => ({
  outputIdIdx: index("model_output_embeddings_output_id_idx").on(table.outputId),
}));

// Ensemble Configurations - define how models work together
export const ensembleConfigs = pgTable("ensemble_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  modelIds: text("model_ids").notNull(), // JSON array of model IDs
  weights: text("weights"), // JSON: { model_id: weight } or null for equal weighting
  aggregationMethod: text("aggregation_method").notNull().default("vote"), // 'vote', 'average', 'weighted', 'stacking'
  confidenceThreshold: doublePrecision("confidence_threshold").default(0.5),
  unanimityRequired: integer("unanimity_required").default(0), // 1 if all models must agree
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("ensemble_configs_name_idx").on(table.name),
  statusIdx: index("ensemble_configs_status_idx").on(table.status),
}));

export const insertEnsembleConfigSchema = createInsertSchema(ensembleConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnsembleConfig = z.infer<typeof insertEnsembleConfigSchema>;
export type EnsembleConfig = typeof ensembleConfigs.$inferSelect;

// Market Regimes - clustering of market conditions
export const marketRegimes = pgTable("market_regimes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // 'high_vol_bearish', 'low_vol_bullish', 'choppy', etc.
  description: text("description"),
  volatilityLevel: text("volatility_level"), // 'low', 'medium', 'high', 'extreme'
  trendDirection: text("trend_direction"), // 'bullish', 'bearish', 'neutral', 'choppy'
  characteristics: text("characteristics"), // JSON: { avg_range, correlation, momentum }
  detectionRules: text("detection_rules"), // JSON: rules to classify into this regime
  // embedding for regime similarity (created via SQL with pgvector)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("market_regimes_name_idx").on(table.name),
}));

export const insertMarketRegimeSchema = createInsertSchema(marketRegimes).omit({ id: true, createdAt: true });
export type InsertMarketRegime = z.infer<typeof insertMarketRegimeSchema>;
export type MarketRegime = typeof marketRegimes.$inferSelect;

// Regime History - track what regime was active when
export const regimeHistory = pgTable("regime_history", {
  id: serial("id").primaryKey(),
  regimeId: integer("regime_id").notNull().references(() => marketRegimes.id),
  symbol: text("symbol").notNull(),
  startTimestamp: bigint("start_timestamp", { mode: "number" }).notNull(),
  endTimestamp: bigint("end_timestamp", { mode: "number" }),
  confidence: doublePrecision("confidence"),
  detectedBy: text("detected_by"), // 'manual', 'model_name', 'clustering'
}, (table) => ({
  regimeIdIdx: index("regime_history_regime_id_idx").on(table.regimeId),
  symbolIdx: index("regime_history_symbol_idx").on(table.symbol),
  timestampIdx: index("regime_history_timestamp_idx").on(table.startTimestamp),
}));

export const insertRegimeHistorySchema = createInsertSchema(regimeHistory).omit({ id: true });
export type InsertRegimeHistory = z.infer<typeof insertRegimeHistorySchema>;
export type RegimeHistory = typeof regimeHistory.$inferSelect;

// Trades - tracking actual or simulated trades for P&L analysis
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // 'long', 'short'
  entryTimestamp: bigint("entry_timestamp", { mode: "number" }).notNull(),
  exitTimestamp: bigint("exit_timestamp", { mode: "number" }),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price"),
  quantity: doublePrecision("quantity").notNull().default(1),
  pnl: doublePrecision("pnl"), // Profit/loss in currency
  pnlPct: doublePrecision("pnl_pct"), // Profit/loss as percentage
  commission: doublePrecision("commission").default(0),
  slippage: doublePrecision("slippage").default(0),
  modelId: integer("model_id"), // Which model generated the signal
  ensembleId: integer("ensemble_id"), // Or which ensemble
  signalConfidence: doublePrecision("signal_confidence"),
  regimeId: integer("regime_id"), // What regime was active
  notes: text("notes"),
  status: text("status").notNull().default("open"), // 'open', 'closed', 'cancelled'
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
export const coherenceSnapshots = pgTable("coherence_snapshots", {
  id: serial("id").primaryKey(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  symbol: text("symbol").notNull(),
  modelCorrelations: text("model_correlations").notNull(), // JSON: { "model1_model2": 0.85, ... }
  agreementMatrix: text("agreement_matrix").notNull(), // JSON: pairwise agreement %
  ensembleSignal: text("ensemble_signal"), // 'long', 'short', 'neutral'
  ensembleConfidence: doublePrecision("ensemble_confidence"),
  divergenceScore: doublePrecision("divergence_score"), // 0 = all agree, 1 = max disagreement
  createdAt: timestamp("created_at").notNull().defaultNow(),
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

// Generated Labels - track label generation jobs and their outputs
export const generatedLabels = pgTable("generated_labels", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").references(() => mlModels.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  generatorType: text("generator_type").notNull(), // 'direction', 'triple_barrier', 'npmm', 'volatility_adaptive', etc.
  category: text("category").notNull(), // 'classification', 'regression', 'sequence', 'contrastive', etc.
  symbol: text("symbol").notNull(),
  config: text("config").notNull(), // JSON of generator parameters
  sampleCount: integer("sample_count").notNull().default(0),
  positiveCount: integer("positive_count"), // For classification: count of positive labels
  negativeCount: integer("negative_count"), // For classification: count of negative labels
  neutralCount: integer("neutral_count"), // For 3-class: count of neutral labels
  labelDistribution: text("label_distribution"), // JSON: { label: count, ... }
  dataStartTimestamp: bigint("data_start_timestamp", { mode: "number" }),
  dataEndTimestamp: bigint("data_end_timestamp", { mode: "number" }),
  parquetPath: text("parquet_path"), // Path to generated labels in cloud storage
  status: text("status").notNull().default("pending"), // 'pending', 'generating', 'completed', 'failed'
  errorMessage: text("error_message"),
  generationTimeMs: integer("generation_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

// Contrastive Pairs - store pre-generated positive/negative pairs for self-supervised learning
export const contrastivePairs = pgTable("contrastive_pairs", {
  id: serial("id").primaryKey(),
  labelSetId: integer("label_set_id").notNull().references(() => generatedLabels.id, { onDelete: 'cascade' }),
  anchorIdx: integer("anchor_idx").notNull(),
  positiveIdx: integer("positive_idx").notNull(),
  negativeIdx: integer("negative_idx").notNull(),
  pairType: text("pair_type").notNull(), // 'temporal', 'augmentation', 'statistical'
  similarity: doublePrecision("similarity"), // For statistical pairs: correlation value
}, (table) => ({
  labelSetIdIdx: index("contrastive_pairs_label_set_id_idx").on(table.labelSetId),
}));

export const insertContrastivePairSchema = createInsertSchema(contrastivePairs).omit({ id: true });
export type InsertContrastivePair = z.infer<typeof insertContrastivePairSchema>;
export type ContrastivePairRecord = typeof contrastivePairs.$inferSelect;

// ============================================================
// BROKER CONFIGURATIONS
// ============================================================

// Broker profiles — cost models for backtesting with real-world trading conditions
export const brokerConfigs = pgTable("broker_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),        // 'oanda', 'amp_futures'
  broker: text("broker").notNull(),              // 'Oanda', 'AMP Futures'
  assetType: text("asset_type").notNull(),       // 'forex', 'futures'
  commissionType: text("commission_type").notNull(), // 'per_lot', 'per_side', 'per_round_turn', 'spread_only'
  commissionPerLot: doublePrecision("commission_per_lot").default(0), // Forex: per standard lot
  commissionPerSide: doublePrecision("commission_per_side").default(0), // Futures: per contract per side
  commissionPerRoundTurn: doublePrecision("commission_per_round_turn").default(0), // Futures: per contract round trip
  spreadType: text("spread_type").notNull().default("variable"), // 'fixed', 'variable'
  typicalSpreadPips: doublePrecision("typical_spread_pips").default(0), // Forex: typical spread in pips
  slippageModel: text("slippage_model").notNull().default("fixed"), // 'fixed', 'proportional', 'volume_based'
  slippageTicks: doublePrecision("slippage_ticks").default(0), // Average slippage in ticks
  marginType: text("margin_type").notNull().default("fixed"), // 'fixed', 'percentage', 'tiered'
  defaultMargin: doublePrecision("default_margin"),  // Default margin per contract
  config: text("config"),  // JSON: broker-specific overrides { symbolOverrides: { ES: { margin: 500 } } }
  isDefault: integer("is_default").default(0),  // 1 if default for this asset type
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("broker_configs_name_idx").on(table.name),
  assetTypeIdx: index("broker_configs_asset_type_idx").on(table.assetType),
}));

export const insertBrokerConfigSchema = createInsertSchema(brokerConfigs).omit({ id: true, createdAt: true });
export type InsertBrokerConfig = z.infer<typeof insertBrokerConfigSchema>;
export type BrokerConfig = typeof brokerConfigs.$inferSelect;

// ============================================================
// BACKTESTING
// ============================================================

// Backtest runs — each backtest is a complete simulation with a specific model, instrument, and broker config
export const backtestRuns = pgTable("backtest_runs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  modelId: integer("model_id").references(() => mlModels.id, { onDelete: 'set null' }),
  symbol: text("symbol").notNull(),
  brokerConfigId: integer("broker_config_id").references(() => brokerConfigs.id),
  timeframe: text("timeframe").notNull().default("1m"), // '1m', '5m', '15m', '1H', '4H', '1D'

  // Data split configuration
  trainStartTimestamp: bigint("train_start_timestamp", { mode: "number" }),
  trainEndTimestamp: bigint("train_end_timestamp", { mode: "number" }),
  testStartTimestamp: bigint("test_start_timestamp", { mode: "number" }),
  testEndTimestamp: bigint("test_end_timestamp", { mode: "number" }),
  splitRatio: doublePrecision("split_ratio").default(0.8), // train portion

  // Position sizing
  initialCapital: doublePrecision("initial_capital").notNull().default(10000),
  positionSize: doublePrecision("position_size").notNull().default(1), // Contracts/lots
  maxPositions: integer("max_positions").notNull().default(1),

  // Risk management
  stopLossTicks: doublePrecision("stop_loss_ticks"),
  takeProfitTicks: doublePrecision("take_profit_ticks"),
  trailingStopTicks: doublePrecision("trailing_stop_ticks"),
  maxDrawdownPct: doublePrecision("max_drawdown_pct"), // Circuit breaker

  // Results (populated after run)
  status: text("status").notNull().default("pending"), // 'pending', 'running', 'completed', 'failed'
  totalTrades: integer("total_trades"),
  winRate: doublePrecision("win_rate"),
  profitFactor: doublePrecision("profit_factor"),
  sharpeRatio: doublePrecision("sharpe_ratio"),
  sortinoRatio: doublePrecision("sortino_ratio"),
  maxDrawdown: doublePrecision("max_drawdown"),
  totalReturn: doublePrecision("total_return"),
  totalReturnPct: doublePrecision("total_return_pct"),
  avgWin: doublePrecision("avg_win"),
  avgLoss: doublePrecision("avg_loss"),
  largestWin: doublePrecision("largest_win"),
  largestLoss: doublePrecision("largest_loss"),
  avgHoldingTimeMs: doublePrecision("avg_holding_time_ms"),
  expectancy: doublePrecision("expectancy"),
  totalCommissions: doublePrecision("total_commissions"),
  totalSlippage: doublePrecision("total_slippage"),
  equityCurve: text("equity_curve"), // JSON array of { timestamp, equity } points

  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  modelIdIdx: index("backtest_runs_model_id_idx").on(table.modelId),
  symbolIdx: index("backtest_runs_symbol_idx").on(table.symbol),
  statusIdx: index("backtest_runs_status_idx").on(table.status),
}));

export const insertBacktestRunSchema = createInsertSchema(backtestRuns).omit({ id: true, createdAt: true });
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type BacktestRun = typeof backtestRuns.$inferSelect;

// Backtest trades — individual trades within a backtest run (linked to the chart)
export const backtestTrades = pgTable("backtest_trades", {
  id: serial("id").primaryKey(),
  backtestRunId: integer("backtest_run_id").notNull().references(() => backtestRuns.id, { onDelete: 'cascade' }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // 'long', 'short'
  entryTimestamp: bigint("entry_timestamp", { mode: "number" }).notNull(),
  exitTimestamp: bigint("exit_timestamp", { mode: "number" }),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price"),
  quantity: doublePrecision("quantity").notNull().default(1),
  pnl: doublePrecision("pnl"),          // Gross P&L
  netPnl: doublePrecision("net_pnl"),   // After commission + slippage
  commission: doublePrecision("commission").default(0),
  slippage: doublePrecision("slippage").default(0),
  spreadCost: doublePrecision("spread_cost").default(0), // Forex spread cost
  entrySignal: doublePrecision("entry_signal"),     // Model confidence at entry
  exitReason: text("exit_reason"), // 'signal', 'stop_loss', 'take_profit', 'trailing_stop', 'end_of_data'
  barsHeld: integer("bars_held"),
  maxFavorableExcursion: doublePrecision("max_favorable_excursion"),   // MFE in ticks
  maxAdverseExcursion: doublePrecision("max_adverse_excursion"),       // MAE in ticks
  runningPnl: doublePrecision("running_pnl"),  // Cumulative P&L at this trade
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

// File ingestion tracking (dedup) — moved from DuckDB market.duckdb
export const ingestedFiles = pgTable("ingested_files", {
  id: serial("id").primaryKey(),
  filePath: text("file_path").notNull().unique(),
  fileHash: text("file_hash"),
  fileSize: bigint("file_size", { mode: "number" }),
  rowCount: bigint("row_count", { mode: "number" }),
  symbol: text("symbol"),
  tsMin: timestamp("ts_min"),
  tsMax: timestamp("ts_max"),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
}, (table) => ({
  filePathIdx: index("ingested_files_file_path_idx").on(table.filePath),
  symbolIdx: index("ingested_files_symbol_idx").on(table.symbol),
}));

export const insertIngestedFileSchema = createInsertSchema(ingestedFiles).omit({ id: true, ingestedAt: true });
export type InsertIngestedFile = z.infer<typeof insertIngestedFileSchema>;
export type IngestedFile = typeof ingestedFiles.$inferSelect;
