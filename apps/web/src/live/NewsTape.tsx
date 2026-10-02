/**
 * Headlines as FinBERT scored them. The bar is p(positive) − p(negative):
 * orange right for positive text, blue left for negative (Okabe–Ito; never red
 * and green), with the sign also written out. The arrows beside each routed
 * instrument are the route's direction — for a forex pair, whether the story's
 * subject is its base (▲ = the score counts as is) or its quote currency
 * (▼ = the score counts reversed).
 */

import type { LiveArticle } from "./types";

function ago(ms: number): string {
  const seconds = (Date.now() - ms) / 1000;
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

function ScoreBar({ score }: { score: number }) {
  const width = Math.min(50, Math.abs(score) * 50);
  const positive = score >= 0;
  return (
    <div className="relative h-2 w-24 shrink-0 rounded-full bg-neutral-800" aria-label={`FinBERT score ${score.toFixed(2)}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-600" />
      <div
        className="absolute inset-y-0 rounded-full"
        style={{
          left: positive ? "50%" : `${50 - width}%`,
          width: `${width}%`,
          background: positive ? "#E69F00" : "#0072B2",
        }}
      />
    </div>
  );
}

export function NewsTape({ news, highlight }: { news: LiveArticle[]; highlight?: string | null }) {
  if (news.length === 0) return <div className="text-xs text-neutral-500 px-1 py-4">No scored headlines yet for this filter.</div>;
  return (
    <ul className="divide-y divide-neutral-800/70">
      {news.map((article) => (
        <li key={article.articleId} className="py-1.5 px-1">
          <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-right text-[10px] font-mono tnum text-neutral-500 pt-0.5" title={new Date(article.seenTs).toISOString()}>
              {ago(article.seenTs)}
            </span>
            <div className="min-w-0 flex-1">
              <a href={article.url} target="_blank" rel="noreferrer" className="text-xs text-neutral-100 hover:underline leading-snug">
                {article.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500">
                <span>{article.domain}</span>
                <span>via {article.vendor === "rss" ? article.source : article.vendor}</span>
                {article.routes.slice(0, 8).map((route) => (
                  <span
                    key={route.root}
                    className={`rounded px-1 border ${route.root === highlight ? "border-neutral-400 text-neutral-200" : "border-neutral-700"}`}
                    title={`${route.tier} rule, relevance ${route.relevance}, direction ${route.direction > 0 ? "+1" : "−1"}`}
                  >
                    {route.direction > 0 ? "▲" : "▼"} {route.root}
                  </span>
                ))}
                {article.routes.length > 8 && <span>+{article.routes.length - 8}</span>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <ScoreBar score={article.score} />
              <span className="text-[10px] font-mono tnum" style={{ color: article.score >= 0 ? "#E69F00" : "#0072B2" }}>
                {article.score >= 0 ? "+" : "−"}
                {Math.abs(article.score).toFixed(2)} {article.label}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
