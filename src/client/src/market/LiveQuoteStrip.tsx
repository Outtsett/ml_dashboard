/**
 * LiveQuoteStrip — the quote box for the forming bar.
 *
 * Two rules govern what may appear here.
 *
 * **Absolute price is allowed, narrowly.** The quote box is one of the named
 * exceptions to the price-normalization rule, because the number IS the
 * deliverable and is labelled as a price. Everything derived — the change
 * shown beside it — is a log return, not a raw difference, so it stays
 * comparable across instruments and across time.
 *
 * **The origin badge is not optional.** The stream is live when Quantower is
 * running and QuantowerBridge is writing, and a replay of stored bars when it
 * is not. Those look identical once rendered, so the badge is the only thing
 * separating "the market is quiet" from "nothing is feeding this". A quote
 * strip that reads live while replaying history is worse than no quote strip.
 */

import { Radio, History } from "lucide-react";
import { useLiveBars } from "./lib/useLiveBars";
import { DeltaValue } from "@/ml/telemetry/DeltaValue";

/**
 * Log return from open to current close, in percent.
 *
 * Log rather than simple percent change so the figure is additive across bars
 * and symmetric between up and down moves — a +1% then −1% round trip reads as
 * ~0 rather than −0.01%.
 */
function logReturnPct(open: number, close: number): number {
  if (!(open > 0) || !(close > 0)) return 0;
  return Math.log(close / open) * 100;
}

export function LiveQuoteStrip({ className = "" }: { className?: string }) {
  const { current, origin, connected } = useLiveBars();

  // Nothing to show before the first frame. An empty quote box implies a
  // market with no price, which is a claim rather than an absence.
  if (!current) return null;

  const change = logReturnPct(current.open, current.close);
  const isReplay = origin === "replay";

  return (
    <div
      className={`flex items-center gap-4 px-3 py-2 rounded-lg surface-sunken shrink-0 ${className}`}
      role="status"
      aria-live="off"
      aria-label={`${current.symbol} quote`}
    >
      <span className="flex flex-col leading-tight shrink-0">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {current.symbol} · {current.timeframe}
        </span>
        {/* Absolute price, labelled as such — a permitted exception. */}
        <span className="metric-value tnum text-base text-foreground">
          {current.close.toFixed(2)}
        </span>
      </span>

      <DeltaValue
        label="bar log return"
        value={change}
        epsilon={0.0005}
        format={(v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}%`}
        className="shrink-0"
      />

      <span className="flex flex-col leading-tight shrink-0 text-[10px] font-mono tnum text-muted-foreground">
        <span>H {current.high.toFixed(2)}</span>
        <span>L {current.low.toFixed(2)}</span>
      </span>

      {/* Bar completion — makes the in-progress state legible rather than
          leaving the reader to guess whether the candle is settled. */}
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="relative h-1 w-12 rounded-full bg-white/[0.08] overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--data-neutral))] motion-quick"
            style={{ width: `${Math.round(current.progress * 100)}%` }}
          />
        </span>
        <span className="text-[9px] font-mono tnum text-muted-foreground/70">
          {current.isClosed ? "closed" : "forming"}
        </span>
      </span>

      <span
        className={`flex items-center gap-1 shrink-0 ml-auto px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest ${
          isReplay
            ? "text-[hsl(var(--data-warn))] border border-[hsl(var(--data-warn)/0.35)] bg-[hsl(var(--data-warn)/0.1)]"
            : "text-[hsl(var(--data-pos))] border border-[hsl(var(--data-pos)/0.35)] bg-[hsl(var(--data-pos)/0.1)]"
        }`}
        title={
          isReplay
            ? "Replay of stored history — not live market data."
            : "Live bars from QuantowerBridge, written while Quantower is running."
        }
      >
        {isReplay ? (
          <History className="h-2.5 w-2.5" aria-hidden="true" />
        ) : (
          <Radio className={`h-2.5 w-2.5 ${connected ? "animate-pulse" : ""}`} aria-hidden="true" />
        )}
        {isReplay ? "Replay" : "Live"}
      </span>
    </div>
  );
}
