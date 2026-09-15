// ── Metadata (every event carries this) ────────────────────
export interface EventMetadata {
  correlationId: string;   // originating request ID
  causationId: string;     // event that directly caused this one
  timestamp: number;       // epoch ms
}

// ── Base event envelope ────────────────────────────────────
export interface BaseEvent<TType extends string, TData> {
  type: TType;
  data: TData;
  metadata: EventMetadata;
}

// ── Pipeline types ─────────────────────────────────────────
export type PipelineType = 'training' | 'ingestion' | 'deployment' | 'backtest';

export type PipelineStatus =
  | 'idle' | 'running' | 'completed' | 'failed'
  | 'compensating' | 'compensated' | 'paused';

// ── Pipeline events ────────────────────────────────────────
export type PipelineEvent =
  | BaseEvent<'pipeline.started', {
      pipelineId: string;
      pipelineType: PipelineType;
      config: Record<string, unknown>;
    }>
  | BaseEvent<'pipeline.step.started', {
      pipelineId: string;
      step: string;
      stepIndex: number;
    }>
  | BaseEvent<'pipeline.step.completed', {
      pipelineId: string;
      step: string;
      stepIndex: number;
      result: Record<string, unknown>;
      durationMs: number;
    }>
  | BaseEvent<'pipeline.step.failed', {
      pipelineId: string;
      step: string;
      stepIndex: number;
      error: string;
    }>
  | BaseEvent<'pipeline.completed', {
      pipelineId: string;
      totalDurationMs: number;
    }>
  | BaseEvent<'pipeline.failed', {
      pipelineId: string;
      error: string;
      failedStep: string;
    }>
  | BaseEvent<'pipeline.compensating', {
      pipelineId: string;
      stepsToCompensate: string[];
    }>
  | BaseEvent<'pipeline.compensated', {
      pipelineId: string;
      compensatedSteps: string[];
    }>
  | BaseEvent<'pipeline.paused', {
      pipelineId: string;
      step: string;
    }>
  | BaseEvent<'pipeline.resumed', {
      pipelineId: string;
      step: string;
    }>;

// ── Training events ────────────────────────────────────────
export type TrainingEvent =
  | BaseEvent<'training.epoch.completed', {
      sessionId: string;
      epoch: number;
      metrics: Record<string, number>;
    }>
  | BaseEvent<'training.checkpoint.saved', {
      sessionId: string;
      path: string;
      epoch: number;
    }>
  | BaseEvent<'training.heartbeat', {
      sessionId: string;
      epoch: number;
      progress: number; // 0-1
    }>
  | BaseEvent<'training.event', {
      sessionId: string;
      modelId: string;
      type: string;
      data: Record<string, unknown>;
      ts: number;
    }>;

// ── Ingestion events ───────────────────────────────────────
export type IngestionEvent =
  | BaseEvent<'ingestion.file.received', {
      uploadId: string;
      filename: string;
      fileSize: number;
    }>
  | BaseEvent<'ingestion.validated', {
      uploadId: string;
      rowCount: number;
      symbol: string;
    }>
  | BaseEvent<'ingestion.completed', {
      uploadId: string;
      symbol: string;
      timeframe: string;
      rowCount: number;
    }>;

// ── Model events ───────────────────────────────────────────
export type ModelEvent =
  | BaseEvent<'model.registered', {
      modelId: string;
      name: string;
      metrics: Record<string, number>;
    }>
  | BaseEvent<'model.promoted', {
      modelId: string;
      previousModelId: string | null;
      reason: string;
    }>
  | BaseEvent<'model.retired', {
      modelId: string;
      reason: string;
    }>;

// ── Cache events ───────────────────────────────────────────
export type CacheEvent =
  | BaseEvent<'cache.invalidate', {
      keys: string[];
    }>;

// ── System events ──────────────────────────────────────────
export type SystemEvent =
  | BaseEvent<'system.startup', {
      version: string;
      databases: Record<string, string>;
    }>
  | BaseEvent<'system.shutdown', {
      reason: string;
    }>
  | BaseEvent<'system.gpu', {
      name: string;
      temperatureC: number;
      utilizationGpu: number;
      utilizationMemory: number;
      memoryUsedMB: number;
      memoryFreeMB: number;
      memoryTotalMB: number;
      memoryUsedPct: number;
      powerDrawW: number;
      powerLimitW: number;
      fanSpeedPct: number;
      clockGraphicsMHz: number;
      clockMemoryMHz: number;
      timestamp: number;
    }>
  | BaseEvent<'system.matrix', {
      cpu: { load: number; cores: number[]; temp: number; speed: number };
      mem: { total: number; active: number; used: number; swaptotal: number; swapused: number };
      network: { tx_sec: number; rx_sec: number };
      // Structurally the `system.gpu` payload, but declared as `unknown` rather
      // than a shared named type: the server's SystemSnapshot.gpu (telemetry.router.ts)
      // is `Omit<GpuEventData, 'timestamp'>`, one field narrower than the full
      // system.gpu contract, so a shared type here would force an assignability
      // fix on the server side. Consumers narrow/cast at the read site.
      gpu?: unknown;
      timestamp: number;
    }>;

// ── Deployment events ──────────────────────────────────────
// Live model-version deployments. Single SSE channel multiplexed by
// `deployment_id` at /api/events/deployments. See backend integration plan
// 2026-05-09 §7 and W7.d.
export type DeploymentMode = 'shadow' | 'paper' | 'live';

export type DeploymentEvent =
  | BaseEvent<'deployment.started', {
      deployment_id: number;
      version_id: number;
      mode: DeploymentMode;
      symbol: string;
      timeframe: string;
      started_at: string;            // ISO 8601
    }>
  | BaseEvent<'deployment.prediction', {
      deployment_id: number;
      ts: string;                    // ISO 8601 (bar timestamp)
      prediction: number | string;   // class label or regression value
      confidence: number;            // 0..1
      paper_pnl_delta?: number;
      paper_pnl_total?: number;
    }>
  | BaseEvent<'deployment.pnl_update', {
      deployment_id: number;
      paper_pnl_total: number;
      predictions_emitted: number;
      last_prediction_at: string;    // ISO 8601
    }>
  | BaseEvent<'deployment.paused', {
      deployment_id: number;
      paused_at: string;             // ISO 8601
    }>
  | BaseEvent<'deployment.resumed', {
      deployment_id: number;
      resumed_at: string;            // ISO 8601
    }>
  | BaseEvent<'deployment.stopped', {
      deployment_id: number;
      stopped_at: string;            // ISO 8601
      reason?: string;
    }>
  | BaseEvent<'deployment.failed', {
      deployment_id: number;
      failed_at: string;             // ISO 8601
      error: string;
    }>;

// ── Agent dispatcher events (W8.c) ─────────────────────────
// Dynamic event types `agent.<runId>.<event>` — the runId is part of the
// channel so SSE subscribers can target a single agent run via EventBus
// pattern matching. Payload is intentionally `Record<string, unknown>`
// because the underlying Claude Agent SDK emits heterogeneous shapes
// (token chunks, tool calls, completion summaries, errors) that the
// frontend's `useAgentDispatch()` discriminates on the suffix.
export type AgentEvent = BaseEvent<
  `agent.${string}.${string}`,
  Record<string, unknown>
>;

// ── Union of all domain events ─────────────────────────────
// ── Market events ──────────────────────────────────────────
// Price bars pushed to the chart as they form. Distinct from IngestionEvent,
// which is about files and batches landing in storage; this is the live
// (or replayed) surface a chart subscribes to.

export type MarketEvent =
  /**
   * A forming or closed price bar.
   *
   * `origin` is not decoration. The stream is live when Quantower is running
   * and QuantowerBridge is writing, and a replay of stored history otherwise —
   * and the two are identical once rendered. Any consumer that trades, alerts,
   * or reports on this data is required to check it.
   */
  | BaseEvent<'market.bar', {
      symbol: string;
      timeframe: string;
      /** Epoch milliseconds of the bar's opening edge. */
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      /** 0..1 through the bar's interval; exactly 1 on the closing frame. */
      progress: number;
      isClosed: boolean;
      origin: 'replay' | 'live';
    }>;

export type DomainEvent =
  | PipelineEvent
  | TrainingEvent
  | IngestionEvent
  | ModelEvent
  | CacheEvent
  | SystemEvent
  | MarketEvent
  | DeploymentEvent
  | AgentEvent;

// ── Extract event type strings ─────────────────────────────
export type DomainEventType = DomainEvent['type'];

// ── Extract data for a specific event type ─────────────────
export type EventDataFor<T extends DomainEventType> =
  Extract<DomainEvent, { type: T }>['data'];

// ── Stored event (after persistence) ───────────────────────
export interface StoredEvent {
  id: number;
  streamId: string;
  streamPosition: number;
  type: string;
  version: number;
  data: Record<string, unknown>;
  metadata: EventMetadata;
  createdAt: string;
}

// ── New event (before persistence) ─────────────────────────
export interface NewEvent {
  type: string;
  version?: number;
  data: Record<string, unknown>;
  metadata: EventMetadata;
}
