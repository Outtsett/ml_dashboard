/**
 * Create materialized views in QuestDB for the unified multi-asset ohlcv table.
 * Single set of 7 views covers all asset classes (futures, forex, equities, crypto).
 * Run: npx tsx scripts/create-mat-views.ts
 */

const QUESTDB_URL = `http://${process.env.QUESTDB_HOST || "localhost"}:${process.env.QUESTDB_HTTP_PORT || "9000"}`;

async function questdbExec(sql: string): Promise<any> {
  const url = `${QUESTDB_URL}/exec?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`QuestDB exec failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

const TIMEFRAMES = [
  { label: "1d",  sample: "1d",  partition: "YEAR",  ttl: "10 YEARS" },
  { label: "1w",  sample: "1w",  partition: "YEAR",  ttl: "10 YEARS" },
  { label: "4h",  sample: "4h",  partition: "YEAR",  ttl: "5 YEARS" },
  { label: "1h",  sample: "1h",  partition: "MONTH", ttl: "3 YEARS" },
  { label: "30m", sample: "30m", partition: "MONTH", ttl: "3 YEARS" },
  { label: "15m", sample: "15m", partition: "MONTH", ttl: "2 YEARS" },
  { label: "5m",  sample: "5m",  partition: "MONTH", ttl: "2 YEARS" },
];

async function main(): Promise<void> {
  console.log("Creating unified materialized views (7 views from single ohlcv table)...\n");

  for (const tf of TIMEFRAMES) {
    const viewName = `ohlcv_${tf.label}`;

    try {
      await questdbExec(`DROP MATERIALIZED VIEW IF EXISTS ${viewName}`);
      console.log(`[${viewName}] Dropped existing view`);
    } catch { /* may not exist */ }

    await new Promise(r => setTimeout(r, 500));

    const sql = `CREATE MATERIALIZED VIEW ${viewName} AS (
      SELECT timestamp, symbol, asset_class, root,
        first(open) as open,
        max(high) as high,
        min(low) as low,
        last(close) as close,
        sum(volume) as volume
      FROM ohlcv
      SAMPLE BY ${tf.sample} ALIGN TO CALENDAR
    ) PARTITION BY ${tf.partition} TTL ${tf.ttl}`;

    try {
      await questdbExec(sql);
      console.log(`[${viewName}] Created (SAMPLE BY ${tf.sample})`);
    } catch (e: any) {
      console.error(`[${viewName}] ERROR:`, e.message.substring(0, 200));
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
