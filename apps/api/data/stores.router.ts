/**
 * Store Routes — what the data actually is, and how to read it without SQL.
 *
 * Three stores, named for what they are rather than for the database that used
 * to be here:
 *   - the Iceberg lake at E:\lake, served by AIStor, the system of record;
 *   - DuckDB, in-process, which defines a view per table of the frozen serving
 *     snapshot and is what every query in this app actually runs on;
 *   - SQLite, the dashboard's own metadata.
 *
 * Routes (mounted at /api/stores):
 *   GET /overview                  -> { lake, duckdb, sqlite }
 *   GET /objects?store=            -> object list with row counts
 *   GET /objects/:store/:name      -> columns, types, null counts, row count
 *   GET /rows/:store/:name?...     -> paged, sorted, filtered rows (no SQL typed by anyone)
 *   GET /iceberg?table=            -> snapshots, manifests, partitions for one Iceberg table
 *   GET /duckdb                    -> version, extensions (vector search included), settings
 *
 * Every identifier reaching SQL is validated against a name pattern and then
 * quoted; every filter is a typed predicate, never a fragment of user SQL.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { stat } from "node:fs/promises";
import { sql as drizzleSql } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import { db as sqliteDb } from "../infrastructure/database/sqlite";
import {
  fetchIcebergTable,
  listIcebergTables,
  queryLake as queryLake,
  lakeObjectsByKind,
  findLakeObject,
  getLakeStats,
} from "../infrastructure/database/lake";
import { SORT_ROW_LIMIT } from "@shared/stores/limits";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { marketPool, quantPool } from "../infrastructure/database/pg_db";
import { readPostgresDatabase } from "../infrastructure/database/postgresInventory";

const router = Router();
const logger = new Logger("StoreRoutes");

/** Identifiers we will quote into SQL. Anything else is rejected outright. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$/;

const StoreSchema = z.enum(["lake", "sqlite"]);
const NameSchema = z.string().regex(SAFE_NAME, "unrecognised object name");

const FilterSchema = z.object({
  column: NameSchema,
  operator: z.enum(["equals", "contains", "greater_than", "less_than", "between"]),
  value: z.string().max(200),
  valueTo: z.string().max(200).optional(),
});

const RowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(5_000_000).default(0),
  orderBy: NameSchema.optional(),
  orderDirection: z.enum(["ascending", "descending"]).default("ascending"),
  /** JSON array of FilterSchema — built by the UI's filter controls, never typed. */
  filters: z.string().max(4000).optional(),
});

export function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** A DuckDB/SQLite literal for a typed filter value. Strings are escaped, numbers pass as numbers. */
export function literal(value: string, numeric: boolean): string {
  if (numeric && value.trim() !== "" && Number.isFinite(Number(value))) return String(Number(value));
  return `'${value.replace(/'/g, "''")}'`;
}

export interface ColumnInfo {
  name: string;
  type: string;
  numeric: boolean;
}

const overviewCache = new LRUCache<string, object>({ max: 8, ttl: 30_000 });

/**
 * The most rows a lake sort may have to read. An ORDER BY reads every row the
 * filters leave, so the rows route sorts only when that number is known and at
 * or under this limit: the object's counted rows when there is no filter, the
 * counted matches when there is one. An unknown count is refused, not waved
 * through. Enforced here, on the server, so it holds whatever the page sends.
 */
export { SORT_ROW_LIMIT };

/** Every lake statement the browse routes run is stopped after this long. */
export const BROWSE_TIMEOUT_MILLISECONDS = 15_000;

/** A forced recount of the whole lake is honoured at most this often. */
const INVENTORY_REFRESH_INTERVAL_MILLISECONDS = 60_000;
let lastInventoryRefresh = 0;

const SQLITE_PATH = process.env.SQLITE_DB_PATH || "data/ml_dashboard.db";

async function sqliteSizeBytes(): Promise<number | null> {
  try {
    const [main, wal] = await Promise.all([
      stat(SQLITE_PATH),
      stat(`${SQLITE_PATH}-wal`).catch(() => null),
    ]);
    return main.size + (wal?.size ?? 0);
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function lakeObjects(): Promise<Array<{ name: string; kind: string }>> {
  const rows = await queryLake<{ table_name: string; table_type: string }>(
    "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
  );
  return rows.map((r) => ({ name: r.table_name, kind: r.table_type === "VIEW" ? "view" : "table" }));
}

async function sqliteObjects(): Promise<Array<{ name: string; kind: string }>> {
  const rows = await sqliteDb.all<{ name: string }>(
    drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  return rows.map((r) => ({ name: r.name, kind: "table" }));
}

async function lakeColumns(name: string): Promise<ColumnInfo[]> {
  const rows = await queryLake<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns ` +
      `WHERE table_schema = 'main' AND table_name = '${name.replace(/'/g, "''")}' ORDER BY ordinal_position`,
  );
  return rows.map((r) => ({
    name: r.column_name,
    type: r.data_type,
    numeric: /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|HUGEINT|REAL|BIGINT/i.test(r.data_type),
  }));
}

async function sqliteColumns(name: string): Promise<ColumnInfo[]> {
  const rows = await sqliteDb.all<{ name: string; type: string }>(
    drizzleSql.raw(`PRAGMA table_info(${quote(name)})`),
  );
  return rows.map((r) => ({
    name: r.name,
    type: r.type || "unknown",
    numeric: /INT|REAL|NUM|DOUBLE|FLOAT/i.test(r.type ?? ""),
  }));
}

export async function columnsFor(store: "lake" | "sqlite", name: string): Promise<ColumnInfo[]> {
  return store === "lake" ? lakeColumns(name) : sqliteColumns(name);
}

function buildWhere(filters: z.infer<typeof FilterSchema>[], columns: ColumnInfo[]): string {
  const clauses: string[] = [];
  for (const filter of filters) {
    const column = columns.find((c) => c.name === filter.column);
    if (!column) continue;
    const id = quote(column.name);
    switch (filter.operator) {
      case "equals":
        clauses.push(`${id} = ${literal(filter.value, column.numeric)}`);
        break;
      case "contains":
        // The typed text is matched literally: its own % and _ are escaped, so
        // "50%" finds the text 50% and not every value containing 50.
        clauses.push(
          `CAST(${id} AS VARCHAR) LIKE ${literal(`%${filter.value.replace(/[\\%_]/g, "\\$&")}%`, false)} ESCAPE '\\'`,
        );
        break;
      case "greater_than":
        clauses.push(`${id} > ${literal(filter.value, column.numeric)}`);
        break;
      case "less_than":
        clauses.push(`${id} < ${literal(filter.value, column.numeric)}`);
        break;
      case "between":
        clauses.push(
          `${id} BETWEEN ${literal(filter.value, column.numeric)} AND ${literal(filter.valueTo ?? filter.value, column.numeric)}`,
        );
        break;
    }
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

// ─── Overview ────────────────────────────────────────────────────────────────

router.get("/stores/overview", queryRateLimiter, async (_req: Request, res: Response) => {
  const cached = overviewCache.get("overview");
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const [objects, duckdbVersion, extensions, sqliteTables] = await Promise.all([
      lakeObjects(),
      queryLake<{ version: string }>("SELECT version() AS version"),
      queryLake<{ extension_name: string; loaded: boolean; installed: boolean }>(
        "SELECT extension_name, loaded, installed FROM duckdb_extensions() ORDER BY extension_name",
      ),
      sqliteObjects(),
    ]);

    const sqliteCounts = await Promise.all(
      sqliteTables.map(async (table) => {
        try {
const [row] = await sqliteDb.all<{ n: number }>(
            drizzleSql.raw(`SELECT count(*) AS n FROM ${quote(table.name)}`),
          );
          return { ...table, rowCount: Number(row?.n ?? 0) as number | null };
        } catch {
          // A count that failed is unknown, never zero.
          return { ...table, rowCount: null as number | null };
        }
      }),
    );

    const payload = {
      lake: {
        label: "Iceberg lake",
        role: "System of record — Apache Iceberg v2 at E:\\lake, served by AIStor",
        catalog: "http://127.0.0.1:9100/_iceberg",
        namespace: "market",
        objectCount: objects.length,
        objects,
      },
      duckdb: {
        label: "DuckDB",
        role: "In-process serving layer — every query on this page runs here, over the lake's parquet",
        version: duckdbVersion[0]?.version ?? "unknown",
        extensions: extensions.map((e) => ({
          name: e.extension_name,
          loaded: Boolean(e.loaded),
          installed: Boolean(e.installed),
        })),
        vectorSearch: (() => {
          const vss = extensions.find((e) => e.extension_name === "vss");
          return {
            available: Boolean(vss?.installed),
            loaded: Boolean(vss?.loaded),
            note: vss?.loaded
              ? "Vector search is loaded: HNSW indexes and array distance functions are available."
              : vss?.installed
                ? "Vector search is installed but not loaded in this connection."
                : "Vector search is not installed in this connection, and nothing in the lake stores embeddings yet.",
          };
        })(),
      },
      sqlite: {
        label: "SQLite",
        role: "The dashboard's own metadata — models, training runs, instruments",
        path: SQLITE_PATH,
        // The database file plus its write-ahead log, as the filesystem reports them.
        sizeBytes: await sqliteSizeBytes(),
        objectCount: sqliteCounts.length,
        objects: sqliteCounts,
      },
    };
    overviewCache.set("overview", payload);
    res.json(payload);
  } catch (error) {
    logger.error(`overview failed: ${(error as Error).message}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── Objects ─────────────────────────────────────────────────────────────────

/**
 * The lake object registry, grouped by kind.
 *
 * The Data page's flat alphabetical list of 439 objects answers "what exists"
 * and nothing else — you cannot tell a candle table from an audit table without
 * reading every name. This is the same list with each object's stable id, kind
 * and origin attached, so a UI can list by kind and a caller can hand a caller
 * an `objectId` instead of a physical view name.
 */
router.get("/stores/objects-by-kind", queryRateLimiter, (_req: Request, res: Response) => {
  try {
    const grouped = lakeObjectsByKind();
    res.json({
      kinds: Object.entries(grouped).map(([kind, objects]) => ({
        kind,
        count: objects.length,
        objects: objects.sort((a, b) => a.viewName.localeCompare(b.viewName)),
      })).sort((a, b) => b.count - a.count),
      total: Object.values(grouped).reduce((sum, rows) => sum + rows.length, 0),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Resolve any accepted spelling — object id, view name, or bare dataset — to
 * the object it names, so a caller never has to know which one it holds.
 */
router.get("/stores/object/:name", queryRateLimiter, (req: Request, res: Response) => {
  const found = findLakeObject(String(req.params.name ?? ""));
  if (!found) {
    res.status(404).json({ error: `no lake object named ${req.params.name}` });
    return;
  }
  res.json(found);
});

/**
 * Every lake object's row count in one answer. Counted once per ten minutes
 * and shared; `?refresh=1` counts again. An Iceberg table's count is the
 * catalog's own total; a view's is SELECT count(*); a failed count is null.
 */
router.get("/stores/inventory", queryRateLimiter, async (req: Request, res: Response) => {
  // `?refresh=1` recounts 440 views; honour it at most once a minute, otherwise serve the held answer.
  const now = Date.now();
  const refresh = req.query.refresh === "1" && now - lastInventoryRefresh >= INVENTORY_REFRESH_INTERVAL_MILLISECONDS;
  if (refresh) lastInventoryRefresh = now;
  const stats = await getLakeStats({ refresh });
  if (!stats.connected) {
    res.status(502).json({ error: stats.error ?? "the lake did not answer" });
    return;
  }
  res.json({
    countedAt: stats.countedAt,
    durationMilliseconds: stats.durationMilliseconds,
    objects: (stats.tableDetails ?? []).map((detail) => ({
      name: detail.name,
      rowCount: detail.rowCount,
      rowCountSource: detail.rowCountSource,
      error: detail.error,
    })),
  });
});

router.get("/stores/objects", queryRateLimiter, async (req: Request, res: Response) => {
  const store = StoreSchema.safeParse(req.query.store);
  if (!store.success) {
    res.status(400).json({ error: "store must be 'lake' or 'sqlite'" });
    return;
  }
  try {
    res.json({ objects: store.data === "lake" ? await lakeObjects() : await sqliteObjects() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/stores/objects/:store/:name", queryRateLimiter, async (req: Request, res: Response) => {
  const store = StoreSchema.safeParse(req.params.store);
  const name = NameSchema.safeParse(req.params.name);
  if (!store.success || !name.success) {
    res.status(400).json({ error: "unrecognised store or object name" });
    return;
  }
  try {
    const columns = await columnsFor(store.data, name.data);
    if (columns.length === 0) {
      res.status(404).json({ error: `no object named ${name.data} in the ${store.data}` });
      return;
    }
    let rowCount: number | null = null;
    const rowCountIsEstimate = false;
    let rowCountSource: "counted" | "iceberg_snapshot" = "counted";
    if (store.data === "sqlite") {
      const [row] = await sqliteDb.all<{ n: number }>(
        drizzleSql.raw(`SELECT count(*) AS n FROM ${quote(name.data)}`),
      );
      rowCount = Number(row?.n ?? 0);
    } else {
      // The inventory already holds this count (and reads an Iceberg table's
      // from the catalog rather than counting hundreds of millions of rows).
      const inventory = await getLakeStats();
      const known = inventory.tableDetails?.find((detail) => detail.name === name.data);
      if (known && known.rowCount !== null) {
        rowCount = known.rowCount;
        if (known.rowCountSource === "iceberg_snapshot") rowCountSource = "iceberg_snapshot";
      } else {
        const rows = await queryLake<{ n: number | bigint }>(`SELECT count(*) AS n FROM ${quote(name.data)}`);
        rowCount = Number(rows[0]?.n ?? 0);
      }
    }
    res.json({ store: store.data, name: name.data, columns, rowCount, rowCountIsEstimate, rowCountSource });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── Rows: the browse surface ────────────────────────────────────────────────

router.get("/stores/rows/:store/:name", queryRateLimiter, async (req: Request, res: Response) => {
  const store = StoreSchema.safeParse(req.params.store);
  const name = NameSchema.safeParse(req.params.name);
  const query = RowsQuerySchema.safeParse(req.query);
  if (!store.success || !name.success || !query.success) {
    res.status(400).json({ error: "unrecognised store, object or paging parameters" });
    return;
  }

  let filters: z.infer<typeof FilterSchema>[] = [];
  if (query.data.filters) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(query.data.filters || "[]");
    } catch {
      res.status(400).json({ error: "filters must be a JSON array of predicates" });
      return;
    }
    const parsed = z.array(FilterSchema).max(8).safeParse(decoded);
    if (!parsed.success) {
      res.status(400).json({ error: "one of the filters is not a recognised predicate" });
      return;
    }
    filters = parsed.data;
  }

  try {
    const columns = await columnsFor(store.data, name.data);
    if (columns.length === 0) {
      res.status(404).json({ error: `no object named ${name.data} in the ${store.data}` });
      return;
    }
    const where = buildWhere(filters, columns);
    const orderColumn = columns.find((c) => c.name === query.data.orderBy);

    // The matches are counted before the rows are read, because the count
    // decides whether a sort is allowed at all.
    let matchedRowCount: number | null = null;
    if (where) {
      const countStatement = `SELECT count(*) AS n FROM ${quote(name.data)} ${where}`;
      const counted =
        store.data === "sqlite"
          ? await sqliteDb.all<{ n: number }>(drizzleSql.raw(countStatement))
          : await queryLake<{ n: number | bigint }>(countStatement, BROWSE_TIMEOUT_MILLISECONDS);
      matchedRowCount = Number(counted[0]?.n ?? 0);
    }

    if (orderColumn && store.data === "lake") {
      let rowsToSort: number | null = matchedRowCount;
      if (!where) {
        const inventory = await getLakeStats();
        rowsToSort = inventory.tableDetails?.find((detail) => detail.name === name.data)?.rowCount ?? null;
      }
      if (rowsToSort === null) {
        res.status(400).json({
          error: `The rows of ${name.data} could not be counted, so it cannot be sorted safely; remove the sort or add a filter.`,
        });
        return;
      }
      if (rowsToSort > SORT_ROW_LIMIT) {
        res.status(400).json({
          error:
            `This sort would read ${rowsToSort.toLocaleString("en-US")} rows of ${name.data}; the limit is ` +
            `${SORT_ROW_LIMIT.toLocaleString("en-US")}. Add a filter that narrows it further before sorting.`,
        });
        return;
      }
    }
    const order = orderColumn
      ? `ORDER BY ${quote(orderColumn.name)} ${query.data.orderDirection === "descending" ? "DESC" : "ASC"}`
      : "";
    const statement =
      `SELECT * FROM ${quote(name.data)} ${where} ${order} LIMIT ${query.data.limit} OFFSET ${query.data.offset}`.replace(
        /\s+/g,
        " ",
      );

    const rows =
      store.data === "sqlite"
        ? await sqliteDb.all(drizzleSql.raw(statement))
        : await queryLake<Record<string, unknown>>(statement, BROWSE_TIMEOUT_MILLISECONDS);

    res.json({
      store: store.data,
      name: name.data,
      columns,
      rows: JSON.parse(
        JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? Number(value) : value)),
      ),
      limit: query.data.limit,
      offset: query.data.offset,
      matchedRowCount,
      statement,
    });
  } catch (error) {
    logger.warn(`rows failed for ${name.data}: ${(error as Error).message}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── Iceberg metadata ────────────────────────────────────────────────────────

router.get("/stores/iceberg", queryRateLimiter, async (req: Request, res: Response) => {
  const requested = z
    .string()
    .regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/)
    .safeParse((req.query.table as string) ?? "bars");
  if (!requested.success) {
    res.status(400).json({ error: "table must be a plain Iceberg table name" });
    return;
  }
  const table = requested.data.includes(".") ? requested.data.split(".").pop()! : requested.data;
  try {
    const [tables, body] = await Promise.all([
      listIcebergTables().catch(() => [] as string[]),
      fetchIcebergTable(table),
    ]);
    const metadata = (body.metadata ?? {}) as Record<string, unknown>;
    const snapshots = (metadata.snapshots ?? []) as Array<Record<string, unknown>>;
    const schemas = (metadata.schemas ?? []) as Array<Record<string, unknown>>;
    const currentSchemaId = metadata["current-schema-id"];
    const currentSchema =
      schemas.find((s) => s["schema-id"] === currentSchemaId) ?? schemas[schemas.length - 1] ?? {};

    res.json({
      table,
      tablesInNamespace: tables,
      metadataLocation: body["metadata-location"] ?? null,
      location: metadata.location ?? null,
      formatVersion: metadata["format-version"] ?? null,
      currentSnapshotId: metadata["current-snapshot-id"] ?? null,
      lastUpdatedMs: metadata["last-updated-ms"] ?? null,
      // Newest first: what changed, when, and how much it wrote.
      snapshots: snapshots
        .slice(-25)
        .reverse()
        .map((snapshot) => ({
          snapshotId: snapshot["snapshot-id"],
          parentSnapshotId: snapshot["parent-snapshot-id"] ?? null,
          sequenceNumber: snapshot["sequence-number"] ?? null,
          timestampMs: snapshot["timestamp-ms"] ?? null,
          manifestList: snapshot["manifest-list"] ?? null,
          summary: snapshot.summary ?? {},
        })),
      snapshotCount: snapshots.length,
      partitionSpecs: metadata["partition-specs"] ?? [],
      sortOrders: metadata["sort-orders"] ?? [],
      schema: currentSchema,
      properties: metadata.properties ?? {},
    });
  } catch (error) {
    logger.warn(`iceberg metadata failed for ${table}: ${(error as Error).message}`);
    res.status(502).json({ error: (error as Error).message });
  }
});

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

const postgresCache = new LRUCache<string, object>({ max: 2, ttl: 30_000 });

/**
 * What the PostgreSQL server says it holds, per database the dashboard connects
 * to. Read from the server's own catalog and held for 30 seconds; a database
 * that does not answer is listed as unreachable with the driver's message.
 */
router.get("/stores/postgres", queryRateLimiter, async (_req: Request, res: Response) => {
  const cached = postgresCache.get("postgres");
  if (cached) {
    res.json(cached);
    return;
  }
  const databases = await Promise.all([
    readPostgresDatabase("quant", quantPool),
    readPostgresDatabase("market", marketPool),
  ]);
  const payload = { databases };
  postgresCache.set("postgres", payload);
  res.json(payload);
});

// ─── DuckDB itself ───────────────────────────────────────────────────────────

router.get("/stores/duckdb", queryRateLimiter, async (_req: Request, res: Response) => {
  try {
    const [version, extensions, settings] = await Promise.all([
      queryLake<{ version: string }>("SELECT version() AS version"),
      queryLake<{ extension_name: string; loaded: boolean; installed: boolean; description: string }>(
        "SELECT extension_name, loaded, installed, description FROM duckdb_extensions() ORDER BY extension_name",
      ),
      queryLake<{ name: string; value: string; description: string }>(
        "SELECT name, value, description FROM duckdb_settings() WHERE name IN " +
          "('memory_limit','threads','temp_directory','max_memory','s3_endpoint','s3_use_ssl','enable_http_metadata_cache')",
      ),
    ]);
    res.json({
      version: version[0]?.version ?? "unknown",
      extensions: extensions.map((e) => ({
        name: e.extension_name,
        loaded: Boolean(e.loaded),
        installed: Boolean(e.installed),
        description: e.description ?? "",
      })),
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
