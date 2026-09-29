/**
 * One event stream per browser tab, carrying every event stream the tab reads.
 *
 * Why: Chrome allows six HTTP/1.1 connections per host, shared by every tab.
 * The dashboard shell alone opened about eight long-lived EventSources per tab
 * (chart and live bars on /api/events/pipeline, GPU and system matrix on
 * /api/events/system, the three activity channels, the live hub stream), so the
 * pool was full and every ordinary request — a list, a start, a chart fetch —
 * waited for a stream to reconnect. Measured 2026-09-28: a 0.27 s request sat
 * queued for over a minute.
 *
 * How: the tab opens ONE `GET /api/stream/mux` and asks for streams by URL with
 * `POST /api/stream/mux/:connection/subscribe`. The server opens each one as a
 * loopback request to itself — server-to-server, where no browser limit applies
 * — parses its server-sent events and forwards each, tagged with the
 * subscription, down the tab's single connection. Every existing stream endpoint
 * is reused unchanged: its events, names, ids and ordering arrive exactly as a
 * direct EventSource would see them.
 *
 * Frames sent to the tab (`event: m`, JSON data):
 *   { s: subscription, t: "__open" }                 upstream answered 200
 *   { s, t: <event name>, d: <data>, i?: <id> }       one upstream event
 *   { s, t: "__end", status?: number }                upstream ended or failed
 */

import { randomUUID } from "crypto";
import type { Response } from "express";
import { Logger } from "@nestjs/common";
import { INTERNAL_REQUEST_HEADER, internalRequestToken } from "../infrastructure/lib/internalRequest";

const logger = new Logger("StreamMux");

const HEARTBEAT_MS = 15_000;
/** Bytes a tab may leave unread before its connection is dropped. A tab that
 *  stops reading (a frozen renderer) would otherwise make the server buffer every
 *  event of every stream in memory; dropped, the tab reconnects and resumes with
 *  Last-Event-ID. */
const MAX_UNREAD_BYTES = 8 * 1024 * 1024;
const MAX_SUBSCRIPTIONS_PER_CONNECTION = 64;

interface Subscription {
  url: string;
  abort: AbortController;
}

interface Connection {
  res: Response;
  subscriptions: Map<string, Subscription>;
  heartbeat: ReturnType<typeof setInterval>;
}

const connections = new Map<string, Connection>();

export interface ParsedEvent {
  type: string;
  data: string;
  id?: string;
}

/** Incremental server-sent-events parser (the WHATWG rules the browser applies):
 *  `event`, `data` (several lines joined by "\n"), `id`; comments and `retry` are
 *  dropped; an event is dispatched on a blank line, and one with no data line is
 *  not dispatched. Feed it chunks; it returns the events each chunk completed. */
export class EventParser {
  private buffer = "";
  private type = "";
  private data: string[] = [];
  private id: string | undefined;
  private sawData = false;

  push(chunk: string): ParsedEvent[] {
    this.buffer += chunk;
    const events: ParsedEvent[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      // A CR at the very end may be half of a CRLF split across chunks.
      if (newline === this.buffer.length - 1 && this.buffer.endsWith("\r")) break;
      const line = this.buffer.slice(0, newline);
      const width = this.buffer.startsWith("\r\n", newline) ? 2 : 1;
      this.buffer = this.buffer.slice(newline + width);
      if (line === "") {
        if (this.sawData) events.push({ type: this.type || "message", data: this.data.join("\n"), id: this.id });
        this.type = "";
        this.data = [];
        this.sawData = false;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") this.type = value;
      else if (field === "data") {
        this.data.push(value);
        this.sawData = true;
      } else if (field === "id" && !value.includes("\0")) this.id = value;
    }
    return events;
  }
}

function send(connection: Connection, frame: Record<string, unknown>): void {
  if (connection.res.writableEnded || connection.res.destroyed) return;
  connection.res.write(`event: m\ndata: ${JSON.stringify(frame)}\n\n`);
  if (connection.res.writableLength > MAX_UNREAD_BYTES) {
    logger.warn(`dropping a stream connection with ${connection.res.writableLength} unread bytes (the tab stopped reading)`);
    connection.res.destroy();
  }
}

/** A URL the mux may open: a same-server API path, nothing else. The browser
 *  could already GET any of these directly, so the mux reaches nothing new. */
export function isAllowedStreamUrl(url: string): boolean {
  return normalizeStreamUrl(url) !== null;
}

/** The path and query the mux will request, or null when `url` is not a
 *  same-server API path. The check is made on the PARSED path (dot segments and
 *  case resolved) and the parsed form is what gets requested, so the URL that
 *  was checked is the URL that is opened. */
export function normalizeStreamUrl(url: string): string | null {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  if (url.includes("\\") || /[\r\n\0]/.test(url) || /%2e|%2f|%5c/i.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://127.0.0.1");
  } catch {
    return null;
  }
  if (parsed.host !== "127.0.0.1") return null;
  const path = parsed.pathname.toLowerCase();
  if (!path.startsWith("/api/") || path.startsWith("/api/stream/mux")) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function openConnection(res: Response): string {
  const id = randomUUID();
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const connection: Connection = { res, subscriptions: new Map(), heartbeat };
  connections.set(id, connection);
  res.write(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ connection: id })}\n\n`);
  res.on("close", () => closeConnection(id));
  return id;
}

export function closeConnection(id: string): void {
  const connection = connections.get(id);
  if (!connection) return;
  connections.delete(id);
  clearInterval(connection.heartbeat);
  for (const subscription of connection.subscriptions.values()) subscription.abort.abort();
  connection.subscriptions.clear();
}

export type SubscribeResult = "ok" | "unknown_connection" | "bad_url" | "too_many";

/** Opens `url` on the server itself and forwards its events. `port` is the port
 *  this request arrived on; `headers` are passed through (cookie, Last-Event-ID). */
export function subscribe(
  connectionId: string,
  subscriptionId: string,
  url: string,
  port: number,
  headers: Record<string, string>,
): SubscribeResult {
  const connection = connections.get(connectionId);
  if (!connection) return "unknown_connection";
  const target = normalizeStreamUrl(url);
  if (target === null) return "bad_url";
  const existing = connection.subscriptions.get(subscriptionId);
  if (existing) existing.abort.abort();
  else if (connection.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) return "too_many";

  const abort = new AbortController();
  const subscription: Subscription = { url, abort };
  connection.subscriptions.set(subscriptionId, subscription);

  void (async () => {
    let status: number | undefined;
    try {
      const response = await fetch(`http://127.0.0.1:${port}${target}`, {
        headers: { accept: "text/event-stream", "cache-control": "no-cache", ...headers, [INTERNAL_REQUEST_HEADER]: internalRequestToken },
        signal: abort.signal,
      });
      status = response.status;
      // Like a native EventSource: anything but a 200 event stream fails it.
      const eventStream = (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream");
      if (!response.ok || !response.body || !eventStream) {
        if (response.ok && !eventStream) status = 415;
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      send(connection, { s: subscriptionId, t: "__open" });
      const parser = new EventParser();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          send(connection, event.id === undefined
            ? { s: subscriptionId, t: event.type, d: event.data }
            : { s: subscriptionId, t: event.type, d: event.data, i: event.id });
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) logger.warn(`stream ${url} failed: ${(err as Error).message}`);
    } finally {
      // Only the subscription that is still current reports its end: a
      // re-subscribe replaced it, or the tab asked to stop, otherwise.
      if (connection.subscriptions.get(subscriptionId) === subscription) {
        connection.subscriptions.delete(subscriptionId);
        if (!abort.signal.aborted) send(connection, { s: subscriptionId, t: "__end", status });
      }
    }
  })();
  return "ok";
}

export function unsubscribe(connectionId: string, subscriptionId: string): boolean {
  const connection = connections.get(connectionId);
  const subscription = connection?.subscriptions.get(subscriptionId);
  if (!connection || !subscription) return false;
  connection.subscriptions.delete(subscriptionId);
  subscription.abort.abort();
  return true;
}

/** For the health view and tests: open connections and their subscriptions. */
export function muxStatistics(): { connections: number; subscriptions: number; urls: Record<string, number> } {
  const urls: Record<string, number> = {};
  let subscriptions = 0;
  for (const connection of connections.values()) {
    for (const subscription of connection.subscriptions.values()) {
      subscriptions++;
      const path = subscription.url.split("?")[0]!;
      urls[path] = (urls[path] ?? 0) + 1;
    }
  }
  return { connections: connections.size, subscriptions, urls };
}

/** Called on shutdown so no loopback stream holds the server open. */
export function closeAllConnections(): void {
  for (const [id, connection] of connections) {
    closeConnection(id);
    if (!connection.res.writableEnded) connection.res.end();
  }
}
