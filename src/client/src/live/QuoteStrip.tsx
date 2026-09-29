/**
 * The quote above the Market chart when the live hub carries the symbol.
 *
 * The badge is the point: OANDA forex is real time, Yahoo futures are about ten
 * minutes behind the exchange (the measured delay is printed), Quantower prints
 * are real time while it records. A delayed price that reads as live is worse
 * than no price.
 */

import { Radio, Timer } from "lucide-react";
import type { LiveQuote } from "./types";

const SOURCE_LABEL: Record<string, string> = {
  oanda: "OANDA",
  yahoo: "Yahoo",
  quantower: "Quantower",
};

function digits(quote: LiveQuote): number {
  const price = quote.mid ?? quote.last ?? 0;
  if (quote.assetClass === "forex") return price > 20 ? 3 : 5;
  return price > 1000 ? 2 : price > 10 ? 3 : 4;
}

export function formatDelay(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s behind`;
  return `${Math.round(seconds / 60)} min behind`;
}

export function HubQuoteStrip({
  quote,
  className = "",
  tail,
}: {
  quote: LiveQuote;
  className?: string;
  tail?: { shown: number; waiting: number; onShow: () => void; gap?: { lastChartBar: number; firstLiveBar: number } | null };
}) {
  const places = digits(quote);
  const price = quote.mid ?? quote.last;
  const delayed = quote.delaySeconds > 30;
  const source = SOURCE_LABEL[quote.source] ?? quote.source;
  return (
    <div className={`flex items-center gap-4 px-3 py-2 rounded-lg surface-sunken shrink-0 ${className}`} role="status" aria-live="off" aria-label={`${quote.symbol} live quote`}>
      <span className="flex flex-col leading-tight shrink-0">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {quote.symbol} · {quote.bid !== null ? "mid" : "last"}
        </span>
        {/* Absolute price, labelled as such — the quote box is a permitted exception. */}
        <span className="metric-value tnum text-base text-foreground">{price !== null ? price.toFixed(places) : "—"}</span>
      </span>
      {quote.bid !== null && quote.ask !== null && (
        <span className="flex flex-col leading-tight shrink-0 text-[10px] font-mono tnum text-muted-foreground">
          <span>bid {quote.bid.toFixed(places)}</span>
          <span>ask {quote.ask.toFixed(places)}</span>
        </span>
      )}
      <span className="text-[10px] font-mono tnum text-muted-foreground/80 shrink-0">
        {new Date(quote.time).toISOString().slice(11, 19)} UTC
      </span>
      {tail && tail.shown > 0 && (
        <span className="text-[10px] text-neutral-400 shrink-0" title="Live bars appended after the lake's newest bar">
          +{tail.shown} live bars on the chart
        </span>
      )}
      {tail?.gap && (
        <span
          className="text-[10px] text-[#E69F00] shrink-0"
          title="The lake's history stops before the live hub's first bar. The tail is not joined across the hole, so no months-old bar sits next to today's."
        >
          Live bars start {new Date(tail.gap.firstLiveBar).toISOString().slice(0, 10)} · history ends {new Date(tail.gap.lastChartBar).toISOString().slice(0, 10)} · not joined
        </span>
      )}
      {tail && !tail.gap && tail.shown === 0 && tail.waiting > 0 && (
        <button
          type="button"
          onClick={tail.onShow}
          className="text-[10px] shrink-0 rounded border border-neutral-600 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-400"
          title="The chart shows an older window; load its newest bars so the live tail can continue them"
        >
          Show live tail ({tail.waiting.toLocaleString()} min)
        </button>
      )}
      <span
        className={`flex items-center gap-1 shrink-0 ml-auto px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest border ${
          delayed ? "text-[#E69F00] border-[#E69F00]/40 bg-[#E69F00]/10" : "text-[#56B4E9] border-[#56B4E9]/40 bg-[#56B4E9]/10"
        }`}
        title={
          delayed
            ? `${source}: the front contract, ${formatDelay(quote.delaySeconds)} the exchange (measured on every poll).`
            : `${source}: real-time.`
        }
      >
        {delayed ? <Timer className="h-2.5 w-2.5" aria-hidden="true" /> : <Radio className="h-2.5 w-2.5 animate-pulse" aria-hidden="true" />}
        {source} · {delayed ? formatDelay(quote.delaySeconds) : "live"}
      </span>
    </div>
  );
}
