/**
 * ML Dashboard - Electron Preload Script
 *
 * Exposes a minimal API to the renderer process via contextBridge.
 * Keeps contextIsolation enabled for security.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,
});
