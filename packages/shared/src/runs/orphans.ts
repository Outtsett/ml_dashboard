/**
 * What to do with run rows a server restart left behind.
 *
 * A run is a child of the dashboard server, so a restart ends its process without the
 * run ever reporting an end: its entity row keeps saying "running". After a boot no run
 * is live, so each such row is one of two things:
 *
 *   - the run landed a record in the lake (it finished at least one fold): the row is
 *     marked stopped, and the page opens the folds it has;
 *   - the run landed nothing (it ended before its first fold): there is nothing to open,
 *     so the row is removed and does not hold a version number for a run nobody can see.
 *
 * Pure: the caller reads the rows and applies the answer.
 */
export interface OrphanActions {
  /** Rows to mark stopped: the run has a record. */
  stop: string[];
  /** Rows to remove: the run has no record. */
  remove: string[];
}

export function classifyOrphanRuns(
  runningRunIds: readonly string[],
  liveRunIds: ReadonlySet<string>,
  recordedRunIds: ReadonlySet<string>,
): OrphanActions {
  const stop: string[] = [];
  const remove: string[] = [];
  for (const runId of runningRunIds) {
    if (liveRunIds.has(runId)) continue;
    if (recordedRunIds.has(runId)) stop.push(runId);
    else remove.push(runId);
  }
  return { stop, remove };
}

export const ORPHANED_RUN_REASON =
  "The server restarted while this run was in progress (a server-file save restarts it and ends its process). The record holds the folds that finished; relaunch to continue.";
