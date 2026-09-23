/**
 * Eligibility and SQL for the regression tab's lake columns — pure functions,
 * checked against the real series catalog and without a database.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eligibleVariables, objectColumnsSql, coversSymbol, regressionBucketExpression } from "../../src/server/market/regressionQuery";
import type { SeriesCatalog, SeriesObject } from "../../src/shared/series/types";

const catalog = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "src", "config", "series_catalog.json"), "utf-8"),
) as SeriesCatalog;

describe("eligibleVariables", () => {
  const minute = eligibleVariables(catalog.objects, "MNQ", 60);
  const byId = new Map(minute.variables.map((variable) => [variable.id, variable]));

  it("offers per-bar numeric lake columns that hold rows for the symbol", () => {
    expect(byId.has("lake:mnq_indicators_norm_1m:rsi_14")).toBe(true);
    expect(byId.has("lake:candle_geometry_1m:range_z")).toBe(true);
  });

  it("never offers event tables, the chart's own bars, or catalog-excluded columns", () => {
    for (const variable of minute.variables) {
      const object = catalog.objects.find((entry) => entry.object === variable.object) as SeriesObject;
      const column = object.columns.find((entry) => entry.id === variable.id);
      expect(object.grain).toBe("per_bar");
      expect(column?.unavailableReason).toBeUndefined();
      expect(["open", "high", "low", "close", "volume"]).not.toContain(variable.column.toLowerCase());
      expect(["timestamp", "text", "categorical"]).not.toContain(variable.valueShape);
    }
    expect(minute.variables.some((variable) => variable.object === "mnq_swing_5m")).toBe(false);
  });

  it("keeps forward-looking label columns, flagged", () => {
    const labels = minute.variables.filter((variable) => variable.object === "mnq_labels_1m");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((variable) => variable.forwardLooking)).toBe(true);
  });

  it("drops objects coarser than the chart timeframe", () => {
    // A 1-minute chart cannot take a 5-minute table's values bar by bar.
    expect(minute.variables.some((variable) => variable.objectTimeframe === "5m")).toBe(false);
    const fiveMinute = eligibleVariables(catalog.objects, "MNQ", 300);
    expect(fiveMinute.variables.length).toBeGreaterThanOrEqual(minute.variables.length);
  });

  it("accounts for every column it leaves out", () => {
    const total = catalog.objects.reduce((sum, object) => sum + object.columns.length, 0);
    expect(minute.variables.length + minute.excludedCount).toBe(total);
  });
});

describe("duplicate tables at two grains", () => {
  const anatomy = catalog.objects.find((entry) => entry.object === "candle_anatomy_1m") as SeriesObject;

  it("keeps both when the coarser table does not cover the finer one's history", () => {
    // MNQ: candle_anatomy (one-second) reaches back to 2019, the one-minute copy to 2024.
    const daily = eligibleVariables(catalog.objects, "MNQ", 86400);
    const objects = new Set(daily.variables.map((variable) => variable.object));
    expect(objects.has("candle_anatomy_1m")).toBe(true);
    expect(objects.has("candle_anatomy")).toBe(true);
  });

  it("drops the finer table when a coarser one covers its whole span", () => {
    const finer = { ...anatomy, object: "anatomy_fine", timeframe: "1s", firstTimestampSeconds: (anatomy.firstTimestampSeconds as number) + 86400, lastTimestampSeconds: (anatomy.lastTimestampSeconds as number) - 86400 };
    const daily = eligibleVariables([anatomy, finer], "MNQ", 86400);
    const objects = new Set(daily.variables.map((variable) => variable.object));
    expect(objects.has("candle_anatomy_1m")).toBe(true);
    expect(objects.has("anatomy_fine")).toBe(false);
    expect(daily.excludedReasons["a coarser table holds the same columns"]).toBeGreaterThan(0);
  });
});

describe("bucketing from a finer table", () => {
  it("labels exact, summed and last-value columns", () => {
    const hourly = new Map(eligibleVariables(catalog.objects, "MNQ", 3600).variables.map((variable) => [variable.id, variable]));
    const minuteRsi = hourly.get("lake:mnq_indicators_norm_1m:rsi_14");
    expect(minuteRsi?.bucketing).toBe("last");
    expect(minuteRsi?.bucketingNote).toBe("last 1m value in each 1h bar");
    const exact = eligibleVariables(catalog.objects, "MNQ", 60).variables.find((variable) => variable.id === "lake:mnq_indicators_norm_1m:rsi_14");
    expect(exact?.bucketing).toBe("exact");
    expect(exact?.bucketingNote).toBeNull();
  });

  it("reads a per-bar flag at the bar's close, never 'fired anywhere'", () => {
    const object = catalog.objects.find((entry) => entry.object === "candle_anatomy_1m") as SeriesObject;
    const flag = object.columns.find((column) => column.column === "is_bullish");
    if (!flag) throw new Error("is_bullish missing from the catalog");
    const expression = regressionBucketExpression(flag, object.timestampColumn);
    expect(expression).toMatch(/^arg_max\(/);
  });

  it("sums a volume", () => {
    const summed = catalog.objects
      .flatMap((object) => object.columns.map((column) => ({ object, column })))
      .find(({ column }) => column.family === "volume" && column.valueShape === "positive_magnitude");
    if (!summed) throw new Error("no volume column in the catalog");
    expect(regressionBucketExpression(summed.column, summed.object.timestampColumn)).toMatch(/^sum\(/);
  });
});

describe("coversSymbol", () => {
  const object = (symbols: string[], symbolColumn: string | null = "symbol") =>
    ({ symbols, symbolColumn }) as unknown as SeriesObject;

  it("reads a short symbol list literally and a capped one as unknown", () => {
    expect(coversSymbol(object(["MNQ"]), "MNQ")).toBe(true);
    expect(coversSymbol(object(["EURUSD"]), "MNQ")).toBe(false);
    expect(coversSymbol(object(Array.from({ length: 500 }, (_, index) => `S${index}`)), "MNQ")).toBe(true);
    expect(coversSymbol(object(["MNQ"], null), "MNQ")).toBe(false);
  });
});

describe("objectColumnsSql", () => {
  const object = catalog.objects.find((entry) => entry.object === "mnq_indicators_norm_1m") as SeriesObject;
  const columns = object.columns.filter((column) => ["rsi_14", "roc_5"].includes(column.column));
  const sql = objectColumnsSql(object, columns, {
    symbol: "MNQ",
    timeframeSeconds: 300,
    fromSeconds: 1_557_000_000,
    toSeconds: 1_767_200_000,
    maxRows: 25_000,
  }) as string;

  it("buckets to the chart timeframe and scopes to the symbol", () => {
    expect(sql).toContain("time_bucket(INTERVAL '300 seconds'");
    expect(sql).toContain(`"symbol" = 'MNQ'`);
    expect(sql).toContain('AS "c0"');
    expect(sql).toContain('AS "c1"');
    expect(sql).toContain("LIMIT 25000");
  });

  it("reads the whole requested window, not the catalog's sampled bounds", () => {
    expect(sql).toContain("to_timestamp(1557000000)");
    expect(sql).toContain("to_timestamp(1767200000)");
  });

  it("escapes a quote in the symbol", () => {
    const hostile = objectColumnsSql(object, columns, {
      symbol: "MNQ' OR 1=1 --",
      timeframeSeconds: 60,
      fromSeconds: 1,
      toSeconds: 2,
      maxRows: 10,
    }) as string;
    expect(hostile).toContain(`'MNQ'' OR 1=1 --'`);
  });

  it("returns nothing for an empty window", () => {
    expect(
      objectColumnsSql(object, columns, { symbol: "MNQ", timeframeSeconds: 60, fromSeconds: 10, toSeconds: 10, maxRows: 10 }),
    ).toBeNull();
  });
});
