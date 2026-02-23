import { describe, it, expect } from "vitest";
import {
  isFuturesRoot,
  detectRollovers,
  computeBackAdjustment,
  RolloverRecord,
} from "../server/services/continuousContract";

// ── isFuturesRoot ───────────────────────────────────────────────────────

describe("isFuturesRoot", () => {
  it("should return true for common futures roots", () => {
    expect(isFuturesRoot("ES")).toBe(true);
    expect(isFuturesRoot("NQ")).toBe(true);
    expect(isFuturesRoot("MNQ")).toBe(true);
    expect(isFuturesRoot("MES")).toBe(true);
    expect(isFuturesRoot("CL")).toBe(true);
    expect(isFuturesRoot("GC")).toBe(true);
    expect(isFuturesRoot("YM")).toBe(true);
  });

  it("should return false for specific contracts", () => {
    expect(isFuturesRoot("ESH5")).toBe(false);
    expect(isFuturesRoot("NQM25")).toBe(false);
    expect(isFuturesRoot("MNQZ26")).toBe(false);
    expect(isFuturesRoot("CLF4")).toBe(false);
    expect(isFuturesRoot("GCG25")).toBe(false);
  });

  it("should return false for forex pairs", () => {
    expect(isFuturesRoot("EURUSD")).toBe(false);
    expect(isFuturesRoot("GBPJPY")).toBe(false);
    expect(isFuturesRoot("USDJPY")).toBe(false);
    expect(isFuturesRoot("AUDUSD")).toBe(false);
  });

  it("should handle case insensitivity", () => {
    expect(isFuturesRoot("es")).toBe(true);
    expect(isFuturesRoot("Nq")).toBe(true);
    expect(isFuturesRoot("eurusd")).toBe(false);
  });

  it("should return false for empty or invalid inputs", () => {
    expect(isFuturesRoot("")).toBe(false);
    expect(isFuturesRoot("12345")).toBe(false);
    expect(isFuturesRoot("ES-FUTURE")).toBe(false);
    expect(isFuturesRoot("ABCDE")).toBe(false); // 5 letters but not 6 (forex)
  });

  it("should return true for single-letter roots", () => {
    // Some commodities use single letter roots
    expect(isFuturesRoot("W")).toBe(true);
    expect(isFuturesRoot("C")).toBe(true);
  });
});

// ── detectRollovers ─────────────────────────────────────────────────────

describe("detectRollovers", () => {
  it("should detect a single rollover when volume leader changes", () => {
    const dailyVolumes = [
      { trade_date: "2025-03-10", symbol: "ESH25", total_volume: 1000000 },
      { trade_date: "2025-03-10", symbol: "ESM25", total_volume: 200000 },
      { trade_date: "2025-03-11", symbol: "ESH25", total_volume: 800000 },
      { trade_date: "2025-03-11", symbol: "ESM25", total_volume: 300000 },
      // Rollover day: ESM25 takes volume lead
      { trade_date: "2025-03-12", symbol: "ESH25", total_volume: 400000 },
      { trade_date: "2025-03-12", symbol: "ESM25", total_volume: 900000 },
    ];

    const closePrices: Record<string, number> = {
      "ESH25|2025-03-10": 5100,
      "ESM25|2025-03-10": 5110,
      "ESH25|2025-03-11": 5105,
      "ESM25|2025-03-11": 5115,
      "ESH25|2025-03-12": 5102,
      "ESM25|2025-03-12": 5118,
    };

    const result = detectRollovers(dailyVolumes, closePrices);

    expect(result).toHaveLength(1);
    expect(result[0].from_contract).toBe("ESH25");
    expect(result[0].to_contract).toBe("ESM25");
    expect(result[0].trade_date).toBe("2025-03-12");
    expect(result[0].from_close).toBe(5102); // ESH25 close on rollover day
    expect(result[0].to_close).toBe(5118);   // ESM25 close on rollover day
    expect(result[0].price_gap).toBe(5102 - 5118); // -16
    expect(result[0].rollover_type).toBe("volume");
  });

  it("should detect multiple rollovers across quarters", () => {
    const dailyVolumes = [
      // H25 leads
      { trade_date: "2025-03-10", symbol: "ESH25", total_volume: 1000000 },
      { trade_date: "2025-03-10", symbol: "ESM25", total_volume: 200000 },
      // M25 takes over
      { trade_date: "2025-03-11", symbol: "ESH25", total_volume: 400000 },
      { trade_date: "2025-03-11", symbol: "ESM25", total_volume: 900000 },
      // M25 leads
      { trade_date: "2025-06-10", symbol: "ESM25", total_volume: 1000000 },
      { trade_date: "2025-06-10", symbol: "ESU25", total_volume: 300000 },
      // U25 takes over
      { trade_date: "2025-06-11", symbol: "ESM25", total_volume: 300000 },
      { trade_date: "2025-06-11", symbol: "ESU25", total_volume: 1100000 },
    ];

    const closePrices: Record<string, number> = {
      "ESH25|2025-03-11": 5100,
      "ESM25|2025-03-11": 5112,
      "ESM25|2025-06-11": 5300,
      "ESU25|2025-06-11": 5315,
    };

    const result = detectRollovers(dailyVolumes, closePrices);

    expect(result).toHaveLength(2);
    expect(result[0].from_contract).toBe("ESH25");
    expect(result[0].to_contract).toBe("ESM25");
    expect(result[0].price_gap).toBe(5100 - 5112); // -12
    expect(result[1].from_contract).toBe("ESM25");
    expect(result[1].to_contract).toBe("ESU25");
    expect(result[1].price_gap).toBe(5300 - 5315); // -15
  });

  it("should return empty array when no rollovers occur", () => {
    const dailyVolumes = [
      { trade_date: "2025-03-10", symbol: "ESH25", total_volume: 1000000 },
      { trade_date: "2025-03-10", symbol: "ESM25", total_volume: 200000 },
      { trade_date: "2025-03-11", symbol: "ESH25", total_volume: 1100000 },
      { trade_date: "2025-03-11", symbol: "ESM25", total_volume: 300000 },
    ];

    const closePrices: Record<string, number> = {};

    const result = detectRollovers(dailyVolumes, closePrices);
    expect(result).toHaveLength(0);
  });

  it("should return empty array when given empty input", () => {
    expect(detectRollovers([], {})).toHaveLength(0);
  });

  it("should handle single date (no consecutive days to compare)", () => {
    const dailyVolumes = [
      { trade_date: "2025-03-10", symbol: "ESH25", total_volume: 1000000 },
      { trade_date: "2025-03-10", symbol: "ESM25", total_volume: 200000 },
    ];

    const result = detectRollovers(dailyVolumes, {});
    expect(result).toHaveLength(0);
  });

  it("should use 0 for missing close prices", () => {
    const dailyVolumes = [
      { trade_date: "2025-03-10", symbol: "ESH25", total_volume: 1000000 },
      { trade_date: "2025-03-11", symbol: "ESM25", total_volume: 1000000 },
    ];

    // No close prices provided for the rollover date
    const result = detectRollovers(dailyVolumes, {});

    expect(result).toHaveLength(1);
    expect(result[0].from_close).toBe(0);
    expect(result[0].to_close).toBe(0);
    expect(result[0].price_gap).toBe(0);
  });
});

// ── computeBackAdjustment ───────────────────────────────────────────────

describe("computeBackAdjustment", () => {
  it("should compute cumulative adjustment for a single rollover", () => {
    const rollovers: RolloverRecord[] = [
      {
        ts: new Date("2025-03-12"),
        root: "ES",
        from_contract: "ESH25",
        to_contract: "ESM25",
        from_close: 5102,
        to_close: 5118,
        price_gap: -16, // from_close - to_close
        rollover_type: "volume",
      },
    ];

    const result = computeBackAdjustment(rollovers);

    expect(result).toHaveLength(1);
    expect(result[0].ts).toEqual(new Date("2025-03-12"));
    expect(result[0].cumulativeAdj).toBe(-16);
  });

  it("should accumulate adjustments newest-to-oldest and output oldest-first", () => {
    const rollovers: RolloverRecord[] = [
      {
        ts: new Date("2025-03-12"),
        root: "ES",
        from_contract: "ESH25",
        to_contract: "ESM25",
        from_close: 5100,
        to_close: 5112,
        price_gap: -12,
        rollover_type: "volume",
      },
      {
        ts: new Date("2025-06-11"),
        root: "ES",
        from_contract: "ESM25",
        to_contract: "ESU25",
        from_close: 5300,
        to_close: 5315,
        price_gap: -15,
        rollover_type: "volume",
      },
    ];

    const result = computeBackAdjustment(rollovers);

    // Output should be oldest-first
    expect(result).toHaveLength(2);
    expect(result[0].ts).toEqual(new Date("2025-03-12"));
    expect(result[1].ts).toEqual(new Date("2025-06-11"));

    // Walk newest-to-oldest: start with June gap (-15), then add March gap (-12)
    // June: cumulative = -15
    // March: cumulative = -15 + (-12) = -27
    // So oldest (March) gets -27, newest (June) gets -15
    expect(result[0].cumulativeAdj).toBe(-27); // March: both gaps accumulated
    expect(result[1].cumulativeAdj).toBe(-15); // June: only its own gap
  });

  it("should handle three rollovers correctly", () => {
    const rollovers: RolloverRecord[] = [
      {
        ts: new Date("2025-03-12"),
        root: "ES",
        from_contract: "ESH25",
        to_contract: "ESM25",
        from_close: 5100,
        to_close: 5110,
        price_gap: -10,
        rollover_type: "volume",
      },
      {
        ts: new Date("2025-06-11"),
        root: "ES",
        from_contract: "ESM25",
        to_contract: "ESU25",
        from_close: 5300,
        to_close: 5320,
        price_gap: -20,
        rollover_type: "volume",
      },
      {
        ts: new Date("2025-09-10"),
        root: "ES",
        from_contract: "ESU25",
        to_contract: "ESZ25",
        from_close: 5500,
        to_close: 5505,
        price_gap: -5,
        rollover_type: "volume",
      },
    ];

    const result = computeBackAdjustment(rollovers);

    expect(result).toHaveLength(3);

    // Walk newest-to-oldest:
    // Sept (newest): cumulative = -5
    // June: cumulative = -5 + (-20) = -25
    // March (oldest): cumulative = -25 + (-10) = -35
    expect(result[0].ts).toEqual(new Date("2025-03-12"));
    expect(result[0].cumulativeAdj).toBe(-35);

    expect(result[1].ts).toEqual(new Date("2025-06-11"));
    expect(result[1].cumulativeAdj).toBe(-25);

    expect(result[2].ts).toEqual(new Date("2025-09-10"));
    expect(result[2].cumulativeAdj).toBe(-5);
  });

  it("should handle positive price gaps (backwardation)", () => {
    const rollovers: RolloverRecord[] = [
      {
        ts: new Date("2025-03-12"),
        root: "CL",
        from_contract: "CLH25",
        to_contract: "CLJ25",
        from_close: 72.5,
        to_close: 71.0,
        price_gap: 1.5, // Backwardation: near > far
        rollover_type: "volume",
      },
      {
        ts: new Date("2025-04-10"),
        root: "CL",
        from_contract: "CLJ25",
        to_contract: "CLK25",
        from_close: 73.0,
        to_close: 72.0,
        price_gap: 1.0,
        rollover_type: "volume",
      },
    ];

    const result = computeBackAdjustment(rollovers);

    // Newest-to-oldest: April +1.0, then March +1.0 + 1.5 = +2.5
    expect(result[0].cumulativeAdj).toBe(2.5);
    expect(result[1].cumulativeAdj).toBe(1.0);
  });

  it("should return empty array for empty input", () => {
    expect(computeBackAdjustment([])).toHaveLength(0);
  });

  it("should handle rollovers passed in non-chronological order", () => {
    const rollovers: RolloverRecord[] = [
      {
        ts: new Date("2025-06-11"),
        root: "ES",
        from_contract: "ESM25",
        to_contract: "ESU25",
        from_close: 5300,
        to_close: 5315,
        price_gap: -15,
        rollover_type: "volume",
      },
      {
        ts: new Date("2025-03-12"),
        root: "ES",
        from_contract: "ESH25",
        to_contract: "ESM25",
        from_close: 5100,
        to_close: 5112,
        price_gap: -12,
        rollover_type: "volume",
      },
    ];

    const result = computeBackAdjustment(rollovers);

    // Should still produce correct oldest-first output
    expect(result[0].ts).toEqual(new Date("2025-03-12"));
    expect(result[1].ts).toEqual(new Date("2025-06-11"));
    expect(result[0].cumulativeAdj).toBe(-27);
    expect(result[1].cumulativeAdj).toBe(-15);
  });
});
