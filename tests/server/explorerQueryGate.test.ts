/**
 * The read-only gate on POST /api/databases/query.
 *
 * This endpoint executes user-supplied SQL by design (it backs the Query
 * Console UI), so the gate is the security boundary. The previous
 * implementation blocklisted `DROP`/`DELETE`/`TRUNCATE` with `startsWith`,
 * which failed open in several ways this file pins down.
 */

import { describe, it, expect } from 'vitest';
import {
  READ_ONLY_STATEMENT,
  stripSqlComments,
  safeLimit,
} from '../../src/server/data/explorer.router';

const allowed = (sql: string) => READ_ONLY_STATEMENT.test(stripSqlComments(sql));

describe('read-only gate — permits genuine reads', () => {
  it.each([
    'SELECT * FROM ml_models',
    '  select id from trades  ',
    'WITH t AS (SELECT 1) SELECT * FROM t',
    'SHOW TABLES',
    'EXPLAIN SELECT * FROM ohlcv',
    'PRAGMA table_info(ml_models)',
    'tables()',
    "table_columns('ohlcv')",
    '-- a leading comment\nSELECT 1',
    '/* banner */ SELECT 1',
  ])('allows %j', (sql) => {
    expect(allowed(sql)).toBe(true);
  });
});

describe('read-only gate — refuses writes', () => {
  it.each([
    // Caught by the old blocklist too.
    'DROP TABLE ohlcv',
    'DELETE FROM trades',
    'TRUNCATE TABLE ohlcv',
    // NOT caught by the old blocklist — verbs it never listed.
    'UPDATE ml_models SET name = \'x\'',
    'INSERT INTO trades VALUES (1)',
    'ALTER TABLE ohlcv DROP COLUMN close',
    'ATTACH DATABASE \'/tmp/evil.db\' AS evil',
    'CREATE TABLE x (a INT)',
    'REPLACE INTO trades VALUES (1)',
    'VACUUM',
    'PRAGMA writable_schema = 1',
    // The comment-prefix bypass: `startsWith('DROP')` is false here, so the
    // old blocklist let this through against an 863M-row table.
    '/**/DROP TABLE ohlcv',
    '/* hi */ DELETE FROM trades',
    '-- x\nDROP TABLE ohlcv',
  ])('refuses %j', (sql) => {
    expect(allowed(sql)).toBe(false);
  });
});

describe('stripSqlComments', () => {
  it('removes block comments so they cannot mask the leading verb', () => {
    expect(stripSqlComments('/**/DROP TABLE t')).toBe('DROP TABLE t');
  });

  it('removes line comments', () => {
    expect(stripSqlComments('-- note\nDROP TABLE t')).toBe('DROP TABLE t');
  });

  it('leaves ordinary SQL untouched', () => {
    expect(stripSqlComments('SELECT 1')).toBe('SELECT 1');
  });
});

describe('safeLimit — the value interpolated into the SQL string', () => {
  it('defaults when absent or unparseable', () => {
    expect(safeLimit(undefined)).toBe(100);
    expect(safeLimit(null)).toBe(100);
    expect(safeLimit('abc')).toBe(100);
    expect(safeLimit({})).toBe(100);
  });

  it('always returns a finite integer, never the raw input', () => {
    // The injection vector: this used to land in the query verbatim.
    for (const evil of [
      '1; DROP TABLE ohlcv',
      '1 UNION SELECT * FROM users',
      '1/**/OR/**/1=1',
      '-1',
      '1e9',
    ]) {
      const out = safeLimit(evil);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(1);
      expect(out).toBeLessThanOrEqual(1000);
    }
  });

  it('clamps to the 1..1000 band', () => {
    expect(safeLimit(0)).toBe(1);
    expect(safeLimit(-5)).toBe(1);
    expect(safeLimit(50)).toBe(50);
    expect(safeLimit(999999)).toBe(1000);
  });
});
