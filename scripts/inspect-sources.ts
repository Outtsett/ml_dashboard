/**
 * Inspect all source data files — print schemas, row counts, and sample data.
 * Run: npx tsx scripts/inspect-sources.ts
 */
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

// Handle BigInt serialization in JSON.stringify
(BigInt.prototype as any).toJSON = function () { return Number(this); };

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
  const stat = fs.statSync(filePath);
  console.log(`SIZE: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

  try {
    const schema = await query(`DESCRIBE SELECT * FROM read_parquet('${safePath}')`);
    console.log('\nSCHEMA:');
    schema.forEach(col => console.log(`  ${col.column_name}: ${col.column_type}`));

    const count = await query(`SELECT COUNT(*) as cnt FROM read_parquet('${safePath}')`);
    console.log(`\nROWS: ${Number(count[0].cnt).toLocaleString()}`);

    const sample = await query(`SELECT * FROM read_parquet('${safePath}') LIMIT 3`);
    console.log('\nSAMPLE:');
    sample.forEach(row => console.log(' ', JSON.stringify(row)));

    for (const col of schema) {
      if (['symbol', 'instrument_id', 'ticker'].includes(col.column_name.toLowerCase())) {
        const symbols = await query(
          `SELECT DISTINCT ${col.column_name} FROM read_parquet('${safePath}') LIMIT 20`
        );
        console.log(`\nDISTINCT ${col.column_name}:`, symbols.map(r => Object.values(r)[0]));
      }
    }
  } catch (err: any) {
    console.log(`ERROR reading: ${err.message}`);
  }
}

async function inspectDuckDB(dbPath: string) {
  const safePath = dbPath.replace(/\\/g, '/');
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DUCKDB: ${dbPath}`);

  try {
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
      console.log(`ROWS: ${Number(count[0].cnt).toLocaleString()}`);

      const sample = await query(`SELECT * FROM src.${name} LIMIT 3`);
      console.log('SAMPLE:');
      sample.forEach(row => console.log(' ', JSON.stringify(row)));
    }

    // Also check views
    const views = await query("SELECT table_name FROM information_schema.tables WHERE table_catalog = 'src' AND table_type = 'VIEW'");
    if (views.length > 0) {
      console.log('\nVIEWS:', views.map(v => v.table_name));
    }

    await query("DETACH src");
  } catch (err: any) {
    console.log(`ERROR: ${err.message}`);
  }
}

async function main() {
  const sourcesDir = path.join(process.cwd(), 'data', 'sources');

  if (!fs.existsSync(sourcesDir)) {
    console.log(`Sources directory not found: ${sourcesDir}`);
    process.exit(1);
  }

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
    console.log(`\n--- Subdirectory: ${subdir} (${subFiles.length} parquet files) ---`);
    for (const f of subFiles.slice(0, 3)) { // Only inspect first 3 per subdir
      await inspectParquet(path.join(subdirPath, f));
    }
    if (subFiles.length > 3) {
      console.log(`  ... and ${subFiles.length - 3} more files`);
    }
  }

  conn.close();
  db.close();
}

main().catch(console.error);
