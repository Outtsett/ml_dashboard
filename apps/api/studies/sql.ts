/**
 * Quoting for the SQL a study handler writes. Handlers interpolate only
 * values their Zod query already parsed, and even those go through these.
 */

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A view or column name, double-quoted. Refuses anything that is not a plain identifier. */
export function ident(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`unsafe SQL identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

/** A string literal, single quotes doubled. */
export function text(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A finite number literal. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
  return String(value);
}

/** A list of string literals for `IN (...)`. */
export function textList(values: readonly string[]): string {
  if (values.length === 0) throw new Error("empty IN list");
  return values.map(text).join(", ");
}

/**
 * DuckDB returns BIGINT as bigint and TIMESTAMP as Date or bigint depending
 * on the path; the browser needs plain numbers. Converts one row in place.
 */
export function plainRow<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (typeof value === "bigint") out[key] = Number(value);
    else if (value instanceof Date) out[key] = value.getTime();
    else out[key] = value;
  }
  return out as T;
}
