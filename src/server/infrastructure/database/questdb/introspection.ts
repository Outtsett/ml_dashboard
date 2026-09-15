/**
 * Serving-layer introspection — object listing, column info, row counts, stats.
 *
 * Used by the Databases management UI, not by chart or training code.
 *
 * QuestDB's metadata surface does not exist in DuckDB: `tables()`,
 * `table_columns()`, `table_partitions()` and `SHOW COLUMNS` are all QuestDB
 * functions, and `information_schema.tables` lives in schema `main` here rather
 * than `public`. Each is translated below, and the result rows keep QuestDB's
 * column names (`table_name`, `column`, `type`) so the UI needs no change.
 */

import { queryQuestDB } from "./connection";

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
 * forced back to QuestDB's answer.
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
  tableDetails?: Array<{ name: string; type: string; rowCount: number; partitionCount?: number; error?: string }>;
  error?: string;
}

export async function getQuestDBTables(): Promise<LakeObjectRow[]> {
  const sql =
    "SELECT table_name, table_type FROM information_schema.tables " +
    "WHERE table_schema = 'main' ORDER BY table_name";
  return await queryQuestDB<LakeObjectRow>(sql);
}

/**
 * Column names and types for one object.
 *
 * Was `SHOW COLUMNS FROM <t>`, a QuestDB statement DuckDB does not parse. The
 * aliases keep QuestDB's output shape (`column`, `type`), which is what the
 * Databases UI renders.
 */
export async function getQuestDBTableInfo(tableName: string): Promise<LakeColumnRow[]> {
  const safeTableName = validateTableName(tableName);
  const escapedName = safeTableName.replace(/'/g, "''");
  const sql =
    `SELECT column_name AS "column", data_type AS type, is_nullable, ordinal_position ` +
    `FROM information_schema.columns WHERE table_schema = 'main' ` +
    `AND table_name = '${escapedName}' ORDER BY ordinal_position`;
  return await queryQuestDB<LakeColumnRow>(sql);
}

/**
 * Always empty.
 *
 * `table_partitions()` was QuestDB's, and QuestDB's day/month partitions were a
 * storage property of its own tables. The serving views are parquet in the lake
 * — hive-partitioned by `year=` on disk, but that is the export's layout, not a
 * partition the database manages. Reporting none is the honest answer; the UI
 * already renders an empty partition list.
 */
export async function getQuestDBPartitions(_tableName: string): Promise<never[]> {
  return [];
}

export async function getQuestDBTableRowCount(tableName: string): Promise<number> {
  const safeTableName = validateAllowedTable(tableName);
  try {
    // `count()` was QuestDB's spelling; DuckDB requires an argument.
    const result = await queryQuestDB<{ count: number | string }>(
      `SELECT count(*) as count FROM "${safeTableName}"`,
    );
    return Number(result[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function getQuestDBTablePreview(tableName: string, limit = 100): Promise<Record<string, unknown>[]> {
  const safeTableName = validateAllowedTable(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM "${safeTableName}" LIMIT ${safeLimit}`;
  return await queryQuestDB<Record<string, unknown>>(sql);
}

// ─── Aggregate Stats ────────────────────────────────────────────────────────

export async function getQuestDBStats(): Promise<LakeObjectStats> {
  try {
    const objects = await getQuestDBTables();

    const tableDetails: NonNullable<LakeObjectStats["tableDetails"]> = [];
    const stats: LakeObjectStats = {
      connected: true,
      tables: objects.length,
      tableDetails,
    };

    for (const obj of objects) {
      const tableName = obj.table_name;
      const tableType = obj.table_type;

      try {
        // validateTableName (not the allowlist) since names come from the
        // database itself, not from a request.
        const safeName = validateTableName(tableName);
        const result = await queryQuestDB<{ count: number | string }>(
          `SELECT count(*) as count FROM "${safeName}"`,
        );

        tableDetails.push({
          name: tableName,
          type: tableType,
          rowCount: Number(result[0]?.count ?? 0),
          partitionCount: 0,
        });
      } catch (e) {
        tableDetails.push({
          name: tableName,
          type: tableType,
          rowCount: 0,
          error: String(e),
        });
      }
    }

    return stats;
  } catch (error) {
    return {
      connected: false,
      error: String(error),
    };
  }
}
