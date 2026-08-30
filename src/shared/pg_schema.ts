import { pgTable, serial, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

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
