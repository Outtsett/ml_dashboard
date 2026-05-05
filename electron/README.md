# Electron — Desktop Wrapper

Electron 34 desktop shell wrapping the web application. Manages database lifecycle, native menus, system tray, keyboard shortcuts, and theme synchronization.

## Files

| File | Purpose |
|---|---|
| `main.cjs` | Main process: window creation, IPC handlers, lifecycle management, heartbeat monitoring |
| `preload.cjs` | Preload script: exposes `electronAPI` to renderer (IPC bridge, heartbeat responder) |
| `start-databases.cjs` | Database lifecycle manager: starts QuestDB `java.exe` process, health checks |
| `menus.cjs` | Native application menu (File, Edit, View, Tools, Window, Help) |
| `contextMenus.cjs` | Right-click context menu handlers |
| `shortcuts.cjs` | Global keyboard shortcuts registration |
| `tray.cjs` | System tray icon + menu |
| `store.cjs` | Persistent settings via `electron-store` (window bounds, preferences) |
| `themeSync.cjs` | OS theme detection + synchronization with app theme |
| `notifications.cjs` | Native desktop notification handlers |
| `splash.html` | Splash screen shown during startup |
| `error.html` | Error page shown on fatal failures |

## Startup Sequence

1. `main.cjs` creates the BrowserWindow
2. `start-databases.cjs` launches QuestDB (if not running as Windows service)
3. Splash screen displayed while server starts
4. Connects to `http://127.0.0.1:5000` when server is ready
5. Heartbeat ping/pong monitors renderer health (auto-reload on crash)

## Development

```bash
# Start with full dev stack (QuestDB + server + Electron)
npm run electron:dev

# Build NSIS installer for Windows
npm run build:electron
```

## Build Output

The `electron-builder` config in `package.json` produces:
- **Windows**: NSIS installer in `release/`
- **Linux**: AppImage
- **macOS**: DMG

All files use `.cjs` extension because Electron's main process requires CommonJS, while the rest of the project uses ESM (`"type": "module"`).
