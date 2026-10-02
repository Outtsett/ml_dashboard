import type { LakeService } from "../infrastructure/database/lake.service";

/** No-op — training_metrics lake table has been removed.
 *  Training metrics are tracked in SQLite via the SSE protocol. */
export async function runTrainingMigrations(_lake: LakeService): Promise<void> {
  // Intentionally empty — kept for API compatibility
}

