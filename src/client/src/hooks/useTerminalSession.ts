import { useState, useRef, useCallback, useEffect } from "react";

interface TerminalSessionState {
  sessionId: string | null;
  connected: boolean;
  output: string;
}

/**
 * Manages a PTY terminal session over WebSocket.
 *
 * - `create()` — POST to create a session, then opens a WebSocket
 * - `sendInput(text)` — send keystrokes / commands to the PTY
 * - `close()` — tear down WebSocket + DELETE the session
 *
 * Cleans up automatically on unmount.
 */
export function useTerminalSession() {
  const [state, setState] = useState<TerminalSessionState>({
    sessionId: null,
    connected: false,
    output: "",
  });
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const close = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
    wsRef.current = null;

    const id = sessionIdRef.current;
    if (id) {
      try {
        await fetch(`/api/terminal/sessions/${id}`, { method: "DELETE" });
      } catch {
        /* best-effort cleanup */
      }
    }
    sessionIdRef.current = null;
    setState({ sessionId: null, connected: false, output: "" });
  }, []);

  const create = useCallback(async () => {
    // Tear down any previous session first
    await close();

    const res = await fetch("/api/terminal/sessions", { method: "POST" });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    const { id } = (await res.json()) as { id: string };
    sessionIdRef.current = id;
    setState((s) => ({ ...s, sessionId: id }));

    // Connect WebSocket — path-based: /ws/terminal/<sessionId>
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal/${id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onmessage = (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      setState((s) => ({ ...s, output: s.output + data }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    return id;
  }, [close]);

  const sendInput = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: text }));
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      const id = sessionIdRef.current;
      if (id) {
        fetch(`/api/terminal/sessions/${id}`, { method: "DELETE" }).catch(() => {});
      }
    };
  }, []);

  return {
    sessionId: state.sessionId,
    connected: state.connected,
    output: state.output,
    create,
    sendInput,
    close,
  };
}
