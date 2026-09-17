#!/usr/bin/env node
/**
 * Create the SQLite schema, then prove it actually landed.
 *
 * Two things make this more than a wrapper around `npm run db:push`.
 *
 * 1. `data/` is gitignored, so it does not exist on a clean checkout, and
 *    better-sqlite3 refuses to create a database in a directory that is not
 *    there. Every CI job that starts the server needs the directory first.
 *
 * 2. **drizzle-kit push exits 0 even when it failed to open the database.** A CI
 *    step that just runs it therefore goes green while the schema is absent, the
 *    server boots against the four tables `enforce-sqlite-invariants` self-heals,
 *    and `markOrphanedSessionsFailed()` throws `no such table: training_sessions`
 *    during bootstrap. Under NODE_ENV=production that exits 1 — so the real
 *    failure surfaces as "server exited during boot" in the smoke job, or as a
 *    180-second webServer timeout in the e2e job, several steps away from the
 *    cause.
 *
 * Counting tables afterwards is the only honest check.
 *
 *   node scripts/db-push-verify.mjs
 *   node scripts/db-push-verify.mjs --min-tables 30
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);

/**
 * Which database to build.
 *
 * Defaults to the real one, which is what CI wants: a clean runner has no
 * database and this is the step that creates it.
 *
 * `--db <path>` targets a throwaway file instead, which is what the local mirror
 * wants. Running `drizzle-kit push` against a developer's working database is
 * both destructive and useless as a gate — on an already-migrated database it
 * fails outright ("index coherence_snapshots_ts_idx already exists"), so the
 * stage would be permanently red locally while CI was perfectly fine.
 */
const dbArg = argv.indexOf('--db');
const DB_PATH =
  dbArg >= 0 && argv[dbArg + 1]
    ? path.resolve(ROOT, argv[dbArg + 1])
    : path.join(ROOT, 'data', 'ml_dashboard.db');
const minTablesArg = argv.indexOf('--min-tables');
/**
 * `src/shared/schema.ts` declares 44 tables. The floor is deliberately well
 * below that so an intentional schema change does not fail the gate, but far
 * enough above the 4 that self-heal at boot to catch a push that did nothing.
 */
const MIN_TABLES = minTablesArg >= 0 ? Number(argv[minTablesArg + 1]) : 20;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// A throwaway target starts empty, so the push exercises the create-from-scratch
// path a clean CI runner takes rather than a migration of existing tables.
if (dbArg >= 0 && fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH, { force: true });

// A compile-time constant with no interpolation, so there is no injection
// surface here. It goes through a shell deliberately: `npx` is a shim script on
// Windows and does not exec directly.
execSync('npx drizzle-kit push', {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, DRIZZLE_SQLITE_PATH: DB_PATH },
});

const { default: Database } = await import('better-sqlite3');
const db = new Database(DB_PATH, { readonly: true });

const { n } = db
  .prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .get();

db.close();

console.log(`schema: ${n} tables in ${path.relative(ROOT, DB_PATH)}`);

if (n < MIN_TABLES) {
  console.error(
    `::error::drizzle-kit push reported success but only ${n} tables exist ` +
      `(expected at least ${MIN_TABLES}). drizzle-kit exits 0 on failure — the schema did not land.`,
  );
  process.exit(1);
}
