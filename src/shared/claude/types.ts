/**
 * The Claude panel's wire contract — what the Claude Code host sidecar
 * (src/server/claude/) sends the browser (src/client/src/claude/) over
 * /api/claude/sessions/:key/stream, and what the browser posts back.
 */

export type ClaudeSessionStatus = "idle" | "starting" | "running" | "waiting" | "error";

export type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions" | "dontAsk";

export const CLAUDE_PERMISSION_MODES: readonly ClaudePermissionMode[] = [
  "default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk",
];

/** One permission update Claude Code suggests with a tool request, as the card shows it. */
export interface ClaudePermissionSuggestion {
  type: string;
  behavior?: string;
  mode?: string;
  rules?: { toolName: string; ruleContent?: string }[];
  directories?: string[];
}

export type ClaudeAssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** Where Tyler is in the dashboard when he sends a message. */
export interface DashboardContext {
  route: string;
  symbol?: string;
  timeframe?: string;
  cycleRunId?: string;
  selection?: string;
  visibleRange?: { from: number; to: number };
}

interface Base {
  /** Monotonic per session; the stream's `id:` for reconnect replay. */
  seq: number;
  at: number;
}

export type ClaudePanelEvent = Base &
  (
    | { type: "init"; sessionId: string; model: string; tools: string[]; mcpServers: { name: string; status: string }[]; permissionMode: string; cwd: string }
    | { type: "status"; status: ClaudeSessionStatus; detail?: string }
    | { type: "user"; text: string; context?: DashboardContext }
    | { type: "text_delta"; messageId: string; blockIndex: number; text: string }
    | { type: "thinking_delta"; messageId: string; blockIndex: number; text: string }
    | { type: "assistant"; messageId: string; blocks: ClaudeAssistantBlock[] }
    | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
    | {
        type: "permission_request";
        requestId: string;
        toolName: string;
        input: unknown;
        title?: string;
        description?: string;
        decisionReason?: string;
        canAlways: boolean;
        /** What "Always allow" would add, shown on the card. Applied for this session only. */
        suggestions?: ClaudePermissionSuggestion[];
      }
    | { type: "permission_resolved"; requestId: string; decision: "allow" | "deny" | "always" }
    | { type: "result"; subtype: string; isError: boolean; costUsd: number; durationMs: number; numTurns: number; text: string }
    | { type: "navigate"; route: string; symbol?: string; timeframe?: string }
    | { type: "error"; message: string }
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the session stamps its `seq` and `at`. */
export type ClaudePanelEventInput = DistributiveOmit<ClaudePanelEvent, "seq" | "at">;

export interface ClaudeSessionSummary {
  /** The key the panel addresses the conversation by: the Claude Code session
   *  id once it exists, `new-<uuid>` before the first message is answered. */
  key: string;
  sessionId: string | null;
  title: string;
  lastModified: number;
  active: boolean;
  status: ClaudeSessionStatus;
  gitBranch?: string;
  permissionMode?: ClaudePermissionMode;
  model?: string;
  costUsd?: number;
  /** This host process's instance of the session: a new id after a restart or
   *  an eviction, so a reconnecting panel knows its view no longer matches. */
  incarnation?: string;
}

export interface ClaudePermissionDecision {
  decision: "allow" | "deny" | "always";
  message?: string;
  /** AskUserQuestion: question text -> chosen label(s). */
  answers?: Record<string, string>;
}
