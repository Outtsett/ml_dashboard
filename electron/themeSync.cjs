/**
 * ML Dashboard - OS Theme Synchronization
 *
 * Watches nativeTheme changes and forwards them to the renderer.
 * Supports "dark", "light", and "system" (follow OS) modes,
 * persisted via an optional electron-store instance.
 */
const { nativeTheme, ipcMain } = require("electron");

let mainWindow = null;
let store = null;

function setupThemeSync(win, electronStore) {
  mainWindow = win;
  store = electronStore || null;

  nativeTheme.on("updated", () => {
    const isDark = nativeTheme.shouldUseDarkColors;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("theme:changed", isDark ? "dark" : "light");
    }
  });

  ipcMain.handle("theme:get", () => {
    const saved = store?.get?.("theme", "system") ?? "system";
    if (saved === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    return saved;
  });

  ipcMain.on("theme:set", (_e, theme) => {
    store?.set?.("theme", theme);
    if (theme === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = theme;
    }
  });
}

module.exports = { setupThemeSync };
