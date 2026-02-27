/**
 * PTY WebSocket Server — Multi-session
 *
 * Spawns real pseudo-terminals (PowerShell on Windows, bash elsewhere)
 * and bridges them to the browser over WebSocket connections.
 *
 * Each terminal tab gets its own session identified by ID in the URL:
 *   /ws/terminal/:sessionId
 *
 * Sessions survive browser disconnects — reconnecting to the same ID
 * restores the scrollback buffer.
 *
 * Also exposes a REST API for session management:
 *   GET    /api/terminal/sessions       — list active sessions
 *   POST   /api/terminal/sessions       — create a new session (returns { id })
 *   DELETE  /api/terminal/sessions/:id  — kill a session
 *   PATCH  /api/terminal/sessions/:id   — rename a session
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Express } from "express";
import * as pty from "node-pty";
import os from "os";
import { log } from "../lib/log";

// ── Types ────────────────────────────────────────────────────────────────────

interface PtySession {
  id: string;
  pty: pty.IPty;
  /** Buffered output while no client is connected (for reconnection). */
  scrollback: string;
  /** Human-readable title (e.g. "PowerShell 1"). */
  title: string;
  /** Creation timestamp. */
  createdAt: number;
  /** Connected WebSocket clients. */
  clients: Set<WebSocket>;
}

/** Messages from client → server */
interface ClientMessage {
  type: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

// ── State ────────────────────────────────────────────────────────────────────

const MAX_SCROLLBACK = 100_000;
const MAX_SESSIONS = 10;
const sessions = new Map<string, PtySession>();
let sessionCounter = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getShell(): string {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellArgs(): string[] {
  const shell = getShell();
  if (shell.includes("powershell") || shell.includes("pwsh")) {
    return ["-NoLogo"];
  }
  return [];
}

function generateId(): string {
  return `term-${++sessionCounter}`;
}

function createSession(id?: string): PtySession {
  const sessionId = id ?? generateId();

  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Maximum terminal sessions (${MAX_SESSIONS}) reached`);
  }

  const shell = getShell();
  const args = getShellArgs();
  const cwd = process.cwd();
  const shellName = shell.includes("pwsh") ? "pwsh" : shell.includes("powershell") ? "PowerShell" : shell.split("/").pop() ?? "shell";

  log(`Spawning PTY [${sessionId}]: ${shell} ${args.join(" ")} (cwd: ${cwd})`, "pty");

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });

  const session: PtySession = {
    id: sessionId,
    pty: ptyProcess,
    scrollback: "",
    title: `${shellName} ${sessionCounter}`,
    createdAt: Date.now(),
    clients: new Set(),
  };

  // Buffer output + broadcast to connected clients
  ptyProcess.onData((data: string) => {
    session.scrollback += data;
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
    }
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    log(`PTY [${sessionId}] exited with code ${exitCode}`, "pty");
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, session);
  return session;
}

function getOrCreateSession(id: string): PtySession {
  return sessions.get(id) ?? createSession(id);
}

// ── REST API ─────────────────────────────────────────────────────────────────

export function registerTerminalRoutes(app: Express): void {
  app.get("/api/terminal/sessions", (_req, res) => {
    const list = Array.from(sessions.values()).map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      clients: s.clients.size,
    }));
    res.json(list);
  });

  app.post("/api/terminal/sessions", (_req, res) => {
    try {
      const session = createSession();
      res.status(201).json({ id: session.id, title: session.title });
    } catch (err: any) {
      res.status(429).json({ error: err.message });
    }
  });

  app.delete("/api/terminal/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    session.pty.kill();
    sessions.delete(session.id);
    res.json({ ok: true });
  });

  app.patch("/api/terminal/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (req.body?.title) {
      session.title = String(req.body.title).slice(0, 50);
    }
    res.json({ id: session.id, title: session.title });
  });
}

// ── WebSocket Server ─────────────────────────────────────────────────────────

/** Allowed origins for WebSocket connections (prevents CSRF-to-RCE). */
const ALLOWED_WS_ORIGINS = new Set([
  "http://127.0.0.1:5000",
  "http://localhost:5000",
]);

export function attachPtyWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    const match = url.match(/^\/ws\/terminal\/?([\w-]*)$/);
    if (!match) return;

    // Origin validation — reject cross-origin WebSocket connections
    const origin = req.headers.origin ?? "";
    if (origin && !ALLOWED_WS_ORIGINS.has(origin)) {
      log(`Rejected WebSocket from origin: ${origin}`, "pty");
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const sessionId = match[1] || "default";
      wss.emit("connection", ws, req, sessionId);
    });
  });

  log("PTY WebSocket listening on /ws/terminal/:sessionId", "pty");

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, sessionId: string) => {
    const session = getOrCreateSession(sessionId);
    session.clients.add(ws);

    if (session.scrollback.length > 0) {
      ws.send(session.scrollback);
    }

    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg: ClientMessage = JSON.parse(
          typeof raw === "string" ? raw : raw.toString("utf-8"),
        );
        switch (msg.type) {
          case "input":
            if (msg.data) session.pty.write(msg.data);
            break;
          case "resize":
            if (msg.cols && msg.rows) {
              session.pty.resize(
                Math.min(Math.max(msg.cols, 1), 500),
                Math.min(Math.max(msg.rows, 1), 200),
              );
            }
            break;
        }
      } catch {
        // Drop malformed messages — do NOT pipe raw text into the shell
        log(`Dropped malformed WebSocket message from terminal client`, "pty");
      }
    });

    ws.on("close", () => {
      session.clients.delete(ws);
    });

    ws.on("error", (err) => {
      log(`Terminal WebSocket error [${sessionId}]: ${err.message}`, "pty");
      session.clients.delete(ws);
    });
  });
}
