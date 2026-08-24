// ─────────────────────────────────────────────────────────────────────────────
// useAgentDispatch — client hook for the ML Studio workshop AI agents (W8).
//
// Reconstructed against the shipped backend contract:
//   POST /api/agents/dispatch  body { agentId, contextBlob } → 202 { runId }
//   SSE  /api/events/agents/:runId  events:
//        connected            { run_id, agent_id?, status, server_time }
//        agent.token_chunk    { run_id, chunk, index }
//        agent.completed      { run_id, output, duration_ms, token_usage }
//        agent.failed         { run_id, error, code? }
//        agent.replay         { event, replay_index }   (wraps an original event)
//        heartbeat            { ts }
//
// The typed envelope (AgentReport, AgentFinding, AgentProposedAction, AgentId,
// AgentFindingSeverity) is the single source of truth in @shared/schema — we
// re-export it so consumers import the contract alongside the hook.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { logError, logWarn } from "@/infrastructure/lib/error_logger";
import type {
  AgentId,
  AgentReport,
  AgentFindingSeverity,
} from "@shared/schema";

export type {
  AgentId,
  AgentReport,
  AgentFinding,
  AgentProposedAction,
} from "@shared/schema";

/** Severity of a single agent finding. Alias of the shared schema union. */
export type AgentSeverity = AgentFindingSeverity;

/**
 * Free-form structured context handed to an agent at dispatch time. The backend
 * caps the serialized blob at 100kb and requires a plain JSON object. `agentId`
 * lets the stage-bound dispatch buttons tag which workshop helper to invoke.
 */
export interface AgentContextBlob {
  agentId?: AgentId;
  stage?: string;
  [key: string]: unknown;
}

/** Lifecycle of a dispatched agent run as observed on the client. */
export type AgentDispatchStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Imperative handle returned by {@link useAgentDispatch}. */
export interface AgentDispatchHandle {
  /** The agent currently dispatched (null before the first dispatch). */
  agentId: AgentId | null;
  /** Server-assigned run id for the in-flight/last dispatch. */
  runId: string | null;
  /** Current run lifecycle state. */
  status: AgentDispatchStatus;
  /** Convenience: true once the run reached a terminal `completed` state. */
  completed: boolean;
  /** Error message if the run failed (or the dispatch request failed). */
  error: string | null;
  /** The structured report envelope, populated on completion. */
  report: AgentReport | null;
  /** Accumulated streamed token text emitted while the agent works. */
  streamingBody: string;
  /** Fire an agent run. Resolves once the dispatch request is accepted. */
  dispatch: (agentId: AgentId, context: AgentContextBlob) => Promise<void>;
  /** Clear all state and detach any live SSE stream. */
  reset: () => void;
}

interface CompletedPayload {
  run_id: string;
  output?: AgentReport | null;
  duration_ms?: number;
  token_usage?: unknown;
}

function unwrapReplay(raw: unknown): unknown {
  // Replay events nest the original event under `.event`.
  if (raw && typeof raw === "object" && "event" in (raw as Record<string, unknown>)) {
    return (raw as { event: unknown }).event;
  }
  return raw;
}

/**
 * Dispatch a workshop AI agent and observe its streamed progress + final report.
 *
 * One handle tracks one run at a time; calling `dispatch` again supersedes the
 * previous run (its SSE stream is detached first). The hook owns its EventSource
 * in a ref so high-frequency token chunks never churn the connection, and tears
 * it down on unmount.
 */
export function useAgentDispatch(): AgentDispatchHandle {
  const [agentId, setAgentId] = useState<AgentId | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentDispatchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [streamingBody, setStreamingBody] = useState<string>("");

  const esRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeStream();
    setAgentId(null);
    setRunId(null);
    setStatus("idle");
    setError(null);
    setReport(null);
    setStreamingBody("");
  }, [closeStream]);

  const attachStream = useCallback(
    (id: string) => {
      closeStream();
      if (typeof EventSource === "undefined") {
        logWarn("useAgentDispatch", "EventSource unavailable; cannot stream run", { runId: id });
        return;
      }
      const es = new EventSource(`/api/events/agents/${encodeURIComponent(id)}`);
      esRef.current = es;

      const onToken = (raw: MessageEvent) => {
        try {
          const data = unwrapReplay(JSON.parse(raw.data)) as { chunk?: string };
          if (typeof data?.chunk === "string") {
            startTransition(() => setStreamingBody((prev) => prev + data.chunk));
          }
          setStatus((s) => (s === "queued" ? "running" : s));
        } catch (err) {
          logWarn("useAgentDispatch", "bad token_chunk payload", { message: (err as Error).message });
        }
      };

      const onCompleted = (raw: MessageEvent) => {
        try {
          const data = unwrapReplay(JSON.parse(raw.data)) as CompletedPayload;
          startTransition(() => {
            if (data?.output) setReport(data.output);
            setStatus("completed");
          });
        } catch (err) {
          logWarn("useAgentDispatch", "bad completed payload", { message: (err as Error).message });
          setStatus("completed");
        } finally {
          closeStream();
        }
      };

      const onFailed = (raw: MessageEvent) => {
        try {
          const data = unwrapReplay(JSON.parse(raw.data)) as { error?: string };
          setError(data?.error ?? "agent run failed");
        } catch {
          setError("agent run failed");
        }
        setStatus("failed");
        closeStream();
      };

      es.addEventListener("agent.token_chunk", onToken as EventListener);
      es.addEventListener("agent.replay", onToken as EventListener);
      es.addEventListener("agent.completed", onCompleted as EventListener);
      es.addEventListener("agent.failed", onFailed as EventListener);
      es.onerror = () => {
        // The browser auto-reconnects EventSource; only surface a hard failure
        // once the run is already terminal-less and the socket is closed.
        if (es.readyState === EventSource.CLOSED) {
          logWarn("useAgentDispatch", "SSE stream closed", { runId: id });
        }
      };
    },
    [closeStream],
  );

  const dispatch = useCallback(
    async (nextAgentId: AgentId, context: AgentContextBlob) => {
      closeStream();
      setAgentId(nextAgentId);
      setStatus("queued");
      setError(null);
      setReport(null);
      setStreamingBody("");
      setRunId(null);

      try {
        const res = await fetch("/api/agents/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: nextAgentId, contextBlob: context }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`dispatch failed (${res.status}) ${detail}`.trim());
        }
        const data = (await res.json()) as { runId?: string };
        if (!data?.runId) throw new Error("dispatch response missing runId");
        setRunId(data.runId);
        attachStream(data.runId);
      } catch (err) {
        const message = (err as Error).message ?? "dispatch error";
        logError("useAgentDispatch", "dispatch failed", { agentId: nextAgentId, message });
        setError(message);
        setStatus("failed");
      }
    },
    [attachStream, closeStream],
  );

  useEffect(() => closeStream, [closeStream]);

  return {
    agentId,
    runId,
    status,
    completed: status === "completed",
    error,
    report,
    streamingBody,
    dispatch,
    reset,
  };
}
