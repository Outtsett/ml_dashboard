/**
 * Model Cycle wire client — REST calls plus the SSE attachment that feeds
 * `useCycleStore`. A module, not a hook or a component: `CyclePage` calls
 * these functions directly (`startCycle`, `attachLatest`) and `Controls`
 * calls `controlCycle` / `stopCycle`.
 *
 * Reconnection: the browser's own EventSource retry does not replay the
 * server's per-run event buffer beyond what it already sent, so on a genuine
 * connection drop (never on our own `done`/`error`) this closes the source,
 * waits with exponential backoff (1, 2, 4, 8 s, capped at 30 s), pulls the
 * server snapshot (`loadSnapshot` is idempotent — bars/logs/trades replace
 * wholesale, everything else applies once by `seq`) and reopens the stream.
 *
 * A server-sent named `event: error` (a business failure the run reports)
 * arrives through the SAME `addEventListener('error', …)` channel a genuine
 * network failure uses. The two are told apart by `"data" in event`: a named
 * SSE event is a `MessageEvent` carrying `data`; a connection failure is a
 * bare `Event` with none.
 */
import { openEventStream } from "@/infrastructure/lib/sharedEventSource";
import { apiRequest } from "@/infrastructure/api/query_client";
import { toast } from "sonner";

import { isCycleActive, useCycleStore } from "@/cycle/store";
import {
  CYCLE_EVENT_TYPES,
  type CycleControl,
  type CycleRunSummary,
  type CycleSnapshot,
} from "@shared/cycle/schema";

export interface CycleDateRange {
  start: string;
  end: string;
}

export interface StartCycleInput {
  /** Runner key, `"<family>+walk_forward_cycle"`. */
  modelType: string;
  symbol: string;
  timeframe: string;
  dateRange: CycleDateRange;
  hyperparameters: Record<string, number | string | boolean>;
}

interface StartCycleResponse {
  sessionId: string;
  modelId: string;
}

/** Standard protocol events beyond the seven `cycle_*` ones — see the plan's event table. */
const STANDARD_EVENT_TYPES = [
  "started",
  "log",
  "metric",
  "fold_complete",
  "overlay",
  "prediction_markers",
  "progress",
  "caught_up",
  "done",
  "error",
] as const;

export const CYCLE_STREAM_EVENT_TYPES: readonly string[] = [...CYCLE_EVENT_TYPES, ...STANDARD_EVENT_TYPES];

const RECONNECT_DELAYS_SECONDS = [1, 2, 4, 8, 16, 30] as const;
const HARD_STOP_TIMEOUT_MILLISECONDS = 10_000;

let activeSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
/** Bumped on every `attach()`; a stale reconnect timer checks this before acting. */
let connectionGeneration = 0;

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function closeActiveSource(): void {
  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stream events are applied to the store in batches, not one by one. A paced
 * run emits ~80-100 events a second (bars, cursor, a log line per bar); one
 * store update each re-rendered the terminal, tiles and phase strip that often
 * and froze the tab (measured 2026-09-25: 14,291 events in 3 minutes). A
 * timer, not requestAnimationFrame: rAF stops in a hidden tab and the queue
 * would grow without bound.
 */
export const EVENT_FLUSH_MILLISECONDS = 100;
let pendingEvents: Array<{ type: string; data: unknown }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Apply every queued stream event now, in arrival order. */
export function flushPendingEvents(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents;
  pendingEvents = [];
  useCycleStore.getState().applyEvents(batch);
}

/** Discard queued events of a stream that is being replaced. */
function dropPendingEvents(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  pendingEvents = [];
}

function queueEvent(type: string, data: unknown): void {
  pendingEvents.push({ type, data });
  if (flushTimer === null) flushTimer = setTimeout(flushPendingEvents, EVENT_FLUSH_MILLISECONDS);
}

/** Open (or reopen) the SSE stream for a model id and wire every named event to the store. */
function openSource(modelId: string, generation: number): void {
  closeActiveSource();
  const source = openEventStream(`/api/training/stream/${encodeURIComponent(modelId)}`);
  activeSource = source;

  for (const type of CYCLE_STREAM_EVENT_TYPES) {
    source.addEventListener(type, (event: Event) => {
      if (generation !== connectionGeneration) return;
      const message = event as MessageEvent<string>;
      let payload: unknown = null;
      if (typeof message.data === "string" && message.data.length > 0) {
        try {
          payload = JSON.parse(message.data);
        } catch {
          return;
        }
      }
      queueEvent(type, payload);
      if (type === "done" || type === "error") {
        flushPendingEvents();
        clearReconnectTimer();
        closeActiveSource();
      }
    });
  }

  source.addEventListener("error", (event: Event) => {
    // A named `event: error` business event is a MessageEvent carrying
    // `data`, and is fully handled by the listener registered above. Only a
    // bare Event with no `data` is a genuine connection failure.
    if ("data" in event) return;
    if (generation !== connectionGeneration) return;
    if (!isCycleActive(useCycleStore.getState().status)) return;
    scheduleReconnect(modelId, generation);
  });
}

function scheduleReconnect(modelId: string, generation: number): void {
  clearReconnectTimer();
  const delaySeconds = RECONNECT_DELAYS_SECONDS[Math.min(reconnectAttempt, RECONNECT_DELAYS_SECONDS.length - 1)]!;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    void reconnectNow(modelId, generation);
  }, delaySeconds * 1000);
}

async function reconnectNow(modelId: string, generation: number): Promise<void> {
  if (generation !== connectionGeneration) return;
  try {
    const response = await apiRequest("GET", `/api/training/cycle/${encodeURIComponent(modelId)}`);
    const snapshot = (await response.json()) as CycleSnapshot;
    if (generation !== connectionGeneration) return;
    useCycleStore.getState().loadSnapshot(snapshot);
    if (isCycleActive(snapshot.status)) {
      reconnectAttempt = 0;
      openSource(modelId, generation);
    }
  } catch {
    if (generation !== connectionGeneration) return;
    scheduleReconnect(modelId, generation);
  }
}

/**
 * Open a run by id: the server's snapshot (live accumulator or the lake
 * archive) replaces the store, and a still-running run is reattached to its
 * stream. A finished run stays idle-shaped, as `attachLatest` leaves it.
 */
export async function openRun(modelId: string): Promise<void> {
  detach();
  const response = await apiRequest("GET", `/api/training/cycle/${encodeURIComponent(modelId)}`);
  const snapshot = (await response.json()) as CycleSnapshot;
  useCycleStore.getState().loadSnapshot(snapshot);
  if (isCycleActive(snapshot.status)) attach(snapshot.modelId);
}

/** Attach to a run's stream — fresh start or reload. Tears down any prior connection first. */
export function attach(modelId: string): void {
  connectionGeneration += 1;
  dropPendingEvents();
  clearReconnectTimer();
  reconnectAttempt = 0;
  openSource(modelId, connectionGeneration);
}

/** Stop listening without changing run status (route navigation away from `/cycle`). */
export function detach(): void {
  connectionGeneration += 1; // invalidates any in-flight reconnect
  dropPendingEvents();
  clearReconnectTimer();
  closeActiveSource();
}

/** POST the run configuration, mark the store as starting, and attach to its stream. */
export async function startCycle(input: StartCycleInput): Promise<void> {
  const response = await apiRequest("POST", "/api/training/start", {
    modelType: input.modelType,
    symbol: input.symbol,
    timeframe: input.timeframe,
    dateRange: input.dateRange,
    hyperparameters: input.hyperparameters,
    maxBars: 0,
  });
  const { modelId } = (await response.json()) as StartCycleResponse;
  useCycleStore.getState().begin(modelId, input.modelType);
  attach(modelId);
}

/** Send a control command for the current run over `POST /api/training/control/:modelId`. */
export async function controlCycle(command: CycleControl): Promise<void> {
  const modelId = useCycleStore.getState().modelId;
  if (!modelId) return;
  try {
    await apiRequest("POST", `/api/training/control/${encodeURIComponent(modelId)}`, command);
  } catch (error) {
    toast.error("Control command failed", { description: describeError(error) });
  }
}

/**
 * Ask the run to stop gracefully; if it has not reached a terminal status
 * within 10 s, escalate to the hard kill (`POST /api/training/stop/:modelId`).
 */
export function stopCycle(): void {
  const modelId = useCycleStore.getState().modelId;
  if (!modelId) return;
  void controlCycle({ command: "stop" });
  setTimeout(() => {
    const state = useCycleStore.getState();
    if (state.modelId !== modelId) return; // a different run has since started
    if (state.status === "stopped" || state.status === "complete" || state.status === "failed") return;
    void apiRequest("POST", `/api/training/stop/${encodeURIComponent(modelId)}`).catch((error: unknown) => {
      toast.error("Hard stop failed", { description: describeError(error) });
    });
  }, HARD_STOP_TIMEOUT_MILLISECONDS);
}

/**
 * Called on `/cycle` mount: rebuilds from the most recent run so a reload
 * still shows what happened. A running run gets a live snapshot + reattach;
 * a finished run gets the snapshot only, and the store stays idle-shaped
 * (`status` reflects the run, `modelId` is set) so the panel can show it
 * without pretending a new run started.
 */
export async function attachLatest(signal?: AbortSignal): Promise<void> {
  let runs: CycleRunSummary[];
  try {
    const response = await apiRequest("GET", "/api/training/cycle", undefined, signal);
    runs = (await response.json()) as CycleRunSummary[];
  } catch {
    return;
  }
  const latest = runs[0];
  if (!latest) return;
  try {
    const response = await apiRequest(
      "GET",
      `/api/training/cycle/${encodeURIComponent(latest.modelId)}`,
      undefined,
      signal,
    );
    const snapshot = (await response.json()) as CycleSnapshot;
    useCycleStore.getState().loadSnapshot(snapshot);
    if (isCycleActive(snapshot.status)) {
      attach(snapshot.modelId);
    }
  } catch {
    // Leave the store idle — the setup form is still usable.
  }
}
