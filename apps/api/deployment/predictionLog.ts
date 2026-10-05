/**
 * Prediction log writer for live deployments — RETIRED.
 *
 * This wrote one ILP row per scoring tick into lake's `prediction_log`.
 * lake was emptied and retired on 2026-09-10, and `prediction_log` is not
 * even in the parquet snapshot the serving layer reads — it was one of the
 * objects that held no rows worth carrying. There is nothing listening on
 * :9000 and nothing to write into.
 *
 * It raises rather than no-ops. An ILP Sender pointed at a dead port buffers
 * happily and only fails on flush, which is exactly how a live deployment ends
 * up reporting healthy for an hour while recording nothing. A deployment that
 * cannot log its predictions should say so on the first tick.
 *
 * Restore path if prediction logging is needed again:
 * `s3://meta/lake_schema/lake_schema_latest.sql` carries the original
 * `prediction_log` DDL. The durable home for it is the lake — land it under
 * `E:\lake\derived\recipe=<name>\` through datalake rather than reviving
 * lake.
 */

const RETIRED =
  'lake was retired on 2026-09-10 and prediction_log has no replacement yet. ' +
  'Its DDL is at s3://meta/lake_schema/lake_schema_latest.sql; the durable ' +
  'home for these rows is the lake, landed through datalake.';

export interface PredictionLogRow {
  deployment_id: number;
  prediction: number; // numeric only — string predictions land in `deployments.lastError`
  confidence: number;
  paper_pnl_delta: number;
  paper_pnl_total: number;
  /** Bar timestamp in epoch ms. */
  ts: number;
}

export class PredictionLog {
  async init(_host?: string, _port?: number): Promise<void> {
    throw new Error(`[predictionLog] init is not available. ${RETIRED}`);
  }

  async write(row: PredictionLogRow): Promise<void> {
    throw new Error(
      `[predictionLog] cannot record deployment ${row.deployment_id}. ${RETIRED}`,
    );
  }

  /** No buffer to drain — write() never accepts a row. */
  async flush(): Promise<void> {}

  /** No sender to release. */
  async close(): Promise<void> {}

  /** Diagnostics — there is no endpoint any more. */
  getEndpoint(): string {
    return 'retired: lake prediction_log (2026-09-10)';
  }
}

let singleton: PredictionLog | null = null;

export function getPredictionLog(): PredictionLog {
  if (!singleton) {
    singleton = new PredictionLog();
  }
  return singleton;
}

/** Test-only. */
export function resetPredictionLogForTests(): void {
  if (singleton) {
    void singleton.close().catch(() => {});
    singleton = null;
  }
}

