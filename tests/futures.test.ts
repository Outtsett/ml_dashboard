import { describe, it, expect } from "vitest";
import {
  isFuturesRoot,
  contractPattern,
} from "../src/server/infrastructure/lib/futures";

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

  it("should return true for roots containing digits (M2K)", () => {
    expect(isFuturesRoot("M2K")).toBe(true);
    expect(isFuturesRoot("RTY")).toBe(true);
    expect(isFuturesRoot("MYM")).toBe(true);
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
    expect(isFuturesRoot("W")).toBe(true);
    expect(isFuturesRoot("C")).toBe(true);
  });
});

// ── contractPattern ─────────────────────────────────────────────────────

describe("contractPattern", () => {
  it("should generate regex matching contracts for a root", () => {
    const pattern = new RegExp(contractPattern("ES"));
    expect(pattern.test("ESH5")).toBe(true);
    expect(pattern.test("ESM25")).toBe(true);
    expect(pattern.test("ESZ1")).toBe(true);
    expect(pattern.test("ES")).toBe(false);
    expect(pattern.test("NQH5")).toBe(false);
    expect(pattern.test("EURUSD")).toBe(false);
  });

  it("should work for multi-letter roots", () => {
    const pattern = new RegExp(contractPattern("MNQ"));
    expect(pattern.test("MNQM5")).toBe(true);
    expect(pattern.test("MNQZ26")).toBe(true);
    expect(pattern.test("NQM5")).toBe(false);
  });
});
