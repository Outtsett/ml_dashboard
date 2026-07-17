# QuestDB Audit Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 15 QuestDB integration issues identified in the 2026-03-04 audit — 2 critical, 5 high, 6 medium, 2 low.

**Architecture:** All changes are in `src/server/database/questdb/` and `scripts/`. No frontend changes. No schema migrations needed (TTL and mat view changes are additive). Connection layer fixes (tasks 1-3) are the highest priority since they affect every write operation.

**Tech Stack:** QuestDB 9.3.1, @questdb/nodejs-client ^4.2.0, pg (PostgreSQL wire), TypeScript ESM

**Validation:** `npx tsc --noEmit` after each task, then `npm run build`. Test with `npx vitest run`.

---

### Task 1: Fix per-row flush and add auto_flush config [CRITICAL]

**Files:**
- Modify: `src/server/database/questdb/connection.ts:14-98`

**Context:** `getQuestDBSender()` creates a Sender singleton with no auto_flush settings. `insertOHLCVStream()` flushes after every single row — catastrophic for throughput. `insertOHLCVBatch()` awaits synchronous buffer calls unnecessarily.

**Step 1: Fix Sender config string to include auto_flush**

In `connection.ts`, change the `getQuestDBSender` function:

```typescript
export async function getQuestDBSender(): Promise<Sender> {
  if (!sender) {
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush_rows=1000;auto_flush_interval=1000;`;
    sender = await Sender.fromConfig(configStr);
  }
  return sender;
}
```

**Step 2: Fix `insertOHLCVBatch` — remove unnecessary await on buffer ops**

The `.table()`, `.symbol()`, `.floatColumn()`, `.at()` chain is synchronous buffer writing. Only `.flush()` needs await:

```typescript
export async function insertOHLCVBatch(rows: OHLCVRow[]): Promise<void> {
  const sender = await getQuestDBSender();

  for (const row of rows) {
    sender
      .table("ohlcv")
      .symbol("symbol", row.symbol)
      .floatColumn("open", row.open)
      .floatColumn("high", row.high)
      .floatColumn("low", row.low)
      .floatColumn("close", row.close)
      .floatColumn("volume", row.volume)
      .at(row.timestamp.getTime(), "ms");
  }

  await sender.flush();
}
```

**Step 3: Fix `insertOHLCVStream` — remove per-row flush**

The auto_flush settings now handle flushing. Remove the explicit flush:

```typescript
export async function insertOHLCVStream(
  symbol: string,
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): Promise<void> {
  const sender = await getQuestDBSender();

  sender
    .table("ohlcv")
    .symbol("symbol", symbol)
    .floatColumn("open", open)
    .floatColumn("high", high)
    .floatColumn("low", low)
    .floatColumn("close", close)
    .floatColumn("volume", volume)
    .at(timestamp, "ms");
  // auto_flush_rows=1000 and auto_flush_interval=1000ms handle flushing
}
```

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```
fix(questdb): add auto_flush config, remove per-row flush, drop unnecessary await on buffer ops
```

---

### Task 2: Use LATEST ON for distinct symbol listing [HIGH]

**Files:**
- Modify: `src/server/database/questdb/marketData.ts:339-343`

**Context:** `getSymbolsInQuestDB()` runs `SELECT DISTINCT symbol FROM ohlcv` which scans all 759.5M rows. `LATEST ON` with a single SYMBOL INDEX column terminates early once all distinct values are found.

**Step 1: Replace DISTINCT with LATEST ON**

```typescript
export async function getSymbolsInQuestDB(): Promise<string[]> {
  const sql = `SELECT symbol FROM ohlcv LATEST ON timestamp PARTITION BY symbol`;
  const result = await queryQuestDB<{ symbol: string }>(sql);
  return result.map(r => r.symbol);
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
perf(questdb): use LATEST ON for distinct symbol listing instead of full table scan
```

---

### Task 3: Use interval scan syntax in OHLCV queries [HIGH]

**Files:**
- Modify: `src/server/database/questdb/marketData.ts:42-106`

**Context:** Current WHERE uses `timestamp >= '...' AND timestamp <= '...'` which may not trigger QuestDB's interval scan optimizer. Using `timestamp IN interval(start, end)` enables binary search + partition pruning.

**Step 1: Refactor `getOHLCVSampleBy` WHERE clause builder**

Replace the timestamp comparison logic (lines 55-61):

```typescript
  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  let whereClause = `WHERE symbol = '${escapedSymbol}'`;
  if (safeStartTime && safeEndTime) {
    whereClause += ` AND timestamp IN interval('${new Date(safeStartTime).toISOString()}', '${new Date(safeEndTime).toISOString()}')`;
  } else if (safeStartTime) {
    whereClause += ` AND timestamp >= '${new Date(safeStartTime).toISOString()}'`;
  } else if (safeEndTime) {
    whereClause += ` AND timestamp <= '${new Date(safeEndTime).toISOString()}'`;
  }
```

**Step 2: Apply same pattern to `getFrontMonthRanges`** (lines 127-137)

Replace:
```typescript
    let timeFilter = '';
    if (startTime) {
      const dayStart = new Date(startTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      timeFilter += ` AND timestamp >= '${dayStart.toISOString()}'`;
    }
    if (endTime) {
      const dayEnd = new Date(endTime);
      dayEnd.setUTCHours(23, 59, 59, 999);
      timeFilter += ` AND timestamp <= '${dayEnd.toISOString()}'`;
    }
```

With:
```typescript
    let timeFilter = '';
    if (startTime && endTime) {
      const dayStart = new Date(startTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(endTime);
      dayEnd.setUTCHours(23, 59, 59, 999);
      timeFilter = ` AND timestamp IN interval('${dayStart.toISOString()}', '${dayEnd.toISOString()}')`;
    } else if (startTime) {
      const dayStart = new Date(startTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      timeFilter = ` AND timestamp >= '${dayStart.toISOString()}'`;
    } else if (endTime) {
      const dayEnd = new Date(endTime);
      dayEnd.setUTCHours(23, 59, 59, 999);
      timeFilter = ` AND timestamp <= '${dayEnd.toISOString()}'`;
    }
```

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```
perf(questdb): use interval() scan syntax for timestamp range queries
```

---

### Task 4: Replace N+1 stats queries with table_storage() [HIGH]

**Files:**
- Modify: `src/server/database/questdb/introspection.ts:62-98`

**Context:** `getQuestDBStats()` runs `getQuestDBTableRowCount()` + `getQuestDBPartitions()` per table. `table_storage()` returns everything in one query.

**Step 1: Rewrite `getQuestDBStats`**

```typescript
export async function getQuestDBStats(): Promise<any> {
  try {
    const storage = await queryQuestDB<{
      tablename: string;
      walenabled: boolean;
      partitionby: string;
      partitioncount: number;
      rowcount: string;
      disksize: string;
    }>(`SELECT tableName, walEnabled, partitionBy, partitionCount, rowCount, diskSize FROM table_storage()`);

    return {
      connected: true,
      tables: storage.length,
      tableDetails: storage.map(t => ({
        name: t.tablename,
        rowCount: parseInt(t.rowcount) || 0,
        partitionCount: t.partitioncount,
        walEnabled: t.walenabled,
        partitionBy: t.partitionby,
        diskSize: parseInt(t.disksize) || 0,
      })),
    };
  } catch (error) {
    return {
      connected: false,
      error: String(error),
    };
  }
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
perf(questdb): replace N+1 stats queries with single table_storage() call
```

---

### Task 5: Add TTL to table schemas [HIGH]

**Files:**
- Modify: `src/server/database/questdb/tables.ts`

**Context:** No TTL on any table. MBP10 (408.8M rows) and trades (12.9M rows) grow unbounded. OHLCV needs long retention for historical charts but MBP10/trades are transient.

**Step 1: Add TTL to CREATE TABLE statements**

For `createTradesTable`:
```sql
) timestamp(ts_event) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(symbol, ts_event, sequence)
TTL 365 DAYS;
```

For `createMBP10Table`:
```sql
) timestamp(ts_event) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(symbol, ts_event, sequence)
TTL 180 DAYS;
```

Leave `ohlcv` without TTL (historical chart data needs indefinite retention).

**Step 2: Add TTL to existing tables (one-time migration)**

Add a function to apply TTL to existing tables:

```typescript
export async function applyTableTTL(): Promise<void> {
  try {
    await queryQuestDB(`ALTER TABLE trades SET TTL 365 DAYS`);
    await queryQuestDB(`ALTER TABLE mbp10 SET TTL 180 DAYS`);
  } catch (err: any) {
    // Tables may not exist yet — safe to ignore
    console.warn('[questdb] TTL apply warning:', err.message);
  }
}
```

Export from `tables.ts` and call from `initQuestDBTables`:

```typescript
export async function initQuestDBTables(): Promise<void> {
  await createOHLCVTable();
  await createTradesTable();
  await createMBP10Table();
  await applyTableTTL();
}
```

**Step 3: Verify + commit**

```
feat(questdb): add TTL to trades (365d) and mbp10 (180d) tables
```

---

### Task 6: Fix weekly timeframe and add FILL to chart queries [MEDIUM]

**Files:**
- Modify: `src/server/database/questdb/marketData.ts:80-103`

**Context:** `1w` uses `SAMPLE BY 7d` which doesn't align to ISO week boundaries. QuestDB supports `SAMPLE BY 1w` natively. Also chart queries have no FILL clause, so empty buckets are silently omitted.

**Step 1: Fix validTimeframes map**

In `getOHLCVSampleBy` (and the duplicates in `getFrontMonthOHLCV` and `getStitchedOHLCV`), change:

```typescript
  const validTimeframes: Record<string, string> = {
    "1m": "SAMPLE BY 1m", "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m", "30m": "SAMPLE BY 30m",
    "1h": "SAMPLE BY 1h", "4h": "SAMPLE BY 4h",
    "1d": "SAMPLE BY 1d", "1w": "SAMPLE BY 1w",
  };
```

**Step 2: Add FILL(NULL) to SAMPLE BY fallback queries**

In `getOHLCVSampleBy` SQL (line 89-103), add FILL(NULL):

```typescript
  const sql = `
    SELECT
      symbol,
      timestamp,
      first(open) as open,
      max(high) as high,
      min(low) as low,
      last(close) as close,
      sum(volume) as volume
    FROM ohlcv
    ${whereClause}
    ${sampleByClause}
    FILL(NULL)
    ALIGN TO CALENDAR
    ${limitClause}
  `;
```

Apply the same to the SAMPLE BY queries in `getFrontMonthOHLCV` (line 208-214) and `getStitchedOHLCV` (line 300-305).

**Step 3: Verify + commit**

```
fix(questdb): use SAMPLE BY 1w for weekly, add FILL(NULL) to chart queries
```

---

### Task 7: Increase statement_timeout and fix symbol sanitization [MEDIUM]

**Files:**
- Modify: `src/server/database/questdb/connection.ts:33`
- Modify: `src/server/database/questdb/integration.ts:154`

**Step 1: Increase statement_timeout**

```typescript
statement_timeout: 120000,  // 120 seconds — large SAMPLE BY queries can exceed 30s
```

**Step 2: Fix symbol sanitization in `getQuestDBRowCount`**

Replace the ad-hoc sanitization (line 154):

```typescript
import { validateSymbol } from "@shared/schema";
```

Then in `getQuestDBRowCount`:

```typescript
export async function getQuestDBRowCount(symbol: string): Promise<number> {
  if (!config.enableQuestDB) return 0;

  try {
    const safeSymbol = validateSymbol(symbol);
    const escapedSymbol = safeSymbol.replace(/'/g, "''");
    const { queryQuestDB } = await import(".");
    const result = await questdbCircuit.execute(async () => {
      const sql = `SELECT count() as cnt FROM ohlcv WHERE symbol = '${escapedSymbol}'`;
      return queryQuestDB(sql);
    });
    return result[0]?.cnt || 0;
  } catch (error) {
    console.warn(`[QuestDB] Failed to get row count for ${symbol}:`, error);
    return 0;
  }
}
```

**Step 3: Verify + commit**

```
fix(questdb): increase statement_timeout to 120s, standardize symbol validation
```

---

### Task 8: Rebuild materialized views with PARTITION BY, TTL, and 1w fix [MEDIUM]

**Files:**
- Modify: `scripts/_create-mat-views.cjs` → Rename to `scripts/create-mat-views.ts`

**Context:** Views lack PARTITION BY and TTL. The script is CommonJS in an ESM project. Weekly uses `7d` instead of `1w`.

**Step 1: Create `scripts/create-mat-views.ts` (ESM + TypeScript)**

```typescript
/**
 * Create materialized views in QuestDB for common chart timeframes.
 * Run: npx tsx scripts/create-mat-views.ts
 */

const QUESTDB_URL = `http://${process.env.QUESTDB_HOST || "localhost"}:${process.env.QUESTDB_HTTP_PORT || "9000"}`;

async function questdbExec(sql: string): Promise<any> {
  const url = `${QUESTDB_URL}/exec?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`QuestDB exec failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

const TIMEFRAMES = [
  { label: "5m",  sample: "5m",  partition: "MONTH", ttl: "2 YEARS" },
  { label: "15m", sample: "15m", partition: "MONTH", ttl: "2 YEARS" },
  { label: "30m", sample: "30m", partition: "MONTH", ttl: "2 YEARS" },
  { label: "1h",  sample: "1h",  partition: "MONTH", ttl: "3 YEARS" },
  { label: "4h",  sample: "4h",  partition: "YEAR",  ttl: "5 YEARS" },
  { label: "1d",  sample: "1d",  partition: "YEAR",  ttl: "10 YEARS" },
  { label: "1w",  sample: "1w",  partition: "YEAR",  ttl: "10 YEARS" },
];

async function main(): Promise<void> {
  console.log("Creating materialized views for OHLCV timeframes...\n");

  for (const tf of TIMEFRAMES) {
    const viewName = `ohlcv_${tf.label}`;

    try {
      await questdbExec(`DROP MATERIALIZED VIEW IF EXISTS ${viewName}`);
      console.log(`[${viewName}] Dropped existing view`);
    } catch { /* may not exist */ }

    await new Promise(r => setTimeout(r, 1000));

    const sql = `CREATE MATERIALIZED VIEW ${viewName} AS (
      SELECT timestamp, symbol,
        first(open) as open,
        max(high) as high,
        min(low) as low,
        last(close) as close,
        sum(volume) as volume
      FROM ohlcv
      SAMPLE BY ${tf.sample} ALIGN TO CALENDAR
    ) PARTITION BY ${tf.partition} TTL ${tf.ttl}`;

    try {
      await questdbExec(sql);
      console.log(`[${viewName}] Created (SAMPLE BY ${tf.sample}, PARTITION BY ${tf.partition}, TTL ${tf.ttl})`);
    } catch (e: any) {
      console.error(`[${viewName}] ERROR:`, e.message.substring(0, 200));
    }
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    const check = await questdbExec("SELECT count() as cnt FROM ohlcv_1h");
    console.log(`\nohlcv_1h row count: ${Number(check.dataset[0][0]).toLocaleString()}`);
  } catch (e: any) {
    console.error("Could not check ohlcv_1h:", e.message);
  }

  console.log("\nDone.");
}

main().catch(console.error);
```

**Step 2: Delete old CJS file**

Delete `scripts/_create-mat-views.cjs`.

**Step 3: Verify + commit**

```
refactor(questdb): rewrite mat view script as TypeScript, add PARTITION BY + TTL, fix 7d->1w
```

---

### Task 9: Add dual-protocol health check [LOW]

**Files:**
- Modify: `src/server/database/questdb/connection.ts:111-124`

**Context:** `checkQuestDBHealth` only tests PG wire, but the app also depends on HTTP for ILP ingestion. If HTTP is down, writes fail silently.

**Step 1: Add HTTP health check and combine**

```typescript
export async function checkQuestDBHealth(): Promise<boolean> {
  try {
    const pool = getQuestDBQueryPool();
    await Promise.race([
      pool.query("SELECT 1;"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return true;
  } catch (error: any) {
    console.warn("[questdb] Health check failed:", error.message);
    return false;
  }
}

export async function checkQuestDBFullHealth(): Promise<{ pg: boolean; http: boolean }> {
  const pgHealthy = await checkQuestDBHealth();
  let httpHealthy = false;
  try {
    const resp = await fetch(`http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}/exec?query=${encodeURIComponent("SELECT 1")}`);
    httpHealthy = resp.ok;
  } catch { /* not reachable */ }
  return { pg: pgHealthy, http: httpHealthy };
}
```

Export `checkQuestDBFullHealth` from `index.ts`.

**Step 2: Verify + commit**

```
feat(questdb): add dual-protocol health check (PG wire + HTTP)
```

---

### Task 10: Add EXPLAIN helper for query debugging [MEDIUM]

**Files:**
- Modify: `src/server/database/questdb/connection.ts`

**Step 1: Add explainQuery function**

```typescript
export async function explainQuery(sql: string): Promise<string[]> {
  const pool = getQuestDBQueryPool();
  const result = await pool.query(`EXPLAIN ${sql}`);
  return result.rows.map((r: any) => r.QUERY_PLAN || r["QUERY PLAN"] || JSON.stringify(r));
}
```

Export from `index.ts`.

**Step 2: Verify + commit**

```
feat(questdb): add EXPLAIN query helper for debugging
```

---

## Execution Order

1. **Task 1** — Critical: flush + auto_flush + await fixes (connection.ts)
2. **Task 2** — High: LATEST ON for symbols (marketData.ts)
3. **Task 3** — High: interval scan syntax (marketData.ts)
4. **Task 4** — High: table_storage() consolidation (introspection.ts)
5. **Task 5** — High: TTL on tables (tables.ts)
6. **Task 6** — Medium: 1w fix + FILL(NULL) (marketData.ts)
7. **Task 7** — Medium: timeout + symbol sanitization (connection.ts + integration.ts)
8. **Task 8** — Medium: mat view rebuild script (scripts/)
9. **Task 9** — Low: dual health check (connection.ts)
10. **Task 10** — Medium: EXPLAIN helper (connection.ts)

After all code changes: run `npx tsc --noEmit && npm run build && npx vitest run` to verify everything compiles and tests pass.

Task 8 (mat view rebuild) requires QuestDB to be running and should be run manually after deploy: `npx tsx scripts/create-mat-views.ts`
