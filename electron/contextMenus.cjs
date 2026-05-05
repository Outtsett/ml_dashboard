/**
 * ML Dashboard - Context Menu Module
 *
 * Provides right-click context menus via IPC. The renderer invokes
 * "context-menu:show" with { type, data } and receives the chosen
 * action string back (or null if dismissed).
 */
const { Menu, ipcMain } = require("electron");

/**
 * Build a menu template for the given context type.
 * Each item carries an `action` string returned to the renderer.
 */
function templateFor(type, _data) {
  switch (type) {
    case "titlebar":
      return [
        { label: "Reload Dashboard", action: "reload" },
        { type: "separator" },
        { label: "Toggle Fullscreen", action: "toggle-fullscreen" }
      ];

    case "chart":
      return [
        { label: "Copy Price", action: "copy-price" },
        { label: "Add Indicator", action: "add-indicator" },
        { label: "Set Alert", action: "set-alert" },
        { type: "separator" },
        { label: "Save Chart as PNG", action: "save-chart-png" },
      ];

    case "table":
      return [
        { label: "Copy Cell", action: "copy-cell" },
        { label: "Copy Row", action: "copy-row" },
        { type: "separator" },
        { label: "Export Selection as CSV", action: "export-selection-csv" },
        { label: "Export All as CSV", action: "export-all-csv" },
      ];

    case "model":
      return [
        { label: "View Details", action: "view-details" },
        { label: "Rename", action: "rename" },
        { label: "Export Model", action: "export-model" },
        { type: "separator" },
        { label: "Delete Model", action: "delete-model" },
      ];

    case "terminal":
      return [
        { label: "Copy", action: "terminal-copy" },
        { label: "Paste", action: "terminal-paste" },
        { label: "Clear Terminal", action: "terminal-clear" },
        { type: "separator" },
        { label: "Kill Process", action: "terminal-kill" },
      ];

    case "general":
    default:
      return [
        { label: "Cut", action: "cut", role: "cut" },
        { label: "Copy", action: "copy", role: "copy" },
        { label: "Paste", action: "paste", role: "paste" },
        { label: "Select All", action: "select-all", role: "selectAll" },
      ];
  }
}

function setupContextMenus(mainWindow) {
  ipcMain.handle("context-menu:show", (_event, { type, data }) => {
    return new Promise((resolve) => {
      const items = templateFor(type, data);
      let resolved = false;

      const menuTemplate = items.map((item) => {
        if (item.type === "separator") return { type: "separator" };
        return {
          label: item.label,
          role: item.role,
          click: () => {
            resolved = true;
            resolve(item.action);
          },
        };
      });

      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup({
        window: mainWindow,
        callback: () => {
          // Menu closed without selection
          if (!resolved) resolve(null);
        },
      });
    });
  });
}

module.exports = { setupContextMenus };
