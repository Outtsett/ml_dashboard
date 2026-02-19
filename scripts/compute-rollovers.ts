/**
 * Compute volume-based contract rollovers from DuckDB OHLCV data.
 *
 * 1. Aggregate all contracts to daily bars
 * 2. For each root symbol + day, find the volume leader
 * 3. Detect rollover days (when leader changes)
 * 4. Compute Panama (additive) price gaps at each rollover
 * 5. Store results in DuckDB `rollovers` table + PG `contract_rollovers`
 *
 * Run: npx tsx scripts/compute-rollovers.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import pg from 'pg';

const ROOTS = ['MNQ', 'MES', 'M2K', 'MYM', 'RTY', 'NQ', 'ES', 'YM'];
const MONTH_CODES = 'FGHJKMNQUVXZ';

// Regex: root symbol followed by single month code + 1-2 digit year
const ROOT_REGEX = ROOTS.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

async function main() {
  const start = Date.now();
  await initMarketDB();

  // Ensure rollovers table exists (clean slate)
  await marketQuery(`DROP TABLE IF EXISTS rollovers`);
  await marketQuery(`
    CREATE TABLE rollovers (
      root VARCHAR NOT NULL,
      rollover_date DATE NOT NULL,
      from_contract VARCHAR NOT NULL,
      to_contract VARCHAR NOT NULL,
      from_close DOUBLE NOT NULL,
      to_close DOUBLE NOT NULL,
      price_gap DOUBLE NOT NULL,
      cumulative_adjustment DOUBLE NOT NULL
    )
  `);

  console.log('[rollovers] Computing daily volume per contract...');

  // Step 1-4: Single DuckDB query — daily aggregation, root extraction,
  // volume leader detection, rollover detection, price gaps
  const rollovers = await marketQuery<{
    root: string;
    rollover_date: string;
    from_contract: string;
    to_contract: string;
    from_close: number;
    to_close: number;
    price_gap: number;
  }>(`
    WITH daily AS (
      SELECT
        symbol,
        CAST(ts AS DATE) as day,
        first(open ORDER BY ts) as day_open,
        max(high) as day_high,
        min(low) as day_low,
        last(close ORDER BY ts) as day_close,
        sum(volume) as day_volume
      FROM ohlcv
      WHERE symbol NOT LIKE '%-%'
        AND regexp_matches(symbol, '^(${ROOT_REGEX})[${MONTH_CODES}]\\d{1,2}$')
      GROUP BY symbol, CAST(ts AS DATE)
    ),
    with_root AS (
      SELECT *,
        regexp_extract(symbol, '^(${ROOT_REGEX})', 1) as root
      FROM daily
      WHERE day_volume > 0
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY root, day ORDER BY day_volume DESC) as rn
      FROM with_root
    ),
    leaders AS (
      SELECT root, day, symbol as leader, day_volume, day_close
      FROM ranked
      WHERE rn = 1
    ),
    with_prev AS (
      SELECT *,
        LAG(leader) OVER (PARTITION BY root ORDER BY day) as prev_leader,
        LAG(day_close) OVER (PARTITION BY root ORDER BY day) as prev_close
      FROM leaders
    )
    SELECT
      root,
      CAST(day AS VARCHAR) as rollover_date,
      prev_leader as from_contract,
      leader as to_contract,
      prev_close as from_close,
      day_close as to_close,
      (day_close - prev_close) as price_gap
    FROM with_prev
    WHERE prev_leader IS NOT NULL
      AND leader != prev_leader
    ORDER BY root, day
  `);

  console.log(`[rollovers] Found ${rollovers.length} rollover events across ${ROOTS.length} roots`);

  // Print summary per root
  const byRoot = new Map<string, typeof rollovers>();
  for (const r of rollovers) {
    if (!byRoot.has(r.root)) byRoot.set(r.root, []);
    byRoot.get(r.root)!.push(r);
  }
  for (const [root, events] of byRoot) {
    console.log(`  ${root}: ${events.length} rollovers (${events[0].rollover_date} → ${events[events.length - 1].rollover_date})`);
  }

  // Step 5: Compute cumulative adjustments (sum of future gaps, backward)
  // For each root, the most recent contract gets 0 adjustment.
  // Each older rollover accumulates the sum of all later price gaps.
  const withCumulative: Array<typeof rollovers[0] & { cumulative_adjustment: number }> = [];

  for (const [root, events] of byRoot) {
    // events are sorted ascending by date. Walk backward to accumulate.
    let cumAdj = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      withCumulative.push({ ...events[i], cumulative_adjustment: cumAdj });
      cumAdj += events[i].price_gap;
    }
  }

  // Step 6: Insert into DuckDB rollovers table
  if (withCumulative.length > 0) {
    const values = withCumulative.map(r =>
      `('${r.root}', '${r.rollover_date}', '${r.from_contract}', '${r.to_contract}', ${r.from_close}, ${r.to_close}, ${r.price_gap}, ${r.cumulative_adjustment})`
    ).join(',\n');

    await marketQuery(`INSERT INTO rollovers VALUES ${values}`);
    console.log(`[rollovers] Inserted ${withCumulative.length} rows into DuckDB rollovers table`);
  }

  // Step 7: Sync to PostgreSQL contract_rollovers table
  console.log('[rollovers] Syncing to PostgreSQL...');
  const pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ml_dashboard',
  });

  try {
    await pgPool.query('DELETE FROM contract_rollovers');

    for (const r of withCumulative) {
      const epochMs = new Date(r.rollover_date).getTime();
      await pgPool.query(
        `INSERT INTO contract_rollovers (base_symbol, from_contract, to_contract, rollover_timestamp, price_adjustment, from_close, to_close, ratio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.root, r.from_contract, r.to_contract, epochMs, r.cumulative_adjustment, r.from_close, r.to_close, r.price_gap]
      );
    }
    console.log(`[rollovers] Synced ${withCumulative.length} rows to PG contract_rollovers`);
  } catch (e: any) {
    console.error('[rollovers] PG sync error:', e.message);
  } finally {
    await pgPool.end();
  }

  // Verify
  const check = await marketQuery(`
    SELECT root, count(*) as cnt,
           min(rollover_date)::VARCHAR as first_roll,
           max(rollover_date)::VARCHAR as last_roll
    FROM rollovers
    GROUP BY root
    ORDER BY root
  `);
  console.log('\n[rollovers] Summary:');
  for (const row of check) {
    console.log(`  ${row.root}: ${row.cnt} rollovers (${row.first_roll} → ${row.last_roll})`);
  }

  closeMarketDB();
  console.log(`\n[rollovers] Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch(console.error);
