import type { PriceInfo } from "./types";

interface ChartHUDProps {
  symbol: string;
  isFutures: boolean;
  activeContract: string | null;
  tickOrPipLabel: string;
  priceInfo: PriceInfo | null;
  decimals: number;
}

export function ChartHUD({
  symbol,
  isFutures,
  activeContract,
  tickOrPipLabel,
  priceInfo,
  decimals
}: ChartHUDProps) {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-3 text-[11px] font-mono bg-black/50 backdrop-blur-md rounded-lg px-3.5 py-2 border-l-2 border-l-primary/60 border border-white/[0.06] shadow-lg pointer-events-none z-10">
      <span className="text-primary font-bold text-xs tracking-wide">{symbol}</span>
      {/* Active contract badge shows which expiration is being charted at the crosshair */}
      {isFutures && activeContract && activeContract !== symbol && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/90 border border-amber-500/20 font-semibold tracking-wide">
          {activeContract}
        </span>
      )}
      <span className="text-muted-foreground/70 text-[10px]">{tickOrPipLabel}</span>
      {priceInfo && (
        <>
          <span className="text-[10px]"><span className="text-blue-400/80 font-medium">O</span> <span className="text-foreground/90">{priceInfo.open.toFixed(decimals)}</span></span>
          <span className="text-[10px]"><span className="text-[hsl(var(--data-pos)/0.8)] font-medium">H</span> <span className="text-[hsl(var(--data-pos)/0.9)]">{priceInfo.high.toFixed(decimals)}</span></span>
          <span className="text-[10px]"><span className="text-[hsl(var(--data-neg)/0.8)] font-medium">L</span> <span className="text-[hsl(var(--data-neg)/0.9)]">{priceInfo.low.toFixed(decimals)}</span></span>
          <span className="text-[10px]"><span className="text-blue-400/80 font-medium">C</span> <span className="text-foreground/90">{priceInfo.close.toFixed(decimals)}</span></span>
        </>
      )}
    </div>
  );
}
