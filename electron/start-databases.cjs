/**
 * Database Startup Script
 *
 * Starts QuestDB before the app launches.
 * Runs as a standalone Node.js script (not inside Electron).
 * Called by npm scripts before concurrently starts the server + Electron.
 *
 * - QuestDB: started via java.exe (detached process, PID saved to file)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const QUESTDB_JAVA = "E:\\source\\databases\\questdb-9.3.3-rt-windows-x86-64\\bin\\java.exe";
const QUESTDB_ROOT = "E:\\source\\databases\\questdb-9.3.3-rt-windows-x86-64";
const QUESTDB_PID_FILE = path.join(__dirname, ".questdb.pid");

// Load .env for port config
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const QUESTDB_HTTP_PORT = parseInt(process.env.QUESTDB_HTTP_PORT || "9000", 10);

async function waitForQuestDB(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const resp = await fetch(`http://localhost:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`);
      if (resp.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  // --- QuestDB ---
  let questdbReady = false;
  try {
    const resp = await fetch(`http://localhost:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`);
    questdbReady = resp.ok;
  } catch {}

  if (questdbReady) {
    console.log("[db] QuestDB is already running");
  } else {
    console.log("[db] Starting QuestDB...");

    // Start QuestDB as a detached process so it outlives this script
    const questdb = spawn(
      QUESTDB_JAVA,
      ["-m", "io.questdb/io.questdb.ServerMain", "-d", QUESTDB_ROOT],
      {
        stdio: "ignore",
        detached: true,
      }
    );
    questdb.unref();

    // Save PID so Electron can stop it on exit
    fs.writeFileSync(QUESTDB_PID_FILE, String(questdb.pid), "utf-8");
    console.log(`[db] QuestDB process started (PID: ${questdb.pid})`);

    const ready = await waitForQuestDB(30000);
    if (ready) {
      console.log("[db] QuestDB is ready on port " + QUESTDB_HTTP_PORT);
    } else {
      console.error("[db] WARNING: QuestDB may not be ready yet");
    }
  }

  console.log("[db] QuestDB started");
}

main().catch((err) => {
  console.error("[db] Database startup error:", err.message);
  // Don't exit with error code — let the app try to start anyway
  process.exit(0);
});
