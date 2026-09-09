/**
 * Explorer Routes — Drizzle (SQLite) and QuestDB direct querying
 *
 * Routes:
 *   GET  /api/databases/tables
 *   GET  /api/databases/questdb/stats
 *   POST /api/databases/query
 *   POST /api/databases/questdb/init
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { getString } from '../infrastructure/lib/routeHelpers';
import { logInfo } from '../infrastructure/lib/log';
import { dbReadOnly } from '../infrastructure/database/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { queryRateLimiter } from '../infrastructure/lib/rateLimiter';

export const DATA_DIR = path.join(process.cwd(), 'data');

// ── SQL validation helpers ──────────────────────────────────

/** Only allow alphanumeric, underscore, dot, and hyphen; max 128 chars */
const SAFE_NAME = /^[a-zA-Z0-9_\-\.]{1,128}$/;

function validateSafeName(name: string, label: string) {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid ${label} name: contains illegal characters or too long`);
  }
}

// ── Shared Table Schema Logic ───────────────────────────────

interface TableMeta {
  name: string;
  source: 'sqlite' | 'questdb';
  rowCount: number;
}

const router = Router();

/** Caps wall-clock time on an ad-hoc QuestDB query issued from the console —
 *  matches the project's existing 15s route-timeout convention. Bounds how
 *  long a runaway scan (e.g. unbounded `SELECT * FROM ohlcv`, 863M rows) can
 *  hold the connection; the row-count cap below still applies only after the
 *  query returns, so this does not bound peak memory on a fast-but-huge scan. */
const QUESTDB_QUERY_TIMEOUT_MS = 15_000;

/**
 * Institutional Table Inventory: Returns all tables across both engines.
 */
router.get('/tables', queryRateLimiter, async (_req: Request, res: Response) => {
  try {
    // 1. Fetch SQLite tables (Drizzle)
    const sqliteTables = await dbReadOnly.all<{ name: string }>(
      drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );

    // 2. Fetch QuestDB tables (if reachable)
    interface QuestDBTableRow {
      table_name: string;
      table_row_count: number;
    }
    let questdbTables: QuestDBTableRow[] = [];
    try {
      const { queryQuestDB } = await import('../infrastructure/database/questdb');
      questdbTables = await queryQuestDB<QuestDBTableRow>('tables()');
    } catch (e) {
      console.warn('[Explorer] QuestDB tables listing failed:', e);
    }

    const results: TableMeta[] = [
      ...sqliteTables.map((r) => ({
        name: r.name,
        source: 'sqlite' as const,
        rowCount: -1, // Placeholder
      })),
      ...questdbTables.map((t) => ({
        name: t.table_name,
        source: 'questdb' as const,
        rowCount: t.table_row_count ?? -1,
      })),
    ];

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Returns column-level schema for a specific table.
 */
router.get('/tables/:name/schema', async (req: Request, res: Response) => {
  try {
    const tableName = getString(req.params.name);
    validateSafeName(tableName, 'table');
    const source = req.query.source as 'sqlite' | 'questdb';

    if (source === 'sqlite') {
      const rows = await dbReadOnly.all(drizzleSql.raw(`PRAGMA table_info(${tableName})`));
      return res.json(rows);
    } else {
      const { queryQuestDB } = await import('../infrastructure/database/questdb');
      const info = await queryQuestDB(`table_columns('${tableName}')`);
      return res.json(info);
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * SQLite Metadata Stats.
 */
router.get('/sqlite/stats', async (_req: Request, res: Response) => {
  try {
    const sqliteTables = await dbReadOnly.all<{ name: string }>(
      drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    
    const tableDetails = [];
    let totalRecords = 0;
    
    for (const t of sqliteTables) {
      const result = await dbReadOnly.all<{ count: number }>(drizzleSql.raw(`SELECT count(*) as count FROM ${t.name}`));
      const count = result?.[0]?.count || 0;
      tableDetails.push({
        name: t.name,
        rowCount: count,
        description: 'SQLite metadata table'
      });
      totalRecords += count;
    }
    
    res.json({
      sizeMb: 0,
      tables: sqliteTables.length,
      records: totalRecords,
      tableDetails
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * QuestDB High-Resolution Stats.
 */
router.get('/questdb/stats', async (_req: Request, res: Response) => {
  try {
    const { getQuestDBStats } = await import('../infrastructure/database/questdb');
    const stats = await getQuestDBStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Strip SQL comments so the read-only gate cannot be walked past with a
 * leading `/*...*​/` or `--` line. Applied ONLY to decide whether the statement
 * is a read; the original text is what actually executes.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
}

/**
 * Read-only allowlist. Blocklisting verbs was the previous approach and it
 * failed open: `startsWith('DROP')` misses `/**​/DROP`, and UPDATE / INSERT /
 * ALTER / PRAGMA / ATTACH were never listed at all. An allowlist fails closed —
 * anything that is not recognisably a read is refused.
 */
export const READ_ONLY_STATEMENT =
  /^\s*(?:WITH\b[\s\S]*?\bSELECT\b|SELECT\b|SHOW\b|EXPLAIN\b|PRAGMA\s+table_info\b|TABLES\s*\(|table_columns\s*\()/i;

/** Coerce an untrusted body value to a bounded row limit. Never interpolated raw. */
export function safeLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(n, 1), 1000);
}

/**
 * Raw Query Console — READ-ONLY, enforced two ways.
 *
 * 1. The statement must match READ_ONLY_STATEMENT (allowlist, fails closed).
 * 2. SQLite runs on `dbReadOnly`, an OS-level `{ readonly: true }` handle, so a
 *    write cannot land even if (1) is bypassed by a SQLite function trick —
 *    which is exactly why db.ts opens that second handle. This endpoint was
 *    using the read-WRITE handle while its siblings at /schema and /preview
 *    used the read-only one.
 *
 * QuestDB has no read-only connection here, so for that source the allowlist is
 * the only barrier — and `ohlcv` is 863M rows with no second copy. Keep the
 * allowlist strict.
 *
 * STILL UNGATED: there is no authentication on this route. That is a product
 * decision, not a bug fix, and is left to the owner. See the note in the
 * session summary.
 */
router.post('/query', queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const { sql, source, limit } = req.body;
    if (!sql) return res.status(400).json({ error: 'Missing SQL query' });

    const cleanSql = String(sql).trim();
    const rowLimit = safeLimit(limit);

    if (!READ_ONLY_STATEMENT.test(stripSqlComments(cleanSql))) {
      return res.status(403).json({
        error:
          'Only read statements are permitted (SELECT / WITH … SELECT / SHOW / ' +
          'EXPLAIN / PRAGMA table_info / TABLES()).',
      });
    }

    if (source === 'sqlite') {
      const rows = await dbReadOnly.all(drizzleSql.raw(`${cleanSql} LIMIT ${rowLimit}`));
      res.json({ rows });
    } else {
      const { queryQuestDB } = await import('../infrastructure/database/questdb');
      // No LIMIT is injected into the caller's SQL (QuestDB's LIMIT syntax is
      // offset,count and blindly appending risks a duplicate/invalid clause on
      // a query that already has one, or on SHOW/EXPLAIN/PRAGMA); the
      // timeoutMs bound is the actual defense against a runaway full-table
      // scan, and the slice below still caps what is returned to the caller.
      const result = await queryQuestDB(cleanSql, QUESTDB_QUERY_TIMEOUT_MS);
      res.json(result.slice(0, rowLimit));
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Data preview (Top 50 rows).
 */
router.get('/tables/:name/preview', async (req: Request, res: Response) => {
  try {
    const tableName = getString(req.params.name);
    validateSafeName(tableName, 'table');
    const source = req.query.source as 'sqlite' | 'questdb';

    if (source === 'sqlite') {
      const rows = await dbReadOnly.all(drizzleSql.raw(`SELECT * FROM ${tableName} LIMIT 50`));
      res.json(rows);
    } else {
      const { queryQuestDB } = await import('../infrastructure/database/questdb');
      const result = await queryQuestDB(`SELECT * FROM ${tableName} LIMIT 50`);
      res.json(result);
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Initialize / Repair QuestDB schemas.
 */
router.post('/questdb/init', async (_req: Request, res: Response) => {
  try {
    const { createOHLCVTable } = await import('../infrastructure/database/questdb');
    await createOHLCVTable();
    res.json({ success: true, message: 'QuestDB schemas verified/created' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Launch D-Tale server for a specific dataset
 */
import { spawn, ChildProcess } from 'child_process';
let currentDtaleProcess: ChildProcess | null = null;

const DTALE_DATA_ROOT = process.env.LAKE_ROOT ?? 'E:\\lake';
// Bind to loopback only. D-Tale has no auth of its own, so anything it is
// pointed at would otherwise be readable by any host on the LAN.
const DTALE_HOST = '127.0.0.1';
// Mirrors the Compression select in DTaleExplorer.tsx.
const ALLOWED_SAMPLE_BY = new Set(['raw', '1m', '5m', '15m', '1h', '4h', '1d']);
// Every live QuestDB table name matches this; it also rules out a leading '-',
// which spawn would otherwise hand to the Python script as a flag.
const QUESTDB_TABLE_RE = /^[A-Za-z0-9_]+$/;

/**
 * Resolve a client-supplied dataset path inside DTALE_DATA_ROOT.
 *
 * Relative subpaths are allowed so run artifacts under runs/<jobId>/ stay
 * reachable, but absolute paths, drive letters, UNC prefixes and '..' segments
 * are rejected before resolving — path.resolve() treats an absolute second
 * argument as a new root, so passing one through would escape the base
 * entirely. The containment check backstops the parsing.
 */
export function resolveDatasetPath(filename: string): string | null {
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (!/\.(parquet|csv)$/i.test(filename)) return null;
  if (path.isAbsolute(filename)) return null;
  if (/^[A-Za-z]:/.test(filename)) return null;
  if (/^[\\/]/.test(filename)) return null;
  if (filename.split(/[\\/]/).some((seg) => seg === '..')) return null;

  const base = path.resolve(DTALE_DATA_ROOT);
  const fullPath = path.resolve(base, filename);
  if (fullPath.toLowerCase() !== base.toLowerCase() &&
      !fullPath.toLowerCase().startsWith(base.toLowerCase() + path.sep)) {
    return null;
  }
  return fullPath;
}

router.post('/dtale/launch', async (req: Request, res: Response) => {
  try {
    const { filename, source, table, sampleBy = 'raw' } = req.body;

    if (currentDtaleProcess) {
      currentDtaleProcess.kill();
      currentDtaleProcess = null;
    }

    if (source === 'questdb') {
      if (!table) return res.status(400).json({ error: 'Missing table parameter for QuestDB' });
      if (typeof table !== 'string' || !QUESTDB_TABLE_RE.test(table)) {
        return res.status(400).json({ error: 'Invalid table name' });
      }
      if (typeof sampleBy !== 'string' || !ALLOWED_SAMPLE_BY.has(sampleBy)) {
        return res.status(400).json({ error: 'Invalid sampleBy value' });
      }

      const pythonExe = 'C:\\Users\\tyler\\anaconda3\\python.exe';
      const scriptPath = path.join(__dirname, 'dtale_questdb.py');

      currentDtaleProcess = spawn(pythonExe, [scriptPath, '--table', table, '--sample_by', sampleBy, '--port', '40000', '--host', DTALE_HOST]);
    } else {
      if (!filename) return res.status(400).json({ error: 'Missing filename parameter' });
      const fullPath = resolveDatasetPath(filename);
      if (!fullPath) return res.status(400).json({ error: 'Invalid filename' });
      const dtaleExe = 'C:\\Users\\tyler\\anaconda3\\Scripts\\dtale.exe';
      const flag = fullPath.toLowerCase().endsWith('.parquet') ? '--parquet' : '--csv';

      currentDtaleProcess = spawn(dtaleExe, [flag, fullPath, '--port', '40000', '--host', DTALE_HOST]);
    }

    currentDtaleProcess.on('error', (err) => {
      console.error('[DTale] Spawn error:', err);
    });

    currentDtaleProcess.stdout?.on('data', (data) => {
      logInfo(`[DTale] ${data.toString()}`);
    });

    currentDtaleProcess.stderr?.on('data', (data) => {
      console.error(`[DTale] ${data.toString()}`);
    });

    // Give it a bit more time for pandas to read the SQL if it's questdb
    const waitTime = source === 'questdb' ? 4000 : 2000;
    setTimeout(() => {
      res.json({ success: true, url: 'http://localhost:40000' });
    }, waitTime);

  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
