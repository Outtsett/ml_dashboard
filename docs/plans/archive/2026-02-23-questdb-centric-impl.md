# QuestDB-Centric Architecture Implementation Plan

> **Status:** Partially superseded — continuous contract tables and Panama back-adjustment were removed in favor of on-demand front-month queries. Core QuestDB/DuckDB separation was implemented as planned.

**Goal:** Migrate all time-series data ownership to QuestDB, make DuckDB a stateless analytics engine.

**Architecture:** QuestDB becomes the sole source of truth for all market data (OHLCV, trades, mbp10, continuous contracts). DuckDB becomes an ephemeral in-memory analytics engine that queries QuestDB via `postgres_scanner`. PostgreSQL keeps app metadata and gains the `ingested_files` table for dedup tracking.

**Tech Stack:** QuestDB 9.3.1 (ILP + PG wire), DuckDB 1.4.3 (postgres_scanner extension), PostgreSQL 18 (Drizzle ORM), Express 5, TypeScript

**Design Doc:** `docs/plans/2026-02-23-questdb-centric-architecture-design.md`

---

## Dependency Map (What Touches What)

`marketQuery` from `server/duckdb/market.ts` is imported by **19+ files**:
- **Routes:** agent.ts, backtest.ts, instruments.ts, parquet.ts, regime.ts
- **ML Pipeline:** walkForward.ts, universalPipeline.ts, inferenceService.ts, dataExporter.ts
- **Ingestion:** ingestParquet.ts, fileTracker.ts
- **Labels:** labelService.ts
- **Sync:** questdbSync.ts
- **Scripts:** compute-rollovers.ts, fast-questdb-sync.ts, ingest-forex.ts, ingest-futures.ts, ingest-mbp10.ts, ingest-trades.ts, sync-mbp10-questdb.ts, sync-to-questdb.ts, sync-trades-questdb.ts

The strategy: build the new QuestDB infrastructure first, then migrate consumers one group at a time, then delete the old code.

---

## Phase 1: QuestDB Infrastructure (New Tables + Continuous Contract Service)

### Task 1: Create QuestDB `ohlcv_continuous` and `rollovers` Tables

**Files:**
- Modify: `server/questdb.ts`

**Step 1: Write the failing test**

Create `tests/questdb-tables.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { queryQuestDB, checkQuestDBHealth } from '../server/questdb';

describe('QuestDB continuous contract tables', () => {
  beforeAll(async () => {
    const healthy = await checkQuestDBHealth();
    if (!healthy) throw new Error('QuestDB not available');
  });

  it('ohlcv_continuous table exists with correct columns', async () => {
    const cols = await queryQuestDB("SHOW COLUMNS FROM ohlcv_continuous");
    const colNames = cols.map((c: any) => c.column);
    expect(colNames).toContain('ts');
    expect(colNames).toContain('root');
    expect(colNames).toContain('open');
    expect(colNames).toContain('high');
    expect(colNames).toContain('low');
    expect(colNames).toContain('close');
    expect(colNames).toContain('volume');
    expect(colNames).toContain('raw_close');
    expect(colNames).toContain('adjustment');
  });

  it('rollovers table exists with correct columns', async () => {
    const cols = await queryQuestDB("SHOW COLUMNS FROM rollovers");
    const colNames = cols.map((c: any) => c.column);
    expect(colNames).toContain('ts');
    expect(colNames).toContain('root');
    expect(colNames).toContain('from_contract');
    expect(colNames).toContain('to_contract');
    expect(colNames).toContain('from_close');
    expect(colNames).toContain('to_close');
    expect(colNames).toContain('price_gap');
    expect(colNames).toContain('rollover_type');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/questdb-tables.test.ts`
Expected: FAIL — tables don't exist yet.

**Step 3: Implement — add table creation functions to questdb.ts**

Add to `server/questdb.ts`:

```typescript
export async function createContinuousTable(): Promise<void> {
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS ohlcv_continuous (
      root SYMBOL CAPACITY 50 CACHE INDEX,
      ts TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE,
      raw_close DOUBLE,
      adjustment DOUBLE
    ) timestamp(ts) PARTITION BY MONTH WAL
    DEDUP UPSERT KEYS(root, ts);
  `);
}

export async function createRolloversTable(): Promise<void> {
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS rollovers (
      root SYMBOL CAPACITY 50 CACHE INDEX,
      ts TIMESTAMP,
      from_contract SYMBOL CAPACITY 200 CACHE,
      to_contract SYMBOL CAPACITY 200 CACHE,
      from_close DOUBLE,
      to_close DOUBLE,
      price_gap DOUBLE,
      rollover_type SYMBOL CAPACITY 10 CACHE
    ) timestamp(ts)
    DEDUP UPSERT KEYS(root, ts);
  `);
}
```

**Step 4: Call the creation functions at startup**

In `server/questdb.ts`, update or add an `initQuestDBTables()` function:

```typescript
export async function initQuestDBTables(): Promise<void> {
  await createOHLCVTable();
  await createTradesTable();
  await createMBP10Table();
  await createContinuousTable();
  await createRolloversTable();
}
```

**Step 5: Run test to verify it passes**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/questdb-tables.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/questdb.ts tests/questdb-tables.test.ts
git commit -m "feat: add QuestDB ohlcv_continuous and rollovers tables"
```

---

### Task 2: Build the Continuous Contract Service

**Files:**
- Create: `server/services/continuousContract.ts`
- Test: `tests/continuousContract.test.ts`

This is the core service that replaces `server/duckdb/preAggregation.ts`. It:
1. Queries QuestDB for daily volumes per contract
2. Detects rollovers (volume leadership changes)
3. Computes Panama back-adjustment
4. Writes adjusted bars to `ohlcv_continuous` via ILP

**Step 1: Write the failing test**

Create `tests/continuousContract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectRollovers, computeBackAdjustment, type RolloverRecord } from '../server/services/continuousContract';

describe('Continuous Contract Logic', () => {
  describe('detectRollovers', () => {
    it('detects volume leadership change', () => {
      // Simulated daily volumes: ESH5 leads Mon-Wed, ESM5 leads Thu+
      const dailyVolumes = [
        { trade_date: '2025-03-10', symbol: 'ESH5', total_volume: 1000000 },
        { trade_date: '2025-03-10', symbol: 'ESM5', total_volume: 500000 },
        { trade_date: '2025-03-11', symbol: 'ESH5', total_volume: 900000 },
        { trade_date: '2025-03-11', symbol: 'ESM5', total_volume: 600000 },
        { trade_date: '2025-03-12', symbol: 'ESH5', total_volume: 700000 },
        { trade_date: '2025-03-12', symbol: 'ESM5', total_volume: 1100000 },
      ];
      const closePrices = {
        'ESH5|2025-03-12': 5100.25,
        'ESM5|2025-03-12': 5105.50,
      };
      const rollovers = detectRollovers(dailyVolumes, closePrices);
      expect(rollovers).toHaveLength(1);
      expect(rollovers[0].from_contract).toBe('ESH5');
      expect(rollovers[0].to_contract).toBe('ESM5');
      expect(rollovers[0].price_gap).toBeCloseTo(5.25);
    });
  });

  describe('computeBackAdjustment', () => {
    it('accumulates Panama adjustment newest-to-oldest', () => {
      const rollovers: RolloverRecord[] = [
        { ts: new Date('2024-12-15'), root: 'ES', from_contract: 'ESZ4', to_contract: 'ESH5', from_close: 5000, to_close: 5002, price_gap: 2, rollover_type: 'volume' },
        { ts: new Date('2025-03-12'), root: 'ES', from_contract: 'ESH5', to_contract: 'ESM5', from_close: 5100, to_close: 5105, price_gap: 5, rollover_type: 'volume' },
      ];
      const adjustments = computeBackAdjustment(rollovers);
      // Before ESZ4->ESH5 rollover: cumulative = 2 + 5 = 7
      // Between rollovers: cumulative = 5
      // After ESH5->ESM5 rollover: cumulative = 0
      expect(adjustments).toHaveLength(2);
      expect(adjustments[0].cumulativeAdj).toBe(7); // oldest rollover
      expect(adjustments[1].cumulativeAdj).toBe(5); // newest rollover
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/continuousContract.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement the continuous contract service**

Create `server/services/continuousContract.ts`:

```typescript
/**
 * Continuous Contract Service
 *
 * Builds back-adjusted continuous futures series from individual contract data
 * stored in QuestDB. Writes results to the ohlcv_continuous table.
 *
 * Replaces: server/duckdb/preAggregation.ts
 */
import { Sender } from '@questdb/nodejs-client';
import { queryQuestDB, getQuestDBSender } from '../questdb';
import { validateSymbol } from '@shared/schema';

export interface RolloverRecord {
  ts: Date;
  root: string;
  from_contract: string;
  to_contract: string;
  from_close: number;
  to_close: number;
  price_gap: number;
  rollover_type: string;
}

interface DailyVolume {
  trade_date: string;
  symbol: string;
  total_volume: number;
}

interface BackAdjustment {
  ts: Date;
  cumulativeAdj: number;
}

/**
 * Detect rollovers from daily volume data.
 * A rollover occurs when the volume leader changes from one contract to another.
 * Pure function — no DB access, easy to test.
 */
export function detectRollovers(
  dailyVolumes: DailyVolume[],
  closePrices: Record<string, number> // key: "SYMBOL|DATE"
): Omit<RolloverRecord, 'ts' | 'root'>[] {
  // Group by date, find leader per day
  const byDate = new Map<string, DailyVolume[]>();
  for (const dv of dailyVolumes) {
    const existing = byDate.get(dv.trade_date) || [];
    existing.push(dv);
    byDate.set(dv.trade_date, existing);
  }

  const dates = [...byDate.keys()].sort();
  const leaders = new Map<string, string>();
  for (const date of dates) {
    const entries = byDate.get(date)!;
    entries.sort((a, b) => b.total_volume - a.total_volume);
    leaders.set(date, entries[0].symbol);
  }

  const rollovers: Omit<RolloverRecord, 'ts' | 'root'>[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prevLeader = leaders.get(dates[i - 1])!;
    const currLeader = leaders.get(dates[i])!;
    if (prevLeader !== currLeader) {
      const fromClose = closePrices[`${prevLeader}|${dates[i]}`] || 0;
      const toClose = closePrices[`${currLeader}|${dates[i]}`] || 0;
      rollovers.push({
        from_contract: prevLeader,
        to_contract: currLeader,
        from_close: fromClose,
        to_close: toClose,
        price_gap: toClose - fromClose,
        rollover_type: 'volume',
      });
    }
  }
  return rollovers;
}

/**
 * Compute cumulative Panama back-adjustment from rollover records.
 * Walk rollovers newest-to-oldest, accumulating price gaps.
 * Pure function — no DB access.
 */
export function computeBackAdjustment(rollovers: RolloverRecord[]): BackAdjustment[] {
  const sorted = [...rollovers].sort((a, b) => b.ts.getTime() - a.ts.getTime());
  let cumulative = 0;
  const adjustments: BackAdjustment[] = [];

  for (const r of sorted) {
    cumulative += r.price_gap;
    adjustments.push({ ts: r.ts, cumulativeAdj: cumulative });
  }

  adjustments.reverse(); // oldest first
  return adjustments;
}

/**
 * Get the Panama adjustment for a given timestamp.
 * Returns the cumulative adjustment to ADD to raw prices.
 */
function getAdjustmentForTimestamp(ts: number, adjustments: BackAdjustment[]): number {
  // Adjustments are sorted oldest-first
  // Find the first adjustment whose timestamp is AFTER our bar
  for (let i = adjustments.length - 1; i >= 0; i--) {
    if (ts < adjustments[i].ts.getTime()) {
      return adjustments[i].cumulativeAdj;
    }
  }
  return 0; // after all rollovers — no adjustment needed
}

/**
 * Build continuous contract series for a futures root symbol.
 * Queries QuestDB for raw contract data, detects rollovers, applies Panama adjustment,
 * and writes the result to ohlcv_continuous.
 */
export async function buildContinuousSeries(root: string): Promise<{
  rolloversDetected: number;
  barsWritten: number;
}> {
  const safeRoot = validateSymbol(root);
  const escapedRoot = safeRoot.replace(/'/g, "''");

  console.log(`[continuous] Building continuous series for ${safeRoot}...`);

  // Step 1: Get daily volumes per contract
  const dailyVolumeRows = await queryQuestDB<{
    symbol: string; trade_date: string; total_volume: number; last_close: number;
  }>(`
    SELECT symbol,
           cast(timestamp as DATE) as trade_date,
           sum(volume) as total_volume,
           last(close) as last_close
    FROM ohlcv
    WHERE symbol ~ '^${escapedRoot}[A-Z][0-9]'
    SAMPLE BY 1d
    ALIGN TO CALENDAR
  `);

  if (dailyVolumeRows.length === 0) {
    console.log(`[continuous] No contract data found for root ${safeRoot}`);
    return { rolloversDetected: 0, barsWritten: 0 };
  }

  // Build close prices lookup
  const closePrices: Record<string, number> = {};
  const dailyVolumes: DailyVolume[] = [];
  for (const row of dailyVolumeRows) {
    const dateStr = typeof row.trade_date === 'string'
      ? row.trade_date.slice(0, 10)
      : new Date(row.trade_date).toISOString().slice(0, 10);
    closePrices[`${row.symbol}|${dateStr}`] = Number(row.last_close);
    dailyVolumes.push({
      trade_date: dateStr,
      symbol: row.symbol,
      total_volume: Number(row.total_volume),
    });
  }

  // Step 2: Detect rollovers
  const rawRollovers = detectRollovers(dailyVolumes, closePrices);
  // We need dates for the rollovers — find them from the daily volume data
  const dates = [...new Set(dailyVolumes.map(d => d.trade_date))].sort();
  const dateLeaders = new Map<string, string>();
  for (const date of dates) {
    const entries = dailyVolumes.filter(d => d.trade_date === date);
    entries.sort((a, b) => b.total_volume - a.total_volume);
    dateLeaders.set(date, entries[0].symbol);
  }

  const rollovers: RolloverRecord[] = [];
  let rolloverIdx = 0;
  for (let i = 1; i < dates.length && rolloverIdx < rawRollovers.length; i++) {
    const prevLeader = dateLeaders.get(dates[i - 1])!;
    const currLeader = dateLeaders.get(dates[i])!;
    if (prevLeader !== currLeader) {
      rollovers.push({
        ...rawRollovers[rolloverIdx],
        ts: new Date(dates[i]),
        root: safeRoot,
      });
      rolloverIdx++;
    }
  }

  console.log(`[continuous] Detected ${rollovers.length} rollovers for ${safeRoot}`);

  // Step 3: Write rollovers to QuestDB
  if (rollovers.length > 0) {
    const sender = await getQuestDBSender();
    for (const r of rollovers) {
      await sender
        .table('rollovers')
        .symbol('root', r.root)
        .symbol('from_contract', r.from_contract)
        .symbol('to_contract', r.to_contract)
        .floatColumn('from_close', r.from_close)
        .floatColumn('to_close', r.to_close)
        .floatColumn('price_gap', r.price_gap)
        .symbol('rollover_type', r.rollover_type)
        .at(r.ts.getTime(), 'ms');
    }
    await sender.flush();
  }

  // Step 4: Compute back-adjustment
  const adjustments = computeBackAdjustment(rollovers);

  // Step 5: Query raw bars (volume leader per day) and write adjusted continuous series
  // Process day by day to pick the correct contract
  const sender = await getQuestDBSender();
  let barsWritten = 0;

  for (const date of dates) {
    const leader = dateLeaders.get(date);
    if (!leader) continue;

    const escapedLeader = leader.replace(/'/g, "''");
    const bars = await queryQuestDB<{
      timestamp: Date; open: number; high: number; low: number; close: number; volume: number;
    }>(`
      SELECT timestamp, open, high, low, close, volume
      FROM ohlcv
      WHERE symbol = '${escapedLeader}'
        AND cast(timestamp as DATE) = '${date}'
      ORDER BY timestamp
    `);

    for (const bar of bars) {
      const tsMs = bar.timestamp instanceof Date ? bar.timestamp.getTime() : new Date(bar.timestamp).getTime();
      const adj = getAdjustmentForTimestamp(tsMs, adjustments);

      await sender
        .table('ohlcv_continuous')
        .symbol('root', safeRoot)
        .floatColumn('open', Number(bar.open) + adj)
        .floatColumn('high', Number(bar.high) + adj)
        .floatColumn('low', Number(bar.low) + adj)
        .floatColumn('close', Number(bar.close) + adj)
        .floatColumn('volume', Number(bar.volume))
        .floatColumn('raw_close', Number(bar.close))
        .floatColumn('adjustment', adj)
        .at(tsMs, 'ms');

      barsWritten++;

      // Flush every 50k rows to avoid memory pressure
      if (barsWritten % 50000 === 0) {
        await sender.flush();
        console.log(`[continuous] ${safeRoot}: ${barsWritten.toLocaleString()} bars written...`);
      }
    }
  }

  await sender.flush();
  console.log(`[continuous] ${safeRoot}: done — ${barsWritten.toLocaleString()} bars, ${rollovers.length} rollovers`);

  return { rolloversDetected: rollovers.length, barsWritten };
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/continuousContract.test.ts`
Expected: PASS (pure function tests, no QuestDB needed)

**Step 5: Commit**

```bash
git add server/services/continuousContract.ts tests/continuousContract.test.ts
git commit -m "feat: add continuous contract service for QuestDB"
```

---

## Phase 2: QuestDB Query Helper (Replace `marketQuery`)

### Task 3: Create a `questdbMarketQuery` Drop-In Replacement

Many files call `marketQuery(sql)` which runs against the DuckDB market.duckdb file. We need a drop-in replacement that runs the same SQL patterns against QuestDB instead. This lets us migrate consumers incrementally.

**Files:**
- Create: `server/lib/questdbMarketQuery.ts`
- Test: `tests/questdbMarketQuery.test.ts`

**Step 1: Write the failing test**

Create `tests/questdbMarketQuery.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { questdbMarketQuery } from '../server/lib/questdbMarketQuery';
import { checkQuestDBHealth } from '../server/questdb';

describe('questdbMarketQuery', () => {
  beforeAll(async () => {
    const healthy = await checkQuestDBHealth();
    if (!healthy) throw new Error('QuestDB not available');
  });

  it('returns rows from QuestDB ohlcv table', async () => {
    const rows = await questdbMarketQuery('SELECT count() as cnt FROM ohlcv');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('cnt');
  });

  it('supports symbol queries', async () => {
    const rows = await questdbMarketQuery<{ symbol: string }>(
      "SELECT DISTINCT symbol FROM ohlcv LIMIT 5"
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/questdbMarketQuery.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `server/lib/questdbMarketQuery.ts`:

```typescript
/**
 * Drop-in replacement for marketQuery from server/duckdb/market.ts.
 * Routes SQL queries to QuestDB instead of DuckDB.
 *
 * Important: QuestDB SQL is PostgreSQL-compatible but has some differences:
 * - No parameterized queries via PG wire for DDL
 * - TIMESTAMP vs TIMESTAMPTZ handling
 * - SYMBOL type instead of VARCHAR for indexed strings
 * - SAMPLE BY instead of time_bucket / GROUP BY for aggregation
 *
 * Callers may need minor SQL adjustments when migrating.
 */
import { queryQuestDB } from '../questdb';

export async function questdbMarketQuery<T = any>(sql: string): Promise<T[]> {
  return queryQuestDB<T>(sql);
}
```

**Step 4: Run test to verify it passes**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/questdbMarketQuery.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/lib/questdbMarketQuery.ts tests/questdbMarketQuery.test.ts
git commit -m "feat: add questdbMarketQuery as drop-in replacement for marketQuery"
```

---

## Phase 3: Migrate Route Consumers (DuckDB → QuestDB)

### Task 4: Migrate `charts.ts` to Support Continuous Contracts

The charts route already queries QuestDB. It just needs to know when to query `ohlcv_continuous` (futures roots) vs `ohlcv` (specific contracts / forex).

**Files:**
- Modify: `server/routes/charts.ts`
- Modify: `server/questdb.ts` (add `getOHLCVContinuousSampleBy`)

**Step 1: Write the failing test**

Create `tests/charts-continuous.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isFuturesRoot } from '../server/services/continuousContract';

describe('isFuturesRoot', () => {
  it('identifies futures root symbols', () => {
    expect(isFuturesRoot('ES')).toBe(true);
    expect(isFuturesRoot('NQ')).toBe(true);
    expect(isFuturesRoot('MNQ')).toBe(true);
  });

  it('rejects specific contracts', () => {
    expect(isFuturesRoot('ESH5')).toBe(false);
    expect(isFuturesRoot('NQM5')).toBe(false);
  });

  it('rejects forex symbols', () => {
    expect(isFuturesRoot('EURUSD')).toBe(false);
    expect(isFuturesRoot('GBPJPY')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/charts-continuous.test.ts`

**Step 3: Add `isFuturesRoot` to the continuous contract service**

Add to `server/services/continuousContract.ts`:

```typescript
/**
 * Determine if a symbol is a futures root (ES, NQ, MNQ) vs a specific contract (ESH5)
 * or a forex pair (EURUSD).
 *
 * Futures roots: 1-3 uppercase letters, no trailing contract month+year.
 * Contract months: H, M, U, Z (quarterlies) or F,G,H,J,K,M,N,Q,U,V,X,Z (all months)
 * Specific contracts: root + month letter + 1-2 digit year (ESH5, NQM25)
 * Forex: 6 letters (EURUSD, GBPJPY)
 */
export function isFuturesRoot(symbol: string): boolean {
  // Forex pairs: exactly 6 uppercase letters
  if (/^[A-Z]{6}$/.test(symbol)) return false;
  // Specific contract: letters + month + year digit(s) (ESH5, NQM25, MNQU5)
  if (/^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/.test(symbol)) return false;
  // Futures root: 1-4 uppercase letters, no digits
  if (/^[A-Z]{1,4}$/.test(symbol)) return true;
  return false;
}
```

**Step 4: Add `getOHLCVContinuousSampleBy` to questdb.ts**

Add to `server/questdb.ts`:

```typescript
export async function getOHLCVContinuousSampleBy(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<any[]> {
  const safeRoot = validateSymbol(root);
  const escapedRoot = safeRoot.replace(/'/g, "''");

  let whereClause = `WHERE root = '${escapedRoot}'`;
  if (startTime) {
    whereClause += ` AND ts >= '${new Date(startTime).toISOString()}'`;
  }
  if (endTime) {
    whereClause += ` AND ts <= '${new Date(endTime).toISOString()}'`;
  }

  const safeLimit = limit ? Math.min(Math.floor(limit), 100000) : undefined;
  const limitClause = safeLimit ? `LIMIT ${safeLimit}` : '';

  const validTimeframes: Record<string, string> = {
    '1s': 'SAMPLE BY 1s', '1m': 'SAMPLE BY 1m', '5m': 'SAMPLE BY 5m',
    '15m': 'SAMPLE BY 15m', '30m': 'SAMPLE BY 30m', '1h': 'SAMPLE BY 1h',
    '4h': 'SAMPLE BY 4h', '1d': 'SAMPLE BY 1d', '1w': 'SAMPLE BY 7d',
  };
  const sampleByClause = validTimeframes[timeframe] || 'SAMPLE BY 1m';

  const sql = `
    SELECT
      root as symbol,
      ts as timestamp,
      first(open) as open,
      max(high) as high,
      min(low) as low,
      last(close) as close,
      sum(volume) as volume
    FROM ohlcv_continuous
    ${whereClause}
    ${sampleByClause}
    ALIGN TO CALENDAR
    ${limitClause}
  `;

  return await queryQuestDB(sql);
}
```

**Step 5: Update `charts.ts` to route futures roots to `ohlcv_continuous`**

In `server/routes/charts.ts`, import the new function and `isFuturesRoot`:

```typescript
import { getOHLCVSampleBy, getOHLCVContinuousSampleBy, checkQuestDBHealth, queryQuestDB } from '../questdb';
import { isFuturesRoot } from '../services/continuousContract';
```

Then in the handler, replace the `getOHLCVSampleBy` call with routing logic:

```typescript
const queryFn = isFuturesRoot(symbol)
  ? () => getOHLCVContinuousSampleBy(symbol, sampleLabel, effectiveStart, effectiveEnd, rowLimit)
  : () => getOHLCVSampleBy(symbol, sampleLabel, effectiveStart, effectiveEnd, rowLimit);

const raw = await cachedQuery(cacheKey, queryFn);
```

**Step 6: Run tests**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run tests/charts-continuous.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add server/routes/charts.ts server/questdb.ts server/services/continuousContract.ts tests/charts-continuous.test.ts
git commit -m "feat: route futures root symbols to ohlcv_continuous table"
```

---

### Task 5: Migrate `instruments.ts` Route (marketQuery → questdbMarketQuery)

**Files:**
- Modify: `server/routes/instruments.ts`

**Step 1: Read the current file**

Read `server/routes/instruments.ts` to find all `marketQuery` usages.

**Step 2: Replace imports**

Change:
```typescript
const { marketQuery } = await import("../duckdb/market");
```
To:
```typescript
const { questdbMarketQuery: marketQuery } = await import("../lib/questdbMarketQuery");
```

Note: The dynamic import pattern means we just change the import path. The SQL queries need review — DuckDB SQL may differ from QuestDB SQL. Common differences:
- `DATE_TRUNC` → QuestDB uses `cast(timestamp as DATE)` for day truncation
- `TO_TIMESTAMP` → QuestDB uses direct timestamp comparison
- `LAST(x ORDER BY y)` → QuestDB uses `last(x)` (implicit timestamp ordering)

**Step 3: Test manually**

Start the dev server and test the instruments API endpoints to verify they return correct data.

**Step 4: Commit**

```bash
git add server/routes/instruments.ts
git commit -m "refactor: migrate instruments route from DuckDB to QuestDB"
```

---

### Task 6: Migrate `regime.ts` Route (3 Dynamic Imports)

**Files:**
- Modify: `server/routes/regime.ts`

The regime route has 3 dynamic imports of `marketQuery`. Replace each with `questdbMarketQuery`. Review each SQL query for QuestDB compatibility.

**Step 1: Replace all 3 dynamic imports**

Lines ~281, ~498, ~669 — change each from:
```typescript
const { marketQuery } = await import("../duckdb/market");
```
To:
```typescript
const { questdbMarketQuery: marketQuery } = await import("../lib/questdbMarketQuery");
```

**Step 2: Review SQL for QuestDB compatibility**

QuestDB differences to watch for:
- No `GROUP BY` needed with `SAMPLE BY` — refactor time-based aggregations
- `SYMBOL` type requires `=` comparison, not `LIKE` for exact match
- Window functions supported but syntax may differ slightly

**Step 3: Test manually and commit**

```bash
git add server/routes/regime.ts
git commit -m "refactor: migrate regime route from DuckDB to QuestDB"
```

---

### Task 7: Migrate `agent.ts`, `backtest.ts`, `parquet.ts` Routes

**Files:**
- Modify: `server/routes/agent.ts`
- Modify: `server/routes/backtest.ts`
- Modify: `server/routes/parquet.ts`

Same pattern: replace `marketQuery` imports with `questdbMarketQuery`. Review SQL.

For `parquet.ts`: Remove the `queryPreAggregatedParquet` and `hasPreAggregatedFiles` imports. The pre-aggregation logic is now handled by QuestDB's `SAMPLE BY` natively. Replace parquet-based OHLCV queries with QuestDB queries.

**Step 1: Update imports in each file**

**Step 2: Review and adapt SQL queries**

**Step 3: Commit**

```bash
git add server/routes/agent.ts server/routes/backtest.ts server/routes/parquet.ts
git commit -m "refactor: migrate agent, backtest, parquet routes to QuestDB"
```

---

## Phase 4: Migrate ML Pipeline

### Task 8: Migrate ML Pipeline Files (walkForward, universalPipeline, inferenceService, dataExporter)

**Files:**
- Modify: `server/ml/walkForward.ts`
- Modify: `server/ml/universalPipeline.ts`
- Modify: `server/ml/inferenceService.ts`
- Modify: `server/training/dataExporter.ts`

Same pattern: replace `marketQuery` with `questdbMarketQuery`. These files query OHLCV data for ML feature computation.

For `dataExporter.ts`: Uses `runQuery` from `duckdb/core.ts` — this one stays as DuckDB since it's doing analytics (creating temp tables, exporting parquet). But change any OHLCV reads to come from QuestDB.

**Step 1: Update imports**

**Step 2: Review SQL for QuestDB compatibility**

**Step 3: Commit**

```bash
git add server/ml/walkForward.ts server/ml/universalPipeline.ts server/ml/inferenceService.ts server/training/dataExporter.ts
git commit -m "refactor: migrate ML pipeline from DuckDB to QuestDB for data reads"
```

---

### Task 9: Migrate Label Service

**Files:**
- Modify: `server/lib/labels/labelService.ts`

Replace dynamic `marketQuery` import with `questdbMarketQuery`.

**Step 1: Update the dynamic import at line ~112**

**Step 2: Commit**

```bash
git add server/lib/labels/labelService.ts
git commit -m "refactor: migrate label service from DuckDB to QuestDB"
```

---

## Phase 5: Migrate Ingestion Pipeline

### Task 10: Add `ingested_files` Table to PostgreSQL Schema

**Files:**
- Modify: `shared/schema.ts`

**Step 1: Add the table definition**

Add to `shared/schema.ts`:

```typescript
// File ingestion tracking (dedup) — moved from DuckDB market.duckdb
export const ingestedFiles = pgTable("ingested_files", {
  id: serial("id").primaryKey(),
  filePath: text("file_path").notNull().unique(),
  fileHash: text("file_hash"),
  fileSize: bigint("file_size", { mode: "number" }),
  rowCount: bigint("row_count", { mode: "number" }),
  symbol: text("symbol"),
  tsMin: timestamp("ts_min"),
  tsMax: timestamp("ts_max"),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
}, (table) => ({
  filePathIdx: index("ingested_files_file_path_idx").on(table.filePath),
  symbolIdx: index("ingested_files_symbol_idx").on(table.symbol),
}));

export const insertIngestedFileSchema = createInsertSchema(ingestedFiles).omit({ id: true, ingestedAt: true });
export type InsertIngestedFile = z.infer<typeof insertIngestedFileSchema>;
export type IngestedFile = typeof ingestedFiles.$inferSelect;
```

**Step 2: Push schema to PostgreSQL**

Run: `cd E:\source\repos\ml_dashboard && npm run db:push`

**Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add ingested_files table to PostgreSQL schema"
```

---

### Task 11: Create Direct-to-QuestDB Ingestion Service

**Files:**
- Create: `server/services/ingestionService.ts`
- Test: `tests/ingestionService.test.ts`

This replaces `server/lib/ingestion/ingestParquet.ts` + `fileTracker.ts`. Reads files, normalizes in-memory (TypeScript), writes directly to QuestDB via ILP. Records dedup info in PostgreSQL.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { detectSchema, normalizeRow } from '../server/services/ingestionService';

describe('ingestionService', () => {
  describe('detectSchema', () => {
    it('detects Databento schema', () => {
      const columns = ['ts_event', 'rtype', 'publisher_id', 'instrument_id', 'open', 'high', 'low', 'close', 'volume'];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe('databento');
      expect(schema.tsColumn).toBe('ts_event');
      expect(schema.symbolColumn).toBe('instrument_id');
      expect(schema.priceScale).toBe(1e-9);
    });

    it('detects standard OHLCV schema', () => {
      const columns = ['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume'];
      const schema = detectSchema(columns);
      expect(schema.provider).toBe('standard');
      expect(schema.tsColumn).toBe('timestamp');
      expect(schema.symbolColumn).toBe('symbol');
      expect(schema.priceScale).toBe(1);
    });
  });

  describe('normalizeRow', () => {
    it('normalizes Databento row', () => {
      const schema = { provider: 'databento' as const, tsColumn: 'ts_event', symbolColumn: 'instrument_id', priceScale: 1e-9 };
      const raw = { ts_event: 1700000000000000000n, instrument_id: 12345, open: 5100250000000, high: 5101000000000, low: 5099000000000, close: 5100500000000, volume: 1500 };
      const normalized = normalizeRow(raw, schema, 'ESH5');
      expect(normalized.symbol).toBe('ESH5');
      expect(normalized.open).toBeCloseTo(5100.25);
      expect(normalized.volume).toBe(1500);
    });
  });
});
```

**Step 2: Implement the service**

Create `server/services/ingestionService.ts` with:
- `detectSchema(columns)` — identifies provider from column names
- `normalizeRow(raw, schema, symbol)` — normalizes timestamps, prices, symbol names
- `ingestFile(filePath, symbol)` — reads parquet/CSV, normalizes, writes to QuestDB ILP, records in PostgreSQL
- File dedup via PostgreSQL `ingested_files` table

**Step 3: Run test, commit**

```bash
git add server/services/ingestionService.ts tests/ingestionService.test.ts
git commit -m "feat: add direct-to-QuestDB ingestion service"
```

---

### Task 12: Rewrite Ingestion Scripts

**Files:**
- Modify: `scripts/ingest-futures.ts`
- Modify: `scripts/ingest-forex.ts`
- Modify: `scripts/ingest-trades.ts`
- Modify: `scripts/ingest-mbp10.ts`

Replace `initMarketDB` + `marketQuery` with the new `ingestionService`. Each script reads files and writes directly to QuestDB.

**Step 1: Update each script to use the new ingestion service**

**Step 2: Test with a small file**

**Step 3: Commit**

```bash
git add scripts/ingest-futures.ts scripts/ingest-forex.ts scripts/ingest-trades.ts scripts/ingest-mbp10.ts
git commit -m "refactor: rewrite ingestion scripts to write directly to QuestDB"
```

---

## Phase 6: Refactor DuckDB to Analytics-Only

### Task 13: Replace `core.ts` with `analytics.ts` (Add postgres_scanner)

**Files:**
- Create: `server/duckdb/analytics.ts`
- Modify: `server/duckdb.ts` (barrel export)

**Step 1: Write the new analytics module**

Create `server/duckdb/analytics.ts`:

```typescript
/**
 * DuckDB Analytics Engine — ephemeral in-memory compute.
 *
 * Replaces: server/duckdb/core.ts + server/duckdb/market.ts
 *
 * No persistent storage. Queries QuestDB via postgres_scanner
 * when analytics need price data. Computes features, indicators,
 * and ML datasets in memory. Exports to Parquet.
 */
import DuckDB from 'duckdb';

const db = new DuckDB.Database(':memory:');
const conn = db.connect();

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

export async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  await mutex.acquire();
  try { return await fn(); }
  finally { mutex.release(); }
}

let initialized = false;

export async function initAnalyticsDuckDB(): Promise<void> {
  if (initialized) return;

  return withMutex(async () => {
    // Performance settings
    await runQueryUnlocked('SET threads TO 4');
    await runQueryUnlocked("SET memory_limit = '4GB'");

    // Install postgres_scanner for QuestDB access
    try {
      await runQueryUnlocked('INSTALL postgres_scanner');
      await runQueryUnlocked('LOAD postgres_scanner');

      const questdbHost = process.env.QUESTDB_HOST || 'localhost';
      const questdbPort = process.env.QUESTDB_PG_PORT || '8812';

      await runQueryUnlocked(`
        ATTACH 'host=${questdbHost} port=${questdbPort} user=admin password=quest dbname=qdb'
        AS questdb (TYPE postgres, READ_ONLY)
      `);
      console.log('[analytics] postgres_scanner attached to QuestDB');
    } catch (err) {
      console.warn('[analytics] postgres_scanner setup failed (QuestDB reads will not work):', err);
    }

    initialized = true;
    console.log('[analytics] DuckDB analytics engine initialized');
  });
}

export function runQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return withMutex(() => runQueryUnlocked<T>(sql, params));
}

export function runQueryUnlocked<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (params.length > 0) {
      const stmt = conn.prepare(sql);
      stmt.all(...params, (err: Error | null, result: T[]) => {
        stmt.finalize();
        if (err) reject(err);
        else resolve(result);
      });
    } else {
      conn.all(sql, (err, result) => {
        if (err) reject(err);
        else resolve(result as T[]);
      });
    }
  });
}

export function closeAnalyticsDuckDB(): void {
  conn.close();
  db.close();
}

export { conn, db };
```

**Step 2: Update the barrel export**

Modify `server/duckdb.ts` to re-export from `analytics.ts` instead of `core.ts`:

```typescript
export { initAnalyticsDuckDB as initDuckDB, runQuery, runQueryUnlocked, withMutex, closeAnalyticsDuckDB as closeDuckDB } from './duckdb/analytics';
```

Remove the preAggregation re-exports.

**Step 3: Update `server/index.ts` startup**

Replace:
```typescript
import { initMarketDB } from "./duckdb/market";
```
With:
```typescript
// Market DB initialization removed — QuestDB is the sole time-series store
```

Remove the `initMarketDB()` call from the startup sequence.

Update the `initDuckDB()` call to be `initAnalyticsDuckDB()` (or keep using the barrel export alias).

**Step 4: Commit**

```bash
git add server/duckdb/analytics.ts server/duckdb.ts server/index.ts
git commit -m "refactor: replace DuckDB core+market with analytics-only engine"
```

---

## Phase 7: Cleanup

### Task 14: Delete Obsolete Files

**Files to delete:**
- `server/duckdb/market.ts` — persistent market DB (replaced by QuestDB)
- `server/duckdb/preAggregation.ts` — DuckDB continuous contracts (replaced by service)
- `server/duckdb/core.ts` — old analytics core (replaced by analytics.ts)
- `server/lib/questdbSync.ts` — DuckDB→QuestDB sync (no longer needed)

**Scripts to delete:**
- `scripts/sync-to-questdb.ts` — no longer needed
- `scripts/fast-questdb-sync.ts` — no longer needed
- `scripts/sync-mbp10-questdb.ts` — no longer needed
- `scripts/sync-trades-questdb.ts` — no longer needed
- `scripts/compute-rollovers.ts` — replaced by continuous contract service

**Step 1: Delete the files**

```bash
git rm server/duckdb/market.ts server/duckdb/preAggregation.ts server/duckdb/core.ts
git rm server/lib/questdbSync.ts
git rm scripts/sync-to-questdb.ts scripts/fast-questdb-sync.ts scripts/sync-mbp10-questdb.ts scripts/sync-trades-questdb.ts scripts/compute-rollovers.ts
```

**Step 2: Verify no remaining imports reference deleted files**

Run: `npx tsc --noEmit` to check for broken imports.

**Step 3: Fix any remaining broken references**

**Step 4: Commit**

```bash
git commit -m "chore: remove obsolete DuckDB market and sync files"
```

---

### Task 15: Update Tests and Documentation

**Files:**
- Modify: `tests/ingestion.test.ts` — update to use new ingestion service
- Modify: `docs/plans/2026-02-18-data-architecture-design.md` — add note that it's superseded
- Verify: All existing tests pass

**Step 1: Update ingestion test**

**Step 2: Run full test suite**

Run: `cd E:\source\repos\ml_dashboard && npx vitest run`
Expected: All tests pass.

**Step 3: Add superseded note to old design doc**

Add at top of `docs/plans/2026-02-18-data-architecture-design.md`:
```
> **SUPERSEDED** by `2026-02-23-questdb-centric-architecture-design.md`
```

**Step 4: Commit**

```bash
git add tests/ docs/plans/
git commit -m "chore: update tests and docs for QuestDB-centric architecture"
```

---

### Task 16: Data Migration (DuckDB → QuestDB)

This task handles migrating any data that exists in DuckDB but not yet in QuestDB.

**Note:** Most OHLCV data (759M of 782M rows) is already in QuestDB. This task covers:
1. Verifying data completeness (are the missing 23M rows accounted for?)
2. Migrating `trades` data (14.5M rows) if not already in QuestDB
3. Migrating `mbp10` data if not already in QuestDB
4. Migrating `ingested_files` records to PostgreSQL
5. Running `buildContinuousSeries()` for each futures root to populate `ohlcv_continuous`

**Step 1: Create a migration script**

Create `scripts/migrate-to-questdb-centric.ts`:

```typescript
/**
 * One-time migration: DuckDB market.duckdb → QuestDB + PostgreSQL
 *
 * 1. Verify OHLCV completeness in QuestDB
 * 2. Migrate trades to QuestDB
 * 3. Migrate mbp10 to QuestDB
 * 4. Migrate ingested_files to PostgreSQL
 * 5. Build continuous contract series
 */
// Implementation: read from DuckDB market.duckdb, write to QuestDB via ILP
// and PostgreSQL via Drizzle ORM
```

**Step 2: Run the migration**

**Step 3: Verify counts match**

**Step 4: Commit the script**

```bash
git add scripts/migrate-to-questdb-centric.ts
git commit -m "feat: add one-time migration script for QuestDB-centric architecture"
```

---

### Task 17: Final Verification

**Step 1: Start the dev server**

Run: `cd E:\source\repos\ml_dashboard && npm run dev`

**Step 2: Verify chart loading works**

Open the dashboard, load a futures root symbol (ES) and verify:
- Chart loads with continuous contract data
- Timeframe switching works (1m, 5m, 1h, 1d)
- No DuckDB errors in console

**Step 3: Verify analytics still work**

Test indicator computation, feature generation, and any ML pipeline endpoints.

**Step 4: Verify no references to deleted modules**

Run: `npx tsc --noEmit`

**Step 5: Run full test suite**

Run: `npx vitest run`

**Step 6: Delete `data/market.duckdb` (after confirming migration is complete)**

This is destructive — only do this after confirming all data is in QuestDB.

**Step 7: Final commit**

```bash
git add -A
git commit -m "chore: QuestDB-centric architecture migration complete"
```

---

## Summary of Phases

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-2 | QuestDB tables + continuous contract service |
| 2 | 3 | Drop-in `questdbMarketQuery` replacement |
| 3 | 4-7 | Migrate route consumers |
| 4 | 8-9 | Migrate ML pipeline + label service |
| 5 | 10-12 | Ingestion pipeline (PostgreSQL dedup + direct QuestDB) |
| 6 | 13 | DuckDB analytics-only refactor |
| 7 | 14-17 | Cleanup, tests, migration, verification |

Total: 17 tasks across 7 phases. Each phase can be committed independently and the app should remain functional between phases.
