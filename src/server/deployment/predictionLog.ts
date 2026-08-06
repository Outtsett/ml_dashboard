/**
 * QuestDB ILP writer for `prediction_log` (W9.b).
 *
 * Each live deployment emits one ILP row per scoring tick. The QuestDB DDL
 * for `prediction_log` ships in W9.d — this client assumes the table exists
 * at runtime; if it does not, the Sender will surface a server-side error
 * on flush.
 *
 * Flush policy:
 *   auto_flush_rows=100, auto_flush_interval=1000ms — batches up to 100 rows
 *   per flush or every 1s, whichever comes first. Low enough latency for the
 *   1Hz polling loop in lifecycle.ts while still amortizing syscall cost
 *   when multiple deployments run concurrently.
 *
 * Singleton-per-process: ZMQ-like, a single Sender is reused. The Sender
 * itself is NOT thread-safe across concurrent table()/at() calls, but the
 * Node single-threaded event loop guarantees one in-flight write at a time
 * as long as callers `await` write().
 */

import { Sender } from '@questdb/nodejs-client';
import { QUESTDB_HOST, QUESTDB_HTTP_PORT } from '../infrastructure/database/questdb/connection';

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
  private sender: Sender | null = null;
  private host = '127.0.0.1';
  private port = 9000;

  async init(host = QUESTDB_HOST, port = Number.parseInt(QUESTDB_HTTP_PORT, 10) || 9000): Promise<void> {
    if (this.sender) return;
    this.host = host;
    this.port = port;
    // ILP-over-HTTP (the canonical local QuestDB transport — same as the
    // existing OHLCV writer in database/questdb/connection.ts).
    const configStr = `http::addr=${host}:${port};auto_flush_rows=100;auto_flush_interval=1000;`;
    this.sender = await Sender.fromConfig(configStr);
  }

  async write(row: PredictionLogRow): Promise<void> {
    if (!this.sender) {
      await this.init();
    }
    if (!this.sender) {
      throw new Error('[predictionLog] sender not initialized');
    }
    await this.sender
      .table('prediction_log')
      .symbol('deployment_id', String(row.deployment_id))
      .floatColumn('prediction', row.prediction)
      .floatColumn('confidence', row.confidence)
      .floatColumn('paper_pnl_delta', row.paper_pnl_delta)
      .floatColumn('paper_pnl_total', row.paper_pnl_total)
      .at(row.ts, 'ms');
  }

  async flush(): Promise<void> {
    if (this.sender) {
      await this.sender.flush();
    }
  }

  async close(): Promise<void> {
    if (this.sender) {
      await this.sender.close();
      this.sender = null;
    }
  }

  /** Diagnostics — expose the endpoint without leaking the Sender. */
  getEndpoint(): string {
    return `http://${this.host}:${this.port}`;
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
