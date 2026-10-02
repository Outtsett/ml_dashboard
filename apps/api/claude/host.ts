/**
 * Claude Code host — a sidecar (port 17191, proxied at /api/claude) that runs
 * the dashboard panel's Claude Code sessions through the Agent SDK.
 *
 * A sidecar, not a router: a Claude session that edits this repository's
 * server files would otherwise restart the process it lives in (tsx --watch)
 * and die mid-turn. Started with `node --import tsx apps/api/claude/host.ts
 * --port 17191` by the dashboard's supervisor (packages/config/sidecars.json).
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
 *
 * Reachable only from this machine's own pages: every request must carry a
 * loopback Host (a DNS-rebinding page has its own name there) and, when a
 * browser sends one, a loopback Origin. The dashboard's proxy rewrites Host to
 * 127.0.0.1:<port> and checks the caller's own Host before forwarding
 * (apps/api/sidecar/proxy.ts).
 */

import http from "http";
import path from "path";
import express, { type Request, type Response } from "express";
import {
  CLAUDE_PERMISSION_MODES,
  type ClaudeAssistantBlock,
  type ClaudePanelEvent,
  type ClaudePermissionDecision,
  type ClaudePermissionMode,
  type ClaudeSessionSummary,
} from "@shared/claude/types";
import { ClaudeSession, stringifyToolContent, type WireBlock } from "./session";
import { dashboardServer } from "./tools";

const REPO = path.resolve(process.cwd());
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.CLAUDE_HOST_PORT ?? 17191);
const STARTED_AT = new Date().toISOString();

const sessions = new Map<string, ClaudeSession>();
const viewers = new Map<ClaudeSession, number>();
const loadSdk = () => import("@anthropic-ai/claude-agent-sdk");
const MAX_SESSIONS = 40;

/** Drop a session nobody is running or watching; its transcript stays on disk. */
function evict(session: ClaudeSession): void {
  if (session.active || (viewers.get(session) ?? 0) > 0) return;
  for (const [key, held] of sessions) if (held === session) sessions.delete(key);
  dashboardServerCache.delete(session);
  viewers.delete(session);
}

function newSession(opts: { sessionId?: string | null; title?: string }): ClaudeSession {
  const distinct = new Set(sessions.values());
  if (distinct.size >= MAX_SESSIONS) for (const held of distinct) evict(held);
  const session = new ClaudeSession(
    {
      cwd: REPO,
      loadSdk,
      mcpServers: (owner) => ({ dashboard: dashboardServerCache.get(owner) }),
      hasViewers: (owner) => (viewers.get(owner) ?? 0) > 0,
    },
    opts,
  );
  sessions.set(session.key, session);
  // Once the SDK assigns the session id, address the same object by it too;
  // when its child exits and no tab is watching, let it go.
  session.subscribe((event) => {
    if (event.type === "init" && !sessions.has(event.sessionId)) sessions.set(event.sessionId, session);
    if (event.type === "status" && event.detail === "session closed") setImmediate(() => evict(session));
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
      if (typeof content === "string") out.push({ seq: ++seq, at, type: "user", text: stripContext(content) });
      else if (Array.isArray(content)) {
        // The panel sends its page context as its own text block; show the
        // words Tyler typed, not the JSON the model read.
        const textParts = content
          .filter((b) => b.type === "text" && !(b.text ?? "").startsWith("<dashboard_context>"))
          .map((b) => stripContext(b.text ?? ""));
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

function stripContext(text: string): string {
  return text.replace(/<dashboard_context>[\s\S]*?<\/dashboard_context>\s*/g, "").trim();
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
    incarnation: session.incarnation,
  };
}

const app = express();
const LOOPBACK_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
app.use((req, res, next) => {
  const host = String(req.headers.host ?? "").toLowerCase();
  const origin = req.headers.origin;
  if (!LOOPBACK_HOSTS.has(host) || (origin !== undefined && !LOOPBACK_ORIGIN.test(origin))) {
    return void res.status(403).json({ error: "the Claude host answers this machine's own pages only" });
  }
  if (req.headers["sec-fetch-site"] === "cross-site") return void res.status(403).json({ error: "cross-site request refused" });
  next();
});
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
  // A session this host has been answering already carries its turns as live
  // events; one it has not (a terminal session, or one from before a restart)
  // is read from the transcript the SDK keeps on disk.
  const disk =
    session.sessionId && !session.active && live.every((e) => e.type !== "user") ? await transcript(session.sessionId) : [];
  res.json({ session: summary(session), transcript: disk, events: live });
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
  viewers.set(session, (viewers.get(session) ?? 0) + 1);
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
    viewers.set(session, Math.max(0, (viewers.get(session) ?? 1) - 1));
    if (!session.active) evict(session);
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
  const permissionMode = req.body?.permissionMode;
  const model = req.body?.model;
  if (permissionMode !== undefined && !(CLAUDE_PERMISSION_MODES as readonly unknown[]).includes(permissionMode)) {
    return void res.status(400).json({ error: `permissionMode must be one of ${CLAUDE_PERMISSION_MODES.join(", ")}` });
  }
  if (model !== undefined && (typeof model !== "string" || !/^[A-Za-z0-9._\-[\]]{0,80}$/.test(model))) {
    return void res.status(400).json({ error: "model must be a model id" });
  }
  await session.settings({ permissionMode: permissionMode as ClaudePermissionMode | undefined, model });
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
