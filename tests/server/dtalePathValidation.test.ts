/**
 * Path containment on POST /api/databases/dtale/launch.
 *
 * The previous implementation passed req.body.filename straight to
 * path.resolve('D:\\ml_data', filename). path.resolve() treats an absolute
 * second argument as a NEW root, so no '../' was needed to escape the base —
 * a bare 'C:\Users\...' read straight out of it. The resulting file was then
 * served by D-Tale bound to 0.0.0.0 with no auth.
 *
 * Windows paths are written with String.raw so a backslash is a backslash and
 * cannot be silently eaten by a string escape.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveDatasetPath } from '../../src/server/data/explorer.router';

const BASE = path.resolve(process.env.LAKE_ROOT ?? 'E:\\lake');

const insideBase = (p: string) =>
  p.toLowerCase().startsWith(BASE.toLowerCase() + path.sep);

describe('resolveDatasetPath — accepts legitimate datasets', () => {
  it.each([
    'BTCUSDT-1m.parquet',
    'ohlcv.csv',
    'runs/job123/train.parquet',
    String.raw`runs\job123\test.parquet`,
    'nested/deeper/file.CSV',
  ])('accepts %j and keeps it inside the base', (name) => {
    const resolved = resolveDatasetPath(name);
    expect(resolved).not.toBeNull();
    expect(insideBase(resolved!)).toBe(true);
  });
});

describe('resolveDatasetPath — rejects escapes', () => {
  it.each([
    ['absolute drive path', String.raw`C:\Users\tyler\.ssh\id_rsa.csv`],
    ['drive-relative path', 'C:secrets.parquet'],
    ['posix absolute', '/etc/passwd.csv'],
    ['windows root', String.raw`\Windows\System32\config\SAM.csv`],
    ['UNC share', String.raw`\\server\share\loot.parquet`],
    ['parent traversal', String.raw`..\..\secrets.parquet`],
    ['embedded traversal', 'runs/../../../secrets.csv'],
    ['posix parent traversal', '../../.env.csv'],
    ['mixed separator traversal', String.raw`runs\..\..\..\secrets.parquet`],
  ])('rejects %s', (_label, name) => {
    expect(resolveDatasetPath(name)).toBeNull();
  });
});

describe('resolveDatasetPath — rejects non-dataset input', () => {
  it.each([
    ['wrong extension', 'id_rsa'],
    ['text file', 'notes.txt'],
    ['no extension', 'runs/job123/train'],
    ['empty string', ''],
  ])('rejects %s', (_label, name) => {
    expect(resolveDatasetPath(name)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(resolveDatasetPath(undefined as unknown as string)).toBeNull();
    expect(resolveDatasetPath(null as unknown as string)).toBeNull();
    expect(resolveDatasetPath(42 as unknown as string)).toBeNull();
  });
});

describe('resolveDatasetPath — a leading dash cannot become an argv flag', () => {
  it('resolves to an absolute path, not a flag', () => {
    const resolved = resolveDatasetPath('-parquet.csv');
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith('-')).toBe(false);
    expect(insideBase(resolved!)).toBe(true);
  });
});
