/**
 * Upload historical tick data CSVs/parquets directly to QuestDB.
 *
 * Source: D:\HistoricalTickData\
 *   - MBP-10 CSVs: glbx-mdp3-YYYYMMDD.mbp-10.csv (26 files, ~210 GB)
 *   - Trade parquets: glbx-mdp3-YYYYMMDD.trades.parquet (27 files, ~0.5 GB)
 *
 * Strategy:
 *   1. Drop & recreate tables with column names matching CSV headers
 *   2. Upload MBP-10 CSVs directly via QuestDB /imp (no DuckDB needed)
 *   3. Convert trade parquets to CSV via Python, then upload via /imp
 *   4. Apply WAL + finance-optimized QuestDB configurations
 *
 * Run: node scripts/upload-tickdata-questdb.cjs
 */

var fs = require("fs");
var path = require("path");
var execSync = require("child_process").execSync;

var QUESTDB_URL = "http://" + (process.env.QUESTDB_HOST || "localhost") + ":" + (process.env.QUESTDB_HTTP_PORT || "9000");
var DATA_DIR = "E:\\lake\\raw\\vendor=databento\\dataset=GLBX.MDP3";
var TMP_DIR = path.join(process.cwd(), "data", "tmp-upload");

async function questdbExec(sql) {
  var url = QUESTDB_URL + "/exec?query=" + encodeURIComponent(sql);
  var res = await fetch(url);
  var body = await res.text();
  if (!res.ok) {
    throw new Error("QuestDB exec failed (" + res.status + "): " + body.substring(0, 300));
  }
  return JSON.parse(body);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function buildMBP10BookLevels() {
  var cols = [];
  for (var i = 0; i < 10; i++) {
    var pad = String(i).padStart(2, "0");
    cols.push(
      "bid_px_" + pad + " DOUBLE",
      "ask_px_" + pad + " DOUBLE",
      "bid_sz_" + pad + " LONG",
      "ask_sz_" + pad + " LONG",
      "bid_ct_" + pad + " INT",
      "ask_ct_" + pad + " INT"
    );
  }
  return cols.join(",\n      ");
}

// ─── Phase 1: Configure QuestDB WAL + Finance Settings ───────────────

async function configureQuestDB() {
  console.log("\n=== Phase 1: QuestDB Configuration ===\n");

  // QuestDB server.conf settings (must be set in config file, not SQL)
  // But we can verify current settings and set what's available via SQL
  var configPath = "E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64\\conf\\server.conf";

  // Finance-optimized settings for server.conf
  var financeConfig = [
    "# ── WAL Configuration ──",
    "cairo.wal.enabled.default=true",
    "cairo.wal.apply.table.time.quota=300000",       // 5 min quota for applying WAL
    "cairo.wal.segment.rollover.size=268435456",      // 256 MB WAL segment rollover
    "cairo.wal.max.lag.size=2147483648",              // 2 GB max uncommitted WAL data
    "",
    "# ── Out-of-Order / Late Data ──",
    "cairo.o3.max.lag=600000000",                     // 600s max O3 lag (late-arriving ticks)
    "cairo.o3.min.lag=1000000",                       // 1s min O3 lag
    "",
    "# ── Memory & Performance ──",
    "cairo.sql.page.frame.max.rows=1000000",          // Max rows per page frame scan
    "cairo.page.frame.shard.count=4",                 // Parallel shard count
    "shared.worker.count=4",                          // Shared worker threads
    "cairo.writer.data.append.page.size=16777216",    // 16 MB append pages
    "cairo.writer.data.index.page.size=4194304",      // 4 MB index pages
    "",
    "# ── Query Performance ──",
    "cairo.sql.jit.mode=on",                          // JIT compilation for WHERE filters
    "cairo.sql.parallel.filter.enabled=true",         // Parallel filter execution
    "",
    "# ── HTTP Import Settings ──",
    "http.min.enabled=true",
    "http.min.net.bind.to=0.0.0.0:9003",
    "line.tcp.net.bind.to=0.0.0.0:9009",
    "",
    "# ── Dedup for Finance Data ──",
    "# Handled per-table via DEDUP UPSERT KEYS in CREATE TABLE DDL",
    "",
  ].join("\n");

  // Check if server.conf exists and if we should update it
  if (fs.existsSync(configPath)) {
    var existing = fs.readFileSync(configPath, "utf-8");
    if (!existing.includes("cairo.wal.enabled.default")) {
      console.log("[config] Appending finance-optimized settings to server.conf");
      fs.appendFileSync(configPath, "\n\n# ── Finance-Optimized Settings (added by upload script) ──\n" + financeConfig);
      console.log("[config] Settings appended. NOTE: QuestDB restart required for server.conf changes.");
    } else {
      console.log("[config] server.conf already has WAL settings, skipping.");
    }
  } else {
    console.log("[config] Writing new server.conf at: " + configPath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, financeConfig);
  }

  // Verify QuestDB is running
  try {
    var health = await questdbExec("SELECT 1 as ok");
    console.log("[config] QuestDB is running and healthy.");
  } catch (e) {
    throw new Error("QuestDB is not reachable at " + QUESTDB_URL + ": " + e.message);
  }
}

// ─── Phase 2: Create Tables ─────────────────────────────────────────

async function createTables() {
  console.log("\n=== Phase 2: Create Tables ===\n");

  // Drop existing tables
  for (var table of ["mbp10", "trades"]) {
    try {
      await questdbExec("DROP TABLE IF EXISTS " + table);
      console.log("[tables] Dropped " + table);
    } catch (e) {
      console.log("[tables] Drop " + table + " warning: " + e.message.substring(0, 100));
    }
  }

  await new Promise(function(r) { setTimeout(r, 3000); });

  // Create MBP-10 table matching CSV header exactly
  // CSV columns: ts_recv, ts_event, rtype, publisher_id, instrument_id,
  //   action, side, depth, price, size, flags, ts_in_delta, sequence,
  //   bid_px_00..09, ask_px_00..09, bid_sz_00..09, ask_sz_00..09,
  //   bid_ct_00..09, ask_ct_00..09, symbol
  console.log("[tables] Creating mbp10 table (74 columns, ts_event designated timestamp)...");
  await questdbExec(
    "CREATE TABLE mbp10 (" +
    "  ts_recv TIMESTAMP," +
    "  ts_event TIMESTAMP," +
    "  rtype SHORT," +
    "  publisher_id INT," +
    "  instrument_id LONG," +
    "  action SYMBOL CAPACITY 10 CACHE," +
    "  side SYMBOL CAPACITY 10 CACHE," +
    "  depth SHORT," +
    "  price DOUBLE," +
    "  size LONG," +
    "  flags SHORT," +
    "  ts_in_delta INT," +
    "  sequence LONG," +
    "  " + buildMBP10BookLevels() + "," +
    "  symbol SYMBOL CAPACITY 200 CACHE INDEX" +
    ") timestamp(ts_event) PARTITION BY DAY WAL" +
    " DEDUP UPSERT KEYS(symbol, ts_event, sequence)"
  );
  console.log("[tables] mbp10 created.");

  // Create trades table matching parquet schema
  // Parquet columns: ts_event, rtype, publisher_id, instrument_id,
  //   action, side, depth, price, size, flags, ts_in_delta, sequence,
  //   symbol, ts_recv
  console.log("[tables] Creating trades table (14 columns, ts_event designated timestamp)...");
  await questdbExec(
    "CREATE TABLE trades (" +
    "  ts_event TIMESTAMP," +
    "  rtype SHORT," +
    "  publisher_id INT," +
    "  instrument_id LONG," +
    "  action SYMBOL CAPACITY 10 CACHE," +
    "  side SYMBOL CAPACITY 10 CACHE," +
    "  depth SHORT," +
    "  price DOUBLE," +
    "  size LONG," +
    "  flags SHORT," +
    "  ts_in_delta INT," +
    "  sequence LONG," +
    "  symbol SYMBOL CAPACITY 200 CACHE INDEX," +
    "  ts_recv TIMESTAMP" +
    ") timestamp(ts_event) PARTITION BY DAY WAL" +
    " DEDUP UPSERT KEYS(symbol, ts_event, sequence)"
  );
  console.log("[tables] trades created.");
}

// ─── Phase 3: Upload MBP-10 CSVs ───────────────────────────────────

async function uploadMBP10() {
  console.log("\n=== Phase 3: Upload MBP-10 CSVs ===\n");

  var files = fs.readdirSync(DATA_DIR)
    .filter(function(f) { return f.endsWith(".mbp-10.csv"); })
    .sort();

  console.log("[mbp10] Found " + files.length + " CSV files to upload.");

  var totalUploaded = 0;
  var totalBytes = 0;
  var startTime = Date.now();

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var filePath = path.join(DATA_DIR, file).replace(/\\/g, "/");
    var stat = fs.statSync(filePath);
    var fileSizeGB = stat.size / 1073741824;

    var t0 = Date.now();
    var rowsImported = 0;
    try {
      // Upload directly to QuestDB /imp
      // timestamp=ts_event tells QuestDB which column is the designated timestamp
      var result = execSync(
        'curl -s -F "data=@' + filePath + '" "' + QUESTDB_URL + '/imp?name=mbp10&timestamp=ts_event&partitionBy=DAY&overwrite=false"',
        { timeout: 3600000, maxBuffer: 100 * 1024 * 1024 } // 1 hour timeout
      ).toString();

      // Parse response for row count
      var match = result.match(/Rows imported[\s|:]*(\d+)/i);
      rowsImported = match ? parseInt(match[1]) : 0;
      if (rowsImported === 0) {
        var altMatch = result.match(/"rowsImported"\s*:\s*(\d+)/);
        if (altMatch) rowsImported = parseInt(altMatch[1]);
      }
      if (rowsImported === 0 && stat.size > 1000) {
        console.log("[mbp10] Warning: could not parse row count. Response: " + result.substring(0, 300));
      }
    } catch (e) {
      console.error("[mbp10] Upload error " + file + ": " + (e.message || "").substring(0, 300));
    }

    var uploadSec = (Date.now() - t0) / 1000;
    totalUploaded += rowsImported;
    totalBytes += stat.size;

    var elapsed = (Date.now() - startTime) / 1000;
    var rate = totalUploaded / Math.max(elapsed, 1);
    var totalFilesSize = files.reduce(function(sum, f) {
      return sum + fs.statSync(path.join(DATA_DIR, f)).size;
    }, 0);
    var bytesRemaining = totalFilesSize - totalBytes;
    var bytesPerSec = totalBytes / Math.max(elapsed, 1);
    var estMinLeft = bytesRemaining / Math.max(bytesPerSec, 1) / 60;

    console.log(
      "[mbp10] " + (i + 1) + "/" + files.length + ": " + file +
      " (" + fileSizeGB.toFixed(1) + " GB) -> " +
      rowsImported.toLocaleString() + " rows in " + uploadSec.toFixed(1) + "s | " +
      "Total: " + totalUploaded.toLocaleString() + " (" + rate.toFixed(0) + "/s, ~" + estMinLeft.toFixed(1) + "m left)"
    );
  }

  console.log("\n[mbp10] Upload complete: " + totalUploaded.toLocaleString() + " rows from " + files.length + " files");
  return totalUploaded;
}

// ─── Phase 4: Convert & Upload Trades ───────────────────────────────

async function uploadTrades() {
  console.log("\n=== Phase 4: Convert & Upload Trade Parquets ===\n");

  var files = fs.readdirSync(DATA_DIR)
    .filter(function(f) { return f.endsWith(".trades.parquet"); })
    .sort();

  console.log("[trades] Found " + files.length + " parquet files to convert & upload.");
  fs.mkdirSync(TMP_DIR, { recursive: true });

  var totalUploaded = 0;
  var startTime = Date.now();

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var parquetPath = path.join(DATA_DIR, file).replace(/\\/g, "/");
    var csvPath = path.join(TMP_DIR, file.replace(".parquet", ".csv")).replace(/\\/g, "/");

    var t0 = Date.now();

    // Convert parquet → CSV via Python (pyarrow)
    try {
      execSync(
        'python -c "' +
        "import pyarrow.parquet as pq; import pyarrow.csv as csv; " +
        "t = pq.read_table('" + parquetPath + "'); " +
        "csv.write_csv(t, '" + csvPath + "')" +
        '"',
        { timeout: 120000 }
      );
    } catch (e) {
      console.error("[trades] Parquet conversion failed for " + file + ": " + (e.message || "").substring(0, 200));
      continue;
    }

    var convertMs = Date.now() - t0;
    var csvStat = fs.statSync(csvPath);

    // Upload CSV to QuestDB
    var t1 = Date.now();
    var rowsImported = 0;
    try {
      var result = execSync(
        'curl -s -F "data=@' + csvPath + '" "' + QUESTDB_URL + '/imp?name=trades&timestamp=ts_event&partitionBy=DAY&overwrite=false"',
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
      ).toString();

      var match = result.match(/Rows imported[\s|:]*(\d+)/i);
      rowsImported = match ? parseInt(match[1]) : 0;
      if (rowsImported === 0) {
        var altMatch = result.match(/"rowsImported"\s*:\s*(\d+)/);
        if (altMatch) rowsImported = parseInt(altMatch[1]);
      }
      if (rowsImported === 0 && csvStat.size > 1000) {
        console.log("[trades] Warning: could not parse row count. Response: " + result.substring(0, 300));
      }
    } catch (e) {
      console.error("[trades] Upload error " + file + ": " + (e.message || "").substring(0, 200));
    }

    var uploadMs = Date.now() - t1;
    totalUploaded += rowsImported;

    // Clean up temp CSV
    try { fs.unlinkSync(csvPath); } catch (e) {}

    console.log(
      "[trades] " + (i + 1) + "/" + files.length + ": " + file +
      " (" + formatBytes(csvStat.size) + ") -> " +
      rowsImported.toLocaleString() + " rows " +
      "(convert=" + (convertMs / 1000).toFixed(1) + "s, upload=" + (uploadMs / 1000).toFixed(1) + "s)"
    );
  }

  // Clean up
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch (e) {}

  console.log("\n[trades] Upload complete: " + totalUploaded.toLocaleString() + " rows from " + files.length + " files");
  return totalUploaded;
}

// ─── Phase 5: Verify ────────────────────────────────────────────────

async function verify() {
  console.log("\n=== Phase 5: Verify ===\n");

  await new Promise(function(r) { setTimeout(r, 5000); }); // WAL flush

  try {
    var mbp10Count = await questdbExec("SELECT count() as cnt FROM mbp10");
    console.log("[verify] mbp10: " + Number(mbp10Count.dataset[0][0]).toLocaleString() + " rows");
  } catch (e) {
    console.error("[verify] mbp10 count failed:", e.message.substring(0, 200));
  }

  try {
    var tradesCount = await questdbExec("SELECT count() as cnt FROM trades");
    console.log("[verify] trades: " + Number(tradesCount.dataset[0][0]).toLocaleString() + " rows");
  } catch (e) {
    console.error("[verify] trades count failed:", e.message.substring(0, 200));
  }

  // Symbol counts
  try {
    var mbp10Symbols = await questdbExec("SELECT count(DISTINCT symbol) as cnt FROM mbp10");
    var tradesSymbols = await questdbExec("SELECT count(DISTINCT symbol) as cnt FROM trades");
    console.log("[verify] mbp10 symbols: " + mbp10Symbols.dataset[0][0]);
    console.log("[verify] trades symbols: " + tradesSymbols.dataset[0][0]);
  } catch (e) {
    console.error("[verify] Symbol count failed:", e.message.substring(0, 200));
  }

  // Time ranges
  try {
    var mbp10Range = await questdbExec("SELECT min(ts_event) as mn, max(ts_event) as mx FROM mbp10");
    var tradesRange = await questdbExec("SELECT min(ts_event) as mn, max(ts_event) as mx FROM trades");
    console.log("[verify] mbp10 range: " + mbp10Range.dataset[0][0] + " to " + mbp10Range.dataset[0][1]);
    console.log("[verify] trades range: " + tradesRange.dataset[0][0] + " to " + tradesRange.dataset[0][1]);
  } catch (e) {
    console.error("[verify] Range query failed:", e.message.substring(0, 200));
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  var totalStart = Date.now();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  QuestDB Direct Upload — Historical Tick Data");
  console.log("  Source: " + DATA_DIR);
  console.log("  Target: " + QUESTDB_URL);
  console.log("═══════════════════════════════════════════════════════════════");

  await configureQuestDB();
  await createTables();

  var mbp10Rows = await uploadMBP10();
  var tradesRows = await uploadTrades();

  await verify();

  var totalMin = (Date.now() - totalStart) / 60000;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  DONE in " + totalMin.toFixed(1) + " min");
  console.log("  MBP-10: " + mbp10Rows.toLocaleString() + " rows");
  console.log("  Trades: " + tradesRows.toLocaleString() + " rows");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(function(e) {
  console.error("FATAL:", e.message);
  process.exit(1);
});
