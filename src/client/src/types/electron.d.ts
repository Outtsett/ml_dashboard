interface ElectronDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
}

interface ElectronNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  category?: 'training' | 'backtest' | 'error' | 'system';
  urgency?: 'low' | 'normal' | 'critical';
  silent?: boolean;
}

interface ElectronAPI {
  platform: NodeJS.Platform;
  isElectron: boolean;

  // Window controls
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  isFullScreen(): Promise<boolean>;
  setFullScreen(flag: boolean): void;
  onMaximizeChange(cb: (maximized: boolean) => void): () => void;

  // Store
  storeGet<T = unknown>(key: string): Promise<T | undefined>;
  storeSet(key: string, value: unknown): void;
  getWindowState(): Promise<{ x: number; y: number; width: number; height: number; maximized: boolean } | undefined>;
  setWindowState(state: { x: number; y: number; width: number; height: number; maximized: boolean }): void;

  // Dialogs
  showOpenDialog(opts: ElectronDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(opts: ElectronDialogOptions & { buttonLabel?: string }): Promise<{ canceled: boolean; filePath?: string }>;

  // Notifications
  showNotification(opts: ElectronNotificationOptions): void;

  // Theme
  getTheme(): Promise<'dark' | 'light' | 'system'>;
  setTheme(theme: 'dark' | 'light' | 'system'): void;
  onThemeChange(cb: (theme: 'dark' | 'light') => void): () => void;

  // App
  getVersion(): Promise<string>;
  getPath(name: 'userData' | 'appData' | 'logs' | 'temp' | 'home'): Promise<string>;
  openExternal(url: string): void;
  openLogsFolder(): void;
  relaunch(): void;

  // Shortcuts
  registerShortcut(accelerator: string, id: string): Promise<boolean>;
  unregisterShortcut(accelerator: string): Promise<void>;
  onShortcut(cb: (id: string) => void): () => void;

  // Menu
  onMenuAction(cb: (action: string) => void): () => void;

  // Tray
  setTrayTooltip(text: string): void;
  setTrayBadge(count: number): void;

  // Context menus
  showContextMenu(opts: { type: 'titlebar' | 'chart' | 'table' | 'model' | 'terminal' | 'general'; data?: unknown }): Promise<string | null>;

  // Reload + restart
  requestReload(): void;
  hardReload(): void;
  restart(): void;

  // Zoom
  getZoom(): Promise<number>;
  setZoom(factor: number): void;
  resetZoom(): void;

  // Beta mode: heartbeat
  onHeartbeatPing(cb: () => void): void;

  // Power
  onPowerEvent(cb: (event: 'suspend' | 'resume' | 'shutdown') => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export type { ElectronAPI, ElectronDialogOptions, ElectronNotificationOptions };
