/**
 * PTY WebSocket Server â€” Multi-session
 *
 * Spawns real pseudo-terminals (PowerShell on Windows, bash elsewhere)
 * and bridges them to the browser over WebSocket connections.
 *
 * Each terminal tab gets its own session identified by ID in the URL:
 *   /ws/terminal/:sessionId
 *
 * Sessions survive browser disconnects â€” reconnecting to the same ID
 * restores the scrollback buffer.
 *
 * Also exposes a REST API for session management:
 *   GET    /api/terminal/sessions       â€” list active sessions
 *   POST   /api/terminal/sessions       â€” create a new session (returns { id })
 *   DELETE  /api/terminal/sessions/:id  â€” kill a session
 *   PATCH  /api/terminal/sessions/:id   â€” rename a session
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Express } from "express";
import * as pty from "node-pty";
import os from "os";
import { existsSync } from "fs";
import { log } from "../lib/log";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  /** Last activity timestamp for idle timeout. */
  lastActivity: number;
  /** Timer handle for idle session cleanup. */
  idleTimer: ReturnType<typeof setTimeout>;
}

/** Messages from client â†’ server */
interface ClientMessage {
  type: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MAX_SCROLLBACK = 500_000;
const MAX_SESSIONS = parseInt(process.env.MAX_PTY_SESSIONS ?? '10', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.PTY_IDLE_TIMEOUT_MS ?? '1800000', 10); // 30 min default
const sessions = new Map<string, PtySession>();
let sessionCounter = 0;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getShell(): string {
  if (os.platform() === "win32") {
    // Prioritize PowerShell 7 (pwsh.exe), then Windows PowerShell
    const paths = [
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "pwsh.exe",
      "powershell.exe"
    ];
    for (const p of paths) {
      try {
        if (existsSync(p)) return p;
      } catch {
        // Unreadable path (permissions, bad drive) — fall through to the next
        // candidate rather than aborting shell selection.
      }
    }
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellArgs(shellOverride?: string): string[] {
  const shell = shellOverride ?? getShell();
  if (shell.includes("powershell") || shell.includes("pwsh")) {
    // Loading with profile enabled (default behavior when no flags provided)
    return [];
  }
  return [];
}

function generateId(): string {
  return `term-${++sessionCounter}`;
}

/** Reset the idle timer for a session; closes the session if it stays idle. */
function resetIdleTimer(session: PtySession): void {
  session.lastActivity = Date.now();
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    log(`PTY [${session.id}] idle for ${IDLE_TIMEOUT_MS / 1000}s â€” closing`, "pty");
    session.pty.kill();
    sessions.delete(session.id);
  }, IDLE_TIMEOUT_MS);
}

function createSession(id?: string, shellOverride?: string, _titleOverride?: string): PtySession {
  const sessionId = id ?? generateId();

  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Maximum terminal sessions (${MAX_SESSIONS}) reached`);
  }

  const shell = shellOverride ?? getShell();
  const args = getShellArgs(shellOverride);
  const cwd = process.cwd();
  const shellName = shell.includes("pwsh") ? "pwsh" : shell.includes("powershell") ? "PowerShell" : shell.split("/").pop() ?? "shell";

  log(`Spawning PTY [${sessionId}]: ${shell} ${args.join(" ")} (cwd: ${cwd})`, "pty");

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 140,
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
    lastActivity: Date.now(),
    idleTimer: setTimeout(() => {}, 0), // placeholder, reset below
  };
  resetIdleTimer(session);

  // Buffer output + broadcast to connected clients
  ptyProcess.onData((data: string) => {
    resetIdleTimer(session);
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
    clearTimeout(session.idleTimer);
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

// â”€â”€ Shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Kill all active PTY sessions. Call on server shutdown to prevent orphaned processes. */
export function shutdownAllPtySessions(): void {
  for (const [id, session] of sessions) {
    try {
      session.pty.kill();
      clearTimeout(session.idleTimer);
    } catch (e) {
      console.warn(`[pty] Failed to kill session ${id}:`, e);
    }
  }
  sessions.clear();
}

// â”€â”€ REST API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  app.post("/api/terminal/sessions", (req, res) => {
    try {
      const { shell, title } = req.body || {}; const session = createSession(undefined, shell, title);
      res.status(201).json({ id: session.id, title: session.title });
    } catch (err) {
      res.status(429).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/terminal/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    clearTimeout(session.idleTimer);
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

// â”€â”€ WebSocket Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Allowed origins for WebSocket connections (prevents CSRF-to-RCE).
 *
 * Derived from PORT, like the HTTP CORS allow-list in main.ts. Both were written
 * as literal :5000 and both had the same consequence on any other port: the
 * server rejected its OWN origin. Here it surfaced as the terminal failing to
 * open with "WebSocket handshake: Unexpected response code: 403" — the shell is
 * simply unreachable whenever the dashboard is not on 5000.
 *
 * Kept as a function rather than a module-scope Set so it reads the port at
 * connection time, which also makes it testable.
 */
function allowedWsOrigins(): Set<string> {
  const port = parseInt(process.env.PORT || "5000", 10);
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

export function attachPtyWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    const match = url.match(/^\/ws\/terminal\/?([\w-]*)$/);
    if (!match) return;

    // Origin validation â€” reject cross-origin WebSocket connections
    const origin = req.headers.origin ?? "";
    if (origin && !allowedWsOrigins().has(origin)) {
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
            if (msg.data) {
              resetIdleTimer(session);
              session.pty.write(msg.data);
            }
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
        // Drop malformed messages â€” do NOT pipe raw text into the shell
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


