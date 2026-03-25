/**
 * ML Dashboard - Electron Store
 *
 * Thin wrapper around electron-store with typed defaults for all
 * persisted application state.
 */
const Store = require("electron-store");

const store = new Store({
  defaults: {
    windowState: {
      x: undefined,
      y: undefined,
      width: 1600,
      height: 1000,
      maximized: false,
    },
    lastRoute: "/",
    theme: "system",
    sidebarCollapsed: false,
    minimizeToTray: true,
    notifications: {
      training: true,
      backtest: true,
      errors: true,
      sound: false,
    },
    recentFiles: [],
    shortcuts: {},
  },
});

module.exports = store;
