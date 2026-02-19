# Data Architecture Reorganization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize ~825M rows of scattered market data into a clean 3-database architecture (DuckDB storage + indicators, QuestDB chart serving, PostgreSQL app/ML layer) with standardized schemas, futures rollover support, and file-level deduplication.

**Architecture:** DuckDB is the source of truth for all market data, loaded from existing Parquet/DuckDB files. QuestDB serves chart rendering via `SAMPLE BY` aggregation. PostgreSQL (Drizzle ORM) handles app state, ML models, and instrument metadata. Electron manages DB lifecycle.

**Tech Stack:** DuckDB 1.4 (embedded), QuestDB 9.3.1 (child process), PostgreSQL 18 + TimescaleDB (pg_ctl), Drizzle ORM, TypeScript, Node.js

**Existing Codebase:** `E:\source\repos\ml_dashboard` — React 19 + Express 5 + Electron 34 dashboard with 21 PostgreSQL tables, DuckDB in-memory analytics, QuestDB streaming pipeline. No test framework configured.

---

## Source Data Inventory

All consolidated at `E:\source\repos\ml_dashboard\data\sources\`:

| File | Content | Rows | Notes |
|------|---------|------|-------|
| `analytics.duckdb` | VIEW over ohlcv-1s.parquet | 720M | Prices scaled by 1B, ts_event in nanoseconds |
| `forex.duckdb` | 15 forex pairs, 6yr M1 | 103M | Column names need inspection |
| `futures/ohlcv-1s.parquet` | 1-second OHLCV | 720M | Raw Databento format (instrument_id integers) |
| `forex/*.parquet` | 15 individual pair files | ~5M total | M1 candles |

---

## Task 1: Set Up Vitest Test Framework

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add vitest dep + test script)
- Create: `tests/setup.ts`

**Step 1: Install vitest**

```bash
cd "E:\source\repos\ml_dashboard" && npm install -D vitest
```

**Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});
```

**Step 3: Add test script to package.json**

Add to `scripts` in `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Create test setup file**

Create `tests/setup.ts`:
```typescript
// Shared test utilities
import DuckDB from 'duckdb';

export function createTestDuckDB(): { db: DuckDB.Database; conn: DuckDB.Connection } {
  const db = new DuckDB.Database(':memory:');
  const conn = db.connect();
  return { db, conn };
}

export function runTestQuery<T = any>(conn: DuckDB.Connection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, result) => {
      if (err) reject(err);
      else resolve(result as T[]);
    });
  });
}
```

**Step 5: Verify vitest runs**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run
```
Expected: 0 tests found, exits cleanly.

**Step 6: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add vitest.config.ts tests/setup.ts package.json package-lock.json
git commit -m "chore: add vitest test framework"
```

---

## Task 2: Update `instruments` Table — Add pip_size and contract_months

The existing `instruments` table in `shared/schema.ts:131-149` is close but missing `pipSize` and `contractMonths` columns needed for forex pip handling and futures rollover.

**Files:**
- Modify: `shared/schema.ts:131-149`
- Create: `tests/schema.test.ts`

**Step 1: Write the failing test**

Create `tests/schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { instruments, insertInstrumentSchema } from '../shared/schema';

describe('instruments table', () => {
  it('should accept pip_size for forex instruments', () => {
    const result = insertInstrumentSchema.safeParse({
      symbol: 'EURUSD',
      name: 'EUR/USD',
      assetType: 'forex',
      exchange: 'OANDA',
      tickSize: 0.00001,
      tickValue: 1,
      pointValue: 100000,
      contractSize: 100000,
      currency: 'USD',
      decimalPlaces: 5,
      pipSize: 0.0001,
    });
    expect(result.success).toBe(true);
  });

  it('should accept contract_months for futures instruments', () => {
    const result = insertInstrumentSchema.safeParse({
      symbol: 'MNQ',
      name: 'Micro Nasdaq',
      assetType: 'futures',
      exchange: 'CME',
      tickSize: 0.25,
      tickValue: 0.5,
      pointValue: 2,
      contractSize: 1,
      currency: 'USD',
      decimalPlaces: 2,
      contractMonths: ['H', 'M', 'U', 'Z'],
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/schema.test.ts
```
Expected: FAIL — `pipSize` and `contractMonths` not recognized by schema.

**Step 3: Add columns to instruments table**

In `shared/schema.ts`, find the `instruments` table definition (line ~131) and add two columns before `createdAt`:

Add after `decimalPlaces` (line 144):
```typescript
  pipSize: doublePrecision("pip_size"),             // NULL for futures, 0.0001 for most forex, 0.01 for JPY pairs
  contractMonths: text("contract_months").array(),  // NULL for forex, ['H','M','U','Z'] for quarterly futures
```

**Step 4: Run test to verify it passes**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/schema.test.ts
```
Expected: PASS

**Step 5: Push schema to PostgreSQL**

```bash
cd "E:\source\repos\ml_dashboard" && npm run db:push
```
Expected: Schema changes applied (adds `pip_size` and `contract_months` columns to `instruments` table).

**Step 6: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add shared/schema.ts tests/schema.test.ts
git commit -m "feat: add pip_size and contract_months to instruments table"
```

---

## Task 3: Update `contractRollovers` Table — Ratio Instead of Panama

The existing `contractRollovers` table uses `priceAdjustment` (a scalar for Panama method). We need `fromClose`, `toClose`, and `ratio` columns for ratio back-adjustment.

**Files:**
- Modify: `shared/schema.ts:78-90` (contractRollovers table)

**Step 1: Write the failing test**

Add to `tests/schema.test.ts`:
```typescript
import { contractRollovers, insertContractRolloverSchema } from '../shared/schema';

describe('contractRollovers table', () => {
  it('should accept ratio back-adjustment fields', () => {
    const result = insertContractRolloverSchema.safeParse({
      baseSymbol: 'MNQ',
      fromContract: 'MNQH26',
      toContract: 'MNQM26',
      rolloverTimestamp: 1710547200000,
      fromClose: 18250.50,
      toClose: 18275.25,
      ratio: 18275.25 / 18250.50,
      rolloverType: 'volume',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ratio).toBeCloseTo(1.001355, 4);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/schema.test.ts
```
Expected: FAIL — `fromClose`, `toClose`, `ratio` not in schema.

**Step 3: Update contractRollovers table**

Replace the `contractRollovers` definition in `shared/schema.ts` (lines 78-90):

```typescript
export const contractRollovers = pgTable("contract_rollovers", {
  id: serial("id").primaryKey(),
  baseSymbol: text("base_symbol").notNull(),
  fromContract: text("from_contract").notNull(),
  toContract: text("to_contract").notNull(),
  rolloverTimestamp: bigint("rollover_timestamp", { mode: "number" }).notNull(),
  fromClose: doublePrecision("from_close").notNull(),
  toClose: doublePrecision("to_close").notNull(),
  ratio: doublePrecision("ratio").notNull(),             // toClose / fromClose
  rolloverType: text("rollover_type").notNull().default("volume"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  baseSymbolIdx: index("base_symbol_idx").on(table.baseSymbol),
  rolloverTimestampIdx: index("rollover_timestamp_idx").on(table.rolloverTimestamp),
}));
```

This removes `priceAdjustment` (Panama) and adds `fromClose`, `toClose`, `ratio` (ratio method).

**Step 4: Run test to verify it passes**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/schema.test.ts
```
Expected: PASS

**Step 5: Push schema**

```bash
cd "E:\source\repos\ml_dashboard" && npm run db:push
```

**Step 6: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add shared/schema.ts tests/schema.test.ts
git commit -m "feat: switch contractRollovers from Panama to ratio back-adjustment"
```

---

## Task 4: Create DuckDB Market Database with Persistent File

Currently DuckDB runs in-memory (`:memory:` in `server/duckdb/core.ts:5`). For market data persistence, we need a file-backed DuckDB at `data/market.duckdb` while keeping the in-memory instance for analytics scratch work.

**Files:**
- Create: `server/duckdb/market.ts`
- Create: `tests/duckdb-market.test.ts`

**Step 1: Write the failing test**

Create `tests/duckdb-market.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-market.duckdb');

describe('DuckDB market database', () => {
  let db: DuckDB.Database;
  let conn: DuckDB.Connection;

  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    db = new DuckDB.Database(TEST_DB_PATH);
    conn = db.connect();
  });

  afterAll(() => {
    conn.close();
    db.close();
    // Clean up test DB
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '.wal'); } catch {}
  });

  function query<T = any>(sql: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err, result) => {
        if (err) reject(err);
        else resolve(result as T[]);
      });
    });
  }

  it('should create ohlcv table', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS ohlcv (
        ts TIMESTAMP NOT NULL,
        symbol VARCHAR NOT NULL,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume BIGINT
      )
    `);
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'ohlcv')).toBe(true);
  });

  it('should create contracts table', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS contracts (
        ts TIMESTAMP NOT NULL,
        symbol VARCHAR NOT NULL,
        root VARCHAR NOT NULL,
        expiry DATE,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume BIGINT
      )
    `);
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'contracts')).toBe(true);
  });

  it('should create rollovers table', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS rollovers (
        ts TIMESTAMP NOT NULL,
        root VARCHAR NOT NULL,
        from_contract VARCHAR NOT NULL,
        to_contract VARCHAR NOT NULL,
        from_close DOUBLE NOT NULL,
        to_close DOUBLE NOT NULL,
        ratio DOUBLE NOT NULL
      )
    `);
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'rollovers')).toBe(true);
  });

  it('should create ingested_files table', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS ingested_files (
        file_path VARCHAR PRIMARY KEY,
        file_hash VARCHAR,
        file_size BIGINT,
        row_count BIGINT,
        symbol VARCHAR,
        ts_min TIMESTAMP,
        ts_max TIMESTAMP,
        ingested_at TIMESTAMP DEFAULT current_timestamp
      )
    `);
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'ingested_files')).toBe(true);
  });

  it('should insert and query ohlcv data', async () => {
    await query(`
      INSERT INTO ohlcv VALUES
        ('2024-01-02 09:30:00', 'MNQ', 16800.25, 16801.00, 16799.50, 16800.75, 150),
        ('2024-01-02 09:30:01', 'MNQ', 16800.75, 16802.00, 16800.50, 16801.50, 200)
    `);
    const result = await query("SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol = 'MNQ'");
    expect(result[0].cnt).toBe(2);
  });

  it('should track ingested files', async () => {
    await query(`
      INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol)
      VALUES ('test/file.parquet', 'abc123', 1024, 100, 'MNQ')
    `);
    const result = await query("SELECT * FROM ingested_files WHERE file_path = 'test/file.parquet'");
    expect(result.length).toBe(1);
    expect(result[0].file_hash).toBe('abc123');
  });
});
```

**Step 2: Run test to verify it passes (these are pure DuckDB tests)**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/duckdb-market.test.ts
```
Expected: PASS (tests create tables directly in DuckDB).

**Step 3: Create the market database module**

Create `server/duckdb/market.ts`:
```typescript
/**
 * Persistent DuckDB Market Database
 *
 * File-backed DuckDB at data/market.duckdb — source of truth for all market data.
 * Separate from the in-memory analytics DuckDB in core.ts.
 */
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

const MARKET_DB_PATH = path.join(process.cwd(), 'data', 'market.duckdb');

let marketDb: DuckDB.Database | null = null;
let marketConn: DuckDB.Connection | null = null;

// Mutex (same pattern as core.ts)
class Mutex {
  private queue: Array<{ resolve: () => void }> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) { this.locked = true; return; }
    return new Promise<void>((resolve) => { this.queue.push({ resolve }); });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next.resolve();
    else this.locked = false;
  }
}

const mutex = new Mutex();

export async function initMarketDB(): Promise<void> {
  if (marketDb) return;

  fs.mkdirSync(path.dirname(MARKET_DB_PATH), { recursive: true });
  marketDb = new DuckDB.Database(MARKET_DB_PATH);
  marketConn = marketDb.connect();

  // Set performance options
  await marketQuery("SET threads TO 4");
  await marketQuery("SET memory_limit = '4GB'");

  // Create tables if they don't exist
  await marketQuery(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      ts TIMESTAMP NOT NULL,
      symbol VARCHAR NOT NULL,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume BIGINT
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS contracts (
      ts TIMESTAMP NOT NULL,
      symbol VARCHAR NOT NULL,
      root VARCHAR NOT NULL,
      expiry DATE,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume BIGINT
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS rollovers (
      ts TIMESTAMP NOT NULL,
      root VARCHAR NOT NULL,
      from_contract VARCHAR NOT NULL,
      to_contract VARCHAR NOT NULL,
      from_close DOUBLE NOT NULL,
      to_close DOUBLE NOT NULL,
      ratio DOUBLE NOT NULL
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path VARCHAR PRIMARY KEY,
      file_hash VARCHAR,
      file_size BIGINT,
      row_count BIGINT,
      symbol VARCHAR,
      ts_min TIMESTAMP,
      ts_max TIMESTAMP,
      ingested_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log('[market-db] Initialized at', MARKET_DB_PATH);
}

export function marketQuery<T = any>(sql: string): Promise<T[]> {
  return new Promise(async (resolve, reject) => {
    await mutex.acquire();
    try {
      if (!marketConn) throw new Error('Market DB not initialized');
      marketConn.all(sql, (err, result) => {
        mutex.release();
        if (err) reject(err);
        else resolve(result as T[]);
      });
    } catch (e) {
      mutex.release();
      reject(e);
    }
  });
}

export function closeMarketDB(): void {
  if (marketConn) { marketConn.close(); marketConn = null; }
  if (marketDb) { marketDb.close(); marketDb = null; }
}

export function getMarketDBPath(): string {
  return MARKET_DB_PATH;
}
```

**Step 4: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/duckdb/market.ts tests/duckdb-market.test.ts
git commit -m "feat: add persistent DuckDB market database module"
```

---

## Task 5: Build Ingestion Engine — File Dedup + Standardization

**Files:**
- Create: `server/lib/ingestion/fileTracker.ts`
- Create: `server/lib/ingestion/standardize.ts`
- Create: `server/lib/ingestion/ingestParquet.ts`
- Create: `tests/ingestion.test.ts`

**Step 1: Create file tracker (dedup by path + hash)**

Create `server/lib/ingestion/fileTracker.ts`:
```typescript
/**
 * File-level deduplication tracker.
 * Checks ingested_files table in market DuckDB before processing any file.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { marketQuery } from '../../duckdb/market';

export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export interface FileStatus {
  alreadyIngested: boolean;
  hashChanged: boolean;
  previousHash?: string;
}

export async function checkFileStatus(filePath: string, currentHash: string): Promise<FileStatus> {
  const safePath = filePath.replace(/\\/g, '/').replace(/'/g, "''");
  const rows = await marketQuery<{ file_hash: string }>(
    `SELECT file_hash FROM ingested_files WHERE file_path = '${safePath}'`
  );

  if (rows.length === 0) {
    return { alreadyIngested: false, hashChanged: false };
  }

  if (rows[0].file_hash === currentHash) {
    return { alreadyIngested: true, hashChanged: false };
  }

  return { alreadyIngested: false, hashChanged: true, previousHash: rows[0].file_hash };
}

export async function recordIngestion(
  filePath: string, fileHash: string, fileSize: number,
  rowCount: number, symbol: string, tsMin: Date, tsMax: Date
): Promise<void> {
  const safePath = filePath.replace(/\\/g, '/').replace(/'/g, "''");
  await marketQuery(`
    INSERT OR REPLACE INTO ingested_files
    (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
    VALUES ('${safePath}', '${fileHash}', ${fileSize}, ${rowCount}, '${symbol}',
            '${tsMin.toISOString()}', '${tsMax.toISOString()}')
  `);
}
```

**Step 2: Create standardization functions**

Create `server/lib/ingestion/standardize.ts`:
```typescript
/**
 * Column standardization for market data.
 * Converts various source formats into unified schema:
 *   ts (TIMESTAMP), symbol (VARCHAR), open, high, low, close (DOUBLE), volume (BIGINT)
 */

export interface ColumnMapping {
  ts: string;            // Source column for timestamp
  symbol?: string;       // Source column for symbol (or null if symbol is external)
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  tsTransform?: string;  // SQL expression to convert ts (e.g., 'to_timestamp(ts_event / 1000000000)')
  priceTransform?: string; // SQL expression applied to OHLC (e.g., '/ 1000000000.0')
}

/**
 * Detect column mapping for a Parquet file by examining its schema.
 * Returns null if columns can't be mapped.
 */
export function detectMapping(columns: string[]): ColumnMapping | null {
  const lower = columns.map(c => c.toLowerCase());

  // Timestamp detection
  let ts = '';
  let tsTransform: string | undefined;
  if (lower.includes('ts_event')) {
    ts = 'ts_event';
    tsTransform = 'to_timestamp(ts_event / 1000000000)';
  } else if (lower.includes('ts')) {
    ts = 'ts';
  } else if (lower.includes('timestamp')) {
    ts = 'timestamp';
  } else if (lower.includes('time')) {
    ts = 'time';
  } else if (lower.includes('date')) {
    ts = 'date';
  }
  if (!ts) return null;

  // OHLCV detection
  const open = lower.includes('open') ? columns[lower.indexOf('open')] : null;
  const high = lower.includes('high') ? columns[lower.indexOf('high')] : null;
  const low = lower.includes('low') ? columns[lower.indexOf('low')] : null;
  const close = lower.includes('close') ? columns[lower.indexOf('close')] : null;
  const volume = lower.includes('volume') ? columns[lower.indexOf('volume')]
    : lower.includes('vol') ? columns[lower.indexOf('vol')] : null;

  if (!open || !high || !low || !close) return null;

  // Symbol detection
  const symbol = lower.includes('symbol') ? columns[lower.indexOf('symbol')]
    : lower.includes('instrument_id') ? columns[lower.indexOf('instrument_id')]
    : lower.includes('ticker') ? columns[lower.indexOf('ticker')]
    : undefined;

  return {
    ts: columns[lower.indexOf(ts.toLowerCase())],
    symbol,
    open, high, low, close,
    volume: volume || 'volume',
    tsTransform,
  };
}

/**
 * Generate a DuckDB SQL INSERT...SELECT that reads a Parquet file
 * and inserts standardized rows into the ohlcv table.
 */
export function buildInsertSQL(
  parquetPath: string,
  mapping: ColumnMapping,
  symbolOverride?: string,
  priceScale?: number,
): string {
  const safePath = parquetPath.replace(/\\/g, '/');
  const tsExpr = mapping.tsTransform || `CAST(${mapping.ts} AS TIMESTAMP)`;
  const priceFn = (col: string) => priceScale ? `(${col} / ${priceScale})` : col;
  const symbolExpr = symbolOverride
    ? `'${symbolOverride}'`
    : mapping.symbol
      ? `CAST(${mapping.symbol} AS VARCHAR)`
      : "'UNKNOWN'";

  return `
    INSERT INTO ohlcv
    SELECT
      ${tsExpr} AS ts,
      ${symbolExpr} AS symbol,
      ${priceFn(mapping.open)} AS open,
      ${priceFn(mapping.high)} AS high,
      ${priceFn(mapping.low)} AS low,
      ${priceFn(mapping.close)} AS close,
      CAST(COALESCE(${mapping.volume}, 0) AS BIGINT) AS volume
    FROM read_parquet('${safePath}')
  `;
}
```

**Step 3: Create Parquet ingestion orchestrator**

Create `server/lib/ingestion/ingestParquet.ts`:
```typescript
/**
 * Parquet file ingestion into DuckDB market database.
 * Handles: schema detection, standardization, file-level dedup.
 */
import * as fs from 'fs';
import * as path from 'path';
import { marketQuery, initMarketDB } from '../../duckdb/market';
import { computeFileHash, checkFileStatus, recordIngestion } from './fileTracker';
import { detectMapping, buildInsertSQL } from './standardize';

export interface IngestResult {
  file: string;
  status: 'ingested' | 'skipped' | 'error';
  rowCount?: number;
  error?: string;
}

/**
 * Ingest a single Parquet file into the market DuckDB.
 */
export async function ingestParquetFile(
  filePath: string,
  options?: {
    symbolOverride?: string;
    priceScale?: number;
    tsTransformOverride?: string;
  }
): Promise<IngestResult> {
  const absPath = path.resolve(filePath);
  const safePath = absPath.replace(/\\/g, '/');

  // Step 1: Compute hash and check dedup
  const fileHash = await computeFileHash(absPath);
  const status = await checkFileStatus(absPath, fileHash);

  if (status.alreadyIngested) {
    return { file: absPath, status: 'skipped' };
  }

  if (status.hashChanged) {
    console.warn(`[ingest] File changed since last ingestion: ${absPath}`);
    // Continue — user may want to re-ingest updated data
  }

  try {
    // Step 2: Read schema from Parquet file
    const schemaRows = await marketQuery<{ column_name: string }>(
      `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${safePath}'))`
    );
    const columns = schemaRows.map(r => r.column_name);

    // Step 3: Detect column mapping
    let mapping = detectMapping(columns);
    if (!mapping) {
      return { file: absPath, status: 'error', error: `Cannot map columns: ${columns.join(', ')}` };
    }

    // Apply overrides
    if (options?.tsTransformOverride) {
      mapping.tsTransform = options.tsTransformOverride;
    }

    // Step 4: Count rows before insert (for tracking)
    const countResult = await marketQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM read_parquet('${safePath}')`
    );
    const rowCount = countResult[0].cnt;

    // Step 5: Insert standardized data
    const sql = buildInsertSQL(safePath, mapping, options?.symbolOverride, options?.priceScale);
    await marketQuery(sql);

    // Step 6: Get time range
    const rangeResult = await marketQuery<{ ts_min: string; ts_max: string }>(
      `SELECT MIN(ts)::VARCHAR as ts_min, MAX(ts)::VARCHAR as ts_max
       FROM ohlcv WHERE symbol = '${options?.symbolOverride || 'UNKNOWN'}'`
    );

    // Step 7: Record ingestion
    const fileSize = fs.statSync(absPath).size;
    await recordIngestion(
      absPath, fileHash, fileSize, rowCount,
      options?.symbolOverride || 'UNKNOWN',
      new Date(rangeResult[0].ts_min),
      new Date(rangeResult[0].ts_max)
    );

    return { file: absPath, status: 'ingested', rowCount };
  } catch (error: any) {
    return { file: absPath, status: 'error', error: error.message };
  }
}

/**
 * Ingest all Parquet files in a directory.
 */
export async function ingestDirectory(
  dirPath: string,
  options?: {
    symbolExtractor?: (filename: string) => string;
    priceScale?: number;
  }
): Promise<IngestResult[]> {
  await initMarketDB();

  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.parquet'))
    .map(f => path.join(dirPath, f));

  const results: IngestResult[] = [];
  for (const file of files) {
    const symbol = options?.symbolExtractor?.(path.basename(file)) || undefined;
    const result = await ingestParquetFile(file, {
      symbolOverride: symbol,
      priceScale: options?.priceScale,
    });
    results.push(result);
    console.log(`[ingest] ${path.basename(file)}: ${result.status}${result.rowCount ? ` (${result.rowCount} rows)` : ''}${result.error ? ` — ${result.error}` : ''}`);
  }

  return results;
}
```

**Step 4: Write ingestion tests**

Create `tests/ingestion.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { detectMapping, buildInsertSQL } from '../server/lib/ingestion/standardize';

describe('detectMapping', () => {
  it('detects standard OHLCV columns', () => {
    const mapping = detectMapping(['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume']);
    expect(mapping).not.toBeNull();
    expect(mapping!.ts).toBe('timestamp');
    expect(mapping!.symbol).toBe('symbol');
    expect(mapping!.open).toBe('open');
  });

  it('detects Databento ts_event format', () => {
    const mapping = detectMapping(['ts_event', 'instrument_id', 'open', 'high', 'low', 'close', 'volume']);
    expect(mapping).not.toBeNull();
    expect(mapping!.ts).toBe('ts_event');
    expect(mapping!.tsTransform).toBe('to_timestamp(ts_event / 1000000000)');
    expect(mapping!.symbol).toBe('instrument_id');
  });

  it('returns null for unrecognizable columns', () => {
    const mapping = detectMapping(['foo', 'bar', 'baz']);
    expect(mapping).toBeNull();
  });
});

describe('buildInsertSQL', () => {
  it('generates INSERT with symbol override', () => {
    const mapping = detectMapping(['timestamp', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:/data/test.parquet', mapping, 'EURUSD');
    expect(sql).toContain("'EURUSD'");
    expect(sql).toContain("read_parquet('E:/data/test.parquet')");
    expect(sql).toContain('INSERT INTO ohlcv');
  });

  it('applies price scale divisor', () => {
    const mapping = detectMapping(['ts_event', 'instrument_id', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:/data/test.parquet', mapping, 'MNQ', 1000000000);
    expect(sql).toContain('/ 1000000000');
  });
});
```

**Step 5: Run tests**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run tests/ingestion.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/lib/ingestion/ tests/ingestion.test.ts
git commit -m "feat: add ingestion engine with file-level dedup and column standardization"
```

---

## Task 6: Inspect Source Data and Map Symbols

Before ingesting, we need to understand the exact column schemas and symbol mappings in each source file.

**Files:**
- Create: `scripts/inspect-sources.ts`

**Step 1: Create inspection script**

Create `scripts/inspect-sources.ts`:
```typescript
/**
 * Inspect all source data files — print schemas, row counts, and sample data.
 * Run: npx tsx scripts/inspect-sources.ts
 */
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

const db = new DuckDB.Database(':memory:');
const conn = db.connect();

function query<T = any>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, result) => {
      if (err) reject(err);
      else resolve(result as T[]);
    });
  });
}

async function inspectParquet(filePath: string) {
  const safePath = filePath.replace(/\\/g, '/');
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FILE: ${filePath}`);
  console.log(`SIZE: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`);

  // Schema
  const schema = await query(`DESCRIBE SELECT * FROM read_parquet('${safePath}')`);
  console.log('\nSCHEMA:');
  schema.forEach(col => console.log(`  ${col.column_name}: ${col.column_type}`));

  // Row count
  const count = await query(`SELECT COUNT(*) as cnt FROM read_parquet('${safePath}')`);
  console.log(`\nROWS: ${count[0].cnt.toLocaleString()}`);

  // Sample
  const sample = await query(`SELECT * FROM read_parquet('${safePath}') LIMIT 3`);
  console.log('\nSAMPLE:');
  sample.forEach(row => console.log(' ', JSON.stringify(row)));

  // Distinct symbols if applicable
  for (const col of schema) {
    if (['symbol', 'instrument_id', 'ticker'].includes(col.column_name.toLowerCase())) {
      const symbols = await query(
        `SELECT DISTINCT ${col.column_name} FROM read_parquet('${safePath}') LIMIT 20`
      );
      console.log(`\nDISTINCT ${col.column_name}:`, symbols.map(r => Object.values(r)[0]));
    }
  }
}

async function inspectDuckDB(dbPath: string) {
  const safePath = dbPath.replace(/\\/g, '/');
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DUCKDB: ${dbPath}`);

  // Attach and list tables
  await query(`ATTACH '${safePath}' AS src (READ_ONLY)`);
  const tables = await query("SELECT table_name FROM information_schema.tables WHERE table_catalog = 'src'");
  console.log('\nTABLES:', tables.map(t => t.table_name));

  for (const t of tables) {
    const name = t.table_name;
    console.log(`\n--- ${name} ---`);

    const schema = await query(`DESCRIBE src.${name}`);
    console.log('SCHEMA:');
    schema.forEach(col => console.log(`  ${col.column_name}: ${col.column_type}`));

    const count = await query(`SELECT COUNT(*) as cnt FROM src.${name}`);
    console.log(`ROWS: ${count[0].cnt.toLocaleString()}`);

    const sample = await query(`SELECT * FROM src.${name} LIMIT 3`);
    console.log('SAMPLE:');
    sample.forEach(row => console.log(' ', JSON.stringify(row)));
  }

  await query("DETACH src");
}

async function main() {
  const sourcesDir = path.join(process.cwd(), 'data', 'sources');

  // Inspect DuckDB files
  const duckdbFiles = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.duckdb'));
  for (const f of duckdbFiles) {
    await inspectDuckDB(path.join(sourcesDir, f));
  }

  // Inspect Parquet files at top level
  const parquetFiles = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.parquet'));
  for (const f of parquetFiles) {
    await inspectParquet(path.join(sourcesDir, f));
  }

  // Inspect Parquet files in subdirectories
  const subdirs = fs.readdirSync(sourcesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const subdir of subdirs) {
    const subdirPath = path.join(sourcesDir, subdir);
    const subFiles = fs.readdirSync(subdirPath).filter(f => f.endsWith('.parquet'));
    for (const f of subFiles) {
      await inspectParquet(path.join(subdirPath, f));
    }
  }

  conn.close();
  db.close();
}

main().catch(console.error);
```

**Step 2: Run the inspection**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/inspect-sources.ts 2>&1 | tee data/sources/inspection-report.txt
```

This will output the exact column names, types, sample data, and distinct symbols for every source file. **Save the output** — it drives the symbol mapping in Task 7.

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add scripts/inspect-sources.ts
git commit -m "chore: add source data inspection script"
```

---

## Task 7: Ingest Futures Data (720M rows from ohlcv-1s.parquet)

**Depends on:** Task 6 output (need to know exact instrument_id → symbol mapping).

**Files:**
- Create: `scripts/ingest-futures.ts`

**Step 1: Create ingestion script**

The `ohlcv-1s.parquet` has columns: `ts_event` (nanoseconds), `instrument_id` (integer), `open/high/low/close` (scaled by 1B), `volume`.

Create `scripts/ingest-futures.ts`:
```typescript
/**
 * Ingest futures data from ohlcv-1s.parquet into market DuckDB.
 *
 * Transformations:
 * - ts_event (nanoseconds) → ts (TIMESTAMP via to_timestamp(ts_event / 1e9))
 * - instrument_id (int) → symbol (VARCHAR via mapping)
 * - open/high/low/close / 1e9 → actual prices
 *
 * Run: npx tsx scripts/ingest-futures.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';

// IMPORTANT: Update this mapping based on the inspection report from Task 6.
// instrument_id → symbol. Run inspect-sources.ts first to get the actual IDs.
const INSTRUMENT_MAP: Record<number, string> = {
  // Example — replace with actual values from inspection:
  // 12345: 'MNQ',
  // 12346: 'MES',
  // 12347: 'MYM',
  // 12348: 'M2K',
};

async function main() {
  await initMarketDB();

  const parquetPath = 'E:/source/repos/ml_dashboard/data/sources/futures/ohlcv-1s.parquet';

  // Check if already ingested
  const existing = await marketQuery(
    `SELECT file_path FROM ingested_files WHERE file_path LIKE '%ohlcv-1s.parquet'`
  );
  if (existing.length > 0) {
    console.log('[ingest] ohlcv-1s.parquet already ingested, skipping');
    closeMarketDB();
    return;
  }

  console.log('[ingest] Starting futures ingestion from ohlcv-1s.parquet...');
  console.log('[ingest] This is ~720M rows and may take several minutes.');

  const start = Date.now();

  // Build CASE expression for instrument_id → symbol mapping
  const caseExpr = Object.entries(INSTRUMENT_MAP).length > 0
    ? `CASE instrument_id ${Object.entries(INSTRUMENT_MAP).map(([id, sym]) => `WHEN ${id} THEN '${sym}'`).join(' ')} ELSE CAST(instrument_id AS VARCHAR) END`
    : 'CAST(instrument_id AS VARCHAR)';

  await marketQuery(`
    INSERT INTO ohlcv
    SELECT
      to_timestamp(ts_event / 1000000000) AS ts,
      ${caseExpr} AS symbol,
      (open / 1000000000.0) AS open,
      (high / 1000000000.0) AS high,
      (low / 1000000000.0) AS low,
      (close / 1000000000.0) AS close,
      CAST(volume AS BIGINT) AS volume
    FROM read_parquet('${parquetPath}')
  `);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ingest] Futures ingestion complete in ${elapsed}s`);

  // Get stats
  const stats = await marketQuery(`
    SELECT symbol, COUNT(*) as cnt, MIN(ts) as ts_min, MAX(ts) as ts_max
    FROM ohlcv
    GROUP BY symbol
    ORDER BY cnt DESC
  `);
  console.log('[ingest] Stats:');
  stats.forEach(row => console.log(`  ${row.symbol}: ${row.cnt.toLocaleString()} rows, ${row.ts_min} → ${row.ts_max}`));

  // Record ingestion
  const totalRows = stats.reduce((sum: number, r: any) => sum + r.cnt, 0);
  await marketQuery(`
    INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
    VALUES ('${parquetPath}', 'bulk-import', 0, ${totalRows}, 'FUTURES_MIXED',
            (SELECT MIN(ts) FROM ohlcv), (SELECT MAX(ts) FROM ohlcv))
  `);

  closeMarketDB();
}

main().catch(console.error);
```

**Step 2: Run the ingestion**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/ingest-futures.ts
```
Expected: Ingests 720M rows. May take 5-15 minutes depending on disk speed.

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add scripts/ingest-futures.ts
git commit -m "feat: add futures data ingestion script (720M rows)"
```

---

## Task 8: Ingest Forex Data (103M rows from forex.duckdb + Parquet files)

**Files:**
- Create: `scripts/ingest-forex.ts`

**Step 1: Create forex ingestion script**

Create `scripts/ingest-forex.ts`:
```typescript
/**
 * Ingest forex data from forex.duckdb and loose Parquet files.
 *
 * Run: npx tsx scripts/ingest-forex.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  await initMarketDB();

  // --- Part 1: forex.duckdb ---
  const forexDbPath = 'E:/source/repos/ml_dashboard/data/sources/forex.duckdb';

  console.log('[ingest] Attaching forex.duckdb...');
  await marketQuery(`ATTACH '${forexDbPath}' AS forex (READ_ONLY)`);

  // List tables in forex.duckdb
  const tables = await marketQuery(
    "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'forex'"
  );
  console.log(`[ingest] Found ${tables.length} tables in forex.duckdb:`, tables.map(t => t.table_name));

  for (const t of tables) {
    const tableName = t.table_name;
    console.log(`[ingest] Processing forex.${tableName}...`);

    // Get schema to determine column mapping
    const schema = await marketQuery(`DESCRIBE forex.${tableName}`);
    const cols = schema.map((c: any) => c.column_name);
    console.log(`  Columns: ${cols.join(', ')}`);

    // Detect timestamp and OHLCV columns
    const tsCol = cols.find((c: string) => ['ts', 'timestamp', 'time', 'date'].includes(c.toLowerCase()));
    const hasOHLC = cols.includes('open') && cols.includes('high') && cols.includes('low') && cols.includes('close');

    if (!tsCol || !hasOHLC) {
      console.log(`  Skipping — can't detect OHLCV columns`);
      continue;
    }

    const symbolCol = cols.find((c: string) => ['symbol', 'pair', 'instrument'].includes(c.toLowerCase()));
    const volCol = cols.find((c: string) => ['volume', 'vol', 'tick_volume'].includes(c.toLowerCase())) || null;

    // Extract symbol from table name if no symbol column
    // Table names are often like: eurusd_m1, EURUSD, etc.
    const symbolFromName = tableName.replace(/_m\d+$/i, '').replace(/_/g, '').toUpperCase();

    const symbolExpr = symbolCol ? `CAST(${symbolCol} AS VARCHAR)` : `'${symbolFromName}'`;
    const volExpr = volCol ? `CAST(${volCol} AS BIGINT)` : '0';

    const count = await marketQuery(`SELECT COUNT(*) as cnt FROM forex.${tableName}`);
    console.log(`  Rows: ${count[0].cnt.toLocaleString()}`);

    await marketQuery(`
      INSERT INTO ohlcv
      SELECT
        CAST(${tsCol} AS TIMESTAMP) AS ts,
        ${symbolExpr} AS symbol,
        CAST(open AS DOUBLE) AS open,
        CAST(high AS DOUBLE) AS high,
        CAST(low AS DOUBLE) AS low,
        CAST(close AS DOUBLE) AS close,
        ${volExpr} AS volume
      FROM forex.${tableName}
    `);

    console.log(`  Ingested ${count[0].cnt.toLocaleString()} rows`);
  }

  await marketQuery("DETACH forex");

  // --- Part 2: Loose Parquet files ---
  const forexParquetDir = path.join(process.cwd(), 'data', 'sources', 'forex');
  if (fs.existsSync(forexParquetDir)) {
    const parquetFiles = fs.readdirSync(forexParquetDir).filter(f => f.endsWith('.parquet'));
    console.log(`\n[ingest] Found ${parquetFiles.length} loose forex Parquet files`);

    for (const file of parquetFiles) {
      const filePath = path.join(forexParquetDir, file).replace(/\\/g, '/');
      // Extract symbol from filename: "EURUSD_M1.parquet" → "EURUSD"
      const symbol = path.basename(file, '.parquet').replace(/_M\d+$/i, '').toUpperCase();

      console.log(`[ingest] ${file} → ${symbol}`);

      const schema = await marketQuery(`DESCRIBE SELECT * FROM read_parquet('${filePath}')`);
      const cols = schema.map((c: any) => c.column_name);
      const tsCol = cols.find((c: string) => ['ts', 'timestamp', 'time', 'date'].includes(c.toLowerCase()));
      const volCol = cols.find((c: string) => ['volume', 'vol', 'tick_volume'].includes(c.toLowerCase()));

      if (!tsCol) {
        console.log(`  Skipping — no timestamp column found in ${cols.join(', ')}`);
        continue;
      }

      const count = await marketQuery(`SELECT COUNT(*) as cnt FROM read_parquet('${filePath}')`);

      await marketQuery(`
        INSERT INTO ohlcv
        SELECT
          CAST(${tsCol} AS TIMESTAMP) AS ts,
          '${symbol}' AS symbol,
          CAST(open AS DOUBLE) AS open,
          CAST(high AS DOUBLE) AS high,
          CAST(low AS DOUBLE) AS low,
          CAST(close AS DOUBLE) AS close,
          CAST(COALESCE(${volCol || '0'}, 0) AS BIGINT) AS volume
        FROM read_parquet('${filePath}')
      `);

      console.log(`  Ingested ${count[0].cnt.toLocaleString()} rows`);
    }
  }

  // --- Summary ---
  console.log('\n[ingest] === Forex Ingestion Summary ===');
  const summary = await marketQuery(`
    SELECT symbol, COUNT(*) as cnt, MIN(ts) as ts_min, MAX(ts) as ts_max
    FROM ohlcv
    WHERE symbol NOT IN (SELECT DISTINCT symbol FROM ohlcv WHERE symbol LIKE '%NQ%' OR symbol LIKE '%ES%' OR symbol LIKE '%YM%' OR symbol LIKE '%2K%')
    GROUP BY symbol
    ORDER BY cnt DESC
  `);
  summary.forEach((row: any) => console.log(`  ${row.symbol}: ${row.cnt.toLocaleString()} rows, ${row.ts_min} → ${row.ts_max}`));

  closeMarketDB();
}

main().catch(console.error);
```

**Step 2: Run**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/ingest-forex.ts
```

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add scripts/ingest-forex.ts
git commit -m "feat: add forex data ingestion script (103M+ rows)"
```

---

## Task 9: Sync DuckDB → QuestDB for Chart Rendering

**Files:**
- Create: `server/lib/questdbSync.ts`
- Modify: `server/questdb.ts` (ensure `createOHLCVTable` uses correct schema)
- Create: `scripts/sync-to-questdb.ts`

**Step 1: Create sync module**

Create `server/lib/questdbSync.ts`:
```typescript
/**
 * Sync market data from DuckDB → QuestDB for chart rendering.
 * Uses QuestDB's ILP (InfluxDB Line Protocol) for fast ingestion.
 */
import { Sender } from '@questdb/nodejs-client';
import { marketQuery } from '../duckdb/market';

const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const BATCH_SIZE = 50000;

export interface SyncResult {
  symbol: string;
  rowsSynced: number;
  duration: number;
}

/**
 * Sync a single symbol from DuckDB ohlcv → QuestDB ohlcv.
 * Only syncs rows newer than the last timestamp in QuestDB.
 */
export async function syncSymbol(symbol: string, lastQuestDBTimestamp?: Date): Promise<SyncResult> {
  const start = Date.now();
  const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};`;
  const sender = await Sender.fromConfig(configStr);

  let whereClause = `WHERE symbol = '${symbol}'`;
  if (lastQuestDBTimestamp) {
    whereClause += ` AND ts > '${lastQuestDBTimestamp.toISOString()}'`;
  }

  // Count total rows to sync
  const countResult = await marketQuery<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM ohlcv ${whereClause}`
  );
  const totalRows = countResult[0].cnt;

  if (totalRows === 0) {
    await sender.close();
    return { symbol, rowsSynced: 0, duration: Date.now() - start };
  }

  console.log(`[sync] ${symbol}: syncing ${totalRows.toLocaleString()} rows...`);

  let offset = 0;
  let synced = 0;

  while (offset < totalRows) {
    const batch = await marketQuery<{
      ts: string; open: number; high: number; low: number; close: number; volume: number;
    }>(`
      SELECT ts::VARCHAR as ts, open, high, low, close, volume
      FROM ohlcv ${whereClause}
      ORDER BY ts
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `);

    for (const row of batch) {
      await sender
        .table('ohlcv')
        .symbol('symbol', symbol)
        .floatColumn('open', row.open)
        .floatColumn('high', row.high)
        .floatColumn('low', row.low)
        .floatColumn('close', row.close)
        .floatColumn('volume', row.volume)
        .at(new Date(row.ts).getTime(), 'ms');
    }

    await sender.flush();
    synced += batch.length;
    offset += BATCH_SIZE;

    if (synced % 500000 === 0) {
      console.log(`[sync] ${symbol}: ${synced.toLocaleString()} / ${totalRows.toLocaleString()}`);
    }
  }

  await sender.close();
  const duration = Date.now() - start;
  console.log(`[sync] ${symbol}: done (${synced.toLocaleString()} rows in ${(duration / 1000).toFixed(1)}s)`);

  return { symbol, rowsSynced: synced, duration };
}

/**
 * Sync all symbols from DuckDB → QuestDB.
 */
export async function syncAllToQuestDB(): Promise<SyncResult[]> {
  const symbols = await marketQuery<{ symbol: string }>(
    'SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol'
  );

  console.log(`[sync] Syncing ${symbols.length} symbols to QuestDB...`);
  const results: SyncResult[] = [];

  for (const { symbol } of symbols) {
    const result = await syncSymbol(symbol);
    results.push(result);
  }

  return results;
}
```

**Step 2: Create sync script**

Create `scripts/sync-to-questdb.ts`:
```typescript
/**
 * Sync all DuckDB market data → QuestDB for chart rendering.
 *
 * Prerequisites:
 * - QuestDB must be running (port 9000)
 * - DuckDB market database must have data
 *
 * Run: npx tsx scripts/sync-to-questdb.ts
 */
import { initMarketDB, closeMarketDB } from '../server/duckdb/market';
import { syncAllToQuestDB } from '../server/lib/questdbSync';
import { createOHLCVTable } from '../server/questdb';

async function main() {
  await initMarketDB();

  // Ensure QuestDB ohlcv table exists
  console.log('[sync] Creating QuestDB ohlcv table if not exists...');
  await createOHLCVTable();

  // Run sync
  const results = await syncAllToQuestDB();

  // Summary
  console.log('\n=== Sync Summary ===');
  let totalRows = 0;
  for (const r of results) {
    console.log(`  ${r.symbol}: ${r.rowsSynced.toLocaleString()} rows (${(r.duration / 1000).toFixed(1)}s)`);
    totalRows += r.rowsSynced;
  }
  console.log(`  TOTAL: ${totalRows.toLocaleString()} rows synced`);

  closeMarketDB();
}

main().catch(console.error);
```

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/lib/questdbSync.ts scripts/sync-to-questdb.ts
git commit -m "feat: add DuckDB → QuestDB sync for chart rendering"
```

---

## Task 10: Seed Instruments Table

**Files:**
- Create: `scripts/seed-instruments.ts`

**Step 1: Create seed script**

Create `scripts/seed-instruments.ts`:
```typescript
/**
 * Seed the instruments table with known symbols and their metadata.
 * Run: npx tsx scripts/seed-instruments.ts
 */
import { db } from '../server/db';
import { instruments } from '../shared/schema';
import { sql } from 'drizzle-orm';

const INSTRUMENTS = [
  // CME Micro Futures
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 0.50, pointValue: 2, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 1.25, pointValue: 5, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'MYM', name: 'Micro E-mini Dow', assetType: 'futures', exchange: 'CBOT', tickSize: 1.0, tickValue: 0.50, pointValue: 0.50, contractSize: 1, currency: 'USD', decimalPlaces: 0, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'M2K', name: 'Micro E-mini Russell 2000', assetType: 'futures', exchange: 'CME', tickSize: 0.10, tickValue: 0.50, pointValue: 5, contractSize: 1, currency: 'USD', decimalPlaces: 1, contractMonths: ['H', 'M', 'U', 'Z'] },

  // Major Forex Pairs
  { symbol: 'EURUSD', name: 'EUR/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'GBPUSD', name: 'GBP/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'AUDUSD', name: 'AUD/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'NZDUSD', name: 'NZD/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'USDCAD', name: 'USD/CAD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'CAD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'USDCHF', name: 'USD/CHF', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'CHF', decimalPlaces: 5, pipSize: 0.0001 },

  // JPY Pairs (different pip location)
  { symbol: 'USDJPY', name: 'USD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'EURJPY', name: 'EUR/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'GBPJPY', name: 'GBP/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'AUDJPY', name: 'AUD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'NZDJPY', name: 'NZD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },

  // Cross Pairs
  { symbol: 'EURGBP', name: 'EUR/GBP', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'GBP', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'EURAUD', name: 'EUR/AUD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'AUD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'GBPAUD', name: 'GBP/AUD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'AUD', decimalPlaces: 5, pipSize: 0.0001 },
];

async function main() {
  console.log('[seed] Seeding instruments table...');

  for (const inst of INSTRUMENTS) {
    await db.insert(instruments)
      .values(inst)
      .onConflictDoUpdate({
        target: instruments.symbol,
        set: {
          name: inst.name,
          assetType: inst.assetType,
          exchange: inst.exchange,
          tickSize: inst.tickSize,
          tickValue: inst.tickValue,
          pointValue: inst.pointValue,
          contractSize: inst.contractSize,
          currency: inst.currency,
          decimalPlaces: inst.decimalPlaces,
          pipSize: (inst as any).pipSize ?? null,
          contractMonths: (inst as any).contractMonths ?? null,
        },
      });
    console.log(`  ${inst.symbol} (${inst.assetType})`);
  }

  console.log(`[seed] Done. ${INSTRUMENTS.length} instruments seeded.`);
  process.exit(0);
}

main().catch(console.error);
```

**Step 2: Run**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/seed-instruments.ts
```

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add scripts/seed-instruments.ts
git commit -m "feat: add instrument seed script with forex pip sizes and futures specs"
```

---

## Task 11: Wire Market DB into Server Startup

**Files:**
- Modify: `server/index.ts` (add `initMarketDB()` call)
- Modify: `server/duckdb.ts` (re-export market module)

**Step 1: Add market DB re-export**

In `server/duckdb.ts`, add at the end:
```typescript
export { initMarketDB, marketQuery, closeMarketDB, getMarketDBPath } from './duckdb/market';
```

**Step 2: Initialize market DB on server start**

In `server/index.ts`, find the async IIFE where `setupPartitionedTables()` is called (~line 77). Add `initMarketDB()`:

After the existing imports at the top of the file, add:
```typescript
import { initMarketDB } from "./duckdb/market";
```

Inside the async IIFE, after the `initDuckDB()` call (if present) or after `setupPartitionedTables()`, add:
```typescript
    await initMarketDB();
    log('Market DuckDB initialized', 'market-db');
```

**Step 3: Verify server starts**

```bash
cd "E:\source\repos\ml_dashboard" && npm run dev
```
Expected: Server starts, logs `Market DuckDB initialized`.

**Step 4: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/index.ts server/duckdb.ts
git commit -m "feat: wire persistent market DuckDB into server startup"
```

---

## Task 12: Add Chart API Route Using QuestDB SAMPLE BY

**Files:**
- Create: `server/routes/charts.ts`
- Modify: `server/routes.ts` (register new route)

**Step 1: Create chart route**

Create `server/routes/charts.ts`:
```typescript
/**
 * Chart data API — serves OHLCV candles from QuestDB.
 * QuestDB's SAMPLE BY handles timeframe aggregation on the fly.
 */
import { Router, Request, Response } from 'express';
import { getOHLCVSampleBy, checkQuestDBHealth } from '../questdb';
import { marketQuery } from '../duckdb/market';

const router = Router();

/**
 * GET /api/charts/ohlcv?symbol=MNQ&timeframe=5m&start=2024-01-01&end=2024-12-31&limit=5000
 *
 * Returns candle data for chart rendering.
 * Primary: QuestDB (SAMPLE BY). Fallback: DuckDB.
 */
router.get('/ohlcv', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe = '1m', start, end, limit } = req.query;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const validTimeframes = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe as string)) {
      return res.status(400).json({ error: `Invalid timeframe. Valid: ${validTimeframes.join(', ')}` });
    }

    const startMs = start ? new Date(start as string).getTime() : undefined;
    const endMs = end ? new Date(end as string).getTime() : undefined;
    const rowLimit = limit ? parseInt(limit as string) : 5000;

    // Try QuestDB first
    const questdbHealthy = await checkQuestDBHealth();

    if (questdbHealthy) {
      const data = await getOHLCVSampleBy(
        symbol as string,
        timeframe as string,
        startMs,
        endMs,
        rowLimit
      );
      return res.json({ source: 'questdb', count: data.length, data });
    }

    // Fallback: DuckDB (no SAMPLE BY, so we just return raw data with optional limit)
    console.warn('[charts] QuestDB unavailable, falling back to DuckDB');
    let sql = `SELECT ts, symbol, open, high, low, close, volume FROM ohlcv WHERE symbol = '${symbol}'`;
    if (startMs) sql += ` AND ts >= '${new Date(startMs).toISOString()}'`;
    if (endMs) sql += ` AND ts <= '${new Date(endMs).toISOString()}'`;
    sql += ` ORDER BY ts LIMIT ${rowLimit}`;

    const data = await marketQuery(sql);
    return res.json({ source: 'duckdb', count: data.length, data });
  } catch (error: any) {
    console.error('[charts]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/charts/symbols
 * Returns available symbols with row counts.
 */
router.get('/symbols', async (_req: Request, res: Response) => {
  try {
    const symbols = await marketQuery(`
      SELECT symbol, COUNT(*) as row_count, MIN(ts) as first_bar, MAX(ts) as last_bar
      FROM ohlcv
      GROUP BY symbol
      ORDER BY symbol
    `);
    return res.json(symbols);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
```

**Step 2: Register route**

In `server/routes.ts`, find where other routes are registered. Add:

```typescript
import chartRoutes from './routes/charts';
```

And in the route registration function, add:
```typescript
app.use('/api/charts', chartRoutes);
```

**Step 3: Test with curl**

```bash
# After server is running:
curl "http://localhost:5000/api/charts/symbols"
curl "http://localhost:5000/api/charts/ohlcv?symbol=EURUSD&timeframe=1h&limit=100"
```

**Step 4: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/routes/charts.ts server/routes.ts
git commit -m "feat: add /api/charts route with QuestDB SAMPLE BY + DuckDB fallback"
```

---

## Task 13: Update Electron Database Lifecycle

The existing `electron/start-databases.cjs` has hardcoded paths that differ from the actual database locations.

**Files:**
- Modify: `electron/start-databases.cjs`

**Step 1: Fix database paths**

Update the constants at the top of `electron/start-databases.cjs` to match actual locations:

```javascript
const PG_CTL = "E:\\source\\databases\\PostgreSQL\\pgsql\\bin\\pg_ctl.exe";
const PG_DATA = "E:\\source\\databases\\PostgreSQL\\pgsql\\data";
const PG_LOG = "E:\\source\\databases\\PostgreSQL\\pgsql\\data\\pg.log";
const QUESTDB_JAVA = "E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64\\bin\\java.exe";
const QUESTDB_ROOT = "E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64";
```

Note: The current file has paths like `E:\\PostgreSQL\\pgsql\\` and `E:\\questdb-9.3.1-rt-windows-x86-64\\` which are wrong — the actual databases are in `E:\\source\\databases\\`.

**Step 2: Verify paths exist**

```bash
ls -la "E:/source/databases/PostgreSQL/pgsql/bin/pg_ctl.exe"
ls -la "E:/source/databases/questdb-9.3.1-rt-windows-x86-64/bin/java.exe"
```

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add electron/start-databases.cjs
git commit -m "fix: update Electron DB paths to match actual database locations"
```

---

## Task 14: Update sqlGenerator to Use Market DB Column Names

The existing `sqlGenerator.ts` defaults to `timestampColumn: 'timestamp'`. Our new schema uses `ts`.

**Files:**
- Modify: `server/lib/indicators/sqlGenerator.ts` (line ~24)

**Step 1: Update default options**

In `server/lib/indicators/sqlGenerator.ts`, change the `DEFAULT_OPTIONS` (around line 24):

```typescript
const DEFAULT_OPTIONS: SQLGeneratorOptions = {
  tableName: 'ohlcv',
  symbolColumn: 'symbol',
  timestampColumn: 'ts',       // was 'timestamp'
  partition: true,
};
```

**Step 2: Search for any hardcoded 'timestamp' references in indicator code**

```bash
cd "E:\source\repos\ml_dashboard" && grep -rn "timestampColumn.*timestamp\|ORDER BY timestamp" server/lib/indicators/
```

Fix any remaining hardcoded references.

**Step 3: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add server/lib/indicators/sqlGenerator.ts
git commit -m "fix: update indicator SQL generator to use 'ts' column name"
```

---

## Task 15: Update CLAUDE.md and Skills

**Files:**
- Modify: `E:\source\repos\ml_dashboard\CLAUDE.md`
- Modify: `E:\source\repos\ml_dashboard\.claude\commands\db-manage.md`
- Modify: `E:\source\repos\ml_dashboard\.claude\commands\architecture.md`
- Modify: `C:\Users\tyler\.claude\projects\C--Users-tyler\memory\ml-dashboard.md`

**Step 1: Update CLAUDE.md**

Update the database architecture section to reflect the new 3-DB split:
- DuckDB: market data source of truth + indicator engine (persistent at `data/market.duckdb`)
- QuestDB: chart rendering via `SAMPLE BY` (synced from DuckDB)
- PostgreSQL: app/ML layer (Drizzle ORM, unchanged)

Add the new files to the file structure map:
- `server/duckdb/market.ts` — persistent market database
- `server/lib/ingestion/` — file tracker, standardization, Parquet ingestion
- `server/lib/questdbSync.ts` — DuckDB → QuestDB sync
- `server/routes/charts.ts` — chart data API
- `scripts/ingest-*.ts` — data ingestion scripts
- `scripts/seed-instruments.ts` — instrument metadata seeder

**Step 2: Update db-manage.md skill**

Add a new "Ingest" operation that references the ingestion scripts.

**Step 3: Update architecture.md skill**

Reflect the new table layout across all 3 databases.

**Step 4: Update memory file**

Update `ml-dashboard.md` with the finalized architecture.

**Step 5: Commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add CLAUDE.md .claude/commands/db-manage.md .claude/commands/architecture.md
git commit -m "docs: update CLAUDE.md and skills to reflect new 3-DB architecture"
```

---

## Task 16: Verify End-to-End

**Step 1: Start databases**

```bash
"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" -D "E:\source\databases\PostgreSQL\pgsql\data" start
```

```bash
# QuestDB (needs admin or use Electron launcher)
node "E:\source\repos\ml_dashboard\electron\start-databases.cjs"
```

**Step 2: Run schema push**

```bash
cd "E:\source\repos\ml_dashboard" && npm run db:push
```

**Step 3: Seed instruments**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/seed-instruments.ts
```

**Step 4: Inspect sources**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/inspect-sources.ts
```

**Step 5: Run futures ingestion**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/ingest-futures.ts
```

**Step 6: Run forex ingestion**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/ingest-forex.ts
```

**Step 7: Sync to QuestDB**

```bash
cd "E:\source\repos\ml_dashboard" && npx tsx scripts/sync-to-questdb.ts
```

**Step 8: Start dev server and test**

```bash
cd "E:\source\repos\ml_dashboard" && npm run dev
```

```bash
# Test chart API
curl "http://localhost:5000/api/charts/symbols"
curl "http://localhost:5000/api/charts/ohlcv?symbol=EURUSD&timeframe=1h&limit=10"
curl "http://localhost:5000/api/health"
```

**Step 9: Run all tests**

```bash
cd "E:\source\repos\ml_dashboard" && npx vitest run
```
Expected: All tests pass.

**Step 10: Final commit**

```bash
cd "E:\source\repos\ml_dashboard"
git add -A
git commit -m "chore: data architecture reorganization complete"
```

---

## Files Created/Modified Summary

| Task | File | Action |
|------|------|--------|
| 1 | `vitest.config.ts` | Create |
| 1 | `tests/setup.ts` | Create |
| 1 | `package.json` | Modify (add vitest) |
| 2 | `shared/schema.ts` | Modify (instruments: +pipSize, +contractMonths) |
| 2 | `tests/schema.test.ts` | Create |
| 3 | `shared/schema.ts` | Modify (contractRollovers: ratio fields) |
| 4 | `server/duckdb/market.ts` | Create |
| 4 | `tests/duckdb-market.test.ts` | Create |
| 5 | `server/lib/ingestion/fileTracker.ts` | Create |
| 5 | `server/lib/ingestion/standardize.ts` | Create |
| 5 | `server/lib/ingestion/ingestParquet.ts` | Create |
| 5 | `tests/ingestion.test.ts` | Create |
| 6 | `scripts/inspect-sources.ts` | Create |
| 7 | `scripts/ingest-futures.ts` | Create |
| 8 | `scripts/ingest-forex.ts` | Create |
| 9 | `server/lib/questdbSync.ts` | Create |
| 9 | `scripts/sync-to-questdb.ts` | Create |
| 10 | `scripts/seed-instruments.ts` | Create |
| 11 | `server/index.ts` | Modify (add initMarketDB) |
| 11 | `server/duckdb.ts` | Modify (re-export market) |
| 12 | `server/routes/charts.ts` | Create |
| 12 | `server/routes.ts` | Modify (register charts route) |
| 13 | `electron/start-databases.cjs` | Modify (fix paths) |
| 14 | `server/lib/indicators/sqlGenerator.ts` | Modify (ts column) |
| 15 | `CLAUDE.md` | Modify |
| 15 | `.claude/commands/db-manage.md` | Modify |
| 15 | `.claude/commands/architecture.md` | Modify |
| 15 | `memory/ml-dashboard.md` | Modify |

## Execution Order

Tasks 1–5 are sequential (each builds on prior). Tasks 6–10 depend on Tasks 4–5. Tasks 11–14 can be done in parallel after Task 4. Task 15 is last (documentation). Task 16 is verification.

Critical path: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 16
