import type { ChildProcess } from "child_process";
import type { OptimizerType } from "@shared/hpoTypes";

/** A single HPO SSE event (buffered for replay). */
export interface HPOEvent {
  type: string;
  data: Record<string, unknown>;
  ts: number;
}

/** Runtime state for a single HPO session. */
export interface HPOSessionState {
  sessionId: string;
  dbId: number;
  child: ChildProcess | null;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  events: HPOEvent[];
  listeners: Set<(evt: HPOEvent) => void>;
  finished: boolean;
  bestScore: number | null;
  bestParams: Record<string, unknown> | null;
  completedTrials: number;
  prunedTrials: number;
  failedTrials: number;
  startedAt: number;
  modelType: string;
  optimizerType: OptimizerType;
}
