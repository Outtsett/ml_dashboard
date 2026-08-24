# Electron — Desktop Wrapper

Electron 34 desktop shell wrapping the web application. Manages database lifecycle, native menus, system tray, keyboard shortcuts, and theme synchronization.

## Files

| File | Purpose |
|---|---|
| `main.cjs` | Main process: orchestrates startup (backend spawn + port pre-flight + QuestDB PID adoption), window creation, IPC handlers, lifecycle, heartbeat + backend health watchdog, backend-aware window restore |
| `preload.cjs` | Preload script: exposes `electronAPI` to renderer (IPC bridge, heartbeat responder) |
| `start-databases.cjs` | Standalone QuestDB starter (`java.exe`, PID file). **Not in the GUI launch path** — `electron .` starts QuestDB via the backend (`src/server/main.ts` → `runStartupSequence()`) and `main.cjs` adopts its PID. Used only for manual/CLI DB startup (`node electron/start-databases.cjs`). |
| `menus.cjs` | Native application menu (File, Edit, View, Tools, Window, Help) |
| `contextMenus.cjs` | Right-click context menu handlers |
| `shortcuts.cjs` | Global keyboard shortcuts registration |
| `tray.cjs` | System tray icon + menu |
| `store.cjs` | Persistent settings via `electron-store` (window bounds, preferences) |
| `themeSync.cjs` | OS theme detection + synchronization with app theme |
| `notifications.cjs` | Native desktop notification handlers |
| `splash.html` | Splash screen shown during startup |
| `error.html` | Error page shown on fatal failures |

**Launch log:** the main process mirrors all `safeLog`/`safeWarn`/`safeError` output — including the spawned backend's `[server]`/`[server:err]` lines — to **`logs/electron-main.log`** (repo root). Desktop-shortcut launches have no attached console, so this file is the authoritative record for diagnosing a failed GUI launch. Each launch appends a `===== launch <ISO> (pid …) =====` banner; the file self-resets past 3 MB.

## Startup Sequence

`main.cjs` is the single orchestrator. Launching the desktop/Start-Menu shortcut (`electron .`) brings up the entire stack — DB, backend, and frontend — no npm script required.

1. `app.whenReady()` → `startServer()`:
   - **Port pre-flight.** Probe `http://127.0.0.1:5000/health`. If a *healthy* backend already answers, reuse it. If port 5000 is held by an *unhealthy* orphan (no `/health`), find the owning PID (`netstat -ano`) and tree-kill it (`taskkill /T /F`), then reclaim the port — otherwise the backend's own `EADDRINUSE` handler would `exit(1)` the fresh spawn.
   - Spawn the backend: `tsx --watch src/server/main.ts` (dev). The backend serves **both** the REST API and the Vite frontend on port 5000, and starts QuestDB itself via `runStartupSequence()`.
2. Splash screen displayed while `waitForServer()` polls until the server is ready.
3. **QuestDB PID adoption** (`adoptQuestDbPid()`): because the backend (not `start-databases.cjs`) starts QuestDB, no PID file is written. `main.cjs` discovers the running QuestDB's PID (owner of the HTTP port, default 9000) and writes `electron/.questdb.pid` so `stopDatabases()` can tear it down on quit — prevents orphaned `java.exe` accumulating across launches.
4. Window loads `http://127.0.0.1:5000`.
5. **Resilience watchdogs:**
   - Heartbeat ping/pong monitors renderer health (auto-reload on crash/freeze).
   - Backend health watchdog polls `/health` every 10s; after 3 consecutive failures it **unconditionally** restarts the backend (tree-kills any wedged process, reclaims the port, re-spawns) — regardless of the tracked process handle.
6. **Close-to-tray.** Closing the window hides it to the system tray (the app stays resident). Every "bring the window back" path — tray click/double-click, tray "Show Window", second-instance (desktop icon re-click), app activate — routes through `ensureBackendAndShow()`, which probes `/health` and restarts a dead backend before revealing the UI. (Prevents re-showing a UI pointed at a backend that died while hidden.)

## Development

```bash
# Full dev stack via npm (server + Electron, concurrently)
npm run electron:dev

# Equivalent: just launch Electron — main.cjs orchestrates DB + backend + frontend
./node_modules/electron/dist/electron.exe .

# Build NSIS installer for Windows
npm run build:electron
```

## Build Output

The `electron-builder` config in `package.json` produces:
- **Windows**: NSIS installer in `release/`
- **Linux**: AppImage
- **macOS**: DMG

All files use `.cjs` extension because Electron's main process requires CommonJS, while the rest of the project uses ESM (`"type": "module"`).
