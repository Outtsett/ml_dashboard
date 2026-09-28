/**
 * ONE EventSource to the live hub per tab, shared by every hook.
 *
 * A browser allows six concurrent HTTP/1.1 connections per origin, and the
 * dashboard already holds several event streams (pipeline, training, system).
 * A stream per hook exhausted the six: every later request — a chart fetch, an
 * API call — queued forever and the tab looked frozen. So quotes, bars and
 * headlines for every symbol arrive on this single connection and each hook
 * filters what it needs. The connection opens with the first subscriber and
 * closes with the last.
 */

import { useEffect, useRef, useState } from "react";

type Kind = "quote" | "bar" | "news";
type Listener = (kind: Kind, payload: unknown) => void;

const KINDS: Kind[] = ["quote", "bar", "news"];
const listeners = new Set<Listener>();
const connectionListeners = new Set<(connected: boolean) => void>();
let source: EventSource | null = null;
let connected = false;
let retry: ReturnType<typeof setTimeout> | null = null;

function setConnected(value: boolean): void {
  connected = value;
  for (const listener of connectionListeners) listener(value);
}

function open(): void {
  if (source || listeners.size === 0) return;
  source = new EventSource(`/api/live/stream?kinds=${KINDS.join(",")}`);
  source.onopen = () => setConnected(true);
  source.onerror = () => {
    setConnected(false);
    source?.close();
    source = null;
    if (retry) clearTimeout(retry);
    retry = setTimeout(open, 3000);
  };
  for (const kind of KINDS) {
    source.addEventListener(kind, (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent).data);
      } catch {
        return;
      }
      for (const listener of listeners) listener(kind, payload);
    });
  }
}

function close(): void {
  if (listeners.size > 0) return;
  if (retry) clearTimeout(retry);
  retry = null;
  source?.close();
  source = null;
  setConnected(false);
}

/** Subscribe to hub events for the life of the component. */
export function useHubEvents(onEvent: Listener, enabled = true): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [isConnected, setIsConnected] = useState(connected);

  useEffect(() => {
    if (!enabled) return;
    const listener: Listener = (kind, payload) => handler.current(kind, payload);
    listeners.add(listener);
    connectionListeners.add(setIsConnected);
    setIsConnected(connected);
    open();
    return () => {
      listeners.delete(listener);
      connectionListeners.delete(setIsConnected);
      close();
    };
  }, [enabled]);

  return isConnected;
}
