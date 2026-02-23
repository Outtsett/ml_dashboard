/**
 * Create materialized views in QuestDB for common chart timeframes.
 * These pre-compute SAMPLE BY aggregations and auto-refresh on new data.
 *
 * Base: ohlcv (1m bars, 759.5M rows)
 * Views: 5m, 15m, 30m, 1h, 4h, 1d, 1w
 */

var QUESTDB_URL = "http://" + (process.env.QUESTDB_HOST || "localhost") + ":" + (process.env.QUESTDB_HTTP_PORT || "9000");

async function questdbExec(sql) {
  var url = QUESTDB_URL + "/exec?query=" + encodeURIComponent(sql);
  var res = await fetch(url);
  var body = await res.text();
  if (!res.ok) {
    throw new Error("QuestDB exec failed (" + res.status + "): " + body);
  }
  return JSON.parse(body);
}

var TIMEFRAMES = [
  { label: "5m", sample: "5m" },
  { label: "15m", sample: "15m" },
  { label: "30m", sample: "30m" },
  { label: "1h", sample: "1h" },
  { label: "4h", sample: "4h" },
  { label: "1d", sample: "1d" },
  { label: "1w", sample: "7d" },  // QuestDB SAMPLE BY uses 7d not 1w
];

async function main() {
  console.log("Creating materialized views for OHLCV timeframes...\n");

  for (var i = 0; i < TIMEFRAMES.length; i++) {
    var tf = TIMEFRAMES[i];
    var viewName = "ohlcv_" + tf.label;

    // Drop existing view if any
    try {
      await questdbExec("DROP MATERIALIZED VIEW IF EXISTS " + viewName);
      console.log("[" + viewName + "] Dropped existing view");
    } catch (e) {
      // May not exist, that's fine
    }

    // Small delay after drop
    await new Promise(function(r) { setTimeout(r, 1000); });

    var sql = "CREATE MATERIALIZED VIEW " + viewName + " AS (" +
      "SELECT timestamp, symbol, " +
      "first(open) as open, " +
      "max(high) as high, " +
      "min(low) as low, " +
      "last(close) as close, " +
      "sum(volume) as volume " +
      "FROM ohlcv " +
      "SAMPLE BY " + tf.sample + " ALIGN TO CALENDAR" +
      ")";

    try {
      await questdbExec(sql);
      console.log("[" + viewName + "] Created (SAMPLE BY " + tf.sample + ")");
    } catch (e) {
      console.error("[" + viewName + "] ERROR:", e.message.substring(0, 200));
    }
  }

  // Verify
  console.log("\nVerifying views...");
  await new Promise(function(r) { setTimeout(r, 3000); });

  try {
    var tables = await questdbExec("SHOW TABLES");
    console.log("\nAll QuestDB tables/views:");
    tables.dataset.forEach(function(row) {
      console.log("  " + row[0]);
    });
  } catch (e) {
    console.error("Could not list tables:", e.message);
  }

  // Quick row count check on one view
  try {
    var check = await questdbExec("SELECT count() as cnt FROM ohlcv_1h");
    console.log("\nohlcv_1h row count: " + Number(check.dataset[0][0]).toLocaleString());
  } catch (e) {
    console.error("Could not check ohlcv_1h:", e.message);
  }

  console.log("\nDone.");
}

main().catch(console.error);
