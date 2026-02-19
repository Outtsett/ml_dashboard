/**
 * Database Startup Script
 *
 * Starts PostgreSQL and QuestDB before the app launches.
 * Runs as a standalone Node.js script (not inside Electron).
 * Called by npm scripts before concurrently starts the server + Electron.
 *
 * - PostgreSQL: started via pg_ctl (runs as a daemon)
 * - QuestDB: started via java.exe (detached process, PID saved to file)
 */
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const PG_CTL = "E:\\source\\databases\\PostgreSQL\\pgsql\\bin\\pg_ctl.exe";
const PG_DATA = "E:\\source\\databases\\PostgreSQL\\pgsql\\data";
const PG_LOG = "E:\\source\\databases\\PostgreSQL\\pgsql\\data\\pg.log";
const QUESTDB_JAVA = "E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64\\bin\\java.exe";
const QUESTDB_ROOT = "E:\\source\\databases\\questdb-9.3.1-rt-windows-x86-64";
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

function isPostgresRunning() {
  try {
    execFileSync(PG_CTL, ["status", "-D", PG_DATA], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function waitForTcpPort(port, timeout = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeout) return resolve(false);
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error", () => { sock.destroy(); setTimeout(check, 500); });
      sock.on("timeout", () => { sock.destroy(); setTimeout(check, 500); });
      sock.connect(port, "127.0.0.1");
    };
    check();
  });
}

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
  // --- PostgreSQL ---
  if (isPostgresRunning()) {
    console.log("[db] PostgreSQL is already running");
  } else {
    console.log("[db] Starting PostgreSQL...");
    // pg_ctl start launches postgres as a daemon and returns
    const pgStart = spawn(PG_CTL, ["start", "-D", PG_DATA, "-l", PG_LOG], {
      stdio: "inherit",
    });
    await new Promise((resolve, reject) => {
      pgStart.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_ctl start exited with code ${code}`));
      });
      pgStart.on("error", reject);
    });

    const pgReady = await waitForTcpPort(5432, 15000);
    if (pgReady) {
      console.log("[db] PostgreSQL is ready on port 5432");
    } else {
      console.error("[db] WARNING: PostgreSQL may not be ready yet");
    }
  }

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

  console.log("[db] All databases started");
}

main().catch((err) => {
  console.error("[db] Database startup error:", err.message);
  // Don't exit with error code — let the app try to start anyway
  process.exit(0);
});
