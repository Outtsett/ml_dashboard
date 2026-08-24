import { useEffect } from 'react';
import { useLocation } from 'wouter';

interface ShortcutEntry {
  id: string;
  label: string;
  handler: () => void;
}

type ShortcutMap = Record<string, ShortcutEntry>;

export function useGlobalShortcuts() {
  const [, setLocation] = useLocation();
  const api = window.electronAPI;

  useEffect(() => {
    const shortcuts: ShortcutMap = {
      'Ctrl+1': { id: 'nav-market', label: 'Market Data', handler: () => setLocation('/') },
      'Ctrl+2': { id: 'nav-ml', label: 'ML Studio', handler: () => setLocation('/ml-studio') },
      'Ctrl+3': { id: 'nav-catalog', label: 'Model Catalog', handler: () => setLocation('/model-catalog') },
      'Ctrl+4': { id: 'nav-portfolio', label: 'Portfolio', handler: () => setLocation('/portfolio') },
      'Ctrl+5': { id: 'nav-databases', label: 'Databases', handler: () => setLocation('/databases') },
      'Ctrl+6': { id: 'nav-watchlist', label: 'Watchlist', handler: () => setLocation('/watchlist') },
      'Ctrl+7': { id: 'nav-settings', label: 'Settings', handler: () => setLocation('/settings') },
      'F11': {
        id: 'fullscreen',
        label: 'Toggle Fullscreen',
        handler: () => {
          api?.isFullScreen().then((fs: boolean) => api.setFullScreen(!fs));
        },
      },
    };

    if (!api) {
      // Browser fallback: register keyboard shortcuts directly
      const handler = (e: KeyboardEvent) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey) {
          const num = parseInt(e.key);
          if (num >= 1 && num <= 7) {
            e.preventDefault();
            const accel = `Ctrl+${num}`;
            shortcuts[accel]?.handler();
          }
        }
        if (e.key === 'F11') {
          e.preventDefault();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }

    // Electron: listen for shortcut events from the main process
    const cleanup = api.onShortcut((id: string) => {
      const shortcut = Object.values(shortcuts).find((s) => s.id === id);
      shortcut?.handler();
    });

    return cleanup;
  }, [api, setLocation]);
}
