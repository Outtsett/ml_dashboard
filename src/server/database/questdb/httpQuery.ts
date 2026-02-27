/**
 * QuestDB HTTP API helpers.
 *
 * Use queryQuestDB() (PG wire) for standard SQL.
 * Use questdbHttpQuery() for HTTP-only features (e.g. SHOW COLUMNS).
 */

import { QUESTDB_HOST, QUESTDB_HTTP_PORT } from "./connection";

const QUESTDB_HTTP_URL = `http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}`;

/**
 * Execute SQL via QuestDB HTTP API. Returns array of typed objects.
 * Prefer queryQuestDB() (PG wire) for most queries.
 * Use this for HTTP-only features like SHOW COLUMNS.
 */
export async function questdbHttpQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const resp = await fetch(`${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(sql)}&nm=true`);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`QuestDB HTTP query failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  const json = await resp.json() as {
    columns: Array<{ name: string; type: string }>;
    dataset: unknown[][];
    count: number;
  };
  if (!json.dataset || json.dataset.length === 0) return [];
  const colNames = json.columns.map(c => c.name);
  return json.dataset.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < colNames.length; i++) {
      obj[colNames[i]!] = row[i];
    }
    return obj as T;
  });
}

/**
 * Export query results as CSV string via QuestDB HTTP /exp endpoint.
 */
export async function questdbExportCSV(sql: string): Promise<string> {
  const resp = await fetch(
    `${QUESTDB_HTTP_URL}/exp?query=${encodeURIComponent(sql)}`
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`QuestDB CSV export failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.text();
}

/**
 * Upload CSV file to QuestDB via /imp endpoint.
 * Returns the import response text.
 */
export async function questdbImportCSV(
  csvContent: Buffer | string,
  tableName: string,
  opts: { timestamp?: string; partitionBy?: string; overwrite?: boolean } = {}
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([csvContent], { type: "text/csv" });
  form.append("data", blob);

  let url = `${QUESTDB_HTTP_URL}/imp?name=${encodeURIComponent(tableName)}`;
  if (opts.timestamp) url += `&timestamp=${encodeURIComponent(opts.timestamp)}`;
  if (opts.partitionBy) url += `&partitionBy=${encodeURIComponent(opts.partitionBy)}`;
  if (opts.overwrite) url += `&overwrite=true`;

  const resp = await fetch(url, { method: "POST", body: form });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`QuestDB /imp failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.text();
}
