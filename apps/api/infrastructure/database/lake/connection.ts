/**
 * The serving layer that replaced lake.
 *
 * lake was emptied and retired on 2026-09-10 â€” all 41 objects dropped after
 * every one was copied to parquet in the lake and row-count verified. It holds
 * zero tables and nothing may read or write it again. This module is what the
 * dashboard reads instead: an in-process DuckDB with one view per former
 * lake table, named exactly as it was named there, so a query that used to
 * run against :9000 runs here unchanged.
 *
 * It is the TypeScript mirror of `lake/serving.py` in the datalake repo â€” same
 * snapshot, same view names, same `SELECT * EXCLUDE (recipe, "table")`, same
 * `bars` view over the Iceberg system of record. The two must not drift.
 *
 * Three things are load-bearing.
 *
 * **In memory, one instance per process.** The views hold no data â€” they are
 * pointers at parquet in the lake â€” so the catalog costs milliseconds to build
 * and nothing is contended. A shared database file would make two consumers
 * fight over a write lock they have no reason to share.
 *
 * **The old names point at the SNAPSHOT, not at `market.bars`.** `ohlcv` is the
 * 863,323,657 rows lake held; `bars` is the 785,766,203 rows under the
 * Iceberg contract. A consumer that wants what it always had gets `ohlcv`; one
 * ready to move gets `bars`, and the difference stays visible.
 *
 * **lake SQL that is not ANSI fails here, loudly.** `SAMPLE BY`, `LATEST ON`
 * and lake's `ASOF JOIN` spelling raise a DuckDB parser error rather than
 * silently returning different rows. Every such query in this repo has been
 * translated; a new one that slips in will stop rather than drift.
 *
 * The exported surface is unchanged from the lake era on purpose â€” thirty
 * modules import through `./index`, and none of them needed editing for the
 * backend swap. The names still say "lake"; a later pass handles renaming.
 */

import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import crypto from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { logInfo } from "../../lib/log";
import { lakeCredentials } from "../../lake/credentials";
import { defineDerivedViews, derivedViews, servedRecipes, type DerivedView } from "./derivedDatasets";
import { buildObjectRegistry } from "./objectRegistry";

export { derivedViews, servedRecipes };

// â”€â”€â”€ Lake configuration (mirrors datalake/src/lake/catalog.py) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** AIStor serves both the S3 API and the Iceberg REST catalog on one port. */
const LAKE_S3_ENDPOINT = process.env.LAKE_S3_ENDPOINT || "http://127.0.0.1:9100";
const LAKE_CATALOG_URI = process.env.LAKE_CATALOG_URI || `${LAKE_S3_ENDPOINT}/_iceberg`;
const LAKE_WAREHOUSE = process.env.LAKE_WAREHOUSE || "lakehouse";
const LAKE_NAMESPACE = process.env.LAKE_NAMESPACE || "market";
const LAKE_REGION = process.env.LAKE_REGION || "us-east-1";
/** AIStor signs catalog requests with SigV4 under this signing name. */
const LAKE_SIGNING_NAME = "s3tables";

/**
 * The snapshot every former lake table was written to before the drop.
 * Pinned by date on purpose: a later export is a different dataset, and a view
 * silently re-pointed at one would change results under a caller that changed
 * nothing.
 *
 * The pinned name is a rename that was applied to this code and to the docs and
 * never to the objects. The directory on disk is still
 * `recipe=snapshot_full_2026-09-09` (verified against `E:\lake\warehouse\derived`),
 * so the pinned name is tried first and the on-disk name is the fallback, and
 * whichever one resolves is logged and exported. Pin it either way with
 * `LAKE_SERVING_SNAPSHOT`; renaming the objects is the other fix and is
 * datalake's to do.
 */
const SERVING_SNAPSHOT =
  process.env.LAKE_SERVING_SNAPSHOT || "derived/recipe=lake_snapshot_2026-09-09";

/** The snapshot as it is actually named in the lake. */
const SERVING_SNAPSHOT_ON_DISK = "derived/recipe=snapshot_full_2026-09-09";

/** The snapshot this process actually bound to; set once, by `buildInstance`. */
let activeSnapshot = SERVING_SNAPSHOT;

/** The snapshot the serving views were defined over, for messages and health. */
export function servingSnapshot(): string {
  return activeSnapshot;
}

// â”€â”€â”€ Legacy lake env constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Still exported because `index.ts` re-exports them and callers outside this
// directory read them. They no longer address a running service â€” lake is
// retired â€” and nothing in this module dials them.

export const lake_HOST = process.env.lake_HOST || "localhost";
export const lake_PG_PORT = process.env.lake_PG_PORT || "8812";
export const lake_HTTP_PORT = process.env.lake_HTTP_PORT || "9000";
export const lake_USER = process.env.lake_USER || "admin";
export const lake_PASSWORD = process.env.lake_PASSWORD || "quest";

const SLOW_QUERY_THRESHOLD_MS = 1000;

/**
 * Every write path in this module raises this. The dashboard reads the lake and
 * never writes to it; landing data is datalake's job, through
 * `scripts/land_raw.py` and `scripts/migrate_to_iceberg.py`.
 */
function retiredWriteMessage(): string {
  return (
    "lake was retired on 2026-09-10 and this server is read-only over the lake â€” " +
    "nothing writes to the lake from ml_dashboard. Land new data through datalake " +
    "(scripts/land_raw.py, then scripts/migrate_to_iceberg.py). Restore path if lake " +
    "is ever needed again: s3://meta/lake_schema/lake_schema_latest.sql plus the " +
    `parquet at s3://${activeSnapshot}/.`
  );
}

function retiredWrite(operation: string): never {
  throw new Error(`[lake] ${operation} is not available. ${retiredWriteMessage()}`);
}

// â”€â”€â”€ Iceberg catalog resolution (SigV4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const sha256Hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: crypto.BinaryLike | Buffer, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest();

/**
 * Sign a catalog request the way PyIceberg's `rest.sigv4-enabled` does.
 *
 * AIStor will not accept an unsigned catalog call and answers
 * `AUTHORIZATION_TYPE 'none'` with a 403, so there is no unauthenticated path.
 * Signing name is `s3tables`, not `s3` â€” a mismatch reads as a signature
 * failure rather than as a configuration error.
 */
function signedCatalogHeaders(method: string, urlString: string): Record<string, string> {
  const url = new URL(urlString);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const canonicalHeaders =
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalQuery = [...url.searchParams.entries()]
    .sort()
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${LAKE_REGION}/${LAKE_SIGNING_NAME}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${lakeCredentials().secretKey}`, date), LAKE_REGION), LAKE_SIGNING_NAME),
    "aws4_request",
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${lakeCredentials().accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Current metadata location for one Iceberg table.
 *
 * Resolved rather than cached at import time so a scan always sees the latest
 * committed snapshot. DuckDB cannot ATTACH this catalog directly â€” its Iceberg
 * SigV4 path parses the AWS service out of the hostname and fails on a custom
 * host with "Could not parse AWS service from host" â€” so the way through is to
 * resolve here and hand `iceberg_scan` the metadata file.
 */
async function resolveIcebergMetadataLocation(table: string): Promise<string> {
  const configUrl = `${LAKE_CATALOG_URI}/v1/config?warehouse=${encodeURIComponent(LAKE_WAREHOUSE)}`;
  const configResp = await fetch(configUrl, { headers: signedCatalogHeaders("GET", configUrl) });
  if (!configResp.ok) {
    throw new Error(`Iceberg catalog config failed (${configResp.status})`);
  }
  const config = (await configResp.json()) as {
    defaults?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  // AIStor routes every table call under a prefix it hands back from /v1/config;
  // without it the request 400s as "an unsupported API call".
  const prefix = config.overrides?.prefix ?? config.defaults?.prefix ?? LAKE_WAREHOUSE;
  const tableUrl =
    `${LAKE_CATALOG_URI}/v1/${encodeURIComponent(prefix)}` +
    `/namespaces/${encodeURIComponent(LAKE_NAMESPACE)}/tables/${encodeURIComponent(table)}`;
  const tableResp = await fetch(tableUrl, { headers: signedCatalogHeaders("GET", tableUrl) });
  if (!tableResp.ok) {
    throw new Error(`Iceberg table ${LAKE_NAMESPACE}.${table} lookup failed (${tableResp.status})`);
  }
  const body = (await tableResp.json()) as { "metadata-location"?: string };
  const location = body["metadata-location"];
  if (!location) {
    throw new Error(`Iceberg table ${LAKE_NAMESPACE}.${table} returned no metadata-location`);
  }
  return location;
}

/**
 * The Iceberg catalog's own answer for one table: schema, partition spec,
 * snapshot log, properties. This is the system of record describing itself â€”
 * DuckDB's iceberg_* functions cannot reach it here (they resolve a path, and
 * this catalog is only addressable over its signed REST API).
 */
export async function fetchIcebergTable(table: string): Promise<Record<string, unknown>> {
  const configUrl = `${LAKE_CATALOG_URI}/v1/config?warehouse=${encodeURIComponent(LAKE_WAREHOUSE)}`;
  const configResp = await fetch(configUrl, { headers: signedCatalogHeaders("GET", configUrl) });
  if (!configResp.ok) throw new Error(`Iceberg catalog config failed (${configResp.status})`);
  const config = (await configResp.json()) as { defaults?: Record<string, string>; overrides?: Record<string, string> };
  const prefix = config.overrides?.prefix ?? config.defaults?.prefix ?? LAKE_WAREHOUSE;
  const tableUrl =
    `${LAKE_CATALOG_URI}/v1/${encodeURIComponent(prefix)}` +
    `/namespaces/${encodeURIComponent(LAKE_NAMESPACE)}/tables/${encodeURIComponent(table)}`;
  const resp = await fetch(tableUrl, { headers: signedCatalogHeaders("GET", tableUrl) });
  if (!resp.ok) throw new Error(`Iceberg table ${LAKE_NAMESPACE}.${table} lookup failed (${resp.status})`);
  return (await resp.json()) as Record<string, unknown>;
}

/** Every table the catalog holds in the configured namespace. */
export async function listIcebergTables(): Promise<string[]> {
  const configUrl = `${LAKE_CATALOG_URI}/v1/config?warehouse=${encodeURIComponent(LAKE_WAREHOUSE)}`;
  const configResp = await fetch(configUrl, { headers: signedCatalogHeaders("GET", configUrl) });
  if (!configResp.ok) throw new Error(`Iceberg catalog config failed (${configResp.status})`);
  const config = (await configResp.json()) as { defaults?: Record<string, string>; overrides?: Record<string, string> };
  const prefix = config.overrides?.prefix ?? config.defaults?.prefix ?? LAKE_WAREHOUSE;
  const listUrl =
    `${LAKE_CATALOG_URI}/v1/${encodeURIComponent(prefix)}/namespaces/${encodeURIComponent(LAKE_NAMESPACE)}/tables`;
  const resp = await fetch(listUrl, { headers: signedCatalogHeaders("GET", listUrl) });
  if (!resp.ok) throw new Error(`Iceberg table list failed (${resp.status})`);
  const body = (await resp.json()) as { identifiers?: Array<{ name: string }> };
  return (body.identifiers ?? []).map((i) => i.name);
}

// â”€â”€â”€ DuckDB instance and view catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let instance: DuckDBInstance | null = null;
let instancePromise: Promise<DuckDBInstance> | null = null;
const connectionPool: DuckDBConnection[] = [];
const MAX_POOL_SIZE = 4;
/** View names discovered in the snapshot, for health reporting and introspection. */
let servingViewNames: string[] = [];

/**
 * Every table name in the snapshot, discovered rather than listed.
 *
 * Discovered because a hard-coded list would quietly stop covering a table
 * someone added, and through DuckDB's own `glob` because DuckDB is already
 * authenticated against the object store on this connection.
 */
async function snapshotTableNames(con: DuckDBConnection, snapshot: string): Promise<string[]> {
  const reader = await con.runAndReadAll(
    "SELECT DISTINCT regexp_extract(file, 'table=([^/\\\\]+)', 1) AS table_name " +
      `FROM glob('s3://${snapshot}/table=*/**/*.parquet') ` +
      "WHERE table_name <> '' ORDER BY table_name",
  );
  return reader.getRowObjectsJS().map((row) => String(row.table_name));
}

/**
 * Bind the snapshot: the pinned name, or the one the objects are actually under.
 *
 * A renamed dataset is a renamed dataset, not a missing one, so an empty glob on
 * the pinned name is answered by trying the on-disk name rather than by an empty
 * dashboard. The name that resolved is logged, and every view, message and health
 * line reports it, so nothing downstream is left believing the other name.
 */
async function bindSnapshot(con: DuckDBConnection): Promise<string[]> {
  const names = await snapshotTableNames(con, SERVING_SNAPSHOT);
  if (names.length > 0) {
    activeSnapshot = SERVING_SNAPSHOT;
    return names;
  }
  if (SERVING_SNAPSHOT === SERVING_SNAPSHOT_ON_DISK) {
    return names;
  }
  const fallback = await snapshotTableNames(con, SERVING_SNAPSHOT_ON_DISK);
  if (fallback.length === 0) {
    return names;
  }
  activeSnapshot = SERVING_SNAPSHOT_ON_DISK;
  logInfo(
    `[lake] s3://${SERVING_SNAPSHOT}/ holds no objects; bound to ` +
      `s3://${activeSnapshot}/ instead (${fallback.length} views). Set ` +
      "LAKE_SERVING_SNAPSHOT to pin it, or rename the objects in the lake.",
  );
  return fallback;
}

async function buildInstance(): Promise<DuckDBInstance> {
  const started = performance.now();
  const created = await DuckDBInstance.create(":memory:");
  const con = await created.connect();
  try {
    // Every timestamp in the lake is stored UTC, so every connection reading it
    // has to say so. DuckDB otherwise renders TIMESTAMPTZ in the machine's local
    // zone, which silently shifts hour-of-day by the host offset and nothing
    // complains.
    await con.run("SET TimeZone='UTC'");
      await con.run("SET threads = 4");
      await con.run("SET memory_limit = '8GB'");
    // vss carries HNSW, which the Lens vector-space panel searches for a bar's
    // nearest neighbours in the full feature space. It loads at the INSTANCE
    // level, so it has to be here rather than in that router â€” a second
    // DuckDBInstance would not see the snapshot views this one defines.
    // The instance is :memory:, so hnsw_enable_experimental_persistence is not
    // needed; an HNSW index on a file-backed database would require it.
    for (const extension of ["iceberg", "httpfs", "vss"]) {
      await con.run(`INSTALL ${extension}`);
      await con.run(`LOAD ${extension}`);
    }
    const host = LAKE_S3_ENDPOINT.replace(/^https?:\/\//, "");
    const { accessKey, secretKey } = lakeCredentials();
    await con.run(
      `CREATE OR REPLACE SECRET aistor_s3 (
         TYPE s3, KEY_ID '${accessKey}', SECRET '${secretKey}',
         ENDPOINT '${host}', URL_STYLE 'path',
         USE_SSL ${LAKE_S3_ENDPOINT.startsWith("https") ? "true" : "false"},
         REGION '${LAKE_REGION}'
       )`,
    );

    const names = await bindSnapshot(con);
    if (names.length === 0) {
      throw new Error(
        `Lake serving snapshot s3://${activeSnapshot}/ is empty or unreachable â€” ` +
          "no views could be defined.",
      );
    }
    for (const name of names) {
      // SELECT * EXCLUDE, not SELECT *. The export is hive-partitioned by
      // recipe= / table= / year=, so read_parquet hands those path segments back
      // as columns lake never had. Two are actively hostile: `table` is a
      // DuckDB reserved word, so any generated query naming every column â€” a
      // discovered SELECT list, a resample â€” is a parser error rather than a
      // wrong answer. Dropping them makes each view the shape its original was.
      await con.run(
        `CREATE OR REPLACE VIEW "${name}" AS ` +
          'SELECT * EXCLUDE (recipe, "table") FROM read_parquet(' +
          `'s3://${activeSnapshot}/table=${name}/**/*.parquet')`,
      );
    }
servingViewNames = names;
    const snapshotNames = names;

    // `bars` is the Iceberg system of record and where a consumer should end up.
    // Best-effort: a catalog that is down must not take the snapshot views with
    // it, and a query against a missing `bars` raises "table does not exist",
    // which is loud enough to diagnose.
    let icebergViewNames: string[] = [];
    try {
      const metadataLocation = await resolveIcebergMetadataLocation("bars");
      await con.run(
        `CREATE OR REPLACE VIEW bars AS SELECT * FROM iceberg_scan('${metadataLocation}')`,
      );
      icebergViewNames = ["bars"];
      servingViewNames = [...names, ...icebergViewNames].sort();
    } catch (error) {
      console.warn(
        "[lake] Iceberg view 'bars' not defined:",
        (error as Error).message,
        "â€” the snapshot views are unaffected.",
      );
    }

    // Every manifested derived dataset (`derived/<dataset>/recipe=â€¦/`) becomes a
    // `derived_<dataset>` view â€” labels, calibration records, landed studies â€”
// so a landing is queryable from the SQL console the moment it is manifested.
    // Best-effort for the same reason as `bars`.
    let definedDerived: DerivedView[] = [];
    try {
      definedDerived = await defineDerivedViews(con);
      servingViewNames = [...servingViewNames, ...definedDerived.map((view) => view.viewName)].sort();
    } catch (error) {
      console.warn("[lake] derived-dataset views not defined:", (error as Error).message);
    }

    // The registry is built here, once, from what actually got defined â€” so it
    // never names an object the serving layer failed to create.
    buildObjectRegistry({
      snapshotViews: snapshotNames,
      derivedViews: definedDerived,
      icebergViews: icebergViewNames,
    });

    logInfo(
      `[lake] DuckDB serving layer ready in ${(performance.now() - started).toFixed(0)}ms ` +
        `(${servingViewNames.length} views over s3://${activeSnapshot}/)`,
    );
  } finally { releaseConnection(con, false); }
  return created;
}

/**
 * Re-read the manifests and redefine the derived-dataset views on the live
 * instance. Called after a landing so `derived_<dataset>` serves the new recipe
 * without a restart; views live in the instance catalog, so every later
 * connection sees the new definitions.
 */
export async function refreshDerivedViews(): Promise<string[]> {
  const con = await (await getInstance()).connect();
  try {
    await con.run("SET TimeZone='UTC'");
      await con.run("SET threads = 4");
      await con.run("SET memory_limit = '8GB'");
const defined = await defineDerivedViews(con);
    // `derived_` is a name *prefix*, not an identity: a snapshot table is
    // whatever the serving layer exposed before the derived views were added,
    // so it is recovered by exclusion and handed to the registry as such.
    const derivedNames = new Set(defined.map((view) => view.viewName));
    const snapshotNames = servingViewNames.filter((name) => !derivedNames.has(name));
    servingViewNames = [...snapshotNames, ...defined.map((view) => view.viewName)].sort();
    buildObjectRegistry({
      snapshotViews: snapshotNames.filter((name) => name !== "bars"),
      derivedViews: defined,
      icebergViews: snapshotNames.includes("bars") ? ["bars"] : [],
    });
    return defined.map((view) => view.viewName);
  } finally { con.closeSync(); }
}

/**
 * The process-wide DuckDB instance, built once.
 *
 * A failed build is not cached: the lake being down at boot must not poison
 * every later query, so the next call retries from scratch.
 */
async function getInstance(): Promise<DuckDBInstance> {
  if (instance) return instance;
  if (!instancePromise) {
    instancePromise = buildInstance()
      .then((built) => {
        instance = built;
        return built;
      })
      .catch((error) => {
        instancePromise = null;
        throw error;
      });
  }
  return instancePromise;
}

/**
 * A fresh connection onto the shared instance.
 *
 * Per query, not pooled: views live in the instance catalog so every connection
 * sees them, connections are cheap, and `interrupt()` is per-connection â€” a
 * shared one would let a timed-out query cancel its neighbours.
 */
async function openConnection(): Promise<DuckDBConnection> {
  if (connectionPool.length > 0) {
    return connectionPool.pop()!;
  }
  const con = await (await getInstance()).connect();
  // Session-scoped, so it has to be re-stated on each connection.
  await con.run("SET TimeZone='UTC'");
      await con.run("SET threads = 4");
      await con.run("SET memory_limit = '8GB'");
  // Session-scoped too, and measured to revert to their defaults on every
  // fresh connection â€” so setting them once at instance build did nothing for
  // the queries that matter. parquet_metadata_cache stops DuckDB re-reading a
  // parquet footer per sub-select (worth 1.15-1.4x on the multi-subselect
  // front-month union); preserve_insertion_order lets it skip keeping row
  // order it is about to sort anyway.
  await con.run('SET parquet_metadata_cache=true');
  await con.run('SET preserve_insertion_order=false');
  return con;
}

function releaseConnection(con: DuckDBConnection, interrupted: boolean = false) {
  if (interrupted) {
    // If the connection was interrupted, it might be in a bad state.
    // Close it and let the pool recreate a new one next time.
    try { con.closeSync(); } catch (e) {}
    return;
  }
  if (connectionPool.length < MAX_POOL_SIZE) {
    connectionPool.push(con);
  } else {
    try { con.closeSync(); } catch (e) {}
  }
}

// â”€â”€â”€ Value conversion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * DuckDB hands BIGINT back as a JS bigint, which breaks arithmetic against the
 * numbers every caller here expects (`Number(row.c)`, `a - b`) and throws on
 * `JSON.stringify`. Narrow to a number where that is lossless and fall back to
 * the decimal string â€” never to a silently truncated number â€” beyond 2^53.
 */
function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  return value;
}

function normalizeRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) out[key] = normalizeValue(row[key]);
    return out as T;
  });
}

// â”€â”€â”€ Read paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runQuery<T>(
  sql: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; label: string },
): Promise<T[]> {
  const start = performance.now();
  const con = await openConnection();

  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const onAbort = () => con.interrupt();
  try {
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        con.interrupt();
      }, opts.timeoutMs);
    }
    if (opts.signal) {
      if (opts.signal.aborted) con.interrupt();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    let reader;
    try {
      reader = await con.runAndReadAll(sql);
    } catch (error) {
      if (timedOut) {
        const preview = sql.length > 120 ? `${sql.slice(0, 120)}â€¦` : sql;
        console.warn(`[lake] QUERY TIMEOUT (${opts.timeoutMs}ms): ${preview}`);
        throw new Error(`Query timed out after ${opts.timeoutMs}ms`);
      }
      throw error;
    }

    const rows = normalizeRows<T>(reader.getRowObjectsJS());
    const durationMs = performance.now() - start;
    const preview = sql.length > 120 ? `${sql.slice(0, 120)}â€¦` : sql;
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(
        `[${opts.label}] SLOW QUERY (${durationMs.toFixed(0)}ms, ${rows.length} rows): ${preview}`,
      );
    } else if (process.env.lake_QUERY_LOG === "verbose") {
      logInfo(`[${opts.label}] query (${durationMs.toFixed(0)}ms, ${rows.length} rows): ${preview}`);
    }
    return rows;
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    con.closeSync();
  }
}

/**
 * Bulk reader. Once the backend is an in-process DuckDB there is no wire
 * protocol to bypass, so this and {@link queryLake} run the same path â€” the
 * name is kept because thirty modules import it.
 *
 * The lake-era version caught its own failures and silently re-ran the query
 * over PG wire. There is no second backend to fall back to now, and a fallback
 * that re-runs a broken query only doubles the cost, so errors propagate.
 */
export async function queryLakeFast<T = never>(sql: string, signal?: AbortSignal): Promise<T[]> {
  return runQuery<T>(sql, { signal, label: "lake-fast" });
}

export async function queryLake<T = never>(sql: string, timeoutMs?: number): Promise<T[]> {
  return runQuery<T>(sql, { timeoutMs, label: "lake" });
}

/**
 * Stream a large result set, handing the caller one chunk of rows at a time so
 * the whole set never lands in memory at once.
 *
 * DuckDB yields its own chunks (typically 2048 rows); they are re-packed to the
 * caller's `chunkSize` so the contract matches the cursor-based version this
 * replaced.
 */
export async function querylakeStream<T = never>(
  sql: string,
  onChunk: (rows: T[]) => void | Promise<void>,
  chunkSize = 5000,
): Promise<{ totalRows: number; durationMs: number }> {
  const start = performance.now();
  const con = await openConnection();
  let totalRows = 0;

  try {
    const result = await con.stream(sql);
    let buffer: T[] = [];
    for await (const rows of result.yieldRowObjectJs()) {
      buffer = buffer.concat(normalizeRows<T>(rows));
      while (buffer.length >= chunkSize) {
        const batch = buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize);
        totalRows += batch.length;
        await onChunk(batch);
      }
    }
    if (buffer.length > 0) {
      totalRows += buffer.length;
      await onChunk(buffer);
      }
    } finally { releaseConnection(con, false); }

  const durationMs = performance.now() - start;
  logInfo(`[lake] streamed ${totalRows} rows in ${durationMs.toFixed(0)}ms (${chunkSize}/chunk)`);
  return { totalRows, durationMs };
}

/**
 * Execute a query with Zod runtime validation on each row.
 * Slower than raw {@link queryLake}, but catches schema drift.
 */
export async function querylakeValidated<T>(sql: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows = await queryLake(sql);
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      console.warn(`[lake] Row ${i} validation failed: ${parsed.error.message}`);
      throw new Error(`Lake result validation failed at row ${i}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

/** Zod schema for OHLCV query results (coerces string numerics). */
export const LakeOHLCVRowSchema = z.object({
  symbol: z.string(),
  timestamp: z.coerce.date(),
  open: z.coerce.number(),
  high: z.coerce.number(),
  low: z.coerce.number(),
  close: z.coerce.number(),
  volume: z.coerce.number(),
});
export type ValidatedLakeOHLCVRow = z.infer<typeof LakeOHLCVRowSchema>;

export interface OHLCVRow {
  symbol: string;
  assetClass?: string;
  root?: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// â”€â”€â”€ Retired connection handles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Kept on the exported surface because `index.ts` re-exports them and
// `lake.service.ts` wraps them. There is no PG wire endpoint behind them any
// more, so they raise rather than hand back a pool that would hang on connect.


export async function closeLake(): Promise<void> {
  if (instance) {
    instance.closeSync();
    instance = null;
  }
  instancePromise = null;
  servingViewNames = [];
}

/**
 * Is the lake reachable and are the serving views defined?
 *
 * Not a bare `SELECT 1` â€” DuckDB is in-process and would always answer. Forcing
 * the instance to build exercises the object store, the snapshot glob and the
 * view definitions, which is the thing a caller actually wants to know.
 */
export async function checkLakeHealth(): Promise<boolean> {
  try {
    const con = await openConnection();
    try {
      const reader = await con.runAndReadAll(
        "SELECT count(*) AS n FROM duckdb_views() WHERE NOT internal AND schema_name = 'main'",
      );
      const views = Number(reader.getRowObjectsJS()[0]?.n ?? 0);
      if (views === 0) {
        console.warn("[lake] Health check failed: no serving views defined");
        return false;
      }
      return true;
      } finally { releaseConnection(con, false); }
  } catch (error) {
    console.warn(
      "[lake] Health check failed:",
      (error as Error).message,
      "at",
      `${LAKE_S3_ENDPOINT} (snapshot s3://${activeSnapshot}/)`,
    );
    return false;
  }
}

/** Names of every view the serving layer defines. Empty until first use. */
export function getServingViewNames(): string[] {
  return [...servingViewNames];
}

/** Where the serving layer reads from, for status reporting. */
export function getServingLocation(): { endpoint: string; snapshot: string; namespace: string } {
  return {
    endpoint: LAKE_S3_ENDPOINT,
    snapshot: `s3://${activeSnapshot}/`,
    namespace: LAKE_NAMESPACE,
  };
}








