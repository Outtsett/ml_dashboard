/**
 * /live — the live data hub on one page: which sources are delivering, every
 * streamed quote (click one to put it on the chart behind this panel), the
 * FinBERT-scored news tape, and the FinBERT features for the selected
 * instrument as a model reading it now would see them.
 */

import { useState } from "react";
import { Radio } from "lucide-react";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { useLiveNews, useLiveQuotes, useLiveSentiment, useLiveStatus } from "./hooks";
import { NewsTape } from "./NewsTape";
import { QuoteBoard } from "./QuoteBoard";
import { SentimentChart } from "./SentimentChart";
import { SourceHealth } from "./SourceHealth";

export default function LivePage() {
  const { symbol } = useSymbolContext();
  const [newsFilter, setNewsFilter] = useState<"symbol" | "all">("symbol");
  const status = useLiveStatus();
  const quotes = useLiveQuotes();
  const news = useLiveNews(newsFilter === "symbol" ? symbol : null, 300);
  const sentiment = useLiveSentiment(symbol, 24, 5);

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-4 text-neutral-200">
      <header className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-[#56B4E9]" />
        <h1 className="text-sm font-semibold tracking-wide">Live data</h1>
        <span className="text-xs text-neutral-500">
          {status.data ? `${status.data.quotes} symbols · ${status.data.news.toLocaleString()} scored headlines in memory` : status.error ? `hub unreachable: ${(status.error as Error).message}` : "connecting…"}
        </span>
      </header>

      <SourceHealth status={status.data} />

      <section className="space-y-1.5">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">Quotes</h2>
        <QuoteBoard quotes={quotes.quotes} />
      </section>

      <section className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">FinBERT features · {symbol} · last 24 h</h2>
          {sentiment.data && (
            <span className="text-[10px] text-neutral-500">{sentiment.data.roots[symbol]?.articles ?? 0} routed headlines in the hub's memory</span>
          )}
        </div>
        <SentimentChart grid={sentiment.data} root={symbol} />
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">News</h2>
          <div className="ml-auto flex rounded border border-neutral-700 text-[11px] overflow-hidden">
            {(["symbol", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setNewsFilter(option)}
                className={`px-2 py-0.5 ${newsFilter === option ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                {option === "symbol" ? `Routed to ${symbol}` : "All headlines"}
              </button>
            ))}
          </div>
        </div>
        <NewsTape news={news.news} highlight={symbol} />
      </section>
    </div>
  );
}
