/**
 * QuestDB Introspection — table listing, schema info, partitions, stats.
 *
 * Used by the Databases management UI, not by chart/training code.
 */

import { queryQuestDB } from "./connection";

// ─── Validation ─────────────────────────────────────────────────────────────

function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tableName)) {
    throw new Error("Invalid table name format");
  }
  return tableName;
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
  const sql = "SHOW TABLES;";
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
  const sql = `SELECT * FROM table_partitions('${escapedName}');`;
  return await queryQuestDB(sql);
}

export async function getQuestDBTableRowCount(tableName: string): Promise<number> {
  const safeTableName = validateTableName(tableName);
  const result = await queryQuestDB<{ count: string }>(`SELECT count() as count FROM ${safeTableName};`);
  return parseInt(result[0]?.count || "0");
}

export async function getQuestDBTablePreview(tableName: string, limit = 100): Promise<any[]> {
  const safeTableName = validateTableName(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM ${safeTableName} LIMIT ${safeLimit};`;
  return await queryQuestDB(sql);
}

// ─── Aggregate Stats ────────────────────────────────────────────────────────

export async function getQuestDBStats(): Promise<any> {
  try {
    const tables = await getQuestDBTables();
    const stats: any = {
      connected: true,
      tables: tables.length,
      tableDetails: [],
    };

    for (const table of tables) {
      const tableName = table.table_name || table.name || table.tableName;
      if (tableName) {
        try {
          const rowCount = await getQuestDBTableRowCount(tableName);
          const partitions = await getQuestDBPartitions(tableName);
          stats.tableDetails.push({
            name: tableName,
            rowCount,
            partitionCount: partitions.length,
          });
        } catch (e) {
          stats.tableDetails.push({
            name: tableName,
            error: String(e),
          });
        }
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
