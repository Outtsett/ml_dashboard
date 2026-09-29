/**
 * `GET /api/analytics` (`src/server/analytics/analytics.router.ts`) on a bare
 * app with injected sources: validation, the four layers in one body, the
 * notes when news or runs are missing, the refusal when bars are too few, and
 * that a failing news read degrades to a note instead of failing the page.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnalyticsRouter, type AnalyticsSources } from "../../src/server/analytics/analytics.router";
import type { AnalyticsBar, AnalyticsResponse } from "../../src/shared/analytics/types";

function bars(count: number): AnalyticsBar[] {
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    close = open + Math.sin(i / 7) * 0.5 + (i % 5 === 0 ? -0.3 : 0.2);
    return { timestamp: Date.UTC(2025, 10, 3) + i * 300_000, open, high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, close, volume: 100 + (i % 11) };
  });
}

let barCount = 2000;
let newsFails = false;
const requestedTimeframes: string[] = [];
const NOW = Date.UTC(2025, 10, 3) + 2000 * 300_000 + 30 * 86_400_000; // 30 days after the last bar

const sources: AnalyticsSources = {
  loadBars: async () => bars(barCount),
  loadNews: async () => {
    if (newsFails) throw new Error("curated news unreadable");
    return [];
  },
  loadRuns: async (_symbol, timeframe) => {
    requestedTimeframes.push(timeframe);
    return [];
  },
  loadRunDetail: async () => null,
  loadCost: (symbol) => (symbol === "MNQ" ? { pointValueUsd: 2, roundTripCostUsd: 2.78, roundTripCostPoints: 1.39, tickSize: 0.25, source: "test" } : null),
  assetClassOf: (symbol) => (symbol === "MNQ" ? "futures" : "forex"),
};

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", createAnalyticsRouter(sources, () => NOW));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

async function get(query: string): Promise<{ status: number; body: AnalyticsResponse & { error?: string } }> {
  const response = await fetch(`${base}/analytics?${query}`);
  return { status: response.status, body: (await response.json()) as AnalyticsResponse & { error?: string } };
}

describe("GET /api/analytics", () => {
  it("refuses an unknown timeframe and a malformed symbol", async () => {
    expect((await get("symbol=MNQ&timeframe=constructor")).status).toBe(400);
    expect((await get("symbol=MN%27Q&timeframe=5m")).status).toBe(400);
  });

  it("returns every layer in one body, priced for a futures root", async () => {
    barCount = 2000;
    newsFails = false;
    const { status, body } = await get("symbol=MNQ&timeframe=5m&bars=2000&horizon=6");
    expect(status).toBe(200);
    expect(body.assetClass).toBe("futures");
    expect(body.cost?.roundTripCostUsd).toBe(2.78);
    expect(body.descriptive.barCount).toBe(2000);
    expect(body.predictive.horizonBars).toBe(6);
    expect(body.prescriptive.costPriced).toBe(true);
    expect(body.notes.join(" ")).toContain("No Model Cycle run");
    expect(requestedTimeframes).toContain("5m");
  });

  it("says when the newest bar is old, so 'now' is read as of that bar", async () => {
    const { body } = await get("symbol=MNQ&timeframe=30m&bars=2000&horizon=6");
    expect(body.notes.join(" ")).toMatch(/30 days ago/);
  });

  it("works in points before costs for forex", async () => {
    const { body } = await get("symbol=EURUSD&timeframe=5m&bars=2000&horizon=7");
    expect(body.cost).toBeNull();
    expect(body.prescriptive.costPriced).toBe(false);
    expect(body.prescriptive.caveats.join(" ")).toContain("points before costs");
  });

  it("turns a failed news read into a note", async () => {
    newsFails = true;
    const { status, body } = await get("symbol=MNQ&timeframe=15m&bars=2000&horizon=6");
    expect(status).toBe(200);
    expect(body.notes.join(" ")).toContain("curated news unreadable");
    newsFails = false;
  });

  it("refuses a window too short to analyse", async () => {
    barCount = 50;
    const { status, body } = await get("symbol=MNQ&timeframe=1h&bars=2000&horizon=6");
    expect(status).toBe(404);
    expect(body.error).toContain("too few");
    barCount = 2000;
  });
});
