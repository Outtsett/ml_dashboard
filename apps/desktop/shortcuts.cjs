const { globalShortcut, ipcMain } = require("electron");

let mainWindow = null;
const registeredShortcuts = new Map();

const DEFAULT_SHORTCUTS = [
  { accelerator: "CommandOrControl+1", id: "nav-market" },
  { accelerator: "CommandOrControl+2", id: "nav-ml" },
  { accelerator: "CommandOrControl+3", id: "nav-catalog" },
  { accelerator: "CommandOrControl+4", id: "nav-portfolio" },
  { accelerator: "CommandOrControl+5", id: "nav-databases" },
  { accelerator: "CommandOrControl+6", id: "nav-watchlist" },
  { accelerator: "CommandOrControl+7", id: "nav-settings" },
  { accelerator: "F11", id: "fullscreen" },
];

function setupShortcuts(win) {
  mainWindow = win;

  for (const { accelerator, id } of DEFAULT_SHORTCUTS) {
    registerShortcut(accelerator, id);
  }

  ipcMain.handle("shortcut:register", (_e, { accelerator, id }) => {
    return registerShortcut(accelerator, id);
  });

  ipcMain.handle("shortcut:unregister", (_e, accelerator) => {
    unregisterShortcut(accelerator);
  });
}

function registerShortcut(accelerator, id) {
  try {
    if (registeredShortcuts.has(accelerator)) {
      globalShortcut.unregister(accelerator);
    }

    const success = globalShortcut.register(accelerator, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("shortcut:triggered", id);
        if (id.startsWith("nav-")) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    if (success) {
      registeredShortcuts.set(accelerator, id);
    }
    return success;
  } catch (err) {
    console.error(`[shortcuts] Failed to register ${accelerator}:`, err.message);
    return false;
  }
}

function unregisterShortcut(accelerator) {
  if (registeredShortcuts.has(accelerator)) {
    globalShortcut.unregister(accelerator);
    registeredShortcuts.delete(accelerator);
  }
}

function unregisterAll() {
  globalShortcut.unregisterAll();
  registeredShortcuts.clear();
}

module.exports = { setupShortcuts, unregisterAll };
