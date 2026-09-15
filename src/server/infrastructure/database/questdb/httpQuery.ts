/**
 * What used to be QuestDB's HTTP API (`/exec`, `/exp`, `/imp`).
 *
 * QuestDB is retired; these run against the DuckDB serving layer instead. The
 * names and signatures are unchanged because callers outside this directory
 * import them — a later pass handles renaming.
 *
 * `questdbHttpQuery` and `queryQuestDB` are now the same path. The QuestDB-era
 * split existed because `/exec` could answer things PG wire could not
 * (`SHOW COLUMNS`); DuckDB answers everything on one connection.
 */

import { queryQuestDB } from "./connection";

/** Execute SQL against the lake. Returns an array of typed row objects. */
export async function questdbHttpQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return queryQuestDB<T>(sql);
}

/**
 * Export query results as a CSV string.
 *
 * QuestDB's `/exp` endpoint did this server-side. DuckDB's own `COPY … TO` only
 * writes files, so the rows are serialised here — RFC 4180 quoting, `NULL`
 * rendered as an empty field, timestamps as ISO-8601 UTC.
 */
export async function questdbExportCSV(sql: string): Promise<string> {
  const rows = await queryQuestDB<Record<string, unknown>>(sql);
  if (rows.length === 0) return "";

  const columns = Object.keys(rows[0]!);
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Retired. Nothing writes to the lake from this server.
 *
 * The QuestDB `/imp` endpoint it wrapped no longer exists. Land CSV through
 * datalake instead: `scripts/land_raw.py` writes it write-once under
 * `E:\lake\raw\vendor=<name>\` with a `.sha256` sidecar, and
 * `scripts/migrate_to_iceberg.py` promotes it.
 */
export async function questdbImportCSV(
  csvContent: Buffer | string,
  tableName: string,
  opts: { timestamp?: string; partitionBy?: string; overwrite?: boolean } = {},
): Promise<string> {
  void [csvContent, opts];
  throw new Error(
    `[lake] questdbImportCSV('${tableName}') is not available. QuestDB was retired on ` +
      "2026-09-10 and this server is read-only over the lake. Land CSV through datalake " +
      "(scripts/land_raw.py, then scripts/migrate_to_iceberg.py). Restore path if QuestDB " +
      "is ever needed again: s3://meta/questdb_schema/questdb_schema_latest.sql plus the " +
      "parquet at s3://derived/recipe=questdb_full_2026-09-09/.",
  );
}
