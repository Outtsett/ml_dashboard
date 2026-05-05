import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DomainEvent, PipelineEvent, TrainingEvent, CacheEvent } from '../src/shared/event-types';
import { EventBus } from '../src/server/events/event-bus';
import { SSEAdapter } from '../src/server/events/sse-adapter';
import type { SSEChannel } from '../src/server/events/sse-adapter';

// ── Helpers ──────────────────────────────────────────────────
function makeEvent<T extends DomainEvent>(
  overrides: Omit<T, 'metadata'> & Partial<Pick<T, 'metadata'>>,
): T {
  return {
    ...overrides,
    metadata: overrides.metadata ?? {
      correlationId: 'cor-1',
      causationId: 'cau-1',
      timestamp: Date.now(),
    },
  } as T;
}

function createMockResponse() {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler);
    }),
    headersSent: false,
    chunks,
    // Helper to simulate client disconnect
    simulateClose() {
      closeHandlers.forEach((h) => h());
    },
  };
}

describe('SSEAdapter', () => {
  let bus: EventBus;
  let adapter: SSEAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus();
    adapter = new SSEAdapter(bus);
  });

  afterEach(() => {
    adapter.shutdown();
    vi.useRealTimers();
  });

  // ── 1. Send SSE-formatted event to connected clients ──────
  it('should send SSE-formatted events to connected clients', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    const event = makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    });
    bus.emit(event);

    // Find the chunk that contains the event (skip connected event)
    const eventChunks = res.chunks.filter((c) => c.includes('event: pipeline.started'));
    expect(eventChunks).toHaveLength(1);

    const chunk = eventChunks[0]!;
    expect(chunk).toContain('event: pipeline.started\n');
    expect(chunk).toContain('data: ');
    expect(chunk).toMatch(/\n\n$/);

    // Verify data payload is valid JSON with expected fields
    const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice(6));
    expect(payload.type).toBe('pipeline.started');
    expect(payload.data.pipelineId).toBe('p-1');
  });

  // ── 2. Channel isolation: only matching events ─────────────
  it('should only send events matching the channel pattern', () => {
    const pipelineRes = createMockResponse();
    const trainingRes = createMockResponse();

    adapter.addClient('pipeline', pipelineRes as any);
    adapter.addClient('training', trainingRes as any);

    // Emit a pipeline event
    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.started',
      data: { pipelineId: 'p-1', pipelineType: 'training', config: {} },
    }));

    // Emit a training event
    bus.emit(makeEvent<TrainingEvent>({
      type: 'training.epoch.completed',
      data: { sessionId: 's-1', epoch: 1, metrics: { loss: 0.5 } },
    }));

    // Pipeline client should get pipeline events but NOT training events
    const pipelineEventChunks = pipelineRes.chunks.filter(
      (c) => c.includes('event: pipeline.') || c.includes('event: training.'),
    );
    expect(pipelineEventChunks).toHaveLength(1);
    expect(pipelineEventChunks[0]).toContain('event: pipeline.started');

    // Training client should get training events but NOT pipeline events
    const trainingEventChunks = trainingRes.chunks.filter(
      (c) => c.includes('event: pipeline.') || c.includes('event: training.'),
    );
    expect(trainingEventChunks).toHaveLength(1);
    expect(trainingEventChunks[0]).toContain('event: training.epoch.completed');
  });

  // ── 3. System channel receives cache, system, model, ingestion ──
  it('should route cache/system/model/ingestion events to system channel', () => {
    const systemRes = createMockResponse();
    adapter.addClient('system', systemRes as any);

    bus.emit(makeEvent<CacheEvent>({
      type: 'cache.invalidate',
      data: { keys: ['k1'] },
    }));

    const cacheChunks = systemRes.chunks.filter((c) => c.includes('event: cache.'));
    expect(cacheChunks).toHaveLength(1);
  });

  // ── 4. Remove disconnected clients ─────────────────────────
  it('should remove disconnected clients on close', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    expect(adapter.clientCount('pipeline')).toBe(1);

    // Simulate disconnect
    res.simulateClose();

    expect(adapter.clientCount('pipeline')).toBe(0);

    // Events should no longer be written
    bus.emit(makeEvent<PipelineEvent>({
      type: 'pipeline.completed',
      data: { pipelineId: 'p-1', totalDurationMs: 1000 },
    }));

    // Only the connected event was written (before close), no pipeline.completed
    const completedChunks = res.chunks.filter((c) => c.includes('event: pipeline.completed'));
    expect(completedChunks).toHaveLength(0);
  });

  // ── 5. clientCount tracks per channel ──────────────────────
  it('should track client count per channel', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();
    const res3 = createMockResponse();

    adapter.addClient('pipeline', res1 as any);
    adapter.addClient('pipeline', res2 as any);
    adapter.addClient('training', res3 as any);

    expect(adapter.clientCount('pipeline')).toBe(2);
    expect(adapter.clientCount('training')).toBe(1);
    expect(adapter.clientCount('system')).toBe(0);
  });

  // ── 6. Connected event sent on addClient ───────────────────
  it('should send a connected event when a client connects', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    expect(res.chunks.length).toBeGreaterThanOrEqual(1);
    expect(res.chunks[0]).toContain('event: connected');
  });

  // ── 7. SSE headers are set correctly ───────────────────────
  it('should set SSE headers on client response', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  // ── 8. Keepalive sends comments ────────────────────────────
  it('should send keepalive comments every 15 seconds', () => {
    const res = createMockResponse();
    adapter.addClient('pipeline', res as any);

    const initialCount = res.chunks.length;

    // Advance 15 seconds
    vi.advanceTimersByTime(15_000);

    const keepaliveChunks = res.chunks.slice(initialCount).filter((c) => c.startsWith(':'));
    expect(keepaliveChunks.length).toBeGreaterThanOrEqual(1);
  });

  // ── 9. Shutdown closes all connections ─────────────────────
  it('should close all connections on shutdown', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();

    adapter.addClient('pipeline', res1 as any);
    adapter.addClient('training', res2 as any);

    adapter.shutdown();

    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
    expect(adapter.clientCount('pipeline')).toBe(0);
    expect(adapter.clientCount('training')).toBe(0);
  });
});
