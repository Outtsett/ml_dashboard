import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy, RotateCw, RefreshCcw } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { useLocation } from 'wouter';

const routeTitles: Record<string, string> = {
  '/': 'Market Data',
  '/portfolio': 'Portfolio',
  '/watchlist': 'Watchlist',
  '/news': 'News',
  '/databases': 'Databases',
  '/ml-studio': 'ML Studio',
  '/model-catalog': 'Model Catalog',
  '/settings': 'Settings',
  '/backtest': 'Backtest',
  '/training': 'Training',
  '/fourier-transform': 'Fourier Transform',
  '/architecture-explorer': 'Architecture Explorer',
};

export function Titlebar() {
  const api = window.electronAPI;
  const [location] = useLocation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.isMaximized().then(setMaximized);
    return api.onMaximizeChange(setMaximized);
  }, [api]);

  if (!api) return null;

  const title = routeTitles[location] || 'QuantAI Dashboard';

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!api) return;
    const action = await api.showContextMenu({ type: 'titlebar' });
    if (action === 'reload') {
      api.requestReload();
    } else if (action === 'toggle-fullscreen') {
      const isFull = await api.isFullScreen();
      api.setFullScreen(!isFull);
    }
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      className="titlebar fixed top-0 left-0 right-0 h-9 z-50 flex items-center select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: App branding */}
      <div
        className="flex items-center gap-2 pl-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Logo className="h-4 w-4" />
        <span className="text-xs font-display font-medium text-muted-foreground/70">
          QuantAI
        </span>
      </div>

      {/* Center: Page title */}
      <div className="flex-1 text-center">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
      </div>

      {/* Right: Reload + Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => api.requestReload()}
          className="h-full w-10 flex items-center justify-center text-muted-foreground/40 hover:bg-white/10 hover:text-muted-foreground transition-colors"
          aria-label="Reload (Ctrl+R)"
          title="Reload (Ctrl+R)"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        <button
          onClick={() => api.hardReload?.()}
          className="h-full w-10 flex items-center justify-center text-muted-foreground/40 hover:bg-white/10 hover:text-muted-foreground transition-colors"
          aria-label="Hard Reload (Ctrl+Shift+R)"
          title="Hard Reload — clear cache (Ctrl+Shift+R)"
        >
          <RefreshCcw className="h-3 w-3" />
        </button>
        <div className="w-px h-4 bg-white/10 mx-0.5" />
        <button
          onClick={() => api.minimize()}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => api.maximize()}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
          aria-label={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? (
            <Copy className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={() => api.close()}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
