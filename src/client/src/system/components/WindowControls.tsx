import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { cn } from "@/shared/utils/utils";

export function WindowControls({ className }: { className?: string }) {
  const api = window.electronAPI;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.isMaximized().then(setMaximized);
    return api.onMaximizeChange(setMaximized);
  }, [api]);

  if (!api) return null;

  return (
    <div
      className={cn('flex items-center h-full', className)}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => api.minimize()}
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
        aria-label="Minimize"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => api.maximize()}
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
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
        className="h-full w-11 flex items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
