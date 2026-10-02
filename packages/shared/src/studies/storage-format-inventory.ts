/**
 * The body of GET /api/studies/storage-format-inventory, shared by the handler
 * and the page, plus the pure pieces both need (the format-family order, the
 * query-list codec and the histogram-bin arithmetic).
 *
 * One measured table, `data_format_inventory` (17,876 files, measured
 * 2026-09-11 under E:\lake\warehouse and the data-bearing repository
 * directories), sliced by store, zone, format family and file size.
 */

import type { LensEightNumberSummary } from "../lens/types";

/** The notebook's format families, in its legend order. */
export const FORMAT_FAMILIES = [
  "parquet_columnar",
  "vendor_archive",
  "iceberg_manifest",
  "iceberg_snapshot_metadata",
  "database_file",
  "model_or_array_binary",
  "text_tabular_or_document",
  "checksum_sidecar",
  "tensorboard_event",
  "report_or_image",
  "other",
] as const;

export const BREAKDOWN_DIMENSIONS = ["format_family", "file_extension", "zone_name", "store_name"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** Separator of the hidden-value lists in the query string (no store, zone or family name contains it). */
export const LIST_SEPARATOR = "|";

export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(LIST_SEPARATOR).filter((item) => item.length > 0);
}

export function joinList(values: readonly string[]): string {
  return values.join(LIST_SEPARATOR);
}

/** The label shown for a null extension (152 files have none). */
export const NO_EXTENSION_LABEL = "(no extension)";

export interface OptionRow {
  value: string;
  fileCount: number;
  gibibytes: number;
}

export interface MeasurementRecord {
  measuredOnDate: string;
  sourceDatabase: string;
  measuredRoots: string;
  fileCount: number;
  totalFileBytes: number;
  zoneCount: number;
  storeNames: string;
  earliestModifiedTimestamp: string | null;
  latestModifiedTimestamp: string | null;
}

export interface InventoryTotals {
  totalBytes: number;
  parquetBytes: number;
  nonParquetBytes: number;
  /** 100 x parquet bytes / total bytes; null when nothing is selected. */
  parquetSharePercent: number | null;
  fileCount: number;
}

export interface BreakdownRow {
  value: string;
  totalBytes: number;
  gibibytes: number;
  fileCount: number;
}

export interface ZoneShareRow {
  zone_name: string;
  parquetBytes: number;
  notParquetBytes: number;
  fileCount: number;
}

export interface SizeHistogramCell {
  /** 0-based bin of log10(file_bytes) across the filtered files. */
  binIndex: number;
  format_family: string;
  fileCount: number;
}

export interface SizeHistogram {
  /** log10(file_bytes) at the lower edge of bin 0. */
  lowerLog10: number;
  binWidthLog10: number;
  binCount: number;
  /** Files with file_bytes = 0 (they have no place on a log axis). */
  zeroByteFileCount: number;
  cells: SizeHistogramCell[];
}

export interface TimelineCell {
  /** "YYYY-MM" of modified_timestamp. */
  month: string;
  format_family: string;
  gibibytes: number;
  fileCount: number;
}

export interface FamilySummaryRow {
  format_family: string;
  fileCount: number;
  totalGibibytes: number;
  /** The eight numbers of file size in mebibytes. */
  mebibytes: LensEightNumberSummary;
}

export interface LargestFile {
  store_name: string;
  zone_name: string;
  format_family: string;
  file_extension: string | null;
  mebibytes: number;
  modified_timestamp: string | null;
  file_path: string;
}

export interface ColumnBin {
  lower: number;
  upper: number;
  count: number;
}

export interface ColumnCount {
  value: string;
  count: number;
}

/** One panel of the per-column grid: a column of data_format_inventory, graphed. */
export type ColumnProfile =
  | {
      kind: "numeric";
      column: string;
      description: string;
      unit: string;
      /** Histogram on log10 of the value (file sizes span ten orders of magnitude). */
      logScaled: boolean;
      nonNullCount: number;
      nullCount: number;
      bins: ColumnBin[];
      summary: LensEightNumberSummary;
    }
  | {
      kind: "categorical";
      column: string;
      description: string;
      nonNullCount: number;
      nullCount: number;
      distinctCount: number;
      top: ColumnCount[];
    }
  | {
      kind: "timestamp";
      column: string;
      description: string;
      nonNullCount: number;
      nullCount: number;
      /** Files per calendar month. */
      months: ColumnCount[];
      /** Eight numbers over the epoch day of each timestamp. */
      summary: LensEightNumberSummary;
      /** The same location statistics as dates ("YYYY-MM-DD"), keyed like the summary. */
      dates: { mean: string | null; median: string | null; percentile25: string | null; percentile75: string | null; minimum: string | null; maximum: string | null };
    };

export interface InventoryBody {
  /** False when the inventory has not been landed (the page shows how to land it). */
  available: boolean;
  measurement: MeasurementRecord | null;
  /** Every landed measurement (recipe), newest first; `recipe` is the one shown. */
  recipes: string[];
  recipe: string | null;
  /** Every store, zone and format family with its unfiltered file count and size (the filter chips). */
  options: { stores: OptionRow[]; zones: OptionRow[]; families: OptionRow[] };
  /** Files in the whole inventory, before any control. */
  inventoryFileCount: number;
  totals: InventoryTotals;
  breakdowns: Record<BreakdownDimension, BreakdownRow[]>;
  zoneShares: ZoneShareRow[];
  sizeHistogram: SizeHistogram;
  timeline: TimelineCell[];
  familySummaries: FamilySummaryRow[];
  largestFiles: LargestFile[];
  columns: ColumnProfile[];
}

export function emptyInventoryBody(): InventoryBody {
  return {
    available: false,
    measurement: null,
    recipes: [],
    recipe: null,
    options: { stores: [], zones: [], families: [] },
    inventoryFileCount: 0,
    totals: { totalBytes: 0, parquetBytes: 0, nonParquetBytes: 0, parquetSharePercent: null, fileCount: 0 },
    breakdowns: { format_family: [], file_extension: [], zone_name: [], store_name: [] },
    zoneShares: [],
    sizeHistogram: { lowerLog10: 0, binWidthLog10: 1, binCount: 0, zeroByteFileCount: 0, cells: [] },
    timeline: [],
    familySummaries: [],
    largestFiles: [],
    columns: [],
  };
}

/** Bin index of a value on an equal-width axis; the top edge belongs to the last bin. */
export function binIndexOf(value: number, lower: number, width: number, binCount: number): number {
  if (!(width > 0)) return 0;
  return Math.min(binCount - 1, Math.max(0, Math.floor((value - lower) / width)));
}

/** GiB from bytes, as the notebook computes it. */
export function gibibytesOf(bytes: number): number {
  return bytes / 1024 ** 3;
}

/** Every calendar month from `first` to `last` inclusive ("YYYY-MM"), so a month with no writes reads as zero. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [year, month] = first.split("-").map(Number) as [number, number];
  const [lastYear, lastMonth] = last.split("-").map(Number) as [number, number];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}
