import { pgTable, serial, text, doublePrecision, timestamp, integer } from "drizzle-orm/pg-core";

export const experimentsPg = pgTable("experiments_pg", {
  id: serial("id").primaryKey(),
  experimentId: text("experiment_id").notNull(),
  model: text("model").notNull(),
  reward: doublePrecision("reward").notNull().default(0),
  valScore: doublePrecision("val_score").notNull().default(0),
  status: text("status").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metricsPg = pgTable("metrics_pg", {
  id: serial("id").primaryKey(),
  experimentId: text("experiment_id").notNull(),
  reward: doublePrecision("reward").notNull().default(0),
  loss: doublePrecision("loss").notNull().default(0),
  kl: doublePrecision("kl").notNull().default(0),
  entropy: doublePrecision("entropy").notNull().default(0),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// --- 3NF Dashboard Schema (Normalized) ---

export const models = pgTable("models", {
  modelId: text("model_id").primaryKey(),
  name: text("name").notNull(),
  architectureType: text("architecture_type").notNull(),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingRuns = pgTable("training_runs", {
  runId: text("run_id").primaryKey(),
  modelId: text("model_id").notNull().references(() => models.modelId),
  epochCount: integer("epoch_count").notNull(),
  finalLoss: doublePrecision("final_loss").notNull(),
  hardwareNode: text("hardware_node").notNull(),
});

export const runMetricsFinal = pgTable("run_metrics_final", {
  metricId: serial("metric_id").primaryKey(),
  runId: text("run_id").notNull().references(() => trainingRuns.runId),
  foldNumber: integer("fold_number").notNull(),
  sharpeRatio: doublePrecision("sharpe_ratio").notNull(),
  maxDrawdown: doublePrecision("max_drawdown").notNull(),
});
