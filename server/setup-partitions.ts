import { pool } from "./db";

const FUTURES_SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM'];
const FOREX_SYMBOLS = [
  'AUDJPY', 'AUDNZD', 'AUDUSD', 'CADJPY', 'EURAUD', 'EURCHF', 'EURGBP', 
  'EURJPY', 'EURUSD', 'GBPAUD', 'GBPCHF', 'GBPJPY', 'GBPUSD', 'NZDUSD', 
  'USDCAD', 'USDCHF', 'USDJPY'
];

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

export async function setupPartitionedTables() {
  const client = await pool.connect();
  
  try {
    console.log('Setting up partitioned tables for OHLCV data...');
    
    await client.query('BEGIN');

    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'ohlcv_partitioned'
      );
    `);

    if (tableExists.rows[0].exists) {
      console.log('Partitioned tables already exist, skipping setup.');
      await client.query('COMMIT');
      return;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ohlcv_partitioned (
        id SERIAL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        PRIMARY KEY (id, asset_type, timestamp),
        UNIQUE (symbol, asset_type, timestamp)
      ) PARTITION BY LIST (asset_type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ohlcv_futures PARTITION OF ohlcv_partitioned
      FOR VALUES IN ('futures')
      PARTITION BY RANGE (timestamp);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ohlcv_forex PARTITION OF ohlcv_partitioned
      FOR VALUES IN ('forex')
      PARTITION BY RANGE (timestamp);
    `);

    for (const year of YEARS) {
      const startTs = new Date(`${year}-01-01T00:00:00Z`).getTime();
      const endTs = new Date(`${year + 1}-01-01T00:00:00Z`).getTime();
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS ohlcv_futures_${year} PARTITION OF ohlcv_futures
        FOR VALUES FROM (${startTs}) TO (${endTs});
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS ohlcv_forex_${year} PARTITION OF ohlcv_forex
        FOR VALUES FROM (${startTs}) TO (${endTs});
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS ohlcv_part_symbol_idx ON ohlcv_partitioned (symbol);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ohlcv_part_timestamp_idx ON ohlcv_partitioned (timestamp);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ohlcv_part_symbol_timestamp_idx ON ohlcv_partitioned (symbol, timestamp);
    `);

    await client.query('COMMIT');
    console.log('Partitioned tables created successfully!');
    console.log(`- Futures partitions: ${YEARS.length} yearly partitions`);
    console.log(`- Forex partitions: ${YEARS.length} yearly partitions`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting up partitions:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateToPartitionedTables() {
  const client = await pool.connect();
  
  try {
    console.log('Migrating existing data to partitioned tables...');
    
    const oldTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'ohlcv_data'
      );
    `);

    if (!oldTableExists.rows[0].exists) {
      console.log('No existing ohlcv_data table to migrate from.');
      return;
    }

    // Check if partitioned tables already have data
    const partitionedCount = await client.query('SELECT COUNT(*) FROM ohlcv_partitioned LIMIT 1');
    const alreadyMigrated = parseInt(partitionedCount.rows[0].count) > 0;
    
    if (alreadyMigrated) {
      console.log('Data already migrated to partitioned tables.');
      return;
    }

    const countResult = await client.query('SELECT COUNT(*) FROM ohlcv_data');
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log('No data to migrate.');
      return;
    }

    console.log(`Migrating ${totalRows.toLocaleString()} rows...`);

    await client.query('BEGIN');

    await client.query(`
      INSERT INTO ohlcv_partitioned (symbol, asset_type, timestamp, open, high, low, close, volume)
      SELECT 
        symbol,
        CASE 
          WHEN symbol IN (${FUTURES_SYMBOLS.map(s => `'${s}'`).join(',')}) THEN 'futures'
          WHEN symbol IN (${FOREX_SYMBOLS.map(s => `'${s}'`).join(',')}) THEN 'forex'
          WHEN symbol ~ '^[A-Z]{6}$' THEN 'forex'
          ELSE 'futures'
        END as asset_type,
        timestamp,
        open,
        high,
        low,
        close,
        volume
      FROM ohlcv_data
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error migrating data:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPartitionStats() {
  const client = await pool.connect();
  
  try {
    const result = await client.query(`
      SELECT 
        schemaname,
        relname as table_name,
        n_live_tup as row_count
      FROM pg_stat_user_tables 
      WHERE relname LIKE 'ohlcv%'
      ORDER BY relname;
    `);
    
    return result.rows;
  } finally {
    client.release();
  }
}
