/**
 * Glossary — the term and symbol bank.
 *
 * Think of it as: the index at the back of the textbook. Every acronym and piece
 * of notation the rest of the dashboard puts on an axis or in a table header,
 * defined in plain language with a line on why it is worth measuring.
 *
 * SRP: Presentation only. Content lives in `./glossary/` — authored files under
 * `terms/`, registry adapters in `derived.ts`, the model catalog fetched at
 * runtime by `useGlossaryTerms`.
 *
 * Virtualised because the list is ~1,000 entries of varying height: rendering
 * them all costs a visible freeze on filter changes, and a fixed row height
 * would clip the long definitions. Deep-linkable via `#<id>`, so a chart caption
 * anywhere can point straight at a definition.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Search, BookMarked, X, CornerDownRight } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { DOMAIN_LABEL, DOMAIN_ORDER, type Domain, type Term } from "./glossary";
import { useGlossaryTerms } from "./glossary/useGlossaryTerms";

type Provenance = "all" | "authored" | "derived";

/** `**bold**` → <strong>. The only markup a definition may carry. */
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

function TermRow({
  term,
  highlighted,
  onNavigate,
  termNames,
}: {
  term: Term;
  highlighted: boolean;
  onNavigate: (id: string) => void;
  termNames: Map<string, string>;
}) {
  return (
    <div
      id={`term-${term.id}`}
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-2 border-b border-neutral-800 px-5 py-4 sm:grid-cols-[minmax(160px,240px)_1fr]",
        highlighted && "bg-amber-500/10",
      )}
    >
      <dt className="min-w-0">
        <span className="font-mono text-[13px] font-semibold leading-snug text-neutral-100">
          {term.term}
        </span>
        {term.expansion && (
          <span className="mt-0.5 block text-[12px] leading-snug text-neutral-400">
            {term.expansion}
          </span>
        )}
        {term.symbol && (
          <span className="mt-1 block font-serif text-base italic text-amber-500">
            {term.symbol}
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="border-neutral-800 px-1.5 py-0 font-mono text-[9.5px] font-medium uppercase tracking-widest text-neutral-500"
          >
            {DOMAIN_LABEL[term.domain]}
          </Badge>
          {term.provenance === "derived" && (
            <span
              className="font-mono text-[9px] uppercase tracking-wider text-neutral-600"
              title="Generated from a registry this app already maintains — improves by improving its source"
            >
              derived
            </span>
          )}
        </span>
      </dt>
      <dd className="min-w-0 text-sm leading-relaxed text-neutral-300">
        <p>{renderEmphasis(term.definition)}</p>
        {term.why && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">
            {renderEmphasis(term.why)}
          </p>
        )}
        {term.see && term.see.length > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <CornerDownRight className="h-3 w-3 text-neutral-600" aria-hidden />
            {term.see.map((ref) => (
              <button
                key={ref}
                type="button"
                onClick={() => onNavigate(ref)}
                className="rounded border border-neutral-800 px-1.5 py-0.5 font-mono text-[10.5px] text-neutral-400 transition-colors hover:border-sky-700 hover:text-sky-300"
              >
                {termNames.get(ref) ?? ref}
              </button>
            ))}
          </p>
        )}
      </dd>
    </div>
  );
}

export default function Glossary() {
  const { terms, fuse, authored, derived, isLoading } = useGlossaryTerms();
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<Domain | null>(null);
  const [provenance, setProvenance] = useState<Provenance>("all");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const termNames = useMemo(
    () => new Map(terms.map((t) => [t.id, t.term])),
    [terms],
  );

  // Domains present in the data, in the taxonomy's own order.
  const domains = useMemo(() => {
    const counts = new Map<Domain, number>();
    for (const t of terms) counts.set(t.domain, (counts.get(t.domain) ?? 0) + 1);
    return DOMAIN_ORDER.filter((d) => counts.has(d)).map((d) => [d, counts.get(d)!] as const);
  }, [terms]);

  const visible = useMemo(() => {
    const q = search.trim();
    // Fuse orders by relevance, which is what a searcher wants; the unsearched
    // list stays alphabetical, which is what a browser wants.
    const base = q.length >= 2 ? fuse.search(q).map((r) => r.item) : terms;
    return base.filter(
      (t) =>
        (!domain || t.domain === domain) &&
        (provenance === "all" ||
          (provenance === "derived") === (t.provenance === "derived")),
    );
  }, [search, fuse, terms, domain, provenance]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    // Rows vary a lot — a one-line derived entry against a definition with a
    // `why` line and six cross-reference chips. This is the starting guess;
    // `measureElement` corrects it from the DOM (measured range is ~75-150px).
    estimateSize: () => 120,
    overscan: 8,
    // React keys rows by term id so a filter change reuses the right DOM node.
    // The virtualizer must be told that, or its measurement cache stays keyed
    // by index while React's nodes move: heights get measured correctly and
    // applied to the wrong rows, and the list renders on top of itself.
    getItemKey: (index) => visible[index]?.id ?? index,
  });

  const navigate = useCallback(
    (id: string) => {
      const index = visible.findIndex((t) => t.id === id);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "center" });
      } else {
        // The target is filtered out — clear the filters and let the hash effect
        // take it from there, rather than silently doing nothing.
        setSearch("");
        setDomain(null);
        setProvenance("all");
        window.requestAnimationFrame(() => {
          const el = document.getElementById(`term-${id}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
      setHighlighted(id);
      window.history.replaceState(null, "", `#${id}`);
    },
    [visible, virtualizer],
  );

  // Deep link on first paint: /glossary#hurst-exponent
  const didJump = useRef(false);
  useEffect(() => {
    if (didJump.current || isLoading || !terms.length) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    didJump.current = true;
    navigate(id);
  }, [isLoading, terms.length, navigate]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const filtered = Boolean(search || domain || provenance !== "all");

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-200">
      <header className="border-b border-neutral-800 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="h-5 w-5 text-amber-500" aria-hidden />
              <h1 className="text-xl font-semibold tracking-tight text-neutral-50">Glossary</h1>
            </div>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Every acronym and piece of notation this desk uses, in plain language — and what each
              one buys you. Written for reading a result, not deriving it.
            </p>
          </div>
          <div className="text-right font-mono text-xs text-neutral-500">
            <div className="tabular-nums text-neutral-300">
              {visible.length.toLocaleString()}
              <span className="text-neutral-600"> / {terms.length.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 text-[10.5px]">
              {authored.toLocaleString()} written · {derived.toLocaleString()} derived
            </div>
          </div>
        </div>

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

          <div className="flex gap-1">
            {(["all", "authored", "derived"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvenance(p)}
                aria-pressed={provenance === p}
                className={cn(
                  "rounded border px-2 py-1 font-mono text-[11px] capitalize transition-colors",
                  provenance === p
                    ? "border-amber-600 bg-amber-600/15 text-amber-400"
                    : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200",
                )}
              >
                {p}
              </button>
            ))}
          </div>

          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs text-neutral-400"
              onClick={() => {
                setSearch("");
                setDomain(null);
                setProvenance("all");
              }}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {domains.map(([d, count]) => (
            <button
              key={d}
              type="button"
              onClick={() => setDomain(domain === d ? null : d)}
              aria-pressed={domain === d}
              className={cn(
                "rounded border px-2 py-1 font-mono text-[11px] tracking-wide transition-colors",
                domain === d
                  ? "border-sky-600 bg-sky-600/20 text-sky-300"
                  : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200",
              )}
            >
              {DOMAIN_LABEL[d]} <span className="text-neutral-600">{count}</span>
            </button>
          ))}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-20 text-center text-sm text-neutral-500">
            {isLoading
              ? "Loading…"
              : `Nothing matches “${search}”. Try a shorter query, or clear the filters.`}
          </p>
        ) : (
          <dl
            className="relative mx-auto max-w-5xl"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const term = visible[row.index]!;
              return (
                <div
                  key={term.id}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <TermRow
                    term={term}
                    highlighted={highlighted === term.id}
                    onNavigate={navigate}
                    termNames={termNames}
                  />
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}
