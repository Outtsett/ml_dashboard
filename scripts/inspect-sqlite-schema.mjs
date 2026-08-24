#!/usr/bin/env node
// Read-only inspection of a SQLite database's live schema (sqlite_master).
// Opens the DB in readonly mode so no WAL checkpoint or write ever occurs.
// Usage: node scripts/inspect-sqlite-schema.mjs <path-to-db> [--table=<name>]
import Database from 'better-sqlite3';

const dbPath = process.argv[2];
const tableFilter = process.argv.find((a) => a.startsWith('--table='))?.split('=')[1];

if (!dbPath) {
  console.error('Usage: node scripts/inspect-sqlite-schema.mjs <path-to-db> [--table=<name>]');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

let query = `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL`;
const params = [];
if (tableFilter) {
  query += ` AND tbl_name = ?`;
  params.push(tableFilter);
}
query += ` ORDER BY type, tbl_name, name`;

const rows = db.prepare(query).all(...params);

for (const row of rows) {
  console.log(`-- type=${row.type} name=${row.name} tbl_name=${row.tbl_name}`);
  console.log(row.sql + ';');
  console.log('');
}

db.close();
