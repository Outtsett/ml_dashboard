/**
 * ML Dashboard - Native Application Menu
 *
 * Builds a professional menu bar with File, Edit, View, Tools,
 * Window, and Help menus. Menu actions are forwarded to the
 * renderer via IPC ("menu:action" channel).
 */
const { Menu, shell, app, BrowserWindow } = require("electron");

function sendAction(win, action) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("menu:action", action);
  }
}

function createAppMenu(mainWindow) {
  const template = [
    // ─── File ───
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            // Re-show existing window rather than spawning a new one
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        { type: "separator" },
        {
          label: "Import Data",
          accelerator: "CmdOrCtrl+I",
          click: () => sendAction(mainWindow, "import-data"),
        },
        {
          label: "Export Results",
          click: () => sendAction(mainWindow, "export-results"),
        },
        { type: "separator" },
        {
          label: "Preferences",
          accelerator: "CmdOrCtrl+,",
          click: () => sendAction(mainWindow, "navigate:/settings"),
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },

    // ─── Edit ───
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        {
          label: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          role: "redo",
        },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          role: "selectAll",
        },
      ],
    },

    // ─── View ───
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+B",
          click: () => sendAction(mainWindow, "toggle-sidebar"),
        },
        { type: "separator" },
        {
          label: "Market Data",
          accelerator: "CmdOrCtrl+1",
          click: () => sendAction(mainWindow, "navigate:/"),
        },
        {
          label: "ML Studio",
          accelerator: "CmdOrCtrl+2",
          click: () => sendAction(mainWindow, "navigate:/ml-studio"),
        },
        {
          label: "Model Catalog",
          accelerator: "CmdOrCtrl+3",
          click: () => sendAction(mainWindow, "navigate:/model-catalog"),
        },
        {
          label: "Portfolio",
          accelerator: "CmdOrCtrl+4",
          click: () => sendAction(mainWindow, "navigate:/portfolio"),
        },
        {
          label: "Databases",
          accelerator: "CmdOrCtrl+5",
          click: () => sendAction(mainWindow, "navigate:/databases"),
        },
        { type: "separator" },
        {
          label: "Toggle Fullscreen",
          accelerator: "F11",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          role: "zoomOut",
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          role: "resetZoom",
        },
        { type: "separator" },
        {
          label: "Developer Tools",
          accelerator: "CmdOrCtrl+Shift+I",
          role: "toggleDevTools",
        },
      ],
    },

    // ─── Tools ───
    {
      label: "Tools",
      submenu: [
        {
          label: "Run Backtest",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => sendAction(mainWindow, "run-backtest"),
        },
        { type: "separator" },
        {
          label: "Open Terminal",
          accelerator: "CmdOrCtrl+`",
          click: () => sendAction(mainWindow, "open-terminal"),
        },
        {
          label: "Open QuestDB Console",
          click: () => shell.openExternal("http://localhost:9000"),
        },
        { type: "separator" },
        {
          label: "Restart Server",
          click: () => sendAction(mainWindow, "restart-server"),
        },
        {
          label: "Clear Cache",
          click: () => sendAction(mainWindow, "clear-cache"),
        },
        { type: "separator" },
        {
          label: "Open Logs Folder",
          click: () => sendAction(mainWindow, "open-logs"),
        },
      ],
    },

    // ─── Window ───
    {
      label: "Window",
      submenu: [
        { label: "Minimize", role: "minimize" },
        {
          label: "Maximize",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMaximized()) {
                mainWindow.restore();
              } else {
                mainWindow.maximize();
              }
            }
          },
        },
        { type: "separator" },
        { label: "Close", accelerator: "CmdOrCtrl+W", role: "close" },
      ],
    },

    // ─── Help ───
    {
      label: "Help",
      submenu: [
        {
          label: "About QuantAI Dashboard",
          click: () => sendAction(mainWindow, "about"),
        },
        {
          label: "Documentation",
          click: () =>
            shell.openExternal(
              "https://github.com/Outtsett/ml_dashboard#readme",
            ),
        },
        { type: "separator" },
        {
          label: "Check for Updates",
          click: () => sendAction(mainWindow, "check-updates"),
        },
        {
          label: "Report Issue",
          click: () =>
            shell.openExternal(
              "https://github.com/Outtsett/ml_dashboard/issues",
            ),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { createAppMenu };
