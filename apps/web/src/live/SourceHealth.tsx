/**
 * Every source the hub runs, and whether it is actually delivering — a quiet
 * source and a dead one look identical on a chart, so each card says which.
 */

import type { LiveSourceHealth, LiveStatus } from "./types";
import { formatDelay } from "./QuoteStrip";

function age(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 90) return `${Math.round(seconds)} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${(seconds / 3600).toFixed(1)} h ago`;
}

function state(source: LiveSourceHealth): { label: string; tone: string; glyph: string } {
  if (!source.connected && (source.note || (source.lastMessageAgeSeconds === null && source.errors === 0)))
    return { label: "waiting", tone: "text-neutral-400 border-neutral-600", glyph: "○" };
  if (!source.connected) return { label: "down", tone: "text-[#D55E00] border-[#D55E00]/50", glyph: "✕" };
  if (!source.realtime || (source.delaySeconds ?? 0) > 30) return { label: "delayed", tone: "text-[#E69F00] border-[#E69F00]/50", glyph: "◐" };
  return { label: "live", tone: "text-[#56B4E9] border-[#56B4E9]/50", glyph: "●" };
}

export function SourceHealth({ status }: { status: LiveStatus | undefined }) {
  if (!status) return null;
  const budget = status.sources.find((s) => s.name === "alphavantage");
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
        {status.sources.map((source) => {
          const s = state(source);
          return (
            <div key={source.name} className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs" title={source.lastError ?? source.note ?? undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-200 truncate">{source.label}</span>
                <span className={`shrink-0 rounded-full border px-1.5 text-[10px] uppercase tracking-wider ${s.tone}`}>
                  {s.glyph} {s.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-400 font-mono tnum">
                <span>{source.messages.toLocaleString()} {source.kind === "news" ? "new items" : "messages"}</span>
                <span>last {age(source.lastMessageAgeSeconds)}</span>
                {source.delaySeconds !== null && source.delaySeconds > 30 && <span>{formatDelay(source.delaySeconds)}</span>}
                {source.errors > 0 && <span className="text-[#D55E00]">{source.errors} errors</span>}
              </div>
              {source.note && <div className="mt-1 text-[11px] text-neutral-500 leading-snug">{source.note}</div>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-400 font-mono tnum">
        {status.scoring && (
          <span>
            FinBERT {status.scoring.model} on {status.scoring.device ?? "…"} · {status.scoring.scored.toLocaleString()} scored
            {status.scoring.lastBatchSeconds !== null ? ` · ${status.scoring.lastBatchSeconds}s/batch` : ""}
          </span>
        )}
        {budget && typeof budget.usedToday === "number" && (
          <span>
            Alpha Vantage {String(budget.usedToday)}/{String(budget.budget)} calls today
            {typeof budget.nextCallAt === "number" && ` · next call ${new Date(budget.nextCallAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </span>
        )}
        {status.landing && (
          <span title={status.landing.lastError ?? undefined}>
            lake: {status.landing.rawLanded} raw objects ({(status.landing.rawBytes / 1e6).toFixed(1)} MB) · today{" "}
            {Object.entries(status.landing.todayRows)
              .map(([k, v]) => `${k.replace("news_", "")} ${v.toLocaleString()}`)
              .join(" · ")}
          </span>
        )}
      </div>
    </section>
  );
}
