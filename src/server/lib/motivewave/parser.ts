/**
 * MotiveWave CSV Parser
 *
 * Handles 3 export formats:
 *  1. Tick data  (no header) — 4 numeric cols: DateTime, Price, Low, Close, Volume
 *  2. Bar data   (header)   — OHLCV + optional indicator columns
 *  3. Daily/custom (header) — OHLCV + Spread, OI, indicators (.txt extension)
 *
 * All exports share: MM/DD/YYYY HH:mm:ss timestamp format (tick/bar).
 * Daily/custom uses DD/MM/YYYY — auto-detected via header presence.
 */

import type { OHLCVRow } from "../../database/questdb/connection";
import { detectInstrumentType } from "../../database/questdb/marketData";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedMotiveWaveFile {
  symbol: string;
  timeframe: string;
  session: string;
  instrumentType: ReturnType<typeof detectInstrumentType>;
  rows: OHLCVRow[];
  format: "tick" | "bar" | "daily";
  filename: string;
}

export interface FilenameMetadata {
  symbol: string;
  timeframe: string;
  session: string;
}

// ─── Filename Parsing ───────────────────────────────────────────────────────

/**
 * Extract symbol, timeframe, and session from MotiveWave filenames.
 *
 * Patterns:
 *   "MNQZ25 - Tick - RTH.csv"     → { symbol: "MNQZ25", timeframe: "tick", session: "RTH" }
 *   "ENQZ25 - 1 min - ETH.csv"    → { symbol: "ENQZ25", timeframe: "1m",   session: "ETH" }
 *   "EP 12-25.Last.txt"           → { symbol: "EPZ25",  timeframe: "1d",   session: "ALL" }
 */
export function parseMotiveWaveFilename(filename: string): FilenameMetadata | null {
  // Strip path, keep basename
  const base = filename.replace(/^.*[\\/]/, "");

  // Format 1 & 2: "{SYMBOL} - {Timeframe} - {Session}.csv"
  const dashPattern = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\.csv$/i;
  const dashMatch = base.match(dashPattern);
  if (dashMatch && dashMatch[1] && dashMatch[2] && dashMatch[3]) {
    return {
      symbol: dashMatch[1].trim().toUpperCase(),
      timeframe: normalizeTimeframe(dashMatch[2].trim()),
      session: dashMatch[3].trim().toUpperCase(),
    };
  }

  // Format 3: "{SYMBOL}.Last.txt" or "{ROOT} {MM}-{YY}.Last.txt"
  const lastPattern = /^(.+?)\.Last\.txt$/i;
  const lastMatch = base.match(lastPattern);
  if (lastMatch && lastMatch[1]) {
    return {
      symbol: normalizeFuturesSymbol(lastMatch[1].trim()),
      timeframe: "1d",
      session: "ALL",
    };
  }

  return null;
}

/**
 * Normalize MotiveWave timeframe strings to standard codes.
 */
function normalizeTimeframe(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "tick") return "tick";

  // "1 min", "5 min", "15 min", "30 min"
  const minMatch = lower.match(/^(\d+)\s*min/);
  if (minMatch) return `${minMatch[1]}m`;

  // "1 hour", "4 hour"
  const hourMatch = lower.match(/^(\d+)\s*hour/);
  if (hourMatch) return `${hourMatch[1]}h`;

  // "daily", "1 day"
  if (lower === "daily" || lower.match(/^1?\s*day/)) return "1d";

  // "weekly", "1 week"
  if (lower === "weekly" || lower.match(/^1?\s*week/)) return "1w";

  return lower;
}

/**
 * Normalize "EP 12-25" → "EPZ25" (root + month code + year).
 */
function normalizeFuturesSymbol(raw: string): string {
  const monthCodes = "FGHJKMNQUVXZ";
  const match = raw.match(/^([A-Z]+)\s+(\d{1,2})-(\d{2})$/i);
  if (match && match[1] && match[2] && match[3]) {
    const root = match[1];
    const monthIdx = parseInt(match[2], 10) - 1;
    const year = match[3];
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${root.toUpperCase()}${monthCodes[monthIdx]}${year}`;
    }
  }
  return raw.toUpperCase().replace(/\s+/g, "");
}

// ─── Timestamp Parsing ──────────────────────────────────────────────────────

/**
 * Parse "MM/DD/YYYY HH:mm:ss" → Date (UTC).
 * Falls back to "DD/MM/YYYY" for daily format if month > 12.
 */
function parseTimestamp(raw: string, preferDDMM = false): Date | null {
  const trimmed = raw.trim().replace(/"/g, "");

  // Try "MM/DD/YYYY HH:mm:ss" or "MM/DD/YYYY"
  const parts = trimmed.split(/[\s]+/);
  const datePart = parts[0] ?? "";
  const timePart = parts[1] ?? "00:00:00";

  const dateFields = datePart.split("/");
  if (dateFields.length !== 3) return null;

  const f1 = parseInt(dateFields[0] ?? "0", 10);
  const f2 = parseInt(dateFields[1] ?? "0", 10);
  let year = parseInt(dateFields[2] ?? "0", 10);
  if (isNaN(f1) || isNaN(f2) || isNaN(year)) return null;

  // Normalize 2-digit year
  if (year < 100) year += 2000;

  let month: number, day: number;
  if (preferDDMM) {
    day = f1;
    month = f2;
  } else {
    month = f1;
    day = f2;
  }

  // Sanity check: if month > 12 the format must be DD/MM
  if (month > 12) {
    [month, day] = [day, month];
  }

  const tp = timePart.split(":");
  const hour = parseInt(tp[0] ?? "0", 10) || 0;
  const minute = parseInt(tp[1] ?? "0", 10) || 0;
  const second = parseInt(tp[2] ?? "0", 10) || 0;

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (isNaN(d.getTime())) return null;
  return d;
}

// ─── CSV Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a MotiveWave CSV buffer into OHLCV rows.
 * Auto-detects format based on header presence and column count.
 */
export function parseMotiveWaveCSV(
  content: string,
  symbol: string,
): { rows: OHLCVRow[]; format: "tick" | "bar" | "daily"; errors: number } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], format: "bar", errors: 0 };

  // Detect format: check if first line is a header
  const firstLine = lines[0]!;
  const hasHeader = /date\/time|Date\/Time|DateTime/i.test(firstLine);

  let format: "tick" | "bar" | "daily";
  let startIdx: number;
  let preferDDMM = false;

  if (!hasHeader) {
    // No header → tick data
    format = "tick";
    startIdx = 0;
  } else {
    // Has header — check columns to distinguish bar vs daily
    const headerLower = firstLine.toLowerCase();
    if (headerLower.includes("open interest") || headerLower.includes("spread")) {
      format = "daily";
      preferDDMM = true; // daily format uses DD/MM/YYYY
    } else {
      format = "bar";
    }
    startIdx = 1;
  }

  const rows: OHLCVRow[] = [];
  let errors = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const row = parseLine(lines[i]!, format, symbol, preferDDMM);
    if (row) {
      rows.push(row);
    } else {
      errors++;
    }
  }

  return { rows, format, errors };
}

/**
 * Parse volume strings that may include magnitude suffixes (e.g., "126M", "2.83K").
 */
function parseVolume(raw: string): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  const suffixMatch = trimmed.match(/^([\d.]+)\s*([KMBkmb])?$/);
  if (!suffixMatch || !suffixMatch[1]) return parseFloat(trimmed) || 0;

  const base = parseFloat(suffixMatch[1]);
  if (isNaN(base)) return 0;

  const suffix = (suffixMatch[2] || "").toUpperCase();
  switch (suffix) {
    case "K": return base * 1_000;
    case "M": return base * 1_000_000;
    case "B": return base * 1_000_000_000;
    default: return base;
  }
}

/**
 * Parse a single CSV line into an OHLCV row.
 */
function parseLine(
  line: string,
  format: "tick" | "bar" | "daily",
  symbol: string,
  preferDDMM: boolean,
): OHLCVRow | null {
  // Smart CSV split: respect quoted fields (for indicator names with commas)
  const fields = splitCSVLine(line);
  if (fields.length < 3) return null;

  const tsField = fields[0];
  if (!tsField) return null;
  const timestamp = parseTimestamp(tsField, preferDDMM);
  if (!timestamp) return null;

  if (format === "tick") {
    const numCols = fields.length - 1;
    if (numCols < 3) return null;

    if (numCols === 4) {
      const open = parseFloat(fields[1]!);
      const low = parseFloat(fields[2]!);
      const close = parseFloat(fields[3]!);
      const volume = parseFloat(fields[4]!) || 1;
      if (isNaN(open) || isNaN(low) || isNaN(close)) return null;
      const high = Math.max(open, close);
      return { symbol, timestamp, open, high, low, close, volume };
    } else if (numCols >= 5) {
      const open = parseFloat(fields[1]!);
      const high = parseFloat(fields[2]!);
      const low = parseFloat(fields[3]!);
      const close = parseFloat(fields[4]!);
      const volume = parseFloat(fields[5]!) || 1;
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;
      return { symbol, timestamp, open, high, low, close, volume };
    }
    return null;
  }

  // Bar or Daily: has header, columns are named.
  // We look for columns by position after header: Date/Time, Open, High, Low, Close, Volume
  // Index 0=DateTime, 1=Open, 2=High, 3=Low, 4=Close, 5=Volume
  // Some daily formats have Range between Close and Volume — skip it
  if (fields.length < 5) return null;

  const open = parseFloat(fields[1]!);
  const high = parseFloat(fields[2]!);
  const low = parseFloat(fields[3]!);
  const close = parseFloat(fields[4]!);

  if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;

  // Volume position differs: bar format has Volume at index 5,
  // daily format has Range(5), Spread(6), Volume(7)
  let volume = 0;
  if (format === "daily") {
    // Skip Range and Spread columns; Volume is at index 7
    if (fields.length > 7) {
      volume = parseVolume(fields[7]!);
    }
  } else {
    // Bar format: Volume at index 5
    if (fields.length > 5) {
      const v = parseFloat(fields[5]!);
      if (!isNaN(v)) volume = v;
    }
  }

  return { symbol, timestamp, open, high, low, close, volume };
}

/**
 * Split a CSV line respecting quoted fields.
 */
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}
