/**
 * The price tape across the top bar: every instrument the live data hub
 * carries (OANDA forex in real time, Yahoo futures about ten minutes behind),
 * laid out as one still row (it does not scroll by itself; drag or wheel to
 * see the rest).
 *
 * Each item carries the direction of its last price change as a glyph as well
 * as a colour, and a delayed quote says how far behind it is: a delayed price
 * that reads as live is worse than no price.
 */

import { useEffect, useState } from "react";
import { useLiveQuotes } from "@/live/hooks";
import type { LiveQuote } from "@/live/types";
import { quoteDigits } from "@/live/QuoteStrip";
import { trendGlyph, trendToneClass, type TrendTone } from "@/shared/theme/dataColors";

/** A quote more than this far behind the exchange shows its delay. */
const DELAYED_AFTER_SECONDS = 60;
const ASSET_ORDER: Record<LiveQuote["assetClass"], number> = { futures: 0, index: 1, forex: 2 };

function priceOf(quote: LiveQuote): number | null {
  return quote.mid ?? quote.last ?? null;
}

function sortQuotes(quotes: LiveQuote[]): LiveQuote[] {
  return [...quotes].sort(
    (a, b) => ASSET_ORDER[a.assetClass] - ASSET_ORDER[b.assetClass] || a.symbol.localeCompare(b.symbol),
  );
}

/**
 * The direction of each symbol's most recent price change. A symbol keeps its
 * last direction until the price moves again, so the tape does not flicker
 * back to flat between updates.
 */
function useTickDirections(quotes: LiveQuote[]): Record<string, TrendTone> {
  const [state, setState] = useState<{ prices: Record<string, number>; tones: Record<string, TrendTone> }>({
    prices: {},
    tones: {},
  });

  useEffect(() => {
    setState((previous) => {
      let changed = false;
      const prices = { ...previous.prices };
      const tones = { ...previous.tones };
      for (const quote of quotes) {
        const price = priceOf(quote);
        if (price === null) continue;
        const before = prices[quote.symbol];
        if (before !== undefined && price !== before) {
          tones[quote.symbol] = price > before ? "up" : "down";
          changed = true;
        }
        if (before !== price) {
          prices[quote.symbol] = price;
          changed = true;
        }
      }
      return changed ? { prices, tones } : previous;
    });
  }, [quotes]);

  return state.tones;
}

function TickerItem({ quote, tone }: { quote: LiveQuote; tone: TrendTone }) {
  const price = priceOf(quote);
  const delayed = quote.delaySeconds > DELAYED_AFTER_SECONDS;
  return (
    <span className="inline-flex items-baseline gap-1.5 px-4 border-r border-neutral-800 last:border-r-0">
      <span className="font-mono font-semibold text-neutral-200">{quote.symbol}</span>
      <span className="font-mono text-neutral-100">{price === null ? "—" : price.toFixed(quoteDigits(quote))}</span>
      <span className={trendToneClass(tone)} aria-label={tone === "flat" ? "unchanged" : tone}>
        {trendGlyph(tone)}
      </span>
      {delayed && (
        <span className="text-[10px] text-neutral-500" title={`${quote.source}: ${Math.round(quote.delaySeconds)} s behind the exchange`}>
          {Math.round(quote.delaySeconds / 60)}m delay
        </span>
      )}
    </span>
  );
}

export function MarketTicker() {
  const { quotes, connected, isLoading } = useLiveQuotes();
  const sorted = sortQuotes(quotes);
  const tones = useTickDirections(quotes);

  if (sorted.length === 0) {
    return (
      <span className="px-4 text-xs text-neutral-500">
        {isLoading ? "Connecting to the live data hub…" : "Live data hub: no quotes"}
      </span>
    );
  }

  const items = sorted.map((quote) => (
    <TickerItem key={quote.symbol} quote={quote} tone={tones[quote.symbol] ?? "flat"} />
  ));

  return (
    <div
      className="market-ticker relative h-full w-full overflow-x-auto overflow-y-hidden flex items-center text-xs [scrollbar-width:none]"
      title={connected ? "Live prices from the live data hub" : "Live data hub stream reconnecting; prices may be stale"}
    >
      <div className="flex w-max whitespace-nowrap">{items}</div>
      {!connected && (
        <span className="absolute right-0 top-1/2 -translate-y-1/2 bg-neutral-950 pl-2 text-[10px] text-neutral-500">
          reconnecting
        </span>
      )}
    </div>
  );
}
