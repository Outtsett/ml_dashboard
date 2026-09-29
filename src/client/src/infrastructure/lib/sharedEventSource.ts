/**
 * `openEventStream(url)` — a drop-in for `new EventSource(url)` that rides on
 * the tab's ONE multiplexed connection (server: src/server/stream/mux.ts).
 *
 * Chrome allows six HTTP/1.1 connections per host, shared by every tab, and the
 * dashboard opened about eight EventSources per tab, so ordinary requests queued
 * behind them. Every stream now shares one connection; the server opens the real
 * streams to itself and forwards their events.
 *
 * The object returned behaves like an EventSource:
 *  - `readyState` with the same CONNECTING / OPEN / CLOSED numbers,
 *    `onopen` / `onmessage` / `onerror`, `addEventListener` for named events
 *    (an event the server names "error" arrives as a MessageEvent with its data,
 *    as it would natively), `lastEventId`, `close()`.
 *  - A stream that ENDS cleanly (or loses its network) fires `error`, returns to
 *    CONNECTING and is subscribed again with its last event id — after 2 s,
 *    doubling to 30 s while it keeps failing — as the browser's own retry would.
 *  - A stream the server REFUSES (a status of 204 or 300 and above, or a
 *    subscribe answered 4xx other than 429) fires `error` and goes to CLOSED
 *    with no retry, exactly as a native EventSource fails on a non-200 answer.
 *  - If the shared connection drops, every stream fires `error`; the browser
 *    reconnects it, or, if it failed for good (a non-200 answer), a new one is
 *    opened with backoff; `ready` re-subscribes every stream, staggered.
 *  - Only if the multiplexed endpoint fails before it has EVER answered (an older
 *    server without it) do streams fall back to native EventSources. A merely
 *    slow first answer is waited for: falling back then would reopen the eight
 *    connections this module exists to remove.
 */

const MUX_URL = "/api/stream/mux";
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
/** Gap between re-subscriptions after a reconnect, so they do not arrive as one burst. */
const RESUBSCRIBE_STAGGER_MS = 75;

type Handler = ((this: EventSource, event: Event) => unknown) | null;
type MessageHandler = ((this: EventSource, event: MessageEvent) => unknown) | null;

interface MuxFrame {
  s: string;
  t: string;
  d?: string;
  i?: string;
  status?: number;
}

/** A status that ends a stream for good, as a native EventSource would treat it. */
export function isFatalStatus(status: number | undefined): boolean {
  return status !== undefined && (status === 204 || status >= 300) && status !== 429;
}

class MuxedEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly withCredentials = false;
  readyState = 0;
  onopen: Handler = null;
  onmessage: MessageHandler = null;
  onerror: Handler = null;
  lastEventId = "";
  retryTimer: ReturnType<typeof setTimeout> | null = null;
  retryDelayMs = FIRST_RETRY_MS;
  /** The subscribe request in flight, so a close waits for it before unsubscribing. */
  pendingSubscribe: Promise<void> | null = null;
  /** Every event type something listens for — needed to forward a native
   *  EventSource's named events after a fall back. */
  readonly types = new Set<string>();
  /** Set only after a fall back to a native EventSource. */
  native: EventSource | null = null;

  constructor(readonly url: string, readonly id: string) {
    super();
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, listener, options);
    if (!this.types.has(type)) {
      this.types.add(type);
      if (this.native) forwardNamed(this, this.native, type);
    }
  }

  close(): void {
    if (this.readyState === 2) return;
    this.readyState = 2;
    this.clearRetry();
    if (this.native) {
      this.native.close();
      return;
    }
    manager.release(this);
  }

  clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Dispatches to listeners, then the matching `on<type>` property. */
  emit(event: Event): void {
    this.dispatchEvent(event);
    const self = this as unknown as EventSource;
    if (event.type === "message") this.onmessage?.call(self, event as MessageEvent);
    else if (event.type === "open") this.onopen?.call(self, event);
    else if (event.type === "error") this.onerror?.call(self, event);
  }
}

/** Forwards one named event type from a native EventSource to the stand-in. */
function forwardNamed(stream: MuxedEventSource, native: EventSource, type: string): void {
  if (type === "message" || type === "open" || type === "error") return;
  native.addEventListener(type, (event) => {
    const message = event as MessageEvent;
    stream.emit(new MessageEvent(type, { data: message.data, lastEventId: message.lastEventId }));
  });
}

class MuxManager {
  private source: EventSource | null = null;
  private connection: string | null = null;
  private everReady = false;
  private streams = new Map<string, MuxedEventSource>();
  private counter = 0;
  private unavailable = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = FIRST_RETRY_MS;

  open(url: string): EventSource {
    if (this.unavailable || typeof window === "undefined") return new EventSource(url);
    this.counter += 1;
    const stream = new MuxedEventSource(url, `s${this.counter}_${Math.random().toString(36).slice(2, 8)}`);
    this.streams.set(stream.id, stream);
    this.ensureConnection();
    if (this.connection) this.subscribe(stream);
    return stream as unknown as EventSource;
  }

  release(stream: MuxedEventSource): void {
    this.streams.delete(stream.id);
    const connection = this.connection;
    if (connection) {
      // A subscribe still in flight would otherwise land after this unsubscribe
      // and leave the server streaming to nobody.
      void (stream.pendingSubscribe ?? Promise.resolve()).finally(() => {
        void this.post(connection, "/unsubscribe", { subscription: stream.id });
      });
    }
    if (this.streams.size === 0) this.shutdown();
  }

  private ensureConnection(): void {
    if (this.source && this.source.readyState !== 2) return;
    if (this.reconnectTimer) return;
    const source = new EventSource(MUX_URL);
    this.source = source;

    source.addEventListener("ready", (event) => {
      if (source !== this.source) return;
      this.everReady = true;
      this.reconnectDelayMs = FIRST_RETRY_MS;
      this.connection = (JSON.parse((event as MessageEvent).data) as { connection: string }).connection;
      let delay = 0;
      for (const stream of this.streams.values()) {
        if (stream.readyState === 2) continue;
        stream.clearRetry();
        setTimeout(() => {
          if (stream.readyState !== 2 && this.streams.has(stream.id)) this.subscribe(stream);
        }, delay);
        delay += RESUBSCRIBE_STAGGER_MS;
      }
    });
    source.addEventListener("m", (event) => {
      if (source !== this.source) return;
      let frame: MuxFrame;
      try {
        frame = JSON.parse((event as MessageEvent).data) as MuxFrame;
      } catch {
        return;
      }
      const stream = this.streams.get(frame.s);
      if (!stream || stream.readyState === 2) return;
      if (frame.t === "__open") {
        stream.readyState = 1;
        stream.retryDelayMs = FIRST_RETRY_MS;
        stream.emit(new Event("open"));
      } else if (frame.t === "__end") {
        if (isFatalStatus(frame.status)) this.fail(stream);
        else this.retry(stream);
      } else {
        if (frame.i !== undefined) stream.lastEventId = frame.i;
        stream.emit(new MessageEvent(frame.t, { data: frame.d ?? "", lastEventId: stream.lastEventId, origin: window.location.origin }));
      }
    });
    source.onerror = () => {
      if (source !== this.source) return;
      // Read BEFORE telling the streams: an owner that closes its stream in
      // onerror can empty the list, and the last close shuts this source,
      // which would then look like a permanent failure and wrongly fall back.
      const failedForGood = source.readyState === 2;
      this.connection = null;
      for (const stream of [...this.streams.values()]) {
        if (stream.readyState === 2) continue;
        stream.clearRetry();
        stream.readyState = 0;
        stream.emit(new Event("error"));
      }
      if (source !== this.source) return; // the last stream closed; shut down deliberately
      if (!failedForGood) return; // the browser is reconnecting it
      // Failed for good (a non-200 answer). Before it has ever answered, this
      // server has no mux: fall back. Afterwards it is a restart or a limit:
      // open a new one with backoff.
      this.source = null;
      if (!this.everReady) {
        this.fallBack();
        return;
      }
      if (this.streams.size === 0) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.streams.size > 0) this.ensureConnection();
      }, this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(MAX_RETRY_MS, this.reconnectDelayMs * 2);
    };
  }

  /** The server refused the stream: CLOSED, no retry, like a native EventSource. */
  private fail(stream: MuxedEventSource): void {
    stream.clearRetry();
    stream.readyState = 2;
    this.streams.delete(stream.id);
    stream.emit(new Event("error"));
    if (this.streams.size === 0) this.shutdown();
  }

  /** The stream ended or could not be subscribed: tell its owner, then try again with backoff. */
  private retry(stream: MuxedEventSource): void {
    stream.readyState = 0;
    stream.emit(new Event("error"));
    if (stream.readyState === 2) return; // the owner closed it in onerror
    stream.clearRetry();
    const delay = stream.retryDelayMs;
    stream.retryDelayMs = Math.min(MAX_RETRY_MS, stream.retryDelayMs * 2);
    stream.retryTimer = setTimeout(() => {
      stream.retryTimer = null;
      if (stream.readyState !== 2 && this.connection) this.subscribe(stream);
    }, delay);
  }

  private subscribe(stream: MuxedEventSource): void {
    const connection = this.connection;
    if (!connection) return;
    stream.clearRetry();
    const request = this.post(connection, "/subscribe", {
      subscription: stream.id,
      url: stream.url,
      ...(stream.lastEventId ? { lastEventId: stream.lastEventId } : {}),
    }).then((status) => {
      if (stream.readyState === 2 || connection !== this.connection) return;
      if (status >= 200 && status < 300) return;
      // 404: the connection closed under us — `ready` will subscribe again.
      if (status === 404) return;
      if (status >= 400 && status < 500 && status !== 429) this.fail(stream);
      else this.retry(stream);
    });
    const tracked: Promise<void> = request.finally(() => {
      if (stream.pendingSubscribe === tracked) stream.pendingSubscribe = null;
    });
    stream.pendingSubscribe = tracked;
  }

  /** POSTs to the connection; the HTTP status, or 0 when the request failed. */
  private async post(connection: string, path: string, body: unknown): Promise<number> {
    try {
      const response = await fetch(`${MUX_URL}/${connection}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      return response.status;
    } catch {
      return 0;
    }
  }

  private shutdown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
    this.connection = null;
  }

  /** This server has no multiplexed endpoint: every stream, now and later, uses
   *  its own native EventSource, keeping the listeners it already has. */
  private fallBack(): void {
    this.unavailable = true;
    this.shutdown();
    for (const stream of [...this.streams.values()]) {
      this.streams.delete(stream.id);
      if (stream.readyState === 2) continue;
      const native = new EventSource(stream.url);
      stream.native = native;
      native.onopen = () => {
        stream.readyState = 1;
        stream.emit(new Event("open"));
      };
      native.onerror = (event) => {
        // A server event named "error" arrives here as a MessageEvent with data;
        // a connection failure as a bare Event.
        if (event instanceof MessageEvent) {
          stream.emit(new MessageEvent("error", { data: event.data, lastEventId: event.lastEventId }));
          return;
        }
        stream.readyState = native.readyState;
        stream.emit(new Event("error"));
      };
      native.onmessage = (event) => stream.emit(new MessageEvent("message", { data: event.data, lastEventId: event.lastEventId }));
      for (const type of stream.types) forwardNamed(stream, native, type);
    }
  }

  /** For tests. */
  reset(): void {
    this.shutdown();
    this.streams.clear();
    this.unavailable = false;
    this.everReady = false;
    this.counter = 0;
    this.reconnectDelayMs = FIRST_RETRY_MS;
  }
}

const manager = new MuxManager();

export function openEventStream(url: string): EventSource {
  return manager.open(url);
}

/** Test seam. */
export function resetEventStreamsForTests(): void {
  manager.reset();
}
