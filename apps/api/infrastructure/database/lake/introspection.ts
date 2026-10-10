/**
 * Serving-layer introspection — object listing, column info, row counts, stats.
 *
 * Used by the Databases management UI, not by chart or training code.
 *
 * lake's metadata surface does not exist in DuckDB: `tables()`,
 * `table_columns()`, `table_partitions()` and `SHOW COLUMNS` are all lake
 * functions, and `information_schema.tables` lives in schema `main` here rather
 * than `public`. Each is translated below, and the result rows keep lake's
 * column names (`table_name`, `column`, `type`) so the UI needs no change.
 */

import { fetchIcebergTable, listIcebergTables, queryLake } from "./connection";

// ─── Validation ─────────────────────────────────────────────────────────────

/** Allowlist of known serving views. Dynamic names must match this list. */
const TABLE_ALLOWLIST = new Set([
  'ohlcv', 'symbols',
]);

function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tableName)) {
    throw new Error("Invalid table name format");
  }
  return tableName;
}

/**
 * Validate table name AND check it against the allowlist.
 * Use for queries where the table name comes from user input.
 */
function validateAllowedTable(tableName: string): string {
  const safe = validateTableName(tableName);
  if (!TABLE_ALLOWLIST.has(safe)) {
    throw new Error(`Table '${safe}' is not in the allowed tables list`);
  }
  return safe;
}

function validatePositiveInt(value: number | undefined, maxValue: number = 1000000): number {
  if (value === undefined) return 0;
  const intVal = Math.floor(value);
  if (isNaN(intVal) || intVal < 0 || intVal > maxValue) {
    throw new Error("Invalid numeric value");
  }
  return intVal;
}

// ─── Table Introspection ────────────────────────────────────────────────────

/**
 * Every object the serving layer exposes.
 *
 * Was `information_schema.tables WHERE table_schema = 'public'`. DuckDB puts
 * user objects in `main`, and everything here is a VIEW over parquet rather
 * than a BASE TABLE — `table_type` reflects that honestly rather than being
 * forced back to lake's answer.
 */
export interface LakeObjectRow {
  table_name: string;
  table_type: string;
}

export interface LakeColumnRow {
  column: string;
  type: string;
  is_nullable: string;
  ordinal_position: number;
}

export interface LakeObjectStats {
  connected: boolean;
  tables?: number;
  tableDetails?: Array<{
    name: string;
    type: string;
    /** null when the count failed; an unknown is never reported as 0. */
    rowCount: number | null;
    /** `counted` = SELECT count(*) on the view; `iceberg_snapshot` = the catalog's total-records. */
    rowCountSource?: "counted" | "iceberg_snapshot" | "failed";
    partitionCount?: number;
    error?: string;
  }>;
  /** When this inventory was counted (ISO 8601) and how long the count took. */
  countedAt?: string;
  durationMilliseconds?: number;
  error?: string;
}

export async function getLakeTables(): Promise<LakeObjectRow[]> {
  const sql =
    "SELECT table_name, table_type FROM information_schema.tables " +
    "WHERE table_schema = 'main' ORDER BY table_name";
  return await queryLake<LakeObjectRow>(sql);
}

/**
 * Column names and types for one object.
 *
 * Was `SHOW COLUMNS FROM <t>`, a lake statement DuckDB does not parse. The
 * aliases keep lake's output shape (`column`, `type`), which is what the
 * Databases UI renders.
 */
export async function getLakeTableInfo(tableName: string): Promise<LakeColumnRow[]> {
  const safeTableName = validateTableName(tableName);
  const escapedName = safeTableName.replace(/'/g, "''");
  const sql =
    `SELECT column_name AS "column", data_type AS type, is_nullable, ordinal_position ` +
    `FROM information_schema.columns WHERE table_schema = 'main' ` +
    `AND table_name = '${escapedName}' ORDER BY ordinal_position`;
  return await queryLake<LakeColumnRow>(sql);
}

/**
 * Always empty.
 *
 * `table_partitions()` was lake's, and lake's day/month partitions were a
 * storage property of its own tables. The serving views are parquet in the lake
 * — hive-partitioned by `year=` on disk, but that is the export's layout, not a
 * partition the database manages. Reporting none is the honest answer; the UI
 * already renders an empty partition list.
 */
export async function getLakePartitions(_tableName: string): Promise<never[]> {
  return [];
}

export async function getLakeTableRowCount(tableName: string): Promise<number> {
  const safeTableName = validateAllowedTable(tableName);
  try {
    // `count()` was lake's spelling; DuckDB requires an argument.
    const result = await queryLake<{ count: number | string }>(
      `SELECT count(*) as count FROM "${safeTableName}"`,
    );
    return Number(result[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function getLakeTablePreview(tableName: string, limit = 100): Promise<Record<string, unknown>[]> {
  const safeTableName = validateAllowedTable(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM "${safeTableName}" LIMIT ${safeLimit}`;
  return await queryLake<Record<string, unknown>>(sql);
}

// ─── Aggregate Stats ────────────────────────────────────────────────────────

/** How long one counted inventory is served before the lake is counted again. */
const INVENTORY_TTL_MILLISECONDS = 10 * 60_000;
/** Views counted at once; each count opens its own DuckDB connection. */
const INVENTORY_CONCURRENCY = 8;

let inventoryCache: { stats: LakeObjectStats; expiresAt: number } | null = null;
let inventoryInFlight: Promise<LakeObjectStats> | null = null;

/** The newest snapshot's `total-records` for an Iceberg table, read from the catalog. */
async function icebergTotalRecords(table: string): Promise<number | null> {
  const body = await fetchIcebergTable(table);
  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  const snapshots = (metadata.snapshots ?? []) as Array<{ "timestamp-ms"?: number; summary?: Record<string, string> }>;
  const newest = snapshots.reduce<(typeof snapshots)[number] | null>(
    (latest, snapshot) => (!latest || (snapshot["timestamp-ms"] ?? 0) > (latest["timestamp-ms"] ?? 0) ? snapshot : latest),
    null,
  );
  const total = Number(newest?.summary?.["total-records"]);
  return Number.isFinite(total) ? total : null;
}

async function countInventory(): Promise<LakeObjectStats> {
  const started = Date.now();
  const objects = await getLakeTables();
  const icebergTables = new Set(await listIcebergTables().catch(() => [] as string[]));
  const tableDetails: NonNullable<LakeObjectStats["tableDetails"]> = new Array(objects.length);

  let next = 0;
  const worker = async () => {
    while (next < objects.length) {
      const index = next++;
      const { table_name: name, table_type: type } = objects[index]!;
      try {
        // An Iceberg table states its own row total in its newest snapshot;
        // counting 882 million rows to learn the same number takes seconds.
        const fromCatalog = icebergTables.has(name) ? await icebergTotalRecords(name).catch(() => null) : null;
        if (fromCatalog !== null) {
          tableDetails[index] = { name, type, rowCount: fromCatalog, rowCountSource: "iceberg_snapshot" };
          continue;
        }
        // Names come from information_schema, so they are quoted, not pattern-checked:
        // a 65-character view name is a valid view.
        const result = await queryLake<{ count: number | string | bigint }>(
          `SELECT count(*) AS count FROM "${name.replace(/"/g, '""')}"`,
        );
        tableDetails[index] = { name, type, rowCount: Number(result[0]?.count ?? 0), rowCountSource: "counted" };
      } catch (e) {
        // A count that failed is unknown, never zero.
        tableDetails[index] = { name, type, rowCount: null, rowCountSource: "failed", error: String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(INVENTORY_CONCURRENCY, objects.length) }, worker));

  return {
    connected: true,
    tables: objects.length,
    tableDetails,
    countedAt: new Date().toISOString(),
    durationMilliseconds: Date.now() - started,
  };
}

/**
 * Every lake object with its row count. Counted at most once per ten minutes
 * (`refresh` forces a recount); concurrent callers share one count.
 */
export async function getLakeStats(options: { refresh?: boolean } = {}): Promise<LakeObjectStats> {
  if (!options.refresh && inventoryCache && inventoryCache.expiresAt > Date.now()) return inventoryCache.stats;
  if (inventoryInFlight) return inventoryInFlight;
  inventoryInFlight = countInventory()
    .then((stats) => {
      inventoryCache = { stats, expiresAt: Date.now() + INVENTORY_TTL_MILLISECONDS };
      return stats;
    })
    .catch((error): LakeObjectStats => ({ connected: false, error: String(error) }))
    .finally(() => {
      inventoryInFlight = null;
    });
  return inventoryInFlight;
}

