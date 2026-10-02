/**
 * The server side of the chart <-> notebook link (apps/api/market/chartLink*.ts):
 * the context is stored with a sequence that moves only on a real change, each
 * source's overlays replace its previous set, invalid bodies are refused, and
 * the stream sends the current state first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import chartLinkRouter from "../market/chartLink.router";
import { resetChartLinkForTests } from "../market/chartLink";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", chartLinkRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => resetChartLinkForTests());

const CONTEXT = {
  symbol: "MNQ", timeframe: "5m", assetClass: "futures",
  visibleStartMs: 1_700_000_000_000, visibleEndMs: 1_700_000_600_000,
  cursorMs: null, selectedMs: null, firstBarMs: 1_699_000_000_000, lastBarMs: 1_700_000_600_000, barCount: 300,
};

const put = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("chart context", () => {
  it("404s before the chart publishes, then returns what it published with a sequence that moves only on change", async () => {
    expect((await fetch(`${base}/chart/context`)).status).toBe(404);
    const first = await (await put("/chart/context", CONTEXT)).json();
    expect(first.changed).toBe(true);
    expect(first.context.sequence).toBe(1);
    const same = await (await put("/chart/context", CONTEXT)).json();
    expect(same.changed).toBe(false);
    expect(same.context.sequence).toBe(1);
    const moved = await (await put("/chart/context", { ...CONTEXT, selectedMs: 1_700_000_300_000 })).json();
    expect(moved.context.sequence).toBe(2);
    expect((await (await fetch(`${base}/chart/context`)).json()).selectedMs).toBe(1_700_000_300_000);
  });

  it("refuses a context that is not the contract", async () => {
    expect((await put("/chart/context", { ...CONTEXT, assetClass: "stocks" })).status).toBe(400);
    expect((await put("/chart/context", { symbol: "MNQ" })).status).toBe(400);
  });
});

describe("overlays", () => {
  const set = (source: string, price: number) => ({ source, symbol: "MNQ", timeframe: "5m", overlays: [{ kind: "level", id: "a", price, style: "dashed" }] });

  it("replaces a source's set, keeps other sources, and deletes one or all", async () => {
    expect((await put("/chart/overlays", set("one", 1))).status).toBe(200);
    await put("/chart/overlays", set("two", 2));
    await put("/chart/overlays", set("one", 3));
    const listed = (await (await fetch(`${base}/chart/overlays`)).json()).sets as Array<{ source: string; overlays: Array<{ price: number }> }>;
    expect(listed.map((s) => [s.source, s.overlays[0]!.price])).toEqual([["one", 3], ["two", 2]]);
    expect((await (await fetch(`${base}/chart/overlays/one`, { method: "DELETE" })).json()).removed).toBe(true);
    expect((await (await fetch(`${base}/chart/overlays`, { method: "DELETE" })).json()).removed).toBe(1);
  });

  it("refuses an unknown kind, a bad colour and a missing field", async () => {
    expect((await put("/chart/overlays", { ...set("x", 1), overlays: [{ kind: "arrow", id: "a" }] })).status).toBe(400);
    expect((await put("/chart/overlays", { ...set("x", 1), overlays: [{ kind: "level", id: "a", price: 1, color: "red" }] })).status).toBe(400);
    expect((await put("/chart/overlays", { source: "x", overlays: [] })).status).toBe(400);
  });

  it("streams the current context and overlays first, then changes", async () => {
    await put("/chart/context", CONTEXT);
    await put("/chart/overlays", set("one", 1));
    const controller = new AbortController();
    const response = await fetch(`${base}/chart/stream`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };
    await readUntil("event: overlays");
    expect(text).toContain("event: context");
    expect(text.indexOf("event: context")).toBeLessThan(text.indexOf("event: overlays"));
    await put("/chart/overlays", set("two", 2));
    await readUntil('"source":"two"');
    expect(text).toContain('"source":"two"');
    controller.abort();
  });
});


describe("chart view requests", () => {
  it("forwards a valid view request on the stream and refuses an invalid one", async () => {
    const stream = await fetch(`${base}/chart/stream`, { headers: { Accept: "text/event-stream" } });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const read = async () => {
      const { value } = await reader.read();
      received += decoder.decode(value ?? new Uint8Array(), { stream: true });
    };
    await read();                                                    // retry + current state
    const bad = await fetch(`${base}/chart/view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startMs: 5, endMs: 1 }) });
    expect(bad.status).toBe(400);
    const good = await fetch(`${base}/chart/view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "latest" }) });
    expect(good.status).toBe(202);
    for (let attempts = 0; attempts < 5 && !received.includes("event: view"); attempts += 1) await read();
    expect(received).toContain('event: view\ndata: {"target":"latest"}');
    await reader.cancel();
  });
});
