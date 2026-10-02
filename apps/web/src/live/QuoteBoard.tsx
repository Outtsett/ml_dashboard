/**
 * Every symbol the hub streams. Clicking a row points the Market chart behind
 * the panel at it.
 */

import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { formatDelay } from "./QuoteStrip";
import type { LiveQuote } from "./types";

const CLASS_ORDER: Record<string, number> = { futures: 0, index: 1, forex: 2 };
const CLASS_LABEL: Record<string, string> = { futures: "Futures", index: "Index", forex: "Forex" };

function places(quote: LiveQuote): number {
  const price = quote.mid ?? quote.last ?? 0;
  if (quote.assetClass === "forex") return price > 20 ? 3 : 5;
  return price > 1000 ? 2 : price > 10 ? 3 : 4;
}

export function QuoteBoard({ quotes }: { quotes: LiveQuote[] }) {
  const { symbol: selected, setSymbol } = useSymbolContext();
  const sorted = [...quotes].sort(
    (a, b) => (CLASS_ORDER[a.assetClass] ?? 9) - (CLASS_ORDER[b.assetClass] ?? 9) || a.symbol.localeCompare(b.symbol),
  );
  return (
    <div className="rounded-md border border-neutral-800 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-neutral-900 text-neutral-400">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">Symbol</th>
            <th className="text-right px-2 py-1.5 font-medium">Price</th>
            <th className="text-right px-2 py-1.5 font-medium">Spread</th>
            <th className="text-left px-2 py-1.5 font-medium">Source</th>
            <th className="text-right px-2 py-1.5 font-medium">Quote time (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((quote) => {
            const digits = places(quote);
            const price = quote.mid ?? quote.last;
            const delayed = quote.delaySeconds > 30;
            return (
              <tr
                key={quote.symbol}
                onClick={() => setSymbol(quote.symbol)}
                className={`cursor-pointer border-t border-neutral-800/70 hover:bg-neutral-800/50 ${quote.symbol === selected ? "bg-neutral-800/70" : ""}`}
                title={`Show ${quote.symbol} on the chart`}
              >
                <td className="px-2 py-1">
                  <span className="font-medium text-neutral-100">{quote.symbol}</span>
                  <span className="ml-1.5 text-[10px] text-neutral-500">{CLASS_LABEL[quote.assetClass] ?? quote.assetClass}</span>
                </td>
                <td className="px-2 py-1 text-right font-mono tnum text-neutral-100">{price !== null ? price.toFixed(digits) : "—"}</td>
                <td className="px-2 py-1 text-right font-mono tnum text-neutral-400">{quote.spread !== null ? quote.spread.toFixed(digits) : "—"}</td>
                <td className="px-2 py-1">
                  <span className={delayed ? "text-[#E69F00]" : "text-[#56B4E9]"}>
                    {quote.source}
                    {delayed ? ` · ${formatDelay(quote.delaySeconds)}` : " · live"}
                  </span>
                </td>
                <td className="px-2 py-1 text-right font-mono tnum text-neutral-400">{new Date(quote.time).toISOString().slice(5, 19).replace("T", " ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
