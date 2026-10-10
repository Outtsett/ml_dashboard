/**
 * The lake inventory (`getLakeStats`): every object's row count in one answer.
 *  - a view whose name is longer than 64 characters is counted, not rejected;
 *  - an Iceberg table takes the catalog's total and is never counted row by row;
 *  - a count that fails is null with its error, never 0;
 *  - two callers at once share one count, and the answer is then served from memory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const LONG_NAME = `derived_${"x".repeat(70)}`;

const queryLake = vi.fn();
const fetchIcebergTable = vi.fn();
const listIcebergTables = vi.fn();
const pinned = new Map<string, string>();

vi.mock("../infrastructure/database/lake/connection", () => ({
  queryLake: (...parameters: unknown[]) => queryLake(...parameters),
  fetchIcebergTable: (...parameters: unknown[]) => fetchIcebergTable(...parameters),
  listIcebergTables: (...parameters: unknown[]) => listIcebergTables(...parameters),
  pinnedIcebergMetadataLocation: (table: string) => pinned.get(table),
}));

async function loadInventory() {
  vi.resetModules();
  return import("../infrastructure/database/lake/introspection");
}

beforeEach(() => {
  queryLake.mockReset();
  fetchIcebergTable.mockReset();
  listIcebergTables.mockReset();
  listIcebergTables.mockResolvedValue(["bars"]);
  pinned.clear();
  pinned.set("bars", "s3://lakehouse/metadata/00533.json");
  fetchIcebergTable.mockResolvedValue({
    "metadata-location": "s3://lakehouse/metadata/00533.json",
    metadata: {
      snapshots: [
        { "timestamp-ms": 1, summary: { "total-records": "10" } },
        { "timestamp-ms": 2, summary: { "total-records": "882665821" } },
      ],
    },
  });
  queryLake.mockImplementation(async (statement: string) => {
    if (statement.includes("information_schema.tables")) {
      return [
        { table_name: "bars", table_type: "VIEW" },
        { table_name: LONG_NAME, table_type: "VIEW" },
        { table_name: "broken_view", table_type: "VIEW" },
      ];
    }
    if (statement.includes('"broken_view"')) throw new Error("object not found");
    if (statement.includes('FROM "bars"')) return [{ count: 7n }];
    if (statement.includes(`"${LONG_NAME}"`)) return [{ count: 42n }];
    throw new Error(`unexpected statement: ${statement}`);
  });
});

describe("getLakeStats", () => {
  it("counts a long-named view, reads an Iceberg table from the catalog, and reports a failed count as null", async () => {
    const { getLakeStats } = await loadInventory();
    const stats = await getLakeStats();

    expect(stats.connected).toBe(true);
    const byName = Object.fromEntries((stats.tableDetails ?? []).map((detail) => [detail.name, detail]));
    expect(byName.bars).toMatchObject({ rowCount: 882665821, rowCountSource: "iceberg_snapshot" });
    expect(byName[LONG_NAME]).toMatchObject({ rowCount: 42, rowCountSource: "counted" });
    expect(byName.broken_view).toMatchObject({ rowCount: null, rowCountSource: "failed" });
    expect(byName.broken_view?.error).toContain("object not found");

    const statements = queryLake.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes('FROM "bars"'))).toBe(false);
  });

  it("counts the view when the catalog has moved past the metadata file the view scans", async () => {
    pinned.set("bars", "s3://lakehouse/metadata/00532.json");
    const { getLakeStats } = await loadInventory();
    const stats = await getLakeStats();
    const bars = (stats.tableDetails ?? []).find((detail) => detail.name === "bars");
    expect(bars).toMatchObject({ rowCount: 7, rowCountSource: "counted" });
  });

  it("shares one count between concurrent callers and then answers from memory", async () => {
    queryLake.mockImplementation(async (statement: string) =>
      statement.includes("information_schema.tables") ? [{ table_name: "bars", table_type: "VIEW" }] : [{ count: 1n }],
    );
    const { getLakeStats } = await loadInventory();
    const [first, second] = await Promise.all([getLakeStats(), getLakeStats()]);
    expect(first).toBe(second);
    const listings = () => queryLake.mock.calls.filter(([statement]) => String(statement).includes("information_schema.tables")).length;
    expect(listings()).toBe(1);

    await getLakeStats();
    expect(listings()).toBe(1);

    await getLakeStats({ refresh: true });
    expect(listings()).toBe(2);
  });
});
