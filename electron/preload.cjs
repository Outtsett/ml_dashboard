/**
 * ML Dashboard - Electron Preload Script
 *
 * Exposes a full API to the renderer process via contextBridge.
 * Keeps contextIsolation enabled for security.
 */
const { contextBridge, ipcRenderer } = require("electron");

// Whitelist of allowed electron-store keys (prevents arbitrary key access from renderer)
const ALLOWED_STORE_KEYS = [
  'theme', 'windowState', 'windowBounds', 'sidebarCollapsed',
  'lastSymbol', 'lastTimeframe', 'recentSymbols', 'settings',
  'motiveWaveConfig', 'terminalSessions', 'chartLayout',
  'betaMode', 'devToolsEnabled', 'fontSize', 'zoomFactor', 'locale', 'lastRoute',
];

contextBridge.exposeInMainWorld("electronAPI", {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  isFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  setFullScreen: (flag) => ipcRenderer.send("window:set-fullscreen", flag),
  onMaximizeChange: (cb) => {
    const handler = (_e, val) => cb(val);
    ipcRenderer.on("window:maximize-changed", handler);
    return () => ipcRenderer.removeListener("window:maximize-changed", handler);
  },

  // Window state persistence
  getWindowState: () => ipcRenderer.invoke("store:get", "windowState"),
  setWindowState: (state) => ipcRenderer.send("store:set", { key: "windowState", value: state }),

  // Generic store (for preferences) — key-whitelisted
  storeGet: (key) => {
    if (!ALLOWED_STORE_KEYS.includes(key)) {
      console.warn(`[preload] Blocked store access for key: ${key}`);
      return Promise.resolve(undefined);
    }
    return ipcRenderer.invoke("store:get", key);
  },
  storeSet: (key, value) => {
    if (!ALLOWED_STORE_KEYS.includes(key)) {
      console.warn(`[preload] Blocked store write for key: ${key}`);
      return;
    }
    ipcRenderer.send("store:set", { key, value });
  },

  // File dialogs
  showOpenDialog: (opts) => ipcRenderer.invoke("dialog:open", opts),
  showSaveDialog: (opts) => ipcRenderer.invoke("dialog:save", opts),

  // Native notifications
  showNotification: (opts) => ipcRenderer.send("notify:show", opts),

  // Theme
  getTheme: () => ipcRenderer.invoke("theme:get"),
  setTheme: (theme) => ipcRenderer.send("theme:set", theme),
  onThemeChange: (cb) => {
    const handler = (_e, theme) => cb(theme);
    ipcRenderer.on("theme:changed", handler);
    return () => ipcRenderer.removeListener("theme:changed", handler);
  },

  // Zoom controls
  getZoom: () => ipcRenderer.invoke("zoom:get"),
  setZoom: (factor) => ipcRenderer.send("zoom:set", factor),
  resetZoom: () => ipcRenderer.send("zoom:reset"),

  // App info
  getVersion: () => ipcRenderer.invoke("app:version"),
  getPath: (name) => ipcRenderer.invoke("app:path", name),
  openExternal: (url) => ipcRenderer.send("app:open-external", url),
  openLogsFolder: () => ipcRenderer.send("app:open-logs"),
  relaunch: () => ipcRenderer.send("app:relaunch"),

  // Shortcuts
  registerShortcut: (accelerator, id) => ipcRenderer.invoke("shortcut:register", { accelerator, id }),
  unregisterShortcut: (accelerator) => ipcRenderer.invoke("shortcut:unregister", accelerator),
  onShortcut: (cb) => {
    const handler = (_e, id) => cb(id);
    ipcRenderer.on("shortcut:triggered", handler);
    return () => ipcRenderer.removeListener("shortcut:triggered", handler);
  },

  // Menu actions (from native menu clicks)
  onMenuAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },

  // Tray
  setTrayTooltip: (text) => ipcRenderer.send("tray:tooltip", text),
  setTrayBadge: (count) => ipcRenderer.send("tray:badge", count),

  // Context menus
  showContextMenu: (opts) => ipcRenderer.invoke("context-menu:show", opts),

  // Power events
  onPowerEvent: (cb) => {
    const handler = (_e, event) => cb(event);
    ipcRenderer.on("power:event", handler);
    return () => ipcRenderer.removeListener("power:event", handler);
  },

  // Beta mode: heartbeat + recovery
  onHeartbeatPing: (cb) => {
    ipcRenderer.on("beta:ping", () => {
      ipcRenderer.send("beta:pong");
      if (cb) cb();
    });
  },
  requestReload: () => ipcRenderer.send("beta:reload"),
  hardReload: () => ipcRenderer.send("app:hard-reload"),
  restart: () => ipcRenderer.send("app:restart"),
});
