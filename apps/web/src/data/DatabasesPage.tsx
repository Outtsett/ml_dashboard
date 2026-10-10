/**
 * The Data page (`/databases`): what the dashboard's stores hold, browsable.
 *
 * Five tabs, each a link, so the tab and what is selected inside it live in the
 * URL (`tabs.ts`): the lake's objects by kind with their rows and a panel per
 * column, SQLite's tables, the PostgreSQL console (pgAdmin), a read-only SQL
 * console, and the engine cards (DuckDB and the Iceberg catalog). Every count on
 * the page is read from the server when the page loads; none is typed in.
 */

import { useState } from "react";
import { Link, useSearch } from "wouter";
import { Database, Layers } from "lucide-react";
import { toast } from "sonner";
import { byteSize, wholeNumber } from "@shared/stores/format";
import { PageShell } from "@/backtest/components/PageShell";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { useEntityFeatures } from "@/shared/hooks/useEntityBrowser";
import { cn } from "@/shared/utils/utils";
import { QueryConsole } from "./QueryConsole";
import { VirtualDataTable } from "./VirtualDataTable";
import { ColumnProfiles } from "./stores/ColumnProfiles";
import { LakeNavigator, SqliteNavigator } from "./stores/Navigator";
import { PgAdminFrame } from "./stores/PgAdminFrame";
import { PostgresPanel } from "./stores/PostgresPanel";
import { StoreBrowser } from "./stores/StoreBrowser";
import { DuckDbPanel, IcebergPanel } from "./stores/StorePanels";
import {
  useCatalogCount,
  useLakeInventory,
  useLakeObjectsByKind,
  useObjectDetail,
  usePgAdminStatus,
  useResolvedLakeObject,
  useRunQuery,
  useStoresOverview,
  type LakeObjectsByKind,
} from "./stores/hooks";
import { serviceMark, serviceState } from "./stores/status";
import { DATA_TABS, DATA_TAB_LABELS, dataHref, parseDataSelection, type DataSelection, type DataTab } from "./tabs";

const ORIGIN_SENTENCES = {
  iceberg: "the Iceberg table market.bars, the system of record",
  snapshot: "the frozen serving snapshot the charts read",
  manifest: "a derived dataset landed with an ingest manifest",
} as const;

const KIND_SENTENCES: Record<string, string> = {
  candles: "Open, high, low, close and volume bars at one timeframe.",
  features: "Columns computed from the bars, one row per bar.",
  labels: "What each bar is labelled as for training.",
  news: "Headlines and their sentiment scores.",
  calendar: "Sessions, macro releases and symbol reference data.",
  events: "Discrete occurrences: patterns, sweeps, zones and study results.",
};

function LakeBody({ selection, inventory, inventoryError }: {
  selection: DataSelection;
  inventory: LakeObjectsByKind | undefined;
  inventoryError: Error | null;
}) {
  const { symbol: chartSymbol } = useSymbolContext();
  const [profileSymbol, setProfileSymbol] = useState(chartSymbol);
  const resolved = useResolvedLakeObject(selection.dataset);
  const object = resolved.data ?? null;
  const detail = useObjectDetail("lake", object?.viewName ?? null);
  const counts = useLakeInventory();
  const features = useEntityFeatures();
  const feature = selection.feature ? (features.data ?? []).find((entry) => entry.id === selection.feature) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r border-border">
        <LakeNavigator
          counts={counts.data}
          countsError={(counts.error as Error | null) ?? null}
          inventory={inventory}
          error={inventoryError}
          selectedViewName={object?.viewName ?? null}
          hrefFor={(viewName) => dataHref({ ...selection, tab: "lake", dataset: viewName, feature: null })}
        />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3" data-testid="lake-detail">
        {selection.feature && (
          <article className="shrink-0 rounded border border-border bg-card/40 p-3 text-xs" data-testid="feature-card">
            {feature ? (
              <>
                <h3 className="font-mono text-sm font-semibold text-foreground">{feature.id}</h3>
                <p className="mt-1 text-foreground">{feature.name}.</p>
                <p className="mt-1 text-muted-foreground">
                  {feature.description ? `${feature.description}. ` : ""}It belongs to the feature category “{feature.category}”
                  in the feature registry (packages/config/features.json) and is computed from the bars at training time;
                  it is not a stored lake object, so there are no rows to open here.
                </p>
              </>
            ) : features.isLoading ? (
              <p className="text-muted-foreground">Reading the feature registry…</p>
            ) : (
              <p className="text-[#D55E00]">✕ The feature registry has no feature with the id “{selection.feature}”.</p>
            )}
          </article>
        )}

        {selection.dataset && resolved.isError && (
          <p className="rounded border border-[#D55E00]/50 p-3 text-xs text-[#D55E00]" data-testid="lake-object-missing">
            ✕ The lake has no object named “{selection.dataset}”: {(resolved.error as Error).message}
          </p>
        )}

        {object && (
          <>
            <header className="shrink-0">
              <h3 className="font-mono text-sm font-semibold text-foreground">{object.viewName}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground" data-testid="lake-object-facts">
                {detail.isLoading && "Counting its rows in DuckDB…"}
                {detail.isError && `✕ Its rows could not be counted: ${(detail.error as Error).message}`}
                {detail.data && (
                  <span
                    title={
                      detail.data.rowCountSource === "iceberg_snapshot"
                        ? "The row total is the Iceberg catalog's total-records for the newest snapshot; the columns come from information_schema.columns in DuckDB."
                        : `The rows are SELECT count(*) FROM "${object.viewName}" in DuckDB, counted at most ten minutes ago; the columns come from information_schema.columns.`
                    }
                  >
                    {wholeNumber(detail.data.rowCount)} rows in {wholeNumber(detail.data.columns.length)} columns.{" "}
                  </span>
                )}
                It is a {object.kind} object from {ORIGIN_SENTENCES[object.origin]}. Its object id is{" "}
                <span className="font-mono">{object.objectId}</span>.
              </p>
              <nav className="mt-2 flex items-center gap-1" aria-label="How to look at this object">
                {(["rows", "columns"] as const).map((view) => (
                  <Link
                    key={view}
                    href={dataHref({ ...selection, dataset: object.viewName, view })}
                    data-testid={`lake-view-${view}`}
                    aria-current={selection.view === view ? "page" : undefined}
                    className={cn(
                      "rounded border px-2.5 py-1 text-[11px]",
                      selection.view === view
                        ? "border-[#0072B2] bg-[#0072B2]/25 font-semibold text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {view === "rows" ? "Rows" : "Columns (one panel per column)"}
                  </Link>
                ))}
              </nav>
            </header>
            <div className="min-h-0 flex-1">
              {selection.view === "rows" ? (
                <StoreBrowser store="lake" objectName={object.viewName} requireFilterToSort={object.origin === "iceberg"} />
              ) : (
                <ColumnProfiles objectName={object.viewName} symbol={profileSymbol} onSymbolChange={setProfileSymbol} />
              )}
            </div>
          </>
        )}

        {!selection.dataset && !selection.feature && inventory && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lake-kind-tiles">
            {inventory.kinds.map((group) => (
              <Link
                key={group.kind}
                href={dataHref({ ...selection, dataset: group.objects[0]?.viewName ?? null })}
                className="rounded border border-border bg-card/40 p-3 hover:border-[#56B4E9]"
              >
                <p className="text-2xl font-semibold text-foreground">{wholeNumber(group.count)}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{group.kind}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{KIND_SENTENCES[group.kind]}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Counted from the server's lake object registry. Opens {group.objects[0]?.viewName}.
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SqliteBody({ selection }: { selection: DataSelection }) {
  const overview = useStoresOverview();
  const tables = overview.data?.sqlite.objects;
  const selected = selection.table && tables?.some((table) => table.name === selection.table) ? selection.table : null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r border-border">
        <SqliteNavigator
          tables={tables}
          error={(overview.error as Error | null) ?? null}
          selectedTable={selected}
          hrefFor={(table) => dataHref({ ...selection, tab: "sqlite", table })}
        />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
        {selected ? (
          <>
            <h3 className="shrink-0 font-mono text-sm font-semibold text-foreground">{selected}</h3>
            <div className="min-h-0 flex-1">
              <StoreBrowser store="sqlite" objectName={selected} />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {selection.table && tables
              ? `✕ SQLite has no table named “${selection.table}”.`
              : overview.data
                ? `SQLite is the dashboard's own record: models, training runs, instruments. The file ${overview.data.sqlite.path} and its write-ahead log take ${byteSize(overview.data.sqlite.sizeBytes)} on disk. Pick one of its ${wholeNumber(overview.data.sqlite.objectCount)} tables on the left to read its rows.`
                : "Reading SQLite…"}
          </p>
        )}
      </section>
    </div>
  );
}

function QueryBody() {
  const [source, setSource] = useState<"lake" | "sqlite">("lake");
  const [statement, setStatement] = useState("");
  const run = useRunQuery();

  const handleRun = () => {
    run.mutate(
      { source, statement },
      {
        onSuccess: (result) => toast.success(`Query ran: ${wholeNumber(result.rows.length)} rows in ${wholeNumber(result.elapsedMilliseconds)} milliseconds.`),
        onError: (error) => toast.error(`The query was refused or failed: ${(error as Error).message}`),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <QueryConsole
        queryDb={source}
        customQuery={statement}
        isPending={run.isPending}
        onQueryDbChange={setSource}
        onCustomQueryChange={setStatement}
        onRunQuery={handleRun}
      />
      {run.isError && (
        <p className="rounded border border-[#D55E00]/50 p-3 font-mono text-xs text-[#D55E00]" data-testid="query-error">
          ✕ {(run.error as Error).message}
        </p>
      )}
      {run.data && (
        <VirtualDataTable
          tableName={run.data.source === "lake" ? "Result from the lake (DuckDB)" : "Result from SQLite"}
          data={run.data.rows}
          isLoading={false}
          description={`${wholeNumber(run.data.rows.length)} rows returned in ${wholeNumber(run.data.elapsedMilliseconds)} milliseconds for: ${run.data.statement}`}
        />
      )}
    </div>
  );
}

export default function DatabasesPage() {
  const selection = parseDataSelection(useSearch());
  const inventory = useLakeObjectsByKind();
  const overview = useStoresOverview();
  const catalogCount = useCatalogCount();
  // The badge needs the state on every tab; the frame polls faster only while it is open.
  const pgAdmin = usePgAdminStatus(true);
  const pgMark = serviceMark(serviceState(pgAdmin.data, pgAdmin.isError));

  useBreadcrumbs([
    { label: "Data", href: "/databases", icon: Database },
    { label: DATA_TAB_LABELS[selection.tab] },
  ]);

  const badges: Record<DataTab, { text: string; color?: string; title: string } | null> = {
    lake: inventory.data
      ? { text: wholeNumber(inventory.data.total), title: "Lake objects in the server's object registry (GET /api/stores/objects-by-kind)." }
      : null,
    sqlite: overview.data
      ? { text: wholeNumber(overview.data.sqlite.objectCount), title: "Tables in data/ml_dashboard.db, read from sqlite_master (GET /api/stores/overview)." }
      : null,
    postgres: { text: `${pgMark.glyph} ${pgMark.word}`, color: pgMark.color, title: "The pgAdmin supervisor's state (GET /api/pgadmin/status)." },
    query: null,
    engine: overview.data ? { text: `DuckDB ${overview.data.duckdb.version}`, title: "SELECT version() on the in-process DuckDB." } : null,
  };

  const subtitle =
    inventory.data && overview.data
      ? `${wholeNumber(inventory.data.total)} lake objects and ${wholeNumber(overview.data.sqlite.objectCount)} SQLite tables, counted when this page loaded.`
      : inventory.isError || overview.isError
        ? "A store did not answer; the tab that failed says which."
        : "Reading the stores…";

  return (
    <PageShell title="Data" subtitle={subtitle} icon={Database} fillHeight>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
        <nav aria-label="Data stores" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card/60 px-3 py-1.5">
          {DATA_TABS.map((tab) => {
            const active = selection.tab === tab;
            const badge = badges[tab];
            return (
              <Link
                key={tab}
                href={dataHref({ ...selection, tab })}
                data-testid={`tab-${tab}`}
                data-state={active ? "active" : "inactive"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md border-b-2 px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-[#56B4E9] bg-[#0072B2]/25 font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <span>{DATA_TAB_LABELS[tab]}</span>
                {badge && (
                  <span className="font-mono text-[10px]" style={badge.color ? { color: badge.color } : undefined} title={badge.title}>
                    {badge.text}
                  </span>
                )}
              </Link>
            );
          })}
          <Link
            href="/model-catalog"
            className="ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            title="The model specifications live under Knowledge. The count is read from GET /api/model-catalog."
            data-testid="data-model-catalog-link"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            Model Catalog{catalogCount.data !== undefined ? ` (${wholeNumber(catalogCount.data)} models)` : ""}
          </Link>
        </nav>

        <div className="min-h-0 flex-1 overflow-hidden" data-testid={`data-body-${selection.tab}`}>
          {selection.tab === "lake" && (
            <LakeBody selection={selection} inventory={inventory.data} inventoryError={(inventory.error as Error | null) ?? null} />
          )}
          {selection.tab === "sqlite" && <SqliteBody selection={selection} />}
          {selection.tab === "postgres" && (
            <div className="flex h-full min-h-0 flex-col">
              <PostgresPanel />
              <div className="min-h-0 flex-1">
                <PgAdminFrame />
              </div>
            </div>
          )}
          {selection.tab === "query" && <QueryBody />}
          {selection.tab === "engine" && (
            <div className="h-full space-y-6 overflow-y-auto p-6">
              <DuckDbPanel />
              <IcebergPanel table="bars" />
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
