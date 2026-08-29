/**
 * Glossary — the term and symbol bank.
 *
 * Think of it as: the index at the back of the textbook. Every acronym and piece
 * of notation the rest of the dashboard puts on an axis or in a table header,
 * defined in plain language with a line on why it is worth measuring.
 *
 * SRP: Presentation only. All content lives in `./glossary/terms.ts`; this file
 * filters and renders it. Deep-linkable via `#<id>` so a chart caption elsewhere
 * can point straight at a definition.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Search, BookMarked, X } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { TERMS, CATEGORY_LABEL, type Term, type TermCategory } from "./glossary/terms";

/** `**bold**` → <strong>. The only markup a definition is allowed to carry. */
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i} className="font-semibold text-neutral-100">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{chunk}</span>
    ),
  );
}

function matches(term: Term, q: string) {
  if (!q) return true;
  const hay = [term.term, term.definition, term.why ?? "", term.symbol ?? "", ...(term.aliases ?? [])]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export default function Glossary() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TermCategory | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Categories present in the data, ordered by how many terms each holds — the
  // filter row is derived, so adding a term never means editing this file.
  const categories = useMemo(() => {
    const counts = new Map<TermCategory, number>();
    for (const t of TERMS) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const visible = useMemo(
    () =>
      TERMS.filter((t) => matches(t, search))
        .filter((t) => !category || t.category === category)
        .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" })),
    [search, category],
  );

  // Deep link: /glossary#hurst scrolls to and flashes that entry.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(`term-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(id);
    const timer = window.setTimeout(() => setHighlighted(null), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  const clearable = search || category;

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-200">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-neutral-800 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="h-5 w-5 text-amber-500" aria-hidden />
              <h1 className="text-xl font-semibold tracking-tight text-neutral-50">Glossary</h1>
            </div>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Every acronym and piece of notation this desk uses, in plain language — and what each
              one buys you. Definitions are written for reading a result, not deriving it.
            </p>
          </div>
          <div className="flex items-center gap-2 tabular-nums text-xs text-neutral-500">
            <span className="font-mono">
              {visible.length} / {TERMS.length}
            </span>
            <span>terms</span>
          </div>
        </div>

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search terms, symbols, definitions…"
              aria-label="Search glossary"
              className="h-9 bg-neutral-900 pl-8 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {categories.map(([cat, count]) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(active ? null : cat)}
                  aria-pressed={active}
                  className={cn(
                    "rounded border px-2 py-1 font-mono text-[11px] tracking-wide transition-colors",
                    active
                      ? "border-sky-600 bg-sky-600/20 text-sky-300"
                      : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200",
                  )}
                >
                  {CATEGORY_LABEL[cat]} <span className="text-neutral-600">{count}</span>
                </button>
              );
            })}
          </div>

          {clearable ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs text-neutral-400"
              onClick={() => {
                setSearch("");
                setCategory(null);
              }}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          ) : null}
        </div>
      </header>

      {/* ── Entries ─────────────────────────────────────────────────────── */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-5">
        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-500">
            Nothing matches “{search}”. Try a shorter query, or clear the category filter.
          </p>
        ) : (
          <dl className="mx-auto grid max-w-5xl grid-cols-1 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-800">
            {visible.map((t) => (
              <div
                key={t.id}
                id={`term-${t.id}`}
                className={cn(
                  "grid grid-cols-1 gap-x-6 gap-y-2 bg-neutral-950 px-5 py-4 transition-colors sm:grid-cols-[minmax(150px,220px)_1fr]",
                  highlighted === t.id && "bg-amber-500/10",
                )}
              >
                <dt className="min-w-0">
                  <span className="font-mono text-[13px] font-semibold leading-snug text-neutral-100">
                    {t.term}
                  </span>
                  {t.symbol ? (
                    <span className="mt-1 block font-serif text-base italic text-amber-500">
                      {t.symbol}
                    </span>
                  ) : null}
                  <Badge
                    variant="outline"
                    className="mt-2 border-neutral-800 px-1.5 py-0 font-mono text-[9.5px] font-medium uppercase tracking-widest text-neutral-500"
                  >
                    {CATEGORY_LABEL[t.category]}
                  </Badge>
                </dt>
                <dd className="min-w-0 text-sm leading-relaxed text-neutral-300">
                  <p>{renderEmphasis(t.definition)}</p>
                  {t.why ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">{t.why}</p>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
