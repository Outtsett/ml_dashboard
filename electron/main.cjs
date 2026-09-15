/**
 * ML Dashboard - Electron Main Process
 *
 * Launch flow (GUI / desktop shortcut runs `electron .`):
 *   app.whenReady() → startServer() spawns the backend (tsx --watch
 *   src/server/main.ts) on :PORT. The backend serves both the REST API and the
 *   Vite frontend on the single port, and the BrowserWindow points at
 *   http://127.0.0.1:PORT. There is no database process to launch: market data
 *   is read through DuckDB over the Iceberg lake at E:\lake (in-process), and
 *   dashboard state lives in a local SQLite file.
 *
 * Reliability (intermittent "backend didn't launch" on relaunch):
 *   - Close-to-tray keeps the instance alive; every "bring the window back"
 *     path (tray, second-instance, activate, window show) routes through
 *     ensureBackendAndShow(), which probes /health and restarts a dead backend
 *     before re-showing the UI.
 *   - The backend health watchdog restarts a wedged backend regardless of the
 *     serverProcess handle (tree-kill + free-port + respawn).
 *   - startServer() pre-flight reclaims :PORT from a wedged orphan (the backend
 *     process.exit(1)s on EADDRINUSE, so a stale holder must be killed first).
 */
const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  nativeTheme,
  Notification,
  globalShortcut,
  powerMonitor,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const store = require("./store.cjs");
const { setupShortcuts, unregisterAll: unregisterAllShortcuts } = require("./shortcuts.cjs");
const { createTray, destroyTray, setTooltip, setBadge, setStatus } = require("./tray.cjs");
const { createAppMenu } = require("./menus.cjs");
const { setupContextMenus } = require("./contextMenus.cjs");
const { showNotification, updatePreferences: updateNotifPrefs } = require("./notifications.cjs");
const { setupThemeSync } = require("./themeSync.cjs");
const { screen } = require("electron");

// Prevent EPIPE crashes when launched without a console (desktop shortcut)
// When there's no terminal, stdout/stderr pipes can close unexpectedly.
process.stdout?.on?.("error", () => {});
process.stderr?.on?.("error", () => {});

// --- Persistent launch log ---------------------------------------------------
// Desktop-shortcut launches have NO attached console, so console.log output is
// lost — a failed GUI launch leaves no trace. Mirror every safeLog/safeWarn/
// safeError line (including the spawned backend's [server]/[server:err] output)
// to logs/electron-main.log at the repo root so any launch failure is
// diagnosable after the fact.
const LOG_FILE = path.join(__dirname, "..", "logs", "electron-main.log");
let logStream = null;
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  // Reset if the log has grown large so it never balloons unbounded.
  try {
    if (fs.statSync(LOG_FILE).size > 3 * 1024 * 1024) fs.rmSync(LOG_FILE);
  } catch {}
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  logStream.on("error", () => { logStream = null; });
  logStream.write(
    `\n===== launch ${new Date().toISOString()} (pid ${process.pid}) =====\n`,
  );
} catch {}

function writeLog(level, args) {
  if (!logStream) return;
  try {
    const line = args
      .map((a) =>
        typeof a === "string"
          ? a
          : (a && a.stack) || require("util").inspect(a, { depth: 3 }),
      )
      .join(" ");
    logStream.write(`${new Date().toISOString()} [${level}] ${line}\n`);
  } catch {}
}

function safeLog(...args) {
  try { console.log(...args); } catch {}
  writeLog("log", args);
}
function safeError(...args) {
  try { console.error(...args); } catch {}
  writeLog("err", args);
}
function safeWarn(...args) {
  try { console.warn(...args); } catch {}
  writeLog("warn", args);
}

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

const APP_ID = "com.ml-dashboard.app";
const PORT = process.env.PORT || 5000;
// Always run in development mode — this is a local tool, not distributed.
// Ensures Vite HMR + tsx --watch are active regardless of launch method
// (taskbar shortcut, start:desktop, electron:dev all behave the same).
const IS_DEV = true;
process.env.NODE_ENV = "development";
// CSP is injected explicitly via session.defaultSession.webRequest below
// (see app.whenReady block). Electron's CSP warning fires when CSP is
// absent OR contains 'unsafe-eval' — our dev CSP intentionally contains
// 'unsafe-eval' (required for Vite HMR), so the warning would still fire
// despite the explicit policy. Suppress it so the legitimate audit-trail
// log from [csp] is the single source of truth.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

// Resolve the system Node.js binary — process.execPath is electron.exe which
// cannot spawn server scripts as a plain Node process.
function findNodeBinary() {
  const { execFileSync } = require("child_process");
  try {
    const result = execFileSync("where.exe", ["node"], { encoding: "utf-8" });
    const first = result.split("\n").map((l) => l.trim()).find((l) => l && !l.includes("electron"));
    if (first && fs.existsSync(first)) return first;
  } catch {}
  // Fallback common locations
  for (const p of [
    "C:\\Program Files\\nodejs\\node.exe",
    path.join(process.env.LOCALAPPDATA || "", "fnm_multishells", "node.exe"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return "node"; // hope it's in PATH
}

const NODE_BIN = findNodeBinary();
safeLog(`[app] Node binary: ${NODE_BIN}`);

// --- Windows taskbar pinning & notification identity ---
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

// --- Single instance lock ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Port / process lifecycle helpers (dependency-free) ──
// These back the reliability fixes for intermittent "backend didn't launch":
//   - probeHealth():    is the backend on :PORT actually alive (200 on /health)?
//   - findPortOwnerPid(): which PID holds a TCP listen socket on a given port?
//   - killProcessTree(): hard-kill a PID and all descendants (tsx --watch spawns
//                        a child node + esbuild; SIGTERM on the parent orphans them)
//   - waitForPortFree(): poll until nothing listens on a port (post-kill settle)

/**
 * Probe the backend liveness endpoint. /health always returns 200 if the
 * Express process is bound to the port — a wedged orphan that crashed before
 * listen() will NOT answer, so a non-OK/throw means "not a healthy backend".
 * @returns {Promise<boolean>}
 */
async function probeHealth(timeoutMs = 2500) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: controller.signal });
    clearTimeout(t);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Find the PID that owns a LISTEN socket on the given TCP port (Windows).
 * Parses `netstat -ano` output (built-in, no deps). Returns null if unowned.
 * @param {number} port
 * @returns {number|null}
 */
function findPortOwnerPid(port) {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("netstat.exe", ["-ano", "-p", "TCP"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    for (const line of out.split("\n")) {
      // Columns: Proto  Local Address  Foreign Address  State  PID
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const [, local, , state, pidStr] = parts;
      if (state !== "LISTENING") continue;
      // Match :<port> at the end of the local address (handles 0.0.0.0:5000,
      // 127.0.0.1:5000, and [::]:5000).
      if (!local.endsWith(`:${port}`)) continue;
      const pid = parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch (e) {
    safeWarn("[port] findPortOwnerPid failed:", e.message || e);
  }
  return null;
}

/**
 * Hard-kill a process and its entire descendant tree (Windows: taskkill /T /F).
 * tsx --watch is a parent that spawns child node + esbuild workers; killing only
 * the parent leaves orphans holding the port. /T kills the tree, /F forces it.
 * @param {number} pid
 * @returns {boolean} true if taskkill ran (process may already have been gone)
 */
function killProcessTree(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    const { execFileSync } = require("child_process");
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf-8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    safeLog(`[port] Killed process tree PID ${pid}`);
    return true;
  } catch (e) {
    // taskkill exits non-zero if the PID is already gone — treat as success.
    const msg = (e.stderr || e.message || "").toString();
    if (msg.includes("not found") || msg.includes("no running")) return true;
    safeWarn(`[port] taskkill PID ${pid} failed:`, msg.trim());
    return false;
  }
}

/**
 * Poll until no process listens on the port (post-kill settle), up to maxWait.
 * @param {number} port
 * @returns {Promise<boolean>} true once free, false on timeout
 */
async function waitForPortFree(port, maxWait = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (findPortOwnerPid(port) === null) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let loadRetryCount = 0;
let userHidWindow = false; // tracks if user intentionally hid via close button
const MAX_LOAD_RETRIES = 5;

// --------------- Beta Mode (auto-recovery) ---------------
// The app always runs in resilient "beta mode":
//  - Auto-reloads on renderer crash (no dialog)
//  - Auto-reloads after sustained unresponsive state
//  - Heartbeat watchdog detects frozen renderer
//  - F12 always opens DevTools for debugging
//  - Ctrl+R / F5 always reloads the page

// --- Global error handlers (must be registered early) ---
process.on('unhandledRejection', (reason, promise) => {
  safeError('[main] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  safeError('[main] Uncaught Exception:', err);
  process.exit(1);
});

let unresponsiveTimer = null;
let heartbeatInterval = null;
let lastHeartbeat = Date.now();
const UNRESPONSIVE_TIMEOUT_MS = 12000; // auto-reload after 12s unresponsive
const HEARTBEAT_INTERVAL_MS = 5000;    // ping renderer every 5s
const HEARTBEAT_DEAD_MS = 30000;       // if no pong for 30s, force reload

// ── Backend health monitoring ──
let backendHealthInterval = null;
let backendHealthy = true;
let backendFailCount = 0;
let backendRestarting = false; // guards against stacked restarts across health ticks
const BACKEND_HEALTH_INTERVAL_MS = 10000; // poll /health every 10s
const BACKEND_FAIL_THRESHOLD = 3;         // 3 consecutive failures = dead

function startBackendHealthCheck() {
  stopBackendHealthCheck();
  backendFailCount = 0;
  backendHealthy = true;

  backendHealthInterval = setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        if (!backendHealthy) {
          safeLog("[health] Backend recovered");
          backendHealthy = true;
          setStatus("online");
          setTooltip("ML Dashboard — Online");
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:status", { healthy: true });
          }
        }
        backendFailCount = 0;
        return;
      }
    } catch {}

    // Failed
    backendFailCount++;
    if (backendFailCount >= BACKEND_FAIL_THRESHOLD && backendHealthy) {
      backendHealthy = false;
      safeError(`[health] Backend unreachable after ${BACKEND_FAIL_THRESHOLD} consecutive checks`);
      setStatus("offline");
      setTooltip("ML Dashboard — Server Down");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("backend:status", { healthy: false });
      }

      // Attempt restart unconditionally. The previous gate (serverProcess ===
      // null) NEVER fired when the tsx --watch PARENT was alive but wedged (its
      // child died / it became a zombie handle) — status stayed "offline"
      // forever. Now: if we still hold a handle, hard-kill its tree first;
      // startServer()'s pre-flight then reclaims the port if any orphan remains.
      if (backendRestarting) return; // don't stack restarts across ticks
      backendRestarting = true;
      safeLog("[health] Backend unhealthy — forcing restart...");
      try {
        if (serverProcess) {
          const pid = serverProcess.pid;
          serverProcess = null; // drop handle so exit listener can't race us
          if (pid) {
            killProcessTree(pid);
            await waitForPortFree(PORT, 8000);
          }
        }
        await startServer();
        safeLog("[health] Server restarted successfully");
        backendFailCount = 0;
        backendHealthy = true;
        setStatus("online");
        setTooltip("ML Dashboard — Online");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("backend:status", { healthy: true });
          mainWindow.webContents.reload();
        }
      } catch (err) {
        safeError("[health] Server restart failed:", err.message || err);
      } finally {
        backendRestarting = false;
      }
    }
  }, BACKEND_HEALTH_INTERVAL_MS);
}

function stopBackendHealthCheck() {
  if (backendHealthInterval) {
    clearInterval(backendHealthInterval);
    backendHealthInterval = null;
  }
}

// --------------- Splash Screen ---------------

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function updateSplashStatus(status) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.postMessage("message", { status });
  }
}

// --------------- Window State Persistence ---------------

let windowStateSaveTimer = null;

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? store.get("windowState", {}) : mainWindow.getBounds();
  store.set("windowState", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1600,
    height: bounds.height || 1000,
    maximized,
  });
}

function debouncedSaveWindowState() {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(saveWindowState, 500);
}

// --------------- IPC Handlers ---------------

function registerIpcHandlers() {
  // --- Window controls ---
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle("window:is-fullscreen", () => mainWindow?.isFullScreen() ?? false);
  ipcMain.on("window:set-fullscreen", (_e, flag) => mainWindow?.setFullScreen(!!flag));

  // --- Store ---
  ipcMain.handle("store:get", (_e, key) => store.get(key));
  ipcMain.on("store:set", (_e, { key, value }) => store.set(key, value));

  // --- Zoom controls ---
  ipcMain.handle("zoom:get", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return 1.0;
    return mainWindow.webContents.getZoomFactor();
  });
  ipcMain.on("zoom:set", (_e, factor) => {
    const clamped = Math.max(0.5, Math.min(3.0, factor));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(clamped);
      store.set("zoomFactor", clamped);
      safeLog(`[window] Zoom set to ${clamped}`);
    }
  });
  ipcMain.on("zoom:reset", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(1.0);
      store.set("zoomFactor", 1.0);
      safeLog("[window] Zoom reset to 1.0");
    }
  });

  // --- Dialogs ---
  ipcMain.handle("dialog:open", async (_e, opts) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, opts || {});
  });
  ipcMain.handle("dialog:save", async (_e, opts) => {
    if (!mainWindow) return { canceled: true, filePath: undefined };
    return dialog.showSaveDialog(mainWindow, opts || {});
  });

  // --- Theme --- (handled by themeSync.cjs via setupThemeSync)

  // --- App info ---
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:set-auto-launch", (_e, flag) => {
    app.setLoginItemSettings({
      openAtLogin: !!flag,
      path: app.getPath("exe"),
    });
    store.set("autoLaunch", !!flag);
    return true;
  });
  ipcMain.handle("app:get-auto-launch", () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  // --- Reload controls ---
  ipcMain.on("beta:reload", () => {
    safeLog("[beta] Renderer requested reload");
    if (mainWindow && !mainWindow.isDestroyed() && !userHidWindow) {
      mainWindow.webContents.reload();
    }
  });
  ipcMain.on("app:hard-reload", () => {
    safeLog("[app] Hard reload (clear cache) requested");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });
  ipcMain.on("app:restart", () => {
    safeLog("[app] Full restart requested");
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("app:path", (_e, name) => {
    const allowed = ["userData", "appData", "logs", "temp", "home"];
    if (allowed.includes(name)) return app.getPath(name);
    return "";
  });
  ipcMain.on("app:open-external", (_e, url) => {
    if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
      shell.openExternal(url);
    }
  });
  ipcMain.on("app:open-logs", () => shell.openPath(app.getPath("logs")));
  // Same allowlist as app:path — only these named app dirs may be revealed.
  ipcMain.on("app:open-path", (_e, name) => {
    const allowed = ["userData", "appData", "logs", "temp", "home"];
    if (typeof name === "string" && allowed.includes(name)) {
      shell.openPath(app.getPath(name));
    }
  });
  ipcMain.on("app:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  // --- Shortcuts (handlers registered in shortcuts.cjs) ---

  // --- Tray ---
  ipcMain.on("tray:tooltip", (_e, text) => setTooltip(text));
  ipcMain.on("tray:badge", (_e, count) => setBadge(count));

  // --- Notifications (delegates to notifications.cjs) ---
  ipcMain.on("notify:show", (_e, opts) => showNotification(opts));
}

// --------------- Power Monitor ---------------

function registerPowerMonitor() {
  powerMonitor.on("suspend", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("power:event", "suspend");
    }
  });
  powerMonitor.on("resume", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("power:event", "resume");
    }
  });
  powerMonitor.on("shutdown", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("power:event", "shutdown");
    }
  });
}

// --------------- Window ---------------

function createWindow() {
  // Restore saved window bounds
  const saved = store.get("windowState", {});
  const windowOpts = {
    width: saved.width || 1600,
    height: saved.height || 1000,
    minWidth: 1024,
    minHeight: 700,
    title: "Quant AI Dashboard (Beta)",
    icon: path.join(__dirname, "..", "build", "icons", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Custom titlebar — rendered by the React app
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    frame: false,
    backgroundColor: "#0a0a0a",
    show: false,
  };
  if (saved.x != null && saved.y != null) {
    windowOpts.x = saved.x;
    windowOpts.y = saved.y;
  }

  mainWindow = new BrowserWindow(windowOpts);

  // --- DPI-aware zoom: auto-detect display scale, apply user override ---
  const savedZoom = store.get("zoomFactor");
  if (savedZoom && savedZoom > 0) {
    mainWindow.webContents.setZoomFactor(savedZoom);
    safeLog(`[window] Restored zoom factor: ${savedZoom}`);
  } else {
    // Auto-detect: on high-DPI displays, scale up if the OS scale factor > 1
    const display = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;
    // If Windows scaling is 100% but resolution is high (e.g. 2560x1440+), bump zoom
    const { width: screenW } = display.workAreaSize;
    let autoZoom = 1.0;
    if (scaleFactor > 1) {
      // OS is already scaling — use a moderate bump
      autoZoom = Math.min(scaleFactor * 0.9, 2.0);
    } else if (screenW >= 2560) {
      autoZoom = 1.25; // Large monitor at 100% scaling
    } else if (screenW >= 1920) {
      autoZoom = 1.1; // Standard 1080p, slight bump
    }
    mainWindow.webContents.setZoomFactor(autoZoom);
    safeLog(`[window] Auto zoom: ${autoZoom} (display: ${screenW}x${display.workAreaSize.height}, scale: ${scaleFactor})`);
  }

  // Restore maximized state
  if (saved.maximized) {
    mainWindow.maximize();
  }

  // --- Content load success: dismiss splash, show window ---
  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL();
    // Don't show for the error page itself
    if (url.includes("error.html")) return;

    safeLog("[window] Content loaded successfully");
    loadRetryCount = 0;
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    // Only auto-show if the user didn't intentionally hide the window
    if (!mainWindow.isVisible() && !userHidWindow) {
      mainWindow.show();
    }

    // Arm the watchdog only NOW, once a renderer exists that can answer it.
    // Starting it at window-creation time made it fire during the very first
    // load: the renderer registers its beta:pong responder from main.tsx, so
    // until the bundle has executed there is nobody to reply. In dev that load
    // routinely exceeds HEARTBEAT_DEAD_MS (Vite serves hundreds of modules and
    // the default "/" route runs a cold front-month stitch measured at 11-18s),
    // so the watchdog force-reloaded the page it was waiting for — which
    // restarted the same slow load, forever. Symptom in the log: repeating
    // "No heartbeat for 30s — force reloading" with "Content loaded
    // successfully" never appearing. Arming here keeps the watchdog's real job
    // (catching a renderer that dies AFTER loading) without the false positive.
    startHeartbeat();
  });

  // --- Content load failure: retry or show error page ---
  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return; // ignore sub-frame failures

      safeError(
        `[window] Failed to load (code ${errorCode}): ${errorDescription}`
      );

      if (loadRetryCount < MAX_LOAD_RETRIES) {
        loadRetryCount++;
        const delay = Math.min(1000 * loadRetryCount, 4000);
        safeLog(
          `[window] Retry ${loadRetryCount}/${MAX_LOAD_RETRIES} in ${delay}ms...`
        );
        updateSplashStatus(
          `Server not ready — retry ${loadRetryCount}/${MAX_LOAD_RETRIES}...`
        );
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && !userHidWindow) {
            mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
          }
        }, delay);
      } else {
        // All retries exhausted — show error page
        safeError("[window] All retries exhausted, showing error page");
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
        }
        mainWindow.loadFile(path.join(__dirname, "error.html"), {
          query: {
            error: errorDescription || "Connection refused",
            code: String(errorCode),
            port: String(PORT),
          },
        });
        if (!userHidWindow) mainWindow.show();
      }
    }
  );

  // --- Beta Mode: Auto-recovery on renderer crash ---
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    safeError(`[beta] Renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (userHidWindow) {
      safeLog("[beta] Window is hidden — skipping auto-reload");
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Auto-reload instead of showing a dialog — beta mode stays alive
      safeLog("[beta] Auto-reloading after crash...");
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !userHidWindow) {
          mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
        }
      }, 1500);
    }
  });

  // --- Beta Mode: Auto-reload on sustained unresponsive ---
  mainWindow.webContents.on("unresponsive", () => {
    if (userHidWindow) return; // don't recover hidden windows
    safeWarn("[beta] Renderer unresponsive — starting recovery timer...");
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      if (userHidWindow) return; // user closed while timer was running
      safeError("[beta] Renderer still unresponsive — force reloading");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.forcefullyCrashRenderer();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && !userHidWindow) {
            mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
          }
        }, 1000);
      }
    }, UNRESPONSIVE_TIMEOUT_MS);
  });
  mainWindow.webContents.on("responsive", () => {
    safeLog("[beta] Renderer responsive again");
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  });

  // --- Beta Mode: DevTools & Reload shortcuts ---
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    // F12 → toggle DevTools
    if (input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
    }
    // Ctrl+R or F5 → reload
    if (input.key === "F5" || (input.control && input.key === "r")) {
      safeLog("[beta] Manual reload triggered");
      mainWindow.webContents.reload();
    }
    // Ctrl+Shift+R → hard reload (clear cache)
    if (input.control && input.shift && input.key === "R") {
      safeLog("[beta] Hard reload (cache clear) triggered");
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  // --- Beta Mode: Heartbeat watchdog ---
  // NOT started here. See did-finish-load above: arming the watchdog before a
  // renderer exists made it force-reload the initial load it was waiting on.
  startBackendHealthCheck();

  // Fallback: if nothing shows after 30s, force-show the window
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible() && !userHidWindow) {
      safeWarn("[window] Timeout — forcing window visible");
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      mainWindow.show();
    }
  }, 30000);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Track maximize/unmaximize for the renderer
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximize-changed", true);
    debouncedSaveWindowState();
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximize-changed", false);
    debouncedSaveWindowState();
  });

  // Persist window state on move/resize
  mainWindow.on("resize", debouncedSaveWindowState);
  mainWindow.on("move", debouncedSaveWindowState);
  mainWindow.on("close", saveWindowState);

  // Track last route for session restore
  mainWindow.webContents.on("did-navigate-in-page", (_e, url) => {
    try {
      const parsed = new URL(url);
      store.set("lastRoute", parsed.pathname + parsed.search);
    } catch {
      // ignore parse errors
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Minimize to tray instead of closing
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      userHidWindow = true;
      stopHeartbeat(); // don't ping a hidden renderer
      // Cancel unresponsive recovery timer — user chose to close, not recover
      if (unresponsiveTimer) {
        clearTimeout(unresponsiveTimer);
        unresponsiveTimer = null;
      }
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // When window becomes visible again (tray click, taskbar, etc.) — resume
  // heartbeat AND verify the backend is alive. If the tray-resident instance's
  // backend child died while hidden, re-showing would otherwise point the UI at
  // a dead :PORT. ensureBackendAndShow() is re-entrancy-guarded, so the
  // reveal()→show() it performs internally won't recurse here.
  mainWindow.on("show", () => {
    userHidWindow = false;
    startHeartbeat();
    if (!ensuringBackend) {
      probeHealth(2000).then((ok) => {
        if (!ok && !ensuringBackend) {
          safeWarn("[window] show: backend not healthy — triggering recovery");
          ensureBackendAndShow();
        }
      });
    }
  });

  // Set up native menus and context menus
  createAppMenu(mainWindow);
  setupContextMenus(mainWindow);
}

// --------------- Beta Mode: Heartbeat Watchdog ---------------

function startHeartbeat() {
  stopHeartbeat();
  lastHeartbeat = Date.now();

  // Listen for pong from renderer
  ipcMain.removeAllListeners("beta:pong");
  ipcMain.on("beta:pong", () => {
    lastHeartbeat = Date.now();
  });

  heartbeatInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Send ping to renderer
    try {
      mainWindow.webContents.send("beta:ping");
    } catch {}

    // Check if renderer has gone silent
    const elapsed = Date.now() - lastHeartbeat;
    if (elapsed > HEARTBEAT_DEAD_MS) {
      safeError(`[beta] No heartbeat for ${Math.round(elapsed / 1000)}s — force reloading`);
      lastHeartbeat = Date.now(); // reset to avoid repeated reloads
      try {
        mainWindow.webContents.reload();
      } catch {
        // renderer may be completely dead — reload URL
        mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// --------------- Window restore (backend-aware) ---------------
// Single entry point for every "bring the window back" path: tray click,
// tray context-menu "Show Window", second-instance (desktop icon re-click),
// and app activate. Because the app lives in the tray (close-to-tray), the
// resident instance can outlive its backend child (tsx crash, user killed
// node). Re-showing a UI pointed at a dead :PORT looks like "backend didn't
// launch". This probes /health first; if the backend is gone, it restarts it
// (startServer() reclaims the port from any wedged orphan) and reloads the
// renderer so the recovered UI points at a live server.
let ensuringBackend = false;
async function ensureBackendAndShow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  const reveal = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  // Show immediately for responsiveness, then heal the backend if needed.
  reveal();

  if (ensuringBackend) return; // a heal is already in flight
  ensuringBackend = true;
  try {
    if (await probeHealth(2000)) return; // backend is alive — nothing to do

    safeWarn("[restore] Backend not healthy on window restore — restarting...");
    setStatus("offline");
    setTooltip("ML Dashboard — Restarting server...");

    // Drop+tree-kill any stale handle so startServer()'s pre-flight has a clean
    // slate; startServer() then reclaims the port from any wedged orphan.
    if (serverProcess) {
      const pid = serverProcess.pid;
      serverProcess = null;
      if (pid) {
        killProcessTree(pid);
        await waitForPortFree(PORT, 8000);
      }
    }

    await startServer();
    await waitForServer(20000);
    safeLog("[restore] Backend restarted — reloading renderer");
    setStatus("online");
    setTooltip("ML Dashboard — Online");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("backend:status", { healthy: true });
      mainWindow.webContents.reload();
      reveal();
    }
    backendHealthy = true;
    backendFailCount = 0;
  } catch (err) {
    safeError("[restore] Backend restart failed:", err.message || err);
  } finally {
    ensuringBackend = false;
  }
}

// --------------- Server ---------------

function startServer() {
  // Pre-flight: distinguish a HEALTHY existing backend from a WEDGED orphan
  // holding the port. A healthy backend answers 200 on /health (it only does
  // so after httpServer.listen() bound the port). If the port is held but
  // /health does NOT answer, the responder is a dead/half-started orphan —
  // the backend's own EADDRINUSE handler would process.exit(1) a fresh spawn,
  // so we must reclaim the port first.
  return new Promise(async (resolve, reject) => {
    if (await probeHealth(2000)) {
      safeLog("[server] Already running and healthy on port", PORT);
      return resolve();
    }

    const orphanPid = findPortOwnerPid(PORT);
    if (orphanPid) {
      safeWarn(
        `[server] Port ${PORT} held by unhealthy PID ${orphanPid} (no /health) — reclaiming`
      );
      // If it's our own tracked process, drop the handle so the exit listener
      // doesn't null it mid-restart, then tree-kill regardless.
      if (serverProcess && serverProcess.pid === orphanPid) serverProcess = null;
      killProcessTree(orphanPid);
      const freed = await waitForPortFree(PORT, 8000);
      if (!freed) {
        safeError(`[server] Port ${PORT} still held after kill — spawning anyway`);
      } else {
        safeLog(`[server] Port ${PORT} reclaimed`);
      }
    }

    if (IS_DEV) {
      // Dev mode: start the TypeScript server with tsx --watch for hot reload.
      // tsx --watch keeps the parent process alive and restarts the child on
      // file changes — Vite HMR handles client-side, tsx handles server-side.
      safeLog("[server] Starting dev server (tsx --watch)...");
      const tsxBin = path.join(__dirname, "..", "node_modules", ".bin", "tsx.cmd");
      const envFile = path.join(__dirname, "..", ".env");
      const serverScript = path.join(__dirname, "..", "src", "server", "main.ts");
      serverProcess = spawn(tsxBin, ["--watch", serverScript], {
        cwd: path.join(__dirname, ".."),
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(PORT),
          // .env loaded by dotenv/config in main.ts + pre-loaded at top of this file
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,  // Required on Windows — tsx.cmd is a batch file
      });
    } else {
      // Production: try the built bundle first, fall back to dev server
      const serverPath = path.join(__dirname, "..", "dist", "index.cjs");
      if (!fs.existsSync(serverPath)) {
        safeWarn("[server] No production build found, falling back to dev server");
        const serverArgs = [
          "--import",
          "tsx",
          path.join(__dirname, "..", "src", "server", "main.ts"),
        ];
        serverProcess = spawn(NODE_BIN, serverArgs, {
          cwd: path.join(__dirname, ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            PORT: String(PORT),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        safeLog("[server] Starting production server...");
        serverProcess = spawn(NODE_BIN, [serverPath], {
          cwd: path.join(__dirname, ".."),
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(PORT),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    }

    let resolved = false;

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      safeLog("[server]", msg.trim());
      if (!resolved && msg.includes("serving on port")) {
        resolved = true;
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      safeError("[server:err]", msg);
      // If the production build crashes, fall back to dev server
      if (
        !resolved &&
        !IS_DEV &&
        (msg.includes("ERR_INVALID_ARG_TYPE") ||
          msg.includes("Cannot find module") ||
          msg.includes("SyntaxError"))
      ) {
        safeWarn("[server] Production build failed, falling back to dev server...");
        const dyingProcess = serverProcess;
        serverProcess = null;
        dyingProcess.kill();

        // Wait for the old process to fully exit before spawning replacement
        const spawnFallback = () => {
          const serverArgs = [
            "--import",
            "tsx",
            path.join(__dirname, "..", "src", "server", "main.ts"),
          ];
          serverProcess = spawn(NODE_BIN, serverArgs, {
            cwd: path.join(__dirname, ".."),
            env: {
              ...process.env,
              NODE_ENV: "development",
              PORT: String(PORT),
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
          serverProcess.stdout.on("data", (d) => {
            const m = d.toString();
            safeLog("[server:fallback]", m.trim());
            if (!resolved && m.includes("serving on port")) {
              resolved = true;
              resolve();
            }
          });
          serverProcess.stderr.on("data", (d) => {
            safeError("[server:fallback:err]", d.toString().trim());
          });
          serverProcess.on("error", (err) => {
            if (!resolved) { resolved = true; reject(err); }
          });
          serverProcess.on("exit", (code) => {
            safeLog("[server:fallback] Exited with code:", code);
            serverProcess = null;
          });
        };

        // Wait for the dying process to exit, with a safety timeout
        const exitTimeout = setTimeout(() => {
          safeWarn("[server] Old process did not exit in time, spawning fallback anyway");
          spawnFallback();
        }, 5000);

        dyingProcess.on("exit", () => {
          clearTimeout(exitTimeout);
          spawnFallback();
        });
      }
    });

    serverProcess.on("error", (err) => {
      safeError("[server] Failed to start:", err);
      if (!resolved) { resolved = true; reject(err); }
    });

    serverProcess.on("exit", (code) => {
      safeLog("[server] Exited with code:", code);
      serverProcess = null;
    });

    // Fallback: resolve after 15 seconds even if we didn't see the ready message
    setTimeout(() => {
      if (!resolved) { resolved = true; resolve(); }
    }, 15000);
  });
}

function stopServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  const pid = proc.pid;
  serverProcess = null;

  // tsx --watch spawns a child node + esbuild; SIGTERM on the parent alone
  // orphans them (they keep holding :PORT). On Windows, tree-kill the PID so
  // nothing survives to wedge the port on the next launch.
  if (process.platform === "win32" && pid) {
    killProcessTree(pid);
    return;
  }

  try { proc.kill("SIGTERM"); } catch {}

  // Force kill after 5s if still alive
  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(proc.pid, 0); // test if alive
      safeWarn(`[server] SIGTERM timeout — force killing PID ${proc.pid}`);
      proc.kill("SIGKILL");
    } catch {} // already dead
  }, 5000);

  proc.on("exit", () => clearTimeout(forceKillTimer));
}

// Wait for server to be reachable (API + Vite client assets)
async function waitForServer(maxWait = 30000) {
  const start = Date.now();
  let lastError = "No response";
  let attempts = 0;

  while (Date.now() - start < maxWait) {
    attempts++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/uploads`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok || (resp.status >= 200 && resp.status < 500)) {
        safeLog(
          `[server] Health check passed after ${attempts} attempts (${Date.now() - start}ms)`
        );
        // In dev mode, also verify Vite can serve the entry point
        // (Vite may still be pre-bundling dependencies)
        if (IS_DEV) {
          try {
            const vc = new AbortController();
            const vt = setTimeout(() => vc.abort(), 3000);
            const vr = await fetch(`http://127.0.0.1:${PORT}/src/main.tsx`, { signal: vc.signal });
            clearTimeout(vt);
            if (!vr.ok) {
              safeLog("[server] Vite not ready yet, waiting...");
              await new Promise((r) => setTimeout(r, 1000));
              continue;
            }
          } catch {
            safeLog("[server] Vite not ready yet, waiting...");
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
        }
        return true;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (e) {
      lastError = e.message || "Connection refused";
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Timeout — don't throw, let the loadURL retry/error page handle it
  safeWarn(
    `[server] Not reachable after ${maxWait}ms (${attempts} attempts): ${lastError}`
  );
  return false;
}

// --- Restore existing window when a second instance is attempted ---
// This fires when the user re-clicks the desktop/Start-Menu icon while the app
// is already resident in the tray. It must be backend-aware: a plain re-show of
// a UI whose backend child died reads to the user as "backend didn't launch".
app.on("second-instance", () => {
  if (mainWindow && mainWindow.isDestroyed()) {
    mainWindow = null;
  }
  ensureBackendAndShow();
});

app.whenReady().then(async () => {
  safeLog(
    `[app] Starting — NODE_ENV=${process.env.NODE_ENV}, IS_DEV=${IS_DEV}, PORT=${PORT}`
  );

  // --- Explicit Content-Security-Policy header injection ---
  // Replaces blanket ELECTRON_DISABLE_SECURITY_WARNINGS suppression with a
  // transparent, auditable policy. In dev: 'unsafe-eval' + 'unsafe-inline'
  // are required for Vite HMR (dynamic module evaluation). In prod (when
  // IS_DEV is flipped) we drop both. The renderer ONLY ever loads
  // http://127.0.0.1:5000 — no remote code execution surface exists.
  try {
    const { session } = require("electron");
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = IS_DEV
        ? [
            "default-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
            "script-src 'self' http://127.0.0.1:* 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' http://127.0.0.1:* 'unsafe-inline'",
            "img-src 'self' data: blob: http://127.0.0.1:*",
            "font-src 'self' data: http://127.0.0.1:*",
            "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
            "worker-src 'self' blob:",
          ].join("; ")
        : [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "worker-src 'self' blob:",
          ].join("; ");
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
        },
      });
    });
    safeLog(`[csp] Installed ${IS_DEV ? "dev (relaxed)" : "prod (strict)"} CSP`);
  } catch (err) {
    safeError("[csp] Failed to install CSP header hook:", err);
  }

  registerIpcHandlers();
  registerPowerMonitor();

  // Apply saved theme
  const savedTheme = store.get("theme", "system");
  nativeTheme.themeSource = savedTheme;

  createSplash();

  try {
    updateSplashStatus("Starting databases...");
    await startServer();

    updateSplashStatus("Connecting to server...");
    const serverReady = await waitForServer();

    if (serverReady) {
      updateSplashStatus("Loading dashboard...");
    } else {
      updateSplashStatus("Server slow — loading anyway...");
    }

    loadRetryCount = 0;
    createWindow();
    setupShortcuts(mainWindow);
    createTray(mainWindow, ensureBackendAndShow);
    setupThemeSync(mainWindow, store);
  } catch (err) {
    safeError("Failed to start application:", err);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    stopServer();
    dialog.showErrorBox(
      "Startup Failed",
      `The application could not start:\n\n${err.message}`
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      ensureBackendAndShow();
    }
  });
});

// ── Idempotent cleanup (safe to call multiple times) ──
let cleanedUp = false;
function runCleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  safeLog("[lifecycle] Running cleanup...");
  stopHeartbeat();
  stopBackendHealthCheck();
  unregisterAllShortcuts();
  destroyTray();
  stopServer();
}

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  runCleanup();
});

app.on("window-all-closed", () => {
  app.quit();
});
