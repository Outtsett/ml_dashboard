/**
 * Navigator — the list a table is picked from.
 *
 * The lake's objects arrive grouped by kind (candles, features, labels, news,
 * calendar, events) from the server's registry; SQLite's tables arrive with
 * their counted rows. Typing narrows either list by name.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { wholeNumber } from "@shared/stores/format";
import { Input } from "@/shared/ui/input";
import { useDeferredFilter } from "@/shared/hooks/useDeferredFilter";
import { cn } from "@/shared/utils/utils";
import type { LakeObject, LakeObjectsByKind } from "./hooks";

const KIND_SENTENCES: Record<string, string> = {
  candles: "Open, high, low, close and volume bars at one timeframe.",
  features: "Columns computed from the bars, one row per bar.",
  labels: "What each bar is labelled as for training.",
  news: "Headlines and their sentiment scores.",
  calendar: "Sessions, macro releases and symbol reference data.",
  events: "Discrete occurrences: patterns, sweeps, zones, study results.",
};

const ORIGIN_WORDS: Record<LakeObject["origin"], string> = {
  iceberg: "Iceberg table",
  snapshot: "serving snapshot",
  manifest: "derived dataset",
};

function rowClasses(active: boolean): string {
  return cn(
    "flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-[11px]",
    active ? "bg-[#0072B2]/25 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  );
}

export interface LakeNavigatorProps {
  inventory: LakeObjectsByKind | undefined;
  error: Error | null;
  selectedViewName: string | null;
  hrefFor: (viewName: string) => string;
}

export function LakeNavigator({ inventory, error, selectedViewName, hrefFor }: LakeNavigatorProps) {
  const { query, setQuery, deferredQuery } = useDeferredFilter();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const needle = deferredQuery.trim().toLowerCase();

  if (error) {
    return (
      <p className="p-3 text-xs text-[#D55E00]" data-testid="lake-navigator-error">
        ✕ The lake's object list could not be read: {error.message}
      </p>
    );
  }
  if (!inventory) return <p className="p-3 text-xs text-muted-foreground">Reading the lake's object registry…</p>;

  const groups = inventory.kinds.map((group) => ({
    ...group,
    visible: needle
      ? group.objects.filter(
          (object) => object.viewName.toLowerCase().includes(needle) || object.displayName.toLowerCase().includes(needle),
        )
      : group.objects,
  }));
  const visibleTotal = groups.reduce((sum, group) => sum + group.visible.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="lake-navigator">
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${wholeNumber(inventory.total)} lake objects`}
          className="h-7 pl-7 text-xs"
          data-testid="lake-navigator-search"
        />
      </div>
      <p className="shrink-0 px-3 pb-1 text-[10px] text-muted-foreground">
        {needle
          ? `${wholeNumber(visibleTotal)} of ${wholeNumber(inventory.total)} objects match “${deferredQuery.trim()}”.`
          : `${wholeNumber(inventory.total)} objects in ${inventory.kinds.length} kinds.`}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.map((group) => {
          // While searching, every group with a match is open.
          const isClosed = needle ? false : closed[group.kind] ?? group.kind !== "candles";
          if (needle && group.visible.length === 0) return null;
          return (
            <section key={group.kind} data-testid={`lake-kind-${group.kind}`}>
              <button
                type="button"
                onClick={() => setClosed((previous) => ({ ...previous, [group.kind]: !isClosed }))}
                className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground hover:bg-muted/30"
                aria-expanded={!isClosed}
                title={KIND_SENTENCES[group.kind]}
              >
                {isClosed ? <ChevronRight className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                <span>{group.kind}</span>
                <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
                  {needle ? `${wholeNumber(group.visible.length)} of ${wholeNumber(group.count)}` : wholeNumber(group.count)}
                </span>
              </button>
              {!isClosed &&
                group.visible.map((object) => (
                  <Link
                    key={object.viewName}
                    href={hrefFor(object.viewName)}
                    className={rowClasses(object.viewName === selectedViewName)}
                    aria-current={object.viewName === selectedViewName ? "true" : undefined}
                    title={`${object.displayName} · ${ORIGIN_WORDS[object.origin]} · object id ${object.objectId}`}
                  >
                    <span className="truncate font-mono">{object.viewName}</span>
                    <span className="shrink-0 text-[9px]">{ORIGIN_WORDS[object.origin]}</span>
                  </Link>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export interface SqliteNavigatorProps {
  tables: Array<{ name: string; rowCount: number }> | undefined;
  error: Error | null;
  selectedTable: string | null;
  hrefFor: (table: string) => string;
}

export function SqliteNavigator({ tables, error, selectedTable, hrefFor }: SqliteNavigatorProps) {
  const { query, setQuery, deferredQuery } = useDeferredFilter();
  const [hideEmpty, setHideEmpty] = useState(false);
  const needle = deferredQuery.trim().toLowerCase();

  if (error) {
    return (
      <p className="p-3 text-xs text-[#D55E00]" data-testid="sqlite-navigator-error">
        ✕ The SQLite table list could not be read: {error.message}
      </p>
    );
  }
  if (!tables) return <p className="p-3 text-xs text-muted-foreground">Counting the rows of every SQLite table…</p>;

  const emptyCount = tables.filter((table) => table.rowCount === 0).length;
  const visible = tables
    .filter((table) => (hideEmpty ? table.rowCount > 0 : true))
    .filter((table) => (needle ? table.name.toLowerCase().includes(needle) : true))
    .sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sqlite-navigator">
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${wholeNumber(tables.length)} tables`}
          className="h-7 pl-7 text-xs"
        />
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 px-3 pb-1 text-[10px] text-muted-foreground">
        <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
        Hide the {wholeNumber(emptyCount)} tables that hold no rows
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {visible.map((table) => (
          <Link
            key={table.name}
            href={hrefFor(table.name)}
            className={rowClasses(table.name === selectedTable)}
            aria-current={table.name === selectedTable ? "true" : undefined}
            title={`${table.name}: ${wholeNumber(table.rowCount)} rows, counted with SELECT count(*)`}
          >
            <span className="truncate font-mono">{table.name}</span>
            <span className="shrink-0 font-mono text-[10px]">
              {table.rowCount === 0 ? "empty" : `${wholeNumber(table.rowCount)} rows`}
            </span>
          </Link>
        ))}
        {visible.length === 0 && <p className="px-2 py-3 text-[11px] text-muted-foreground">No table matches.</p>}
      </div>
    </div>
  );
}
