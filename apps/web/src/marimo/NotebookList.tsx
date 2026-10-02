/** The notebook library: search (titles or inside cells), filters, sort, the
 *  pinned section, and one row per notebook. Render only — the page owns the
 *  state and passes it down. */

import { Star, X } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { cn } from "@/shared/utils/utils";
import { sectionNotebooks, whenLabel, type HealthView, type SortOrder } from "./format";
import { DatasetChips, GitMarker, HealthBadge, HEALTH_FILTER_WORDS } from "./Markers";
import type { NotebookEntry, SearchResponse, SourceMatch } from "./types";

export type SearchMode = "titles" | "cells";

export interface NotebookListProps {
  total: number;
  categories: Array<{ name: string; count: number }>;
  pinned: NotebookEntry[];
  rest: NotebookEntry[];
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  text: string;
  onTextChange: (text: string) => void;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  selectedCategories: ReadonlySet<string>;
  onToggleCategory: (category: string) => void;
  onClearCategories: () => void;
  dataset: string | null;
  onDatasetChange: (dataset: string | null) => void;
  health: HealthView | null;
  onHealthChange: (health: HealthView | null) => void;
  uncommittedOnly: boolean;
  onUncommittedChange: (value: boolean) => void;
  activeId: string | null;
  onOpen: (notebook: NotebookEntry, lineNumber?: number) => void;
  onTogglePin: (notebook: NotebookEntry) => void;
  search: { data?: SearchResponse; isFetching: boolean; error: Error | null };
  notebooksById: Map<string, NotebookEntry>;
}

function Highlighted({ match }: { match: SourceMatch }) {
  return (
    <>
      {match.text.slice(0, match.matchStart)}
      <mark className="rounded-sm bg-[#F0E442]/60 px-0.5 text-foreground">{match.text.slice(match.matchStart, match.matchEnd)}</mark>
      {match.text.slice(match.matchEnd)}
    </>
  );
}

function NotebookRow({
  notebook,
  active,
  dataset,
  onOpen,
  onTogglePin,
  onDatasetChange,
}: {
  notebook: NotebookEntry;
  active: boolean;
  dataset: string | null;
  onOpen: (notebook: NotebookEntry) => void;
  onTogglePin: (notebook: NotebookEntry) => void;
  onDatasetChange: (dataset: string | null) => void;
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(notebook)}
        onKeyDown={(event) => {
          // Keys pressed on the pin star or a dataset chip belong to them.
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(notebook);
          }
        }}
        className={cn(
          "group w-full cursor-pointer rounded-md border px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          active ? "border-primary/60 bg-muted" : "border-transparent hover:border-border hover:bg-muted/50",
        )}
        title={notebook.relativePath}
        data-testid="notebook-row"
        data-notebook-id={notebook.id}
      >
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin(notebook);
            }}
            className={cn("shrink-0 rounded p-0.5 hover:bg-background", !notebook.pinned && "opacity-40 group-hover:opacity-100")}
            title={notebook.pinned ? "Unpin: stop keeping its environment warm" : "Pin: keep it at the top and its environment warm"}
            aria-label={notebook.pinned ? `Unpin ${notebook.title}` : `Pin ${notebook.title}`}
            aria-pressed={notebook.pinned}
            data-testid="pin-toggle"
          >
            <Star className="h-3 w-3" style={notebook.pinned ? { color: "#E69F00", fill: "#E69F00" } : undefined} />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{notebook.title}</span>
          <GitMarker state={notebook.gitState} />
          <HealthBadge health={notebook.health} modifiedAtIso={notebook.modifiedAtIso} />
        </span>
        {notebook.description && (
          <span className="ml-5 mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground" data-testid="notebook-description">
            {notebook.description}
          </span>
        )}
        <span className="ml-5 mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground tnum">
          <span className="min-w-0 truncate font-mono">{notebook.relativePath}</span>
        </span>
        <span className="ml-5 mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground tnum">
          <span title={`created ${whenLabel(notebook.createdAtIso)}\nlast edited ${whenLabel(notebook.modifiedAtIso)}`}>{whenLabel(notebook.modifiedAtIso)}</span>
          <span>·</span>
          <span>{notebook.cellCount} cells</span>
          <span>·</span>
          <span className="truncate">{notebook.category}</span>
        </span>
        {notebook.datasets.length > 0 && (
          <span className="ml-5 mt-1 block">
            <DatasetChips datasets={notebook.datasets} active={dataset} onSelect={(name) => onDatasetChange(dataset === name ? null : name)} limit={3} />
          </span>
        )}
      </div>
    </li>
  );
}

export function NotebookList(props: NotebookListProps) {
  const { pinned, rest, sort, mode, text, dataset } = props;
  const sections = sectionNotebooks(rest, sort);
  const shown = pinned.length + rest.length;
  const filtered = props.selectedCategories.size > 0 || dataset !== null || props.health !== null || props.uncommittedOnly || (mode === "titles" && text.trim() !== "");

  const row = (notebook: NotebookEntry) => (
    <NotebookRow
      key={notebook.path}
      notebook={notebook}
      active={props.activeId === notebook.id}
      dataset={dataset}
      onOpen={props.onOpen}
      onTogglePin={props.onTogglePin}
      onDatasetChange={props.onDatasetChange}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* ── Search ─────────────────────────────────────────── */}
      <div className="flex gap-1">
        <Input
          value={text}
          onChange={(event) => props.onTextChange(event.target.value)}
          placeholder={mode === "titles" ? `Search ${props.total} notebooks…` : "Search inside every cell…"}
          className="h-8 text-xs"
          data-testid="notebook-filter"
        />
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border text-[10px]" role="group" aria-label="Search in">
          {(["titles", "cells"] as SearchMode[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => props.onModeChange(option)}
              className={cn("px-2", mode === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              aria-pressed={mode === option}
              data-testid={`search-mode-${option}`}
            >
              {option === "titles" ? "Titles" : "Inside cells"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1" data-testid="category-chips">
        {props.categories.map(({ name, count }) => {
          const on = props.selectedCategories.has(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => props.onToggleCategory(name)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={on}
            >
              {on && <span aria-hidden="true">✓ </span>}
              {name} <span className="tnum opacity-70">{count}</span>
            </button>
          );
        })}
        {props.selectedCategories.size > 0 && (
          <button type="button" onClick={props.onClearCategories} className="px-1 text-[10px] text-muted-foreground underline">
            all
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Select value={sort} onValueChange={(value) => props.onSortChange(value as SortOrder)}>
          <SelectTrigger className="h-7 w-[7.5rem] text-[11px]" data-testid="sort-select" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="edited">Last edited</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="category">Category</SelectItem>
          </SelectContent>
        </Select>
        <Select value={props.health ?? "any"} onValueChange={(value) => props.onHealthChange(value === "any" ? null : (value as HealthView))}>
          <SelectTrigger className="h-7 w-[8.5rem] text-[11px]" data-testid="health-filter" aria-label="Health">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any health</SelectItem>
            {HEALTH_FILTER_WORDS.map(({ view, word }) => (
              <SelectItem key={view} value={view}>{word}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => props.onUncommittedChange(!props.uncommittedOnly)}
          className={cn("h-7 rounded-md border px-2 text-[10px]", props.uncommittedOnly ? "border-primary bg-primary/15" : "border-border text-muted-foreground")}
          aria-pressed={props.uncommittedOnly}
          title="Only notebooks with changes git has not recorded"
          data-testid="uncommitted-toggle"
        >
          ● uncommitted
        </button>
      </div>

      {dataset && (
        <div className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[10px]" data-testid="dataset-filter">
          <span className="text-muted-foreground">Reads</span>
          <span className="truncate font-mono text-foreground">{dataset}</span>
          <button type="button" onClick={() => props.onDatasetChange(null)} className="ml-auto rounded p-0.5 hover:bg-muted" aria-label="Clear the dataset filter">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {mode === "cells" ? (
          <SearchResults {...props} />
        ) : (
          <>
            {filtered && <p className="px-2 pb-1 text-[10px] text-muted-foreground tnum">{shown} of {props.total} notebooks</p>}
            {pinned.length > 0 && (
              <section className="mb-3" data-testid="pinned-section">
                <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span aria-hidden="true" style={{ color: "#E69F00" }}>★ </span>Pinned <span className="tnum">({pinned.length})</span>
                </h3>
                <ul>{pinned.map(row)}</ul>
              </section>
            )}
            {sections.map((section) => (
              <section key={section.key} className="mb-3">
                <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label} <span className="tnum">({section.entries.length})</span>
                </h3>
                <ul>{section.entries.map(row)}</ul>
              </section>
            ))}
            {shown === 0 && <p className="px-2 text-xs text-muted-foreground">No notebook matches these filters.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function SearchResults(props: NotebookListProps) {
  const { search, text } = props;
  if (text.trim().length < 2) return <p className="px-2 text-xs text-muted-foreground">Type two or more characters to search the code and markdown of every cell.</p>;
  if (search.error) return <p className="px-2 text-xs text-destructive">Search failed: {search.error.message}</p>;
  if (!search.data) return <p className="px-2 text-xs text-muted-foreground">Searching…</p>;
  const { results, notebookCount } = search.data;
  if (results.length === 0) return <p className="px-2 text-xs text-muted-foreground">“{text.trim()}” is not in any notebook.</p>;
  return (
    <div data-testid="cell-search-results">
      <p className="px-2 pb-1 text-[10px] text-muted-foreground tnum">
        {notebookCount} notebook{notebookCount === 1 ? "" : "s"} contain “{search.data.query}”{search.isFetching ? " · updating…" : ""}
      </p>
      <ul className="space-y-2">
        {results.map((result) => {
          const notebook = props.notebooksById.get(result.id);
          return (
            <li key={result.id} className="rounded-md border border-border p-1.5">
              <button type="button" className="w-full text-left" onClick={() => notebook && props.onOpen(notebook)} disabled={!notebook}>
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{result.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tnum">{result.total} line{result.total === 1 ? "" : "s"}</span>
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{result.relativePath}</span>
              </button>
              <ul className="mt-1 space-y-0.5">
                {result.matches.map((match) => (
                  <li key={match.lineNumber}>
                    <button
                      type="button"
                      className="flex w-full gap-1.5 rounded px-1 text-left font-mono text-[10px] hover:bg-muted"
                      onClick={() => notebook && props.onOpen(notebook, match.lineNumber)}
                      title={`Line ${match.lineNumber}`}
                    >
                      <span className="w-8 shrink-0 text-right text-muted-foreground tnum">{match.lineNumber}</span>
                      <span className="min-w-0 truncate text-foreground/90"><Highlighted match={match} /></span>
                    </button>
                  </li>
                ))}
                {result.total > result.matches.length && (
                  <li className="pl-10 text-[10px] text-muted-foreground">+{result.total - result.matches.length} more lines</li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
