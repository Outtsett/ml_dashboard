/**
 * EmbeddedTerminal — Real interactive terminal powered by xterm.js.
 *
 * Connects to the server's PTY via WebSocket at /ws/terminal.
 * Completely independent of the dashboard — if React crashes, the PTY
 * session survives and reconnects when the component remounts.
 *
 * Features:
 *   - Auto-fit to container size
 *   - Clickable URLs
 *   - Scrollback buffer (from server)
 *   - Auto-reconnect on disconnect
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// ── Theme (matches dashboard dark mode) ──────────────────────────────────────

const TERMINAL_THEME = {
  background: "#0a0a0a",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

// ── Component ────────────────────────────────────────────────────────────────

interface EmbeddedTerminalProps {
  /** Unique session ID — each tab gets its own PTY session */
  sessionId: string;
  /** If false, terminal is hidden but WebSocket stays alive */
  visible?: boolean;
}

export function EmbeddedTerminal({ sessionId, visible = true }: EmbeddedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);
  const [_connected, setConnected] = useState(false);

  // Build WebSocket URL relative to current page, including session ID
  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/terminal/${sessionId}`;
  }, [sessionId]);

  // ── Connect to PTY WebSocket ───────────────────────────────────────────────

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send initial size
      if (termRef.current) {
        ws.send(JSON.stringify({
          type: "resize",
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        }));
      }
    };

    ws.onmessage = (event) => {
      termRef.current?.write(typeof event.data === "string" ? event.data : "");
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2s (unless disposed)
      if (!disposedRef.current) {
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [getWsUrl]);

  // ── Initialize xterm.js ────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: TERMINAL_THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    termRef.current = term;
    fitRef.current = fit;

    term.open(containerRef.current);

    // Double-rAF ensures browser has completed layout before fitting
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fitRef.current) {
          fitRef.current.fit();
        }
      });
    });

    // Forward user input to WebSocket
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Connect to server PTY
    disposedRef.current = false;
    connect();

    return () => {
      disposedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);  

  // ── Resize handling ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || !fitRef.current) return;

    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }));
        }
      } catch {
        // Container not visible yet
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Re-fit when visibility changes ─────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
      });
    }
  }, [visible]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        width: '100%',
        display: visible ? 'flex' : 'none',
        flexDirection: 'column' as const,
      }}
    >
      {/* Terminal viewport */}
      <div
        ref={containerRef}
        style={{ flex: '1 1 0%', minHeight: 0, padding: 0 }}
      />
    </div>
  );
}
