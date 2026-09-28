/**
 * One Claude Code conversation driven from the dashboard's panel.
 *
 * A session holds a single Agent SDK `query()` fed by a queue of user messages
 * (the SDK's streaming-input mode), so one `claude.exe` child answers every
 * turn with its context intact. The child is started on the first message and
 * closed after `IDLE_CLOSE_MS` of quiet; the next message restarts it with
 * `resume`, so a conversation survives an idle close, a host restart, or being
 * picked up from the terminal CLI (the SDK keeps every session's transcript
 * under ~/.claude/projects).
 *
 * Tool use is approved in the browser: `canUseTool` parks each request as a
 * `permission_request` event and resolves when Tyler answers.
 */

import { randomUUID } from "crypto";
import type { CanUseTool, PermissionResult, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_PERMISSION_MODES } from "../../shared/claude/types";
import type {
  ClaudeAssistantBlock,
  ClaudePanelEvent,
  ClaudePanelEventInput,
  ClaudePermissionDecision,
  ClaudePermissionMode,
  ClaudePermissionSuggestion,
  ClaudeSessionStatus,
  DashboardContext,
} from "../../shared/claude/types";

const RING_MAX = 4000;
const IDLE_CLOSE_MS = 30 * 60_000;

/** Variables a parent Claude Code session sets that would make the child
 *  behave as a nested sub-session of whatever started the dashboard. */
const INHERITED_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
];

export function childEnvironment(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of INHERITED_SESSION_VARS) delete env[name];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "ml-dashboard-panel/1.0";
  return env;
}

export const PANEL_PROMPT = [
  "You are running inside Tyler's ML Dashboard (http://127.0.0.1:5000) as its built-in Claude Code panel,",
  "with this repository as the working directory.",
  "A user turn may begin with a <dashboard_context> block: the page he is looking at (route, symbol, timeframe,",
  "Model Cycle run). Use it to resolve 'this', 'here' and 'the chart'.",
  "Tools from the `dashboard` MCP server: open_dashboard_page navigates his dashboard (use it to show him what you",
  "built or found), dashboard_api_get reads any GET endpoint of the dashboard's /api, live_quotes and news_sentiment",
  "read the live data hub (OANDA forex, Yahoo delayed futures, FinBERT-scored headlines).",
  "Every tool call you make is shown to him in the panel; the ones Claude Code would ask about are approved or denied there.",
].join(" ");

/** A content block as SDK messages and transcripts carry it — read field by field. */
export interface WireBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Any SDK message, read field by field (the union is wider than the panel needs). */
interface WireMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
  permissionMode?: string;
  cwd?: string;
  uuid?: string;
  event?: { type?: string; index?: number; delta?: { type?: string; text?: string; thinking?: string } };
  message?: { id?: string; content?: WireBlock[] | string };
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  result?: unknown;
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((value: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

type Listener = (event: ClaudePanelEvent) => void;

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: unknown;
  toolName: string;
}

export interface SessionDeps {
  cwd: string;
  loadSdk: () => Promise<typeof import("@anthropic-ai/claude-agent-sdk")>;
  mcpServers: (session: ClaudeSession) => Record<string, unknown>;
  /** True while a browser tab is streaming this session. */
  hasViewers?: (session: ClaudeSession) => boolean;
}

/** A permission update as the SDK hands it, read field by field. */
interface WireSuggestion {
  type?: string;
  behavior?: string;
  mode?: string;
  destination?: string;
  rules?: { toolName?: string; ruleContent?: string }[];
  directories?: string[];
}

function suggestionsFrom(value: unknown): WireSuggestion[] {
  return Array.isArray(value) ? (value.filter((s) => s && typeof s === "object") as WireSuggestion[]) : [];
}

/** The card's view of a suggestion (no destination: the panel applies it for this session only). */
function describeSuggestion(s: WireSuggestion): ClaudePermissionSuggestion {
  return {
    type: String(s.type ?? ""),
    behavior: s.behavior,
    mode: s.mode,
    rules: s.rules?.map((r) => ({ toolName: String(r.toolName ?? ""), ruleContent: r.ruleContent })),
    directories: s.directories,
  };
}

export class ClaudeSession {
  key: string;
  sessionId: string | null;
  title: string;
  status: ClaudeSessionStatus = "idle";
  permissionMode: ClaudePermissionMode = "default";
  model: string | undefined;
  costUsd = 0;
  lastModified = Date.now();
  context: DashboardContext | undefined;

  private events: ClaudePanelEvent[] = [];
  private seq = 0;
  private listeners = new Set<Listener>();
  private inputs: AsyncQueue<SDKUserMessage> | null = null;
  private query: Query | null = null;
  private pending = new Map<string, PendingPermission>();
  private idleTimer: NodeJS.Timeout | null = null;
  private assistantBlocks = new Map<string, ClaudeAssistantBlock[]>();

  constructor(
    private readonly deps: SessionDeps,
    opts: { sessionId?: string | null; title?: string },
  ) {
    this.sessionId = opts.sessionId ?? null;
    this.key = this.sessionId ?? `new-${randomUUID()}`;
    this.title = opts.title ?? "New conversation";
  }

  get active(): boolean {
    return this.query !== null;
  }

  // ── events ───────────────────────────────────────────────────────────

  emit(event: ClaudePanelEventInput): void {
    const full = { ...event, seq: ++this.seq, at: Date.now() } as ClaudePanelEvent;
    this.events.push(full);
    if (this.events.length > RING_MAX) this.events.splice(0, this.events.length - RING_MAX);
    this.lastModified = full.at;
    for (const listener of this.listeners) listener(full);
  }

  since(seq: number): ClaudePanelEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: ClaudeSessionStatus, detail?: string): void {
    this.status = status;
    this.emit({ type: "status", status, detail });
  }

  // ── turns ────────────────────────────────────────────────────────────

  async send(text: string, context?: DashboardContext): Promise<void> {
    this.context = context ?? this.context;
    if (this.title === "New conversation") this.title = text.slice(0, 80);
    this.emit({ type: "user", text, context });
    const content: { type: "text"; text: string }[] = [];
    if (context) content.push({ type: "text", text: `<dashboard_context>\n${JSON.stringify(context, null, 1)}\n</dashboard_context>` });
    content.push({ type: "text", text });
    if (!this.query) await this.start();
    this.inputs!.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? "",
    } as SDKUserMessage);
    this.setStatus("running");
    this.touch();
  }

  private async start(): Promise<void> {
    this.setStatus("starting");
    const sdk = await this.deps.loadSdk();
    this.inputs = new AsyncQueue<SDKUserMessage>();
    const canUseTool: CanUseTool = (toolName, input, options) => this.askPermission(toolName, input, options);
    this.query = sdk.query({
      prompt: this.inputs,
      options: {
        cwd: this.deps.cwd,
        resume: this.sessionId ?? undefined,
        model: this.model,
        permissionMode: this.permissionMode,
        includePartialMessages: true,
        canUseTool,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code", append: PANEL_PROMPT },
        mcpServers: this.deps.mcpServers(this) as never,
        env: childEnvironment(),
        stderr: (data: string) => {
          if (/error/i.test(data)) this.emit({ type: "error", message: data.slice(0, 2000) });
        },
      },
    });
    void this.pump(this.query);
  }

  private async pump(query: Query): Promise<void> {
    try {
      for await (const message of query) this.handle(message);
      this.setStatus("idle", "session closed");
    } catch (error) {
      this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      this.setStatus("error", error instanceof Error ? error.message : String(error));
    } finally {
      if (this.query === query) {
        this.query = null;
        this.inputs = null;
        for (const [requestId, pending] of this.pending) {
          pending.resolve({ behavior: "deny", message: "The session ended before this was answered." });
          this.pending.delete(requestId);
        }
      }
    }
  }

  private handle(message: SDKMessage): void {
    const m = message as unknown as WireMessage;
    if (m.session_id && !this.sessionId) this.sessionId = m.session_id;
    const content = m.message?.content;
    const blocks: WireBlock[] = Array.isArray(content) ? content : [];
    switch (m.type) {
      case "system":
        if (m.subtype === "init") {
          this.sessionId = m.session_id ?? this.sessionId;
          this.model = m.model;
          this.emit({
            type: "init",
            sessionId: m.session_id ?? "",
            model: m.model ?? "",
            tools: m.tools ?? [],
            mcpServers: (m.mcp_servers ?? []).map((server) => ({ name: server.name, status: server.status })),
            permissionMode: m.permissionMode ?? this.permissionMode,
            cwd: m.cwd ?? this.deps.cwd,
          });
        }
        return;
      case "stream_event": {
        const event = m.event;
        const messageId = String(m.uuid ?? "");
        if (event?.type === "content_block_delta") {
          const index = event.index ?? 0;
          if (event.delta?.type === "text_delta")
            this.emit({ type: "text_delta", messageId, blockIndex: index, text: event.delta.text ?? "" });
          else if (event.delta?.type === "thinking_delta")
            this.emit({ type: "thinking_delta", messageId, blockIndex: index, text: event.delta.thinking ?? "" });
        }
        return;
      }
      case "assistant": {
        const out: ClaudeAssistantBlock[] = [];
        for (const block of blocks) {
          if (block.type === "text") out.push({ type: "text", text: block.text ?? "" });
          else if (block.type === "thinking") out.push({ type: "thinking", text: block.thinking ?? "" });
          else if (block.type === "tool_use") out.push({ type: "tool_use", id: block.id ?? "", name: block.name ?? "", input: block.input });
        }
        const id = String(m.message?.id ?? m.uuid);
        this.assistantBlocks.set(id, out);
        this.emit({ type: "assistant", messageId: id, blocks: out });
        return;
      }
      case "user":
        for (const block of blocks) {
          if (block.type === "tool_result") {
            this.emit({
              type: "tool_result",
              toolUseId: block.tool_use_id ?? "",
              content: stringifyToolContent(block.content).slice(0, 20_000),
              isError: Boolean(block.is_error),
            });
          }
        }
        return;
      case "result":
        this.costUsd += Number(m.total_cost_usd ?? 0);
        this.emit({
          type: "result",
          subtype: m.subtype ?? "",
          isError: Boolean(m.is_error),
          costUsd: Number(m.total_cost_usd ?? 0),
          durationMs: Number(m.duration_ms ?? 0),
          numTurns: Number(m.num_turns ?? 0),
          text: typeof m.result === "string" ? m.result : "",
        });
        this.setStatus("idle");
        this.touch();
        return;
      default:
        return;
    }
  }

  // ── permissions ──────────────────────────────────────────────────────

  private askPermission(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; suggestions?: unknown; title?: string; description?: string; decisionReason?: string; toolUseID: string },
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(requestId, { resolve, input, suggestions: options.suggestions, toolName });
      options.signal.addEventListener("abort", () => {
        if (this.pending.delete(requestId)) resolve({ behavior: "deny", message: "Cancelled." });
      });
      this.setStatus("waiting", toolName);
      const suggestions = suggestionsFrom(options.suggestions);
      this.emit({
        type: "permission_request",
        requestId,
        toolName,
        input,
        title: options.title,
        description: options.description,
        decisionReason: typeof options.decisionReason === "string" ? options.decisionReason : undefined,
        canAlways: suggestions.length > 0,
        suggestions: suggestions.map(describeSuggestion),
      });
    });
  }

  answer(requestId: string, decision: ClaudePermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    if (decision.decision === "deny") {
      pending.resolve({ behavior: "deny", message: decision.message || "Denied from the dashboard panel." });
    } else {
      const updatedInput = decision.answers ? { ...pending.input, answers: decision.answers } : pending.input;
      // "Always" applies exactly what the card showed, for THIS session only:
      // a suggestion aimed at a settings file would otherwise outlive the panel
      // and loosen every later session, terminal ones included.
      const updates = decision.decision === "always" ? suggestionsFrom(pending.suggestions).map((s) => ({ ...s, destination: "session" })) : [];
      const mode = updates.find((s) => s.type === "setMode")?.mode;
      if (mode && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(mode)) this.permissionMode = mode as ClaudePermissionMode;
      pending.resolve(updates.length ? { behavior: "allow", updatedInput, updatedPermissions: updates as never } : { behavior: "allow", updatedInput });
    }
    this.emit({ type: "permission_resolved", requestId, decision: decision.decision });
    if (this.pending.size === 0) this.setStatus("running");
    return true;
  }

  // ── control ──────────────────────────────────────────────────────────

  async interrupt(): Promise<void> {
    await this.query?.interrupt();
  }

  async settings(next: { permissionMode?: ClaudePermissionMode; model?: string }): Promise<void> {
    if (next.permissionMode) {
      this.permissionMode = next.permissionMode;
      await this.query?.setPermissionMode(next.permissionMode);
    }
    if (next.model !== undefined) {
      this.model = next.model || undefined;
      await this.query?.setModel(this.model);
    }
    this.emit({ type: "status", status: this.status, detail: `mode ${this.permissionMode}, model ${this.model ?? "default"}` });
  }

  navigate(route: string, symbol?: string, timeframe?: string): void {
    this.emit({ type: "navigate", route, symbol, timeframe });
  }

  close(): void {
    this.inputs?.close();
    this.query?.close();
  }

  /** The idle clock, re-armed until it can act: an idle session closes; a
   *  session nobody is watching (tab closed mid-approval) has its pending
   *  approvals denied and closes; one being watched keeps running. */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.query) return;
      const watched = this.deps.hasViewers?.(this) ?? false;
      if (this.status === "idle" && this.pending.size === 0) return this.close();
      if (!watched) {
        for (const [requestId, pending] of this.pending) {
          pending.resolve({ behavior: "deny", message: "Nobody answered in the dashboard panel." });
          this.pending.delete(requestId);
        }
        return this.close();
      }
      this.touch();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }
}

export function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: WireBlock) => (part?.type === "text" ? (part.text ?? "") : part?.type === "image" ? "[image]" : JSON.stringify(part)))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}
