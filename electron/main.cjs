/**
 * ML Dashboard - Electron Main Process
 *
 * Databases are started by electron/start-databases.cjs before this runs.
 * This process opens a BrowserWindow pointing at the server, and stops
 * databases when the window closes.
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");

// Load .env file so DATABASE_URL and other vars are available
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const PORT = process.env.PORT || 5000;
const IS_DEV = process.env.NODE_ENV === "development";

// Database paths for shutdown
const PG_CTL = "E:\\source\\databases\\PostgreSQL\\pgsql\\bin\\pg_ctl.exe";
const PG_DATA = "E:\\source\\databases\\PostgreSQL\\pgsql\\data";
const QUESTDB_PID_FILE = path.join(__dirname, ".questdb.pid");

let mainWindow = null;
let serverProcess = null;

// --------------- Database Shutdown ---------------

function stopDatabases() {
  // --- QuestDB (kill by saved PID) ---
  try {
    if (fs.existsSync(QUESTDB_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(QUESTDB_PID_FILE, "utf-8").trim(), 10);
      if (pid) {
        console.log(`[db] Stopping QuestDB (PID: ${pid})...`);
        process.kill(pid);
        fs.unlinkSync(QUESTDB_PID_FILE);
        console.log("[db] QuestDB stopped");
      }
    }
  } catch (err) {
    // ESRCH = process doesn't exist (already stopped)
    if (err.code !== "ESRCH") {
      console.error("[db] Error stopping QuestDB:", err.message);
    }
    try { fs.unlinkSync(QUESTDB_PID_FILE); } catch {}
  }

  // --- PostgreSQL ---
  try {
    execFileSync(PG_CTL, ["status", "-D", PG_DATA], { stdio: "pipe" });
    // If status succeeds, PostgreSQL is running — stop it
    console.log("[db] Stopping PostgreSQL...");
    execFileSync(PG_CTL, ["stop", "-D", PG_DATA, "-m", "fast"], {
      stdio: "pipe",
      timeout: 30000,
    });
    console.log("[db] PostgreSQL stopped");
  } catch {
    // Not running or already stopped — that's fine
  }
}

// --------------- Window ---------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    title: "Quant AI Dashboard",
    icon: path.join(__dirname, "..", "src", "client", "public", "favicon.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Frameless title bar with native window controls
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0a",
      symbolColor: "#ffffff",
      height: 36,
    },
    backgroundColor: "#0a0a0a",
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startServer() {
  if (IS_DEV) {
    // In dev mode, server is started externally via concurrently
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, "..", "dist", "index.cjs");
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[server]", msg.trim());
      if (msg.includes("serving on port")) {
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error("[server:err]", data.toString().trim());
    });

    serverProcess.on("error", (err) => {
      console.error("[server] Failed to start:", err);
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      console.log("[server] Exited with code:", code);
      serverProcess = null;
    });

    // Fallback: resolve after 8 seconds even if we didn't see the ready message
    setTimeout(resolve, 8000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

// Wait for server to be reachable
async function waitForServer(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/uploads`);
      if (resp.ok || resp.status < 500) return true;
    } catch (e) {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Try anyway even if server didn't respond cleanly
  return true;
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error("Failed to start application:", err);
    stopServer();
    stopDatabases();
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopServer();
  stopDatabases();
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
  stopDatabases();
});

// Safety net
process.on("exit", () => {
  stopDatabases();
});
