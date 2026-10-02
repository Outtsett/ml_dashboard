// @vitest-environment jsdom
/**
 * `apps/web/src/cycle/connection.ts` — REST + SSE wiring for the Model
 * Cycle store. Covers:
 *   1. startCycle POSTs the right body and registers a listener for every
 *      stream event type.
 *   2. A dispatched `cycle_bars` event reaches `useCycleStore`.
 *   3. `stopCycle` escalates to the hard stop after the 10s timeout when the
 *      run has not reached a terminal status.
 *   4. `attachLatest` loads the snapshot from `GET /api/training/cycle`.
 */
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCycleStore } from "@/cycle/store";
import { CYCLE_STREAM_EVENT_TYPES, flushPendingEvents } from "@/cycle/connection";
import { emptyBarColumns } from "@shared/cycle/schema";

// connection.ts opens its stream through the tab's shared connection
// (sharedEventSource.ts, tested on its own); here the stream is the fake below.
vi.mock("@/infrastructure/lib/sharedEventSource", () => ({
  openEventStream: (url: string) => new EventSource(url),
}));

// ─── Fake EventSource ────────────────────────────────────────────────────────

type Handler = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private handlers = new Map<string, Set<Handler>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: EventListener): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as unknown as Handler);
  }

  removeEventListener(type: string, handler: EventListener): void {
    this.handlers.get(type)?.delete(handler as unknown as Handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, payload: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  registeredTypes(): string[] {
    return [...this.handlers.keys()];
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  useCycleStore.setState({
    modelId: null,
    modelType: null,
    status: "idle",
    error: null,
    lastSequence: -1,
    plan: null,
    cursor: null,
    bars: emptyBarColumns(),
    barsVersion: 0,
    barCount: 0,
    barsEpoch: 0,
    trades: [],
    running: null,
    folds: [],
    final: null,
    history: [],
    epochs: [],
    trials: [],
    logs: [],
    logsVersion: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startCycle", () => {
  it("POSTs the run config and registers a listener for every stream event type", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/training/start");
      return new Response(JSON.stringify({ sessionId: "s1", modelId: "MNQ_5m_xgboost" }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { startCycle } = await import("@/cycle/connection");
    await startCycle({
      modelType: "xgboost+walk_forward_cycle",
      symbol: "MNQ",
      timeframe: "5m",
      dateRange: { start: "2025-08-01", end: "2025-12-30" },
      hyperparameters: { boosting_rounds: 400 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      modelType: "xgboost+walk_forward_cycle",
      symbol: "MNQ",
      timeframe: "5m",
      dateRange: { start: "2025-08-01", end: "2025-12-30" },
      hyperparameters: { boosting_rounds: 400 },
      maxBars: 0,
    });

    expect(useCycleStore.getState().modelId).toBe("MNQ_5m_xgboost");
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/training/stream/MNQ_5m_xgboost");
    for (const type of CYCLE_STREAM_EVENT_TYPES) {
      expect(source.registeredTypes()).toContain(type);
    }
    expect(source.registeredTypes()).toContain("error");
  });

  it("delivers a dispatched cycle_bars event to the store", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ sessionId: "s1", modelId: "run-1" }), { status: 202 })),
    );

    const { startCycle } = await import("@/cycle/connection");
    await startCycle({
      modelType: "lstm+walk_forward_cycle",
      symbol: "MNQ",
      timeframe: "5m",
      dateRange: { start: "2025-08-01", end: "2025-12-30" },
      hyperparameters: {},
    });

    const source = FakeEventSource.instances[0]!;
    source.emit("cycle_bars", {
      seq: 1,
      role: "context",
      foldIndex: 0,
      timestamps: [1_700_000_000, 1_700_000_060],
      open: [100, 101],
      high: [101, 102],
      low: [99, 100],
      close: [100.5, 101.5],
      volume: [10, 12],
    });

    // Stream events are batched; nothing reaches the store until the flush.
    expect(useCycleStore.getState().barCount).toBe(0);
    flushPendingEvents();
    expect(useCycleStore.getState().barCount).toBe(2);
    expect(useCycleStore.getState().bars.timestamps).toEqual([1_700_000_000, 1_700_000_060]);
    expect(useCycleStore.getState().status).toBe("running");
  });
});

describe("stopCycle", () => {
  it("escalates to the hard stop after 10s when the run has not reached a terminal status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/training/start") {
        return new Response(JSON.stringify({ sessionId: "s1", modelId: "run-2" }), { status: 202 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { startCycle, stopCycle } = await import("@/cycle/connection");
    await startCycle({
      modelType: "xgboost+walk_forward_cycle",
      symbol: "MNQ",
      timeframe: "5m",
      dateRange: { start: "2025-08-01", end: "2025-12-30" },
      hyperparameters: {},
    });
    useCycleStore.setState({ status: "running" });
    fetchMock.mockClear();

    stopCycle();
    // The graceful control command fires immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/training/control/run-2",
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockClear();

    // Still running 10s later (no `done`/`error` arrived): hard stop fires.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledWith("/api/training/stop/run-2", expect.objectContaining({ method: "POST" }));
  });

  it("does not hard-stop once the run has reached a terminal status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/training/start") {
        return new Response(JSON.stringify({ sessionId: "s1", modelId: "run-3" }), { status: 202 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { startCycle, stopCycle } = await import("@/cycle/connection");
    await startCycle({
      modelType: "xgboost+walk_forward_cycle",
      symbol: "MNQ",
      timeframe: "5m",
      dateRange: { start: "2025-08-01", end: "2025-12-30" },
      hyperparameters: {},
    });
    useCycleStore.setState({ status: "running" });

    stopCycle();
    useCycleStore.setState({ status: "stopped" });
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/training/stop/run-3", expect.anything());
  });
});

describe("attachLatest", () => {
  it("loads the newest run's snapshot into the store", async () => {
    const snapshot = {
      modelId: "run-4",
      modelType: "xgboost+walk_forward_cycle",
      status: "complete" as const,
      startedAt: 1_700_000_000,
      finishedAt: 1_700_001_000,
      error: null,
      lastSequence: 42,
      plan: null,
      cursor: null,
      bars: emptyBarColumns(),
      trades: [],
      scoreboards: { running: null, folds: [], final: null },
      epochs: [],
      trials: [],
      logs: [],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/training/cycle") {
        return new Response(
          JSON.stringify([{ modelId: "run-4", modelType: "xgboost+walk_forward_cycle", symbol: "MNQ", timeframe: "5m", modelFamily: "xgboost", status: "complete", startedAt: 1_700_000_000, finishedAt: 1_700_001_000, barCount: 0, tradeCount: 0 }]),
          { status: 200 },
        );
      }
      if (url === "/api/training/cycle/run-4") {
        return new Response(JSON.stringify(snapshot), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { attachLatest } = await import("@/cycle/connection");
    await attachLatest();

    expect(useCycleStore.getState().modelId).toBe("run-4");
    expect(useCycleStore.getState().status).toBe("complete");
    expect(useCycleStore.getState().lastSequence).toBe(42);
    // A finished run's snapshot is not followed by an SSE attach.
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
