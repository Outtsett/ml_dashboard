import { describe, it, expect } from "vitest";
import {
  detectSchema,
  normalizeRow,
} from "../server/services/ingestionService";

describe("ingestionService", () => {
  // ── detectSchema ────────────────────────────────────────────────────────

  describe("detectSchema", () => {
    it("detects Databento schema", () => {
      const columns = [
        "ts_event",
        "rtype",
        "publisher_id",
        "instrument_id",
        "open",
        "high",
        "low",
        "close",
        "volume",
      ];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("databento");
      expect(schema.tsColumn).toBe("ts_event");
      expect(schema.symbolColumn).toBe("instrument_id");
      expect(schema.priceScale).toBe(1e-9);
      expect(schema.tsTransform).toBe("nanoseconds");
    });

    it("detects standard OHLCV schema", () => {
      const columns = [
        "timestamp",
        "symbol",
        "open",
        "high",
        "low",
        "close",
        "volume",
      ];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("standard");
      expect(schema.tsColumn).toBe("timestamp");
      expect(schema.symbolColumn).toBe("symbol");
      expect(schema.priceScale).toBe(1);
    });

    it("detects OANDA schema with ts column", () => {
      const columns = ["ts", "open", "high", "low", "close", "volume"];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("oanda");
      expect(schema.tsColumn).toBe("ts");
    });

    it("detects OANDA schema with time column", () => {
      const columns = ["time", "open", "high", "low", "close", "volume"];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("oanda");
      expect(schema.tsColumn).toBe("time");
    });

    it("detects OANDA schema with date column", () => {
      const columns = [
        "date",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "symbol",
      ];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("oanda");
      expect(schema.tsColumn).toBe("date");
      expect(schema.symbolColumn).toBe("symbol");
    });

    it("returns unknown for unrecognized schema", () => {
      const columns = ["foo", "bar", "baz"];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("unknown");
      expect(schema.tsColumn).toBe("");
      expect(schema.symbolColumn).toBeNull();
    });

    it("is case-insensitive for column matching", () => {
      const columns = [
        "Ts_Event",
        "Instrument_Id",
        "OPEN",
        "HIGH",
        "LOW",
        "CLOSE",
        "Volume",
      ];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe("databento");
    });
  });

  // ── normalizeRow ────────────────────────────────────────────────────────

  describe("normalizeRow", () => {
    it("normalizes Databento row with nanosecond timestamps and price scaling", () => {
      const schema = {
        provider: "databento" as const,
        tsColumn: "ts_event",
        symbolColumn: "instrument_id",
        priceScale: 1e-9,
        tsTransform: "nanoseconds" as const,
      };
      const raw = {
        ts_event: BigInt("1700000000000000000"),
        instrument_id: 12345,
        open: 5100250000000,
        high: 5101000000000,
        low: 5099000000000,
        close: 5100500000000,
        volume: 1500,
      };
      const normalized = normalizeRow(raw, schema, "ESH5");
      expect(normalized.symbol).toBe("ESH5");
      expect(normalized.ts).toBe(1700000000000);
      expect(normalized.open).toBeCloseTo(5100.25, 1);
      expect(normalized.high).toBeCloseTo(5101.0, 1);
      expect(normalized.low).toBeCloseTo(5099.0, 1);
      expect(normalized.close).toBeCloseTo(5100.5, 1);
      expect(normalized.volume).toBe(1500);
    });

    it("normalizes standard row", () => {
      const schema = {
        provider: "standard" as const,
        tsColumn: "timestamp",
        symbolColumn: "symbol",
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        timestamp: 1700000000000,
        symbol: "EURUSD",
        open: 1.085,
        high: 1.086,
        low: 1.084,
        close: 1.0855,
        volume: 5000,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.symbol).toBe("EURUSD");
      expect(normalized.ts).toBe(1700000000000);
      expect(normalized.open).toBe(1.085);
      expect(normalized.high).toBe(1.086);
      expect(normalized.low).toBe(1.084);
      expect(normalized.close).toBe(1.0855);
      expect(normalized.volume).toBe(5000);
    });

    it("uses symbolOverride when provided", () => {
      const schema = {
        provider: "standard" as const,
        tsColumn: "timestamp",
        symbolColumn: "symbol",
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        timestamp: 1700000000000,
        symbol: "OLD",
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
      };
      const normalized = normalizeRow(raw, schema, "NEW_SYMBOL");
      expect(normalized.symbol).toBe("NEW_SYMBOL");
    });

    it("converts seconds to milliseconds when rawTs < 2e10", () => {
      const schema = {
        provider: "standard" as const,
        tsColumn: "timestamp",
        symbolColumn: "symbol",
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        timestamp: 1700000000, // seconds
        symbol: "TEST",
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 500,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.ts).toBe(1700000000000); // converted to ms
    });

    it("keeps millisecond timestamps as-is when rawTs >= 2e10", () => {
      const schema = {
        provider: "standard" as const,
        tsColumn: "timestamp",
        symbolColumn: "symbol",
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        timestamp: 1700000000000, // already ms
        symbol: "TEST",
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 500,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.ts).toBe(1700000000000);
    });

    it("parses ISO string timestamps", () => {
      const schema = {
        provider: "oanda" as const,
        tsColumn: "time",
        symbolColumn: null,
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        time: "2023-11-14T12:00:00.000Z",
        open: 1.5,
        high: 1.6,
        low: 1.4,
        close: 1.55,
        volume: 200,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.ts).toBe(new Date("2023-11-14T12:00:00.000Z").getTime());
    });

    it("handles milliseconds tsTransform", () => {
      const schema = {
        provider: "oanda" as const,
        tsColumn: "ts",
        symbolColumn: null,
        priceScale: 1,
        tsTransform: "milliseconds" as const,
      };
      const raw = {
        ts: 1700000000000,
        open: 50,
        high: 55,
        low: 48,
        close: 52,
        volume: 1000,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.ts).toBe(1700000000000);
    });

    it("defaults volume to 0 when missing", () => {
      const schema = {
        provider: "standard" as const,
        tsColumn: "timestamp",
        symbolColumn: "symbol",
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        timestamp: 1700000000000,
        symbol: "TEST",
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        // no volume field
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.volume).toBe(0);
    });

    it("defaults symbol to UNKNOWN when no symbolColumn or override", () => {
      const schema = {
        provider: "oanda" as const,
        tsColumn: "ts",
        symbolColumn: null,
        priceScale: 1,
        tsTransform: "timestamp" as const,
      };
      const raw = {
        ts: 1700000000000,
        open: 50,
        high: 55,
        low: 48,
        close: 52,
        volume: 100,
      };
      const normalized = normalizeRow(raw, schema);
      expect(normalized.symbol).toBe("UNKNOWN");
    });
  });
});
