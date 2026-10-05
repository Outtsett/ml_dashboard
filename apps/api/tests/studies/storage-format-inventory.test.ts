/**
 * The storage-format-inventory study: the handler's SQL run for real on an
 * in-memory DuckDB whose tables carry the landed views' names and columns.
 * Checks the headline totals and parquet share, every filter (hidden store /
 * zone / family, the small-file slider), the eight numbers against the shared
 * `eightNumberSummary` (same estimators as the rest of the dashboard), the
 * histogram and month arithmetic, the null-extension label, recipe pinning,
 * the missing-view degradation and the query refusals, plus the pure helpers.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, { FILES_VIEW, MEASUREMENT_VIEW, filterClause, querySchema } from "../../studies/handlers/storage-format-inventory";
import { plainRow } from "../../studies/sql";
import type { StudyContext, StudyLake } from "../../studies/types";
import { eightNumberSummary } from "@shared/lens/stats";
import {
  binIndexOf, gibibytesOf, joinList, monthRange, parseList,
} from "@shared/studies/storage-format-inventory";

const RECIPE = "measured_2026_09_11";
const OLDER = "measured_2026_01_01";

interface FileSeed {
  store: string;
  zone: string;
  path: string;
  extension: string | null;
  bytes: number;
  modified: string | null;
  family: string;
  parquet: boolean | null;
}

const PARQUET_SIZES = [1024, 2048, 8192, 300_000, 4096, 65_536];

const SEEDS: FileSeed[] = [
  ...PARQUET_SIZES.map((bytes, index): FileSeed => ({
    store: "lake", zone: "derived", path: `E:\\lake\\derived\\part-${index}.parquet`, extension: ".parquet", bytes,
    modified: `2026-0${3 + (index % 2)}-1${index} 10:00:00`, family: "parquet_columnar", parquet: true,
  })),
  { store: "lake", zone: "raw", path: "E:\\lake\\raw\\a.zip", extension: ".zip", bytes: 40_960, modified: "2026-03-05 10:00:00", family: "vendor_archive", parquet: false },
  { store: "lake", zone: "raw", path: "E:\\lake\\raw\\b.zip", extension: ".zip", bytes: 4_194_304, modified: "2026-06-05 10:00:00", family: "vendor_archive", parquet: false },
  { store: "repository", zone: "ml_dashboard\\data", path: "E:\\r\\c.csv", extension: ".csv", bytes: 512, modified: "2026-03-20 08:00:00", family: "text_tabular_or_document", parquet: false },
  { store: "repository", zone: "ml_dashboard\\data", path: "E:\\r\\Makefile", extension: null, bytes: 0, modified: null, family: "other", parquet: null },
  { store: "repository", zone: "it's a zone", path: "E:\\r\\quote", extension: ".bin", bytes: 1_048_576, modified: "2026-06-30 23:59:59", family: "model_or_array_binary", parquet: false },
];

let instance: DuckDBInstance;

async function run(sql: string) {
  const connection = await instance.connect();
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJS().map((row) => plainRow(row as Record<string, unknown>));
  } finally {
    connection.closeSync();
  }
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    return (await run(sql)) as T[];
  },
  async hasView(name) {
    return Number((await run(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${name}'`))[0]?.n) > 0;
  },
  async columns() {
    return [];
  },
};

const emptyLake: StudyLake = { async query() { return []; }, async hasView() { return false; }, async columns() { return []; } };

function sqlString(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

async function call(rawQuery: Record<string, string | number> = {}, using: StudyLake = lake) {
  const context: StudyContext = { lake: using, notes: [] };
  const body = await handler.run(querySchema.parse(rawQuery), context);
  return { body, notes: context.notes };
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(":memory:");
  const rows = SEEDS.map(
    (seed) =>
      `(${sqlString(seed.store)}, ${sqlString(seed.zone)}, ${sqlString(seed.path)}, ${sqlString(seed.extension)}, ${seed.bytes}::BIGINT, ${seed.bytes / 1024 ** 3}, ` +
      `${seed.modified === null ? "NULL::TIMESTAMP" : `TIMESTAMP '${seed.modified}'`}, ${sqlString(seed.family)}, ${seed.parquet === null ? "NULL::BOOLEAN" : seed.parquet})`,
  ).join(", ");
  await run(
    `CREATE TABLE ${FILES_VIEW} AS SELECT * FROM (VALUES ${rows}) AS t(store_name, zone_name, file_path, file_extension, file_bytes, file_gibibytes, modified_timestamp, format_family, is_parquet), ` +
      `(VALUES ('${RECIPE}')) AS r(recipe)`,
  );
  // An older measurement with one file: it must never leak into the newest recipe's numbers.
  await run(
    `INSERT INTO ${FILES_VIEW} VALUES ('lake', 'old', 'E:\\old', '.parquet', 999999::BIGINT, 0.0, TIMESTAMP '2026-01-01 00:00:00', 'parquet_columnar', true, '${OLDER}')`,
  );
  await run(
    `CREATE TABLE ${MEASUREMENT_VIEW} AS SELECT '2026-09-11' AS measured_on_date, 'db.duckdb' AS source_database, 'data_format_inventory' AS source_table, 'E:\\lake; E:\\repos' AS measured_roots, ` +
      `${SEEDS.length} AS file_count, ${SEEDS.reduce((sum, seed) => sum + seed.bytes, 0)}::BIGINT AS total_file_bytes, 4 AS zone_count, 'lake, repository' AS store_names, ` +
      `1 AS format_family_count, TIMESTAMP '2026-03-05 10:00:00' AS earliest_modified_timestamp, TIMESTAMP '2026-06-30 23:59:59' AS latest_modified_timestamp, '${RECIPE}' AS recipe`,
  );
});

afterAll(() => {
  instance.closeSync();
});

describe("totals and filters", () => {
  const totalBytes = SEEDS.reduce((sum, seed) => sum + seed.bytes, 0);
  const parquetBytes = PARQUET_SIZES.reduce((sum, bytes) => sum + bytes, 0);

  it("reports the newest recipe's total, parquet share and file count", async () => {
    const { body } = await call();
    expect(body.recipe).toBe(RECIPE);
    expect(body.recipes).toEqual([RECIPE, OLDER]);
    expect(body.totals.totalBytes).toBe(totalBytes);
    expect(body.totals.parquetBytes).toBe(parquetBytes);
    expect(body.totals.nonParquetBytes).toBe(totalBytes - parquetBytes);
    expect(body.totals.parquetSharePercent).toBeCloseTo((100 * parquetBytes) / totalBytes, 9);
    expect(body.totals.fileCount).toBe(SEEDS.length);
    expect(body.inventoryFileCount).toBe(SEEDS.length);
  });

  it("can show an older measurement by name, and ignores an unknown one", async () => {
    expect((await call({ recipe: OLDER })).body.totals.totalBytes).toBe(999_999);
    expect((await call({ recipe: "no_such_recipe" })).body.recipe).toBe(RECIPE);
  });

  it("hides a store, a zone (quotes included) and a family", async () => {
    const hiddenStore = (await call({ hiddenStores: "repository" })).body.totals;
    expect(hiddenStore.fileCount).toBe(SEEDS.filter((seed) => seed.store === "lake").length);
    const hiddenZone = (await call({ hiddenZones: joinList(["it's a zone", "raw"]) })).body.totals;
    expect(hiddenZone.fileCount).toBe(SEEDS.filter((seed) => seed.zone !== "it's a zone" && seed.zone !== "raw").length);
    const hiddenFamily = (await call({ hiddenFamilies: "parquet_columnar" })).body.totals;
    expect(hiddenFamily.parquetBytes).toBe(0);
    expect(hiddenFamily.parquetSharePercent).toBe(0);
  });

  it("hiding every value is an empty selection with no share, not an error", async () => {
    const { body } = await call({ hiddenStores: "lake|repository" });
    expect(body.totals.fileCount).toBe(0);
    expect(body.totals.parquetSharePercent).toBeNull();
    expect(body.familySummaries).toEqual([]);
    expect(body.largestFiles).toEqual([]);
  });

  it("drops files under the slider's size, in kibibytes", async () => {
    const { body } = await call({ minimumKibibytes: 2 });
    expect(body.totals.fileCount).toBe(SEEDS.filter((seed) => seed.bytes >= 2048).length);
  });

  it("quotes every hidden value and keeps the small-file bound numeric", () => {
    const clause = filterClause(querySchema.parse({ hiddenZones: "a'b|c", minimumKibibytes: 16 }));
    expect(clause).toContain(`"zone_name" NOT IN ('a''b', 'c')`);
    expect(clause).toContain("file_bytes >= 16384");
  });
});

describe("panels", () => {
  it("breaks bytes down by each dimension, biggest first, labelling a missing extension", async () => {
    const { body } = await call();
    const byFamily = body.breakdowns.format_family;
    expect(byFamily[0]?.value).toBe("vendor_archive");
    expect(byFamily[0]?.totalBytes).toBe(40_960 + 4_194_304);
    expect(body.breakdowns.store_name.map((row) => row.value).sort()).toEqual(["lake", "repository"]);
    expect(body.breakdowns.file_extension.some((row) => row.value === "(no extension)" && row.fileCount === 1)).toBe(true);
    const sumOfFamilies = byFamily.reduce((sum, row) => sum + row.totalBytes, 0);
    expect(sumOfFamilies).toBe(body.totals.totalBytes);
  });

  it("splits each zone into parquet and not-parquet bytes, a null flag counting as not parquet", async () => {
    const { body } = await call();
    const data = body.zoneShares.find((row) => row.zone_name === "ml_dashboard\\data");
    expect(data).toMatchObject({ parquetBytes: 0, notParquetBytes: 512, fileCount: 2 });
    const derived = body.zoneShares.find((row) => row.zone_name === "derived");
    expect(derived?.parquetBytes).toBe(PARQUET_SIZES.reduce((sum, bytes) => sum + bytes, 0));
    expect(derived?.notParquetBytes).toBe(0);
  });

  it("bins log10(file size) into equal bins, every positive file in exactly one", async () => {
    const { body } = await call({ sizeBins: 10 });
    const histogram = body.sizeHistogram;
    const positive = SEEDS.filter((seed) => seed.bytes > 0);
    expect(histogram.zeroByteFileCount).toBe(1);
    expect(histogram.cells.reduce((sum, cell) => sum + cell.fileCount, 0)).toBe(positive.length);
    expect(histogram.lowerLog10).toBeCloseTo(Math.log10(512), 9);
    expect(histogram.binWidthLog10).toBeCloseTo((Math.log10(4_194_304) - Math.log10(512)) / 10, 9);
    for (const seed of positive.filter((file) => file.family === "vendor_archive")) {
      const expected = binIndexOf(Math.log10(seed.bytes), histogram.lowerLog10, histogram.binWidthLog10, 10);
      expect(histogram.cells.some((cell) => cell.format_family === "vendor_archive" && cell.binIndex === expected)).toBe(true);
    }
  });

  it("sums bytes written per month and family, leaving undated files out", async () => {
    const { body } = await call();
    expect(body.timeline.reduce((sum, cell) => sum + cell.fileCount, 0)).toBe(SEEDS.filter((seed) => seed.modified !== null).length);
    const juneArchive = body.timeline.find((cell) => cell.month === "2026-06" && cell.format_family === "vendor_archive");
    expect(juneArchive?.gibibytes).toBeCloseTo(gibibytesOf(4_194_304), 12);
  });

  it("lists the largest files first with their path and mebibytes", async () => {
    const { body } = await call();
    expect(body.largestFiles[0]).toMatchObject({ file_path: "E:\\lake\\raw\\b.zip", mebibytes: 4, modified_timestamp: "2026-06-05 10:00" });
    expect(body.largestFiles.at(-1)?.file_extension).toBeNull();
  });
});

describe("the eight numbers", () => {
  it("equal the dashboard's shared estimators on the parquet family, in mebibytes", async () => {
    const { body } = await call();
    const row = body.familySummaries.find((summary) => summary.format_family === "parquet_columnar");
    const expected = eightNumberSummary(PARQUET_SIZES.map((bytes) => bytes / 1024 ** 2));
    expect(row?.fileCount).toBe(PARQUET_SIZES.length);
    for (const key of ["count", "mean", "median", "standardDeviation", "skewness", "kurtosis", "percentile25", "percentile75", "minimum", "maximum"] as const) {
      expect(row?.mebibytes[key], key).toBeCloseTo(expected[key] as number, 9);
    }
  });

  it("leaves the shape numbers null where a family has too few files", async () => {
    const { body } = await call();
    const row = body.familySummaries.find((summary) => summary.format_family === "vendor_archive");
    expect(row?.mebibytes.count).toBe(2);
    expect(row?.mebibytes.skewness).toBeNull();
    expect(row?.mebibytes.kurtosis).toBeNull();
  });
});

describe("column profiles", () => {
  it("graphs every column of the inventory table", async () => {
    const { body } = await call({ columnBins: 8 });
    expect(body.columns.map((column) => column.column)).toEqual([
      "store_name", "zone_name", "format_family", "file_extension", "is_parquet", "file_bytes", "file_gibibytes", "modified_timestamp", "file_path",
    ]);
    const flag = body.columns.find((column) => column.column === "is_parquet");
    expect(flag?.kind === "categorical" && flag.top.find((entry) => entry.value === "unknown")?.count).toBe(1);
    const bytes = body.columns.find((column) => column.column === "file_bytes");
    expect(bytes?.kind === "numeric" && bytes.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(SEEDS.filter((seed) => seed.bytes > 0).length);
    const when = body.columns.find((column) => column.column === "modified_timestamp");
    expect(when?.kind === "timestamp" && when.dates.minimum).toBe("2026-03-05");
    const depth = body.columns.find((column) => column.column === "file_path");
    expect(depth?.kind === "numeric" && depth.summary.minimum).toBe(3);
  });
});

describe("the measurement record and degradation", () => {
  it("reads what was measured, when and from where", async () => {
    const { body } = await call();
    expect(body.measurement).toMatchObject({ measuredOnDate: "2026-09-11", sourceDatabase: "db.duckdb", fileCount: SEEDS.length, storeNames: "lake, repository" });
    expect(body.measurement?.earliestModifiedTimestamp).toBe("2026-03-05");
  });

  it("answers an empty body with a note when the inventory is not landed", async () => {
    const { body, notes } = await call({}, emptyLake);
    expect(body.available).toBe(false);
    expect(body.columns).toEqual([]);
    expect(notes.join(" ")).toContain(FILES_VIEW);
    expect(notes.join(" ")).toContain("build.py");
  });

  it("refuses queries outside the schema", () => {
    expect(querySchema.safeParse({ sizeBins: 500 }).success).toBe(false);
    expect(querySchema.safeParse({ minimumKibibytes: -1 }).success).toBe(false);
    expect(querySchema.safeParse({ recipe: "x'; DROP TABLE t; --" }).success).toBe(false);
  });
});

describe("shared helpers", () => {
  it("round-trips the hidden-value lists", () => {
    expect(parseList(joinList(["a", "b c"]))).toEqual(["a", "b c"]);
    expect(parseList("")).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });

  it("fills every month between two bounds", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthRange("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  it("puts the top edge in the last bin and a flat axis in the first", () => {
    expect(binIndexOf(5, 0, 0.5, 10)).toBe(9);
    expect(binIndexOf(0, 0, 0.5, 10)).toBe(0);
    expect(binIndexOf(3, 3, 0, 4)).toBe(0);
  });
});
