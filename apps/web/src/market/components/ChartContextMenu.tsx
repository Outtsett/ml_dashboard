import { RefreshCw, Maximize2, ChevronsRight } from 'lucide-react';

interface ChartContextMenuProps {
  menuPoint: { x: number; y: number };
  isReloadingBars?: boolean;
  onReloadBars?: () => void;
  onJumpLatest: () => void;
  onFitContent: () => void;
  onClose: () => void;
}

export function ChartContextMenu({
  menuPoint,
  isReloadingBars,
  onReloadBars,
  onJumpLatest,
  onFitContent,
  onClose
}: ChartContextMenuProps) {
  return (
    <div
      className="absolute z-50 min-w-[11rem] rounded-md border border-white/10 bg-popover/95 backdrop-blur-sm p-1 shadow-lg"
      style={{ left: menuPoint.x, top: menuPoint.y }}
      onPointerDown={event => event.stopPropagation()}
      role="menu"
      data-testid="chart-context-menu"
    >
      <button
        type="button"
        role="menuitem"
        disabled={isReloadingBars}
        onClick={() => { onClose(); onReloadBars?.(); }}
        data-testid="menu-reload-bars"
        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-white/[0.06] disabled:opacity-50"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 mr-2 ${isReloadingBars ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        {isReloadingBars ? 'Reloading bars' : 'Reload bars'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => { onClose(); onJumpLatest(); }}
        data-testid="menu-jump-latest"
        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
      >
        <ChevronsRight className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
        Jump to most recent candle
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => { onClose(); onFitContent(); }}
        data-testid="menu-fit-content"
        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-white/[0.06]"
      >
        <Maximize2 className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
        Fit bars to view
      </button>
    </div>
  );
}
