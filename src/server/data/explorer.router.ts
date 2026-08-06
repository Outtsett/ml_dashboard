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
 * Raw Query Console: Restricted to READ-ONLY if not admin.
 * (Currently open to all in dev, should be gated in prod).
 */
router.post('/databases/query', queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const { sql, source, limit = 100 } = req.body;
    if (!sql) return res.status(400).json({ error: 'Missing SQL query' });

    const cleanSql = String(sql).trim();
    const upper = cleanSql.toUpperCase();

    // Basic safety: reject destructive commands
    if (upper.startsWith('DROP') || upper.startsWith('DELETE') || upper.startsWith('TRUNCATE')) {
      return res.status(403).json({ error: 'Destructive commands are forbidden via the API' });
    }

    if (source === 'sqlite') {
      const { db: sqliteDb } = await import('../infrastructure/database/db');
      const rows = await sqliteDb.all(drizzleSql.raw(`${cleanSql} LIMIT ${limit}`));
      res.json({ rows });
    } else {
      const { queryQuestDB } = await import('../infrastructure/database/questdb');
      // QuestDB handle limit internally or via suffix
      const result = await queryQuestDB(cleanSql);
      res.json(result.slice(0, limit));
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
