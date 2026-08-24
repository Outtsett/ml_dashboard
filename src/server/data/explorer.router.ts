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

/**
 * Institutional Table Inventory: Returns all tables across both engines.
 */
router.get('/databases/tables', queryRateLimiter, async (_req: Request, res: Response) => {
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
router.get('/databases/tables/:name/schema', async (req: Request, res: Response) => {
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
 * QuestDB High-Resolution Stats.
 */
router.get('/databases/questdb/stats', async (_req: Request, res: Response) => {
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
router.post('/databases/query', queryRateLimiter, async (req: Request, res: Response) => {
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
      // QuestDB handles LIMIT internally or via suffix; slice defensively.
      const result = await queryQuestDB(cleanSql);
      res.json(result.slice(0, rowLimit));
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Data preview (Top 50 rows).
 */
router.get('/databases/tables/:name/preview', async (req: Request, res: Response) => {
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
router.post('/databases/questdb/init', async (_req: Request, res: Response) => {
  try {
    const { createOHLCVTable } = await import('../infrastructure/database/questdb');
    await createOHLCVTable();
    res.json({ success: true, message: 'QuestDB schemas verified/created' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
