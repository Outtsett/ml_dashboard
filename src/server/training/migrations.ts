import type { QuestDBService } from "../database/questdb.service";

/** No-op — training_metrics QuestDB table has been removed.
 *  Training metrics are tracked in SQLite via the SSE protocol. */
export async function runTrainingMigrations(_questdb: QuestDBService): Promise<void> {
  // Intentionally empty — kept for API compatibility
}
