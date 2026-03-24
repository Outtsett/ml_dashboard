/**
 * ML Dashboard - Electron Main Process
 *
 * Databases are started by electron/start-databases.cjs before this runs.
 * This process opens a BrowserWindow pointing at the server, and stops
 * databases when the window closes.
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

// Prevent EPIPE crashes when launched without a console (desktop shortcut)
// When there's no terminal, stdout/stderr pipes can close unexpectedly.
function safeLog(...args) {
  try { console.log(...args); } catch {}
}
function safeError(...args) {
  try { console.error(...args); } catch {}
}
function safeWarn(...args) {
  try { console.warn(...args); } catch {}
}
process.stdout?.on?.("error", () => {});
process.stderr?.on?.("error", () => {});

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
const IS_DEV = process.env.NODE_ENV === "development";

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

// Database paths for shutdown
const QUESTDB_PID_FILE = path.join(__dirname, ".questdb.pid");

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
  // Attempt graceful shutdown
  try {
    stopDatabases();
  } catch (e) {
    safeError('[main] Failed to stop databases during crash:', e);
  }
  process.exit(1);
});

let unresponsiveTimer = null;
let heartbeatInterval = null;
let lastHeartbeat = Date.now();
const UNRESPONSIVE_TIMEOUT_MS = 12000; // auto-reload after 12s unresponsive
const HEARTBEAT_INTERVAL_MS = 5000;    // ping renderer every 5s
const HEARTBEAT_DEAD_MS = 30000;       // if no pong for 30s, force reload

// --------------- Database Shutdown ---------------

function stopDatabases() {
  // --- QuestDB (kill by saved PID) ---
  try {
    if (fs.existsSync(QUESTDB_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(QUESTDB_PID_FILE, "utf-8").trim(), 10);
      if (pid) {
        safeLog(`[db] Stopping QuestDB (PID: ${pid})...`);
        process.kill(pid);
        fs.unlinkSync(QUESTDB_PID_FILE);
        safeLog("[db] QuestDB stopped");
      }
    }
  } catch (err) {
    // ESRCH = process doesn't exist (already stopped)
    if (err.code !== "ESRCH") {
      safeError("[db] Error stopping QuestDB:", err.message);
    }
    try { fs.unlinkSync(QUESTDB_PID_FILE); } catch {}
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

  // --- Beta mode: renderer-requested reload ---
  ipcMain.on("beta:reload", () => {
    safeLog("[beta] Renderer requested reload");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
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
          if (mainWindow && !mainWindow.isDestroyed()) {
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
        mainWindow.show();
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
  startHeartbeat();

  // Fallback: if nothing shows after 30s, force-show the window
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
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

  // When window becomes visible again (tray click, taskbar, etc.) — resume heartbeat
  mainWindow.on("show", () => {
    userHidWindow = false;
    startHeartbeat();
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

// --------------- Server ---------------

function startServer() {
  // First check if a server is already running (e.g. from `npm run dev`)
  return new Promise(async (resolve, reject) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/uploads`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok || (resp.status >= 200 && resp.status < 500)) {
        safeLog("[server] Already running on port", PORT);
        return resolve();
      }
    } catch {
      // Not running — we need to start it
    }

    if (IS_DEV) {
      // Dev mode: start the TypeScript server directly
      safeLog("[server] Starting dev server...");
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
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
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
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isDestroyed()) {
      mainWindow = null;
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.whenReady().then(async () => {
  safeLog(
    `[app] Starting — NODE_ENV=${process.env.NODE_ENV}, IS_DEV=${IS_DEV}, PORT=${PORT}`
  );
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
    createTray(mainWindow);
    setupThemeSync(mainWindow, store);
  } catch (err) {
    safeError("Failed to start application:", err);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    stopServer();
    stopDatabases();
    dialog.showErrorBox(
      "Startup Failed",
      `The application could not start:\n\n${err.message}`
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  stopHeartbeat();
  unregisterAllShortcuts();
  destroyTray();
  stopServer();
  stopDatabases();
});

app.on("window-all-closed", () => {
  stopServer();
  stopDatabases();
  app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  destroyTray();
  stopServer();
  stopDatabases();
});

// Safety net
process.on("exit", () => {
  stopDatabases();
});
