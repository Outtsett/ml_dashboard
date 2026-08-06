/**
 * QuestDB Introspection — table listing, schema info, partitions, stats.
 *
 * Used by the Databases management UI, not by chart/training code.
 */

import { queryQuestDB } from "./connection";

// ─── Validation ─────────────────────────────────────────────────────────────

/** Allowlist of known QuestDB tables. Dynamic table names must match this list. */
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

export async function getQuestDBTables(): Promise<any[]> {
  const sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';";
  return await queryQuestDB(sql);
}

export async function getQuestDBTableInfo(tableName: string): Promise<any[]> {
  const safeTableName = validateTableName(tableName);
  const sql = `SHOW COLUMNS FROM ${safeTableName};`;
  return await queryQuestDB(sql);
}

export async function getQuestDBPartitions(tableName: string): Promise<any[]> {
  const safeTableName = validateTableName(tableName);
  const escapedName = safeTableName.replace(/'/g, "''");
  try {
    const sql = `SELECT * FROM table_partitions('${escapedName}');`;
    return await queryQuestDB(sql);
  } catch {
    // Views and Materialized Views might not support table_partitions in all versions
    return [];
  }
}

export async function getQuestDBTableRowCount(tableName: string): Promise<number> {
  const safeTableName = validateAllowedTable(tableName);
  try {
    const result = await queryQuestDB<{ count: string }>(`SELECT count() as count FROM ${safeTableName};`);
    return parseInt(result[0]?.count || "0");
  } catch {
    return 0;
  }
}

export async function getQuestDBTablePreview(tableName: string, limit = 100): Promise<any[]> {
  const safeTableName = validateAllowedTable(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM ${safeTableName} LIMIT ${safeLimit};`;
  return await queryQuestDB(sql);
}

// ─── Aggregate Stats ────────────────────────────────────────────────────────

export async function getQuestDBStats(): Promise<any> {
  try {
    // Get all tables and views
    const objects = await queryQuestDB<{ table_name: string, table_type: string }>(
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public';"
    );
    
    const stats: any = {
      connected: true,
      tables: objects.length,
      tableDetails: [],
    };

    for (const obj of objects) {
      const tableName = obj.table_name;
      const tableType = obj.table_type;
      
      try {
        // Use validateTableName (not allowlist) since names come from QuestDB itself
        const safeName = validateTableName(tableName);
        const result = await queryQuestDB<{ count: string }>(`SELECT count() as count FROM ${safeName};`);
        const rowCount = parseInt(result[0]?.count || "0");
        let partitionCount = 0;
        
        if (tableType === 'BASE TABLE') {
          const partitions = await getQuestDBPartitions(tableName);
          partitionCount = partitions.length;
        }

        stats.tableDetails.push({
          name: tableName,
          type: tableType,
          rowCount: rowCount || 0,
          partitionCount: partitionCount,
        });
      } catch (e) {
        stats.tableDetails.push({
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
