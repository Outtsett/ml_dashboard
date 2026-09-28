/**
 * Claude Code host — a sidecar (port 17191, proxied at /api/claude) that runs
 * the dashboard panel's Claude Code sessions through the Agent SDK.
 *
 * A sidecar, not a router: a Claude session that edits this repository's
 * server files would otherwise restart the process it lives in (tsx --watch)
 * and die mid-turn. Started with `node --import tsx src/server/claude/host.ts
 * --port 17191` by the dashboard's supervisor (src/config/sidecars.json).
 *
 *   GET  /health
 *   GET  /sessions                              every Claude Code session for this repo (terminal ones too) + live ones
 *   POST /sessions                              a new conversation -> { key }
 *   GET  /sessions/:key/history                 events so far (a closed session's transcript is read from disk)
 *   GET  /sessions/:key/stream?after=<seq>      server-sent events (replays after `after`, then live)
 *   POST /sessions/:key/messages                { text, context }
 *   POST /sessions/:key/permissions/:requestId  { decision: allow | deny | always, message?, answers? }
 *   POST /sessions/:key/interrupt
 *   POST /sessions/:key/settings                { permissionMode?, model? }
 *
 * Authentication is the logged-in Claude Code CLI (~/.claude/.credentials.json);
 * no API key is involved.
 */

import http from "http";
import path from "path";
import express, { type Request, type Response } from "express";
import type {
  ClaudeAssistantBlock,
  ClaudePanelEvent,
  ClaudePermissionDecision,
  ClaudeSessionSummary,
} from "../../shared/claude/types";
import { ClaudeSession, stringifyToolContent, type WireBlock } from "./session";
import { dashboardServer } from "./tools";

const REPO = path.resolve(process.cwd());
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.CLAUDE_HOST_PORT ?? 17191);
const STARTED_AT = new Date().toISOString();

const sessions = new Map<string, ClaudeSession>();
const loadSdk = () => import("@anthropic-ai/claude-agent-sdk");

function newSession(opts: { sessionId?: string | null; title?: string }): ClaudeSession {
  const session = new ClaudeSession(
    {
      cwd: REPO,
      loadSdk,
      mcpServers: (owner) => ({ dashboard: dashboardServerCache.get(owner) }),
    },
    opts,
  );
  sessions.set(session.key, session);
  // Once the SDK assigns the session id, address the same object by it too.
  session.subscribe((event) => {
    if (event.type === "init" && !sessions.has(event.sessionId)) sessions.set(event.sessionId, session);
  });
  return session;
}

// createSdkMcpServer is async (it imports the SDK); build each session's server
// before its first query starts.
const dashboardServerCache = new Map<ClaudeSession, unknown>();
async function ensureTools(session: ClaudeSession): Promise<void> {
  if (!dashboardServerCache.has(session)) dashboardServerCache.set(session, await dashboardServer(session));
}

async function sessionFor(key: string): Promise<ClaudeSession | null> {
  const known = sessions.get(key);
  if (known) return known;
  if (!/^[0-9a-f-]{36}$/i.test(key)) return null;
  const sdk = await loadSdk();
  const info = await sdk.getSessionInfo(key, { dir: REPO }).catch(() => undefined);
  if (!info) return null;
  const session = newSession({ sessionId: key, title: info.customTitle || info.summary || info.firstPrompt || key });
  return session;
}

/** A closed session's transcript as panel events (for the first paint). */
async function transcript(sessionId: string): Promise<ClaudePanelEvent[]> {
  const sdk = await loadSdk();
  const messages = await sdk.getSessionMessages(sessionId, { dir: REPO }).catch(() => []);
  const out: ClaudePanelEvent[] = [];
  let seq = 0;
  const at = Date.now();
  for (const message of messages as { type: string; uuid: string; message?: { id?: string; content?: WireBlock[] | string } }[]) {
    const content = message.message?.content;
    if (message.type === "user") {
      if (typeof content === "string") out.push({ seq: ++seq, at, type: "user", text: content });
      else if (Array.isArray(content)) {
        const textParts = content.filter((b) => b.type === "text").map((b) => b.text ?? "");
        if (textParts.length) out.push({ seq: ++seq, at, type: "user", text: textParts.join("\n") });
        for (const block of content.filter((b) => b.type === "tool_result")) {
          out.push({
            seq: ++seq,
            at,
            type: "tool_result",
            toolUseId: block.tool_use_id ?? "",
            content: stringifyToolContent(block.content).slice(0, 20_000),
            isError: Boolean(block.is_error),
          });
        }
      }
    } else if (message.type === "assistant" && Array.isArray(content)) {
      out.push({
        seq: ++seq,
        at,
        type: "assistant",
        messageId: String(message.message?.id ?? message.uuid),
        blocks: content
          .map((b): ClaudeAssistantBlock | null =>
            b.type === "text"
              ? { type: "text", text: b.text ?? "" }
              : b.type === "thinking"
                ? { type: "thinking", text: b.thinking ?? "" }
                : b.type === "tool_use"
                  ? { type: "tool_use", id: b.id ?? "", name: b.name ?? "", input: b.input }
                  : null,
          )
          .filter((b: ClaudeAssistantBlock | null): b is ClaudeAssistantBlock => b !== null),
      });
    }
  }
  return out;
}

function summary(session: ClaudeSession): ClaudeSessionSummary {
  return {
    key: session.key,
    sessionId: session.sessionId,
    title: session.title,
    lastModified: session.lastModified,
    active: session.active,
    status: session.status,
    permissionMode: session.permissionMode,
    model: session.model,
    costUsd: session.costUsd,
  };
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sidecar: "claude", pid: process.pid, startedAt: STARTED_AT, sessions: sessions.size });
});

app.get("/sessions", async (_req: Request, res: Response) => {
  const sdk = await loadSdk();
  const listed = await sdk.listSessions({ dir: REPO, limit: 60 }).catch(() => []);
  const seen = new Set<ClaudeSession>();
  const out: ClaudeSessionSummary[] = [];
  for (const session of sessions.values()) {
    if (seen.has(session)) continue;
    seen.add(session);
    out.push(summary(session));
  }
  const live = new Set(out.map((s) => s.sessionId).filter(Boolean));
  for (const info of listed) {
    if (live.has(info.sessionId)) continue;
    out.push({
      key: info.sessionId,
      sessionId: info.sessionId,
      title: info.customTitle || info.summary || info.firstPrompt || info.sessionId,
      lastModified: info.lastModified,
      active: false,
      status: "idle",
      gitBranch: info.gitBranch,
    });
  }
  out.sort((a, b) => b.lastModified - a.lastModified);
  res.json({ sessions: out });
});

app.post("/sessions", (_req, res) => {
  const session = newSession({});
  res.status(201).json(summary(session));
});

app.get("/sessions/:key/history", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  const live = session.since(0);
  const disk = session.sessionId && live.every((e) => e.type !== "assistant") ? await transcript(session.sessionId) : [];
  res.json({ session: summary(session), events: disk.length ? [...disk, ...live.map((e, i) => ({ ...e, seq: disk.length + i + 1 }))] : live });
});

app.get("/sessions/:key/stream", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  const after = Number(req.query.after ?? req.headers["last-event-id"] ?? 0) || 0;
  const write = (event: ClaudePanelEvent) => res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  for (const event of session.since(after)) write(event);
  const unsubscribe = session.subscribe(write);
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

app.post("/sessions/:key/messages", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  const text = String(req.body?.text ?? "").trim();
  if (!text) return void res.status(400).json({ error: "text is required" });
  try {
    await ensureTools(session);
    await session.send(text, req.body?.context);
    res.status(202).json(summary(session));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/sessions/:key/permissions/:requestId", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  const decision = req.body as ClaudePermissionDecision;
  if (!["allow", "deny", "always"].includes(decision?.decision)) return void res.status(400).json({ error: "decision must be allow, deny or always" });
  const ok = session.answer(req.params.requestId, decision);
  res.status(ok ? 200 : 404).json({ ok });
});

app.post("/sessions/:key/interrupt", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  await session.interrupt();
  res.json(summary(session));
});

app.post("/sessions/:key/settings", async (req, res) => {
  const session = await sessionFor(req.params.key);
  if (!session) return void res.status(404).json({ error: "unknown session" });
  await session.settings({ permissionMode: req.body?.permissionMode, model: req.body?.model });
  res.json(summary(session));
});

const server = http.createServer(app);
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`[claude-host] listening on 127.0.0.1:${PORT} (cwd ${REPO})
`);
});

function shutdown(): void {
  for (const session of new Set(sessions.values())) session.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
