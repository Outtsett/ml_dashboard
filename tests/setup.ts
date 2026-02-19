// Shared test utilities
import DuckDB from 'duckdb';

export function createTestDuckDB(): { db: DuckDB.Database; conn: DuckDB.Connection } {
  const db = new DuckDB.Database(':memory:');
  const conn = db.connect();
  return { db, conn };
}

export function runTestQuery<T = any>(conn: DuckDB.Connection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, result) => {
      if (err) reject(err);
      else resolve(result as T[]);
    });
  });
}
