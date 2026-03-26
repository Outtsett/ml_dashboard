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
export type PipelineType = 'training' | 'ingestion' | 'deployment';

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
  | BaseEvent<'system.motivewave-update', {
      symbol: string;
      timeframe: string;
      rowCount: number;
      durationMs: number;
      source: string;
    }>
  | BaseEvent<'system.motivewave-status', {
      status: string;
      watchDir: string;
    }>
  | BaseEvent<'system.motivewave-error', {
      symbol: string;
      error: string;
      source: string;
    }>;

// ── Union of all domain events ─────────────────────────────
export type DomainEvent =
  | PipelineEvent
  | TrainingEvent
  | IngestionEvent
  | ModelEvent
  | CacheEvent
  | SystemEvent;

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
