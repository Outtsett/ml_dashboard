import type { QuestDBService } from "../database/questdb.service";

const TRAINING_METRICS_DDL = `
CREATE TABLE IF NOT EXISTS training_metrics (
  ts TIMESTAMP,
  phase SYMBOL,
  model SYMBOL,
  metric SYMBOL,
  value DOUBLE,
  step LONG,
  epoch INT,
  fold INT
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP ENABLED UPSERT KEYS(ts, phase, model, metric, step);
`;

export async function runTrainingMigrations(questdb: QuestDBService): Promise<void> {
  await questdb.query(TRAINING_METRICS_DDL);
}
