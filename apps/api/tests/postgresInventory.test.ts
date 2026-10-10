/**
 * `readPostgresDatabase`: what PostgreSQL says it holds, mapped from its catalog.
 *  - a database that cannot be reached is reported unreachable with the driver's message;
 *  - the hypertable statements run only when the timescaledb extension is installed;
 *  - a statement that fails after connecting is reported, and the client is released;
 *  - every statement is fixed text (the database name never reaches SQL).
 */
import { describe, expect, it, vi } from "vitest";
import { readPostgresDatabase } from "../infrastructure/database/postgresInventory";

function poolAnswering(extensions: string[], fail?: (statement: string) => boolean) {
  const statements: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (statement: string) => {
    statements.push(statement);
    if (fail?.(statement)) throw new Error("canceling statement due to statement timeout");
    if (statement.includes("server_version")) return { rows: [{ version: "17.11" }] };
    if (statement.includes("pg_extension")) return { rows: extensions.map((extname) => ({ extname, extversion: "1.0" })) };
    if (statement.includes("pg_database_size")) return { rows: [{ bytes: "141898225331" }] };
    if (statement.includes("pg_stat_user_tables")) {
      return { rows: [{ relname: "symbols", n_live_tup: "417127", analyzed: new Date("2026-10-09T00:00:00Z"), bytes: "42041344" }] };
    }
    if (statement.includes("pg_views")) return { rows: [{ viewname: "ohlcv_1m" }] };
    if (statement.includes("timescaledb_information.hypertables")) {
      return {
        rows: [{
          hypertable_name: "market_bars", num_chunks: 198, bytes: "141665550336", approximate_rows: "785766203",
          earliest: new Date("2010-05-31T00:00:00Z"), latest: new Date("2026-09-04T00:00:00Z"),
        }],
      };
    }
    return { rows: [] };
  });
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  return { pool: pool as never, statements, release };
}

describe("readPostgresDatabase", () => {
  it("reports an unreachable database with the driver's message", async () => {
    const pool = { connect: vi.fn(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); }) };
    const facts = await readPostgresDatabase("market", pool as never);
    expect(facts.reachable).toBe(false);
    expect(facts.error).toContain("ECONNREFUSED");
    expect(facts.tables).toBeUndefined();
  });

  it("maps the catalog and reads hypertables when timescaledb is installed", async () => {
    const { pool, statements, release } = poolAnswering(["plpgsql", "timescaledb"]);
    const facts = await readPostgresDatabase("market", pool);
    expect(facts).toMatchObject({ reachable: true, serverVersion: "17.11", databaseSizeBytes: 141898225331, views: ["ohlcv_1m"] });
    expect(facts.tables?.[0]).toEqual({
      name: "symbols", estimatedRowCount: 417127, lastAnalyzedAt: "2026-10-09T00:00:00.000Z", totalSizeBytes: 42041344,
    });
    expect(facts.hypertables?.[0]).toMatchObject({ name: "market_bars", chunkCount: 198, approximateRowCount: 785766203 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(statements.every((statement) => !statement.includes("market;") && !statement.includes("$"))).toBe(true);
    expect(statements[0]).toMatch(/^SET statement_timeout = \d+$/);
  });

  it("skips the hypertable statements without the extension", async () => {
    const { pool, statements } = poolAnswering(["plpgsql"]);
    const facts = await readPostgresDatabase("quant", pool);
    expect(facts.hypertables).toEqual([]);
    expect(statements.some((statement) => statement.includes("timescaledb_information"))).toBe(false);
  });

  it("reports a failed statement and still releases the client", async () => {
    const { pool, release } = poolAnswering(["plpgsql"], (statement) => statement.includes("pg_stat_user_tables"));
    const facts = await readPostgresDatabase("quant", pool);
    expect(facts.reachable).toBe(true);
    expect(facts.error).toContain("statement timeout");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
