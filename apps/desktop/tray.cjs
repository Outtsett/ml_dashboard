/**
 * ML Dashboard - System Tray Module
 *
 * Creates and manages the system tray icon, tooltip, badge,
 * and right-click context menu with quick navigation actions.
 */
const { Tray, Menu, nativeImage, app } = require("electron");

let tray = null;
let mainWindow = null;
// Backend-aware reveal callback supplied by main.cjs (ensureBackendAndShow).
// Every tray path that brings the window back routes through this so a
// tray-resident instance whose backend child died gets the server restarted
// before the UI is re-shown. Falls back to a plain show() if not provided.
let onActivate = null;

function reveal() {
  if (typeof onActivate === "function") {
    onActivate();
    return;
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * Create a 16×16 RGBA icon buffer with a rounded-square shape.
 * @param {"healthy"|"training"|"error"} status
 */
function createTrayIconBuffer(status) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const colors = {
    healthy: [70, 128, 179, 255],  // primary blue #4680B3
    training: [234, 179, 8, 255],  // yellow
    error: [239, 68, 68, 255],     // red
  };
  const [r, g, b, a] = colors[status] || colors.healthy;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2 + 0.5;
      const cy = y - size / 2 + 0.5;
      const dist = Math.max(Math.abs(cx), Math.abs(cy));
      const idx = (y * size + x) * 4;
      if (dist <= 6) {
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = a;
      } else {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
      }
    }
  }
  return buf;
}

function navigateTo(route) {
  if (mainWindow) {
    reveal(); // backend-aware show
    mainWindow.webContents.send("menu:action", `navigate:${route}`);
  }
}

function updateContextMenu(status = "healthy", trainingActive = false) {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: "QuantAI Dashboard", enabled: false },
    { type: "separator" },
    {
      label: mainWindow?.isVisible() ? "Hide Window" : "Show Window",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          reveal(); // backend-aware show
        }
      },
    },
    { type: "separator" },
    {
      label: "Quick Actions",
      submenu: [
        { label: "Market Data", click: () => navigateTo("/") },
        { label: "ML Studio", click: () => navigateTo("/ml-studio") },
        { label: "Portfolio", click: () => navigateTo("/portfolio") },
        { label: "Databases", click: () => navigateTo("/databases") },
      ],
    },
    { type: "separator" },
    {
      label: trainingActive
        ? "\u27F3 Training in Progress..."
        : "No Active Training",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(win, activateCb) {
  mainWindow = win;
  onActivate = typeof activateCb === "function" ? activateCb : null;

  const trayIcon = nativeImage.createFromBuffer(
    createTrayIconBuffer("healthy"),
    { width: 16, height: 16 },
  );

  tray = new Tray(trayIcon);
  tray.setToolTip("QuantAI Dashboard \u2014 Running");

  updateContextMenu();

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        reveal(); // backend-aware show
      }
    }
  });

  tray.on("double-click", () => {
    if (mainWindow) {
      reveal(); // backend-aware show
    }
  });

  return tray;
}

function setTooltip(text) {
  if (tray) tray.setToolTip(text);
}

function setBadge(count) {
  if (tray) {
    const base = "QuantAI Dashboard";
    tray.setToolTip(
      count > 0 ? `${base} \u2014 ${count} alert(s)` : `${base} \u2014 Running`,
    );
  }
}

function setStatus(status) {
  if (!tray) return;
  const icon = nativeImage.createFromBuffer(
    createTrayIconBuffer(status),
    { width: 16, height: 16 },
  );
  tray.setImage(icon);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  updateContextMenu,
  setTooltip,
  setBadge,
  setStatus,
  destroyTray,
};
