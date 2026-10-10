/**
 * What the PostgreSQL server holds, read from the server itself.
 *
 * One answer per database the dashboard connects to (`quant`, `market`): the
 * server version, the installed extensions, the database's size on disk, its
 * tables in the public schema with the planner's row estimate, its views, and, when TimescaleDB is
 * installed, its hypertables with their chunk count and size. Every statement
 * is fixed text; nothing from a request reaches SQL. A database that cannot be
 * reached is reported as unreachable with the driver's message, never guessed.
 */

import type pg from "pg";

/** Each statement is stopped after this long, so a slow catalog never holds the request. */
const STATEMENT_TIMEOUT_MILLISECONDS = 3_000;

export interface PostgresTable {
  name: string;
  /** The planner's estimate (`n_live_tup`), not a count; exact only right after an ANALYZE. */
  estimatedRowCount: number;
  lastAnalyzedAt: string | null;
  totalSizeBytes: number | null;
}

export interface PostgresHypertable {
  name: string;
  chunkCount: number;
  totalSizeBytes: number | null;
  /** TimescaleDB's `approximate_row_count`, an estimate from chunk statistics. */
  approximateRowCount: number | null;
  earliestChunkStart: string | null;
  latestChunkEnd: string | null;
}

export interface PostgresDatabaseFacts {
  database: string;
  reachable: boolean;
  /** The driver's message when the database could not be reached or a statement failed. */
  error?: string;
  serverVersion?: string;
  extensions?: Array<{ name: string; version: string }>;
  databaseSizeBytes?: number;
  tables?: PostgresTable[];
  views?: string[];
  hypertables?: PostgresHypertable[];
  measuredAt: string;
  durationMilliseconds: number;
}

type Queryable = Pick<pg.Pool, "connect">;

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readPostgresDatabase(database: string, pool: Queryable): Promise<PostgresDatabaseFacts> {
  const started = Date.now();
  const done = (facts: Omit<PostgresDatabaseFacts, "database" | "measuredAt" | "durationMilliseconds">): PostgresDatabaseFacts => ({
    database,
    ...facts,
    measuredAt: new Date().toISOString(),
    durationMilliseconds: Date.now() - started,
  });

  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return done({ reachable: false, error: (error as Error).message });
  }

  try {
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MILLISECONDS}`);
    const version = await client.query("SELECT current_setting('server_version') AS version");
    const extensions = await client.query("SELECT extname, extversion FROM pg_extension ORDER BY extname");
    const size = await client.query("SELECT pg_database_size(current_database()) AS bytes");
    const tables = await client.query(
      "SELECT relname, n_live_tup, GREATEST(last_analyze, last_autoanalyze) AS analyzed, " +
        "pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables WHERE schemaname = 'public' " +
        "ORDER BY n_live_tup DESC, relname",
    );
    const views = await client.query("SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname");

    let hypertables: PostgresHypertable[] = [];
    if (extensions.rows.some((row) => row.extname === "timescaledb")) {
      const found = await client.query(
        "SELECT h.hypertable_schema, h.hypertable_name, h.num_chunks, " +
          "hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) AS bytes, " +
          "approximate_row_count(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) AS approximate_rows, " +
          "(SELECT min(c.range_start) FROM timescaledb_information.chunks c " +
          "  WHERE c.hypertable_schema = h.hypertable_schema AND c.hypertable_name = h.hypertable_name) AS earliest, " +
          "(SELECT max(c.range_end) FROM timescaledb_information.chunks c " +
          "  WHERE c.hypertable_schema = h.hypertable_schema AND c.hypertable_name = h.hypertable_name) AS latest " +
          "FROM timescaledb_information.hypertables h ORDER BY h.hypertable_name",
      );
      hypertables = found.rows.map((row) => ({
        name: String(row.hypertable_name),
        chunkCount: Number(row.num_chunks ?? 0),
        totalSizeBytes: numberOrNull(row.bytes),
        approximateRowCount: numberOrNull(row.approximate_rows),
        earliestChunkStart: isoOrNull(row.earliest),
        latestChunkEnd: isoOrNull(row.latest),
      }));
    }

    return done({
      reachable: true,
      serverVersion: String(version.rows[0]?.version ?? ""),
      extensions: extensions.rows.map((row) => ({ name: String(row.extname), version: String(row.extversion) })),
      databaseSizeBytes: Number(size.rows[0]?.bytes ?? 0),
      tables: tables.rows.map((row) => ({
        name: String(row.relname),
        estimatedRowCount: Number(row.n_live_tup ?? 0),
        lastAnalyzedAt: isoOrNull(row.analyzed),
        totalSizeBytes: numberOrNull(row.bytes),
      })),
      views: views.rows.map((row) => String(row.viewname)),
      hypertables,
    });
  } catch (error) {
    return done({ reachable: true, error: (error as Error).message });
  } finally {
    client.release();
  }
}
