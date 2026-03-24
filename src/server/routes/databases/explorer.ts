/**
 * Database Explorer — Stats, Preview, Query
 *
 * Shared helpers and routes for browsing database contents.
 *
 * Routes:
 *   GET  /api/databases/sqlite/stats
 *   GET  /api/databases/questdb/stats
 *   GET  /api/databases/preview/:db/:table
 *   POST /api/databases/query
 *   POST /api/databases/questdb/init
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { getString } from '../helpers';
import { db, dbReadOnly } from '../../database/db';
import { sql as drizzleSql } from 'drizzle-orm';

export const DATA_DIR = path.join(process.cwd(), 'data');

// ── SQL validation helpers ──────────────────────────────────

/** Only allow alphanumeric, underscore, dot, and hyphen; max 128 chars */
export const isValidIdentifier = (name: string): boolean =>
  /^[a-zA-Z_][a-zA-Z0-9_.\-]{0,127}$/.test(name);

/** Ensure a query is read-only (SELECT / SHOW / DESCRIBE / EXPLAIN).
 *  Defense-in-depth: blocklist + SQLite read-only connection (see query endpoint). */
export const isSafeReadOnlyQuery = (sql: string): { safe: boolean; error?: string } => {
  const normalizedSql = sql.trim().toUpperCase();

  if (
    !normalizedSql.startsWith('SELECT') &&
    !normalizedSql.startsWith('SHOW') &&
    !normalizedSql.startsWith('DESCRIBE') &&
    !normalizedSql.startsWith('EXPLAIN')
  ) {
    return { safe: false, error: 'Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed' };
  }

  // Block DML/DDL keywords
  const dangerousPatterns =
    /\b(DROP|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|CREATE|EXEC|EXECUTE|CALL|SET|INTO|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;
  if (dangerousPatterns.test(sql)) {
    return { safe: false, error: 'Destructive or modifying queries are not allowed' };
  }

  // Block multiple statements (semicolon followed by any non-whitespace, or just trailing semicolons)
  if (/;/.test(sql.trim().replace(/;+\s*$/, ''))) {
    return { safe: false, error: 'Multiple statements are not allowed' };
  }

  // Block dangerous filesystem and extension functions in read-only queries
  const dangerousFunctions = /\b(read_csv|read_json|read_parquet|readfile|writefile|load_extension|fts3_tokenizer)\s*\(/i;
  if (dangerousFunctions.test(sql)) {
    return { safe: false, error: 'Filesystem and extension functions are not allowed in queries' };
  }

  return { safe: true };
};

// ── Router ──────────────────────────────────────────────────

const router = Router();

// SQLite Stats
router.get('/databases/sqlite/stats', async (_req: Request, res: Response) => {
  try {
    const tables = db.all<{ name: string }>(
      drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );

    const tableDetails = [];
    for (const table of tables) {
      try {
        const countRow = db.get<{ count: number }>(
          drizzleSql.raw(`SELECT count(*) as count FROM "${table.name}"`),
        );
        const columns = db.all<{ name: string; type: string; notnull: number }>(
          drizzleSql.raw(`PRAGMA table_info("${table.name}")`),
        );
        tableDetails.push({
          name: table.name,
          rowCount: countRow?.count ?? 0,
          type: 'table',
          columns: columns.map((c: any) => ({
            name: c.name,
            type: c.type,
            nullable: !c.notnull,
          })),
        });
      } catch (e) {
        tableDetails.push({ name: table.name, rowCount: 0, error: String(e) });
      }
    }

    res.json({ connected: true, tables: tableDetails.length, tableDetails });
  } catch (error: any) {
    res.json({ connected: false, tables: 0, tableDetails: [], error: error.message });
  }
});

// QuestDB Stats
router.get('/databases/questdb/stats', async (_req: Request, res: Response) => {
  try {
    const { getQuestDBStats } = await import('../../database/questdb');
    const stats = await getQuestDBStats();
    res.json(stats);
  } catch (error: any) {
    res.json({ connected: false, tables: 0, tableDetails: [], error: error.message });
  }
});

// Table preview
router.get('/databases/preview/:db/:table', async (req: Request, res: Response) => {
  try {
    const dbParam = getString(req.params.db);
    const table = getString(req.params.table);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 1000);

    if (!['sqlite', 'questdb'].includes(dbParam)) {
      return res.status(400).json({ error: 'Invalid database specified' });
    }
    if (!isValidIdentifier(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    let rows: any[] = [];

    if (dbParam === 'sqlite') {
      const escapedTable = table.replace(/"/g, '""');
      const { db: sqliteDb } = await import('../../database/db');
      rows = sqliteDb.all(drizzleSql.raw(`SELECT * FROM "${escapedTable}" LIMIT ${limit}`));
    } else if (dbParam === 'questdb') {
      const { queryQuestDB } = await import('../../database/questdb');
      const escapedTable = table.replace(/'/g, "''");
      rows = await queryQuestDB(`SELECT * FROM '${escapedTable}' LIMIT ${limit}`);
    }

    res.json({ rows, count: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Custom query execution
router.post('/databases/query', async (req: Request, res: Response) => {
  try {
    const { db: dbParam, sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL query required' });
    }
    if (sql.length > 10000) {
      return res.status(400).json({ error: 'Query too long (max 10000 characters)' });
    }
    if (!['sqlite', 'questdb'].includes(dbParam)) {
      return res.status(400).json({ error: 'Invalid database specified' });
    }

    const validation = isSafeReadOnlyQuery(sql);
    if (!validation.safe) {
      return res.status(403).json({ error: validation.error });
    }

    let rows: any[] = [];

    if (dbParam === 'sqlite') {
      rows = dbReadOnly.all<Record<string, unknown>>(drizzleSql.raw(sql)) as any[];
    } else if (dbParam === 'questdb') {
      const { queryQuestDB } = await import('../../database/questdb');
      rows = await queryQuestDB(sql);
    }

    if (rows.length > 10000) rows = rows.slice(0, 10000);

    res.json({ rows, rowCount: rows.length });
  } catch (error: any) {
    // Sanitize error messages — don't leak internal paths or SQL details
    const safeMessage = String(error.message || '').replace(/[A-Z]:\\[^\s]*/gi, '[path]');
    res.status(500).json({ error: safeMessage });
  }
});

// Initialize QuestDB OHLCV table
router.post('/databases/questdb/init', async (_req: Request, res: Response) => {
  try {
    const { createOHLCVTable } = await import('../../database/questdb');
    await createOHLCVTable();
    res.json({ success: true, message: 'QuestDB OHLCV table created' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
