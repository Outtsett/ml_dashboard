// @vitest-environment jsdom
/**
 * `openEventStream` (src/client/src/infrastructure/lib/sharedEventSource.ts):
 * every stream in a tab rides one EventSource to /api/stream/mux and behaves like
 * a native EventSource to its owner — open, message, named events (including a
 * server event named "error" with its data), retry with the last event id after
 * a stream ends, re-subscription when the shared connection drops, unsubscribe on
 * close, and a fall back to native EventSources when the mux never answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openEventStream, resetEventStreamsForTests } from "@/infrastructure/lib/sharedEventSource";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: typeof data === "string" ? data : JSON.stringify(data) }));
  }
  /** A transport error; `closed` = the browser gave up (a non-200 answer). */
  fail(closed = false): void {
    if (closed) this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
}

let posts: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  posts = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  subscribeStatus = 202;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: url.endsWith("/subscribe") ? subscribeStatus : 200 });
  }));
  resetEventStreamsForTests();
});

afterEach(() => {
  resetEventStreamsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mux = () => FakeEventSource.instances.filter((s) => s.url === "/api/stream/mux").at(-1)!;
let subscribeStatus = 202;

describe("openEventStream", () => {
  it("opens one shared connection for any number of streams and subscribes each by URL", async () => {
    const a = openEventStream("/api/events/pipeline");
    const b = openEventStream("/api/events/system");
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual(["/api/stream/mux"]);
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    expect(posts.map((p) => [p.url, p.body.url])).toEqual([
      ["/api/stream/mux/c1/subscribe", "/api/events/pipeline"],
      ["/api/stream/mux/c1/subscribe", "/api/events/system"],
    ]);
    expect(a.readyState).toBe(0);
    expect(b.readyState).toBe(0);
  });

  it("delivers open, message and named events — a server 'error' event keeps its data", async () => {
    const stream = openEventStream("/api/training/stream/run-1");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts[0]!.body.subscription as string;
    const seen: string[] = [];
    stream.onopen = () => seen.push("open");
    stream.onmessage = (event) => seen.push(`message:${event.data}`);
    stream.addEventListener("cycle_bars", (event) => seen.push(`bars:${(event as MessageEvent).data}:${(event as MessageEvent).lastEventId}`));
    stream.addEventListener("error", (event) => seen.push(`error:${(event as MessageEvent).data ?? "transport"}`));
    mux().send("m", { s: id, t: "__open" });
    mux().send("m", { s: id, t: "message", d: "hello" });
    mux().send("m", { s: id, t: "cycle_bars", d: "{\"n\":1}", i: "41" });
    mux().send("m", { s: id, t: "error", d: "{\"message\":\"run failed\"}" });
    mux().send("m", { s: "someone-else", t: "message", d: "not mine" });
    expect(seen).toEqual(["open", "message:hello", "bars:{\"n\":1}:41", "error:{\"message\":\"run failed\"}"]);
    expect(stream.readyState).toBe(1);
  });

  it("fires error when a stream ends and subscribes again after two seconds with its last event id", async () => {
    const stream = openEventStream("/api/training/stream/run-1");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts[0]!.body.subscription as string;
    let errors = 0;
    stream.onerror = () => errors++;
    mux().send("m", { s: id, t: "__open" });
    mux().send("m", { s: id, t: "x", d: "1", i: "99" });
    mux().send("m", { s: id, t: "__end", status: 200 });
    expect(errors).toBe(1);
    expect(stream.readyState).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(posts.at(-1)!.body).toMatchObject({ subscription: id, url: "/api/training/stream/run-1", lastEventId: "99" });
  });

  it("does not retry a stream its owner closed in onerror, and unsubscribes it", async () => {
    const stream = openEventStream("/api/news/stream/MNQ");
    openEventStream("/api/events/system"); // keeps the shared connection open
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts[0]!.body.subscription as string;
    stream.onerror = () => stream.close();
    mux().send("m", { s: id, t: "__end" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stream.readyState).toBe(2);
    expect(posts.filter((p) => p.url.endsWith("/subscribe") && p.body.subscription === id)).toHaveLength(1);
    expect(posts.some((p) => p.url === "/api/stream/mux/c1/unsubscribe" && p.body.subscription === id)).toBe(true);
  });

  it("re-subscribes every stream when the shared connection comes back with a new id", async () => {
    const stream = openEventStream("/api/events/pipeline");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    let errors = 0;
    stream.onerror = () => errors++;
    mux().fail();
    expect(errors).toBe(1);
    mux().send("ready", { connection: "c2" });
    await vi.runOnlyPendingTimersAsync();
    expect(posts.at(-1)!.url).toBe("/api/stream/mux/c2/subscribe");
  });

  it("closes the shared connection when the last stream closes", async () => {
    const stream = openEventStream("/api/events/pipeline");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    stream.close();
    expect(mux().closed).toBe(true);
  });

  it("closes a stream the server refuses (404 upstream, 400 subscribe) with no retry, like a native EventSource", async () => {
    const refused = openEventStream("/api/hpo/stream/gone");
    openEventStream("/api/events/system");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts.find((p) => p.body.url === "/api/hpo/stream/gone")!.body.subscription as string;
    let errors = 0;
    refused.onerror = () => errors++;
    mux().send("m", { s: id, t: "__end", status: 404 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toBe(1);
    expect(refused.readyState).toBe(2);
    expect(posts.filter((p) => p.body.subscription === id && p.url.endsWith("/subscribe"))).toHaveLength(1);

    subscribeStatus = 400;
    const bad = openEventStream("/api/not-a-stream");
    await vi.runOnlyPendingTimersAsync();
    expect(bad.readyState).toBe(2);
  });

  it("backs off while a stream keeps ending: 2 s, then 4 s", async () => {
    const stream = openEventStream("/api/events/pipeline");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts[0]!.body.subscription as string;
    const subscribes = () => posts.filter((p) => p.body.subscription === id && p.url.endsWith("/subscribe")).length;
    mux().send("m", { s: id, t: "__end" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscribes()).toBe(2);
    mux().send("m", { s: id, t: "__end" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscribes()).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subscribes()).toBe(3);
    expect(stream.readyState).toBe(0);
  });

  it("opens a new shared connection when the old one failed for good, and re-subscribes on it", async () => {
    const stream = openEventStream("/api/events/pipeline");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const first = mux();
    first.fail(true);
    expect(stream.readyState).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mux()).not.toBe(first);
    mux().send("ready", { connection: "c2" });
    await vi.runOnlyPendingTimersAsync();
    expect(posts.at(-1)!.url).toBe("/api/stream/mux/c2/subscribe");
  });

  it("a reconnect's re-subscribe cancels a pending retry, so the stream is subscribed once", async () => {
    openEventStream("/api/events/pipeline");
    mux().send("ready", { connection: "c1" });
    await vi.runOnlyPendingTimersAsync();
    const id = posts[0]!.body.subscription as string;
    mux().send("m", { s: id, t: "__end" }); // schedules a retry in 2 s
    mux().send("ready", { connection: "c2" }); // the reconnect subscribes at once
    await vi.advanceTimersByTimeAsync(5_000);
    expect(posts.filter((p) => p.url === "/api/stream/mux/c2/subscribe" && p.body.subscription === id)).toHaveLength(1);
  });

  it("waits for a slow first answer instead of falling back", async () => {
    openEventStream("/api/events/system");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual(["/api/stream/mux"]);
  });

  it("falls back to a native EventSource per stream when the mux fails before it ever answered, keeping listeners", async () => {
    const stream = openEventStream("/api/events/system");
    const seen: string[] = [];
    stream.addEventListener("gpu", (event) => seen.push((event as MessageEvent).data));
    mux().fail(true);
    const native = FakeEventSource.instances.find((s) => s.url === "/api/events/system")!;
    expect(native).toBeDefined();
    native.send("gpu", "{\"load\":0.5}");
    expect(seen).toEqual(["{\"load\":0.5}"]);
    stream.close();
    expect(native.closed).toBe(true);
    // Streams opened after the fall back go straight to native EventSources.
    openEventStream("/api/events/pipeline");
    expect(FakeEventSource.instances.at(-1)!.url).toBe("/api/events/pipeline");
  });

  it("does not fall back when owners close their streams inside a first-connect error", async () => {
    const first = openEventStream("/api/events/pipeline");
    const second = openEventStream("/api/events/system");
    first.onerror = () => first.close();
    second.onerror = () => second.close();
    mux().fail(false); // refused while connecting; the browser is still retrying
    openEventStream("/api/live/stream");
    // Still one shared connection, no native streams.
    expect(FakeEventSource.instances.every((s) => s.url === "/api/stream/mux")).toBe(true);
  });
});
