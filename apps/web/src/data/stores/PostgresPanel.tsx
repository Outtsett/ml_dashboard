/**
 * PostgresPanel — what the PostgreSQL server says it holds, one card per
 * database the dashboard connects to. Every figure is the server's own answer;
 * a row figure from the planner or from TimescaleDB's chunk statistics is
 * labelled an estimate, because it is one.
 */

import { useState } from "react";
import { byteSize, wholeNumber } from "@shared/stores/format";
import { usePostgresFacts, type PostgresDatabaseFacts } from "./hooks";

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

function DatabaseCard({ facts }: { facts: PostgresDatabaseFacts }) {
  const [showAll, setShowAll] = useState(false);

  if (!facts.reachable) {
    return (
      <article className="rounded border border-[#D55E00]/50 p-3 text-xs" data-testid={`postgres-${facts.database}`}>
        <h4 className="font-mono text-sm font-semibold text-foreground">{facts.database}</h4>
        <p className="mt-1 text-[#D55E00]">✕ unreachable: {facts.error}</p>
      </article>
    );
  }

  const tables = facts.tables ?? [];
  const hypertables = facts.hypertables ?? [];
  const shown = showAll ? tables : tables.slice(0, 6);

  return (
    <article className="rounded border border-border bg-card/40 p-3 text-xs" data-testid={`postgres-${facts.database}`}>
      <h4 className="font-mono text-sm font-semibold text-foreground">
        {facts.database} <span className="font-sans text-[11px] font-normal text-[#56B4E9]">● reachable</span>
      </h4>
      {facts.error && <p className="mt-1 text-[#D55E00]">✕ A catalog statement failed: {facts.error}</p>}
      <p
        className="mt-1 text-muted-foreground"
        title={`Read ${facts.measuredAt} in ${facts.durationMilliseconds} milliseconds: current_setting('server_version'), pg_extension, pg_database_size(current_database()).`}
      >
        PostgreSQL {facts.serverVersion}. The database takes{" "}
        <strong className="text-foreground">{byteSize(facts.databaseSizeBytes)}</strong> on disk and holds{" "}
        {wholeNumber(tables.length)} tables and {wholeNumber((facts.views ?? []).length)} views. Extensions:{" "}
        {(facts.extensions ?? []).map((extension) => `${extension.name} ${extension.version}`).join(", ") || "none"}.
      </p>

      {hypertables.map((hypertable) => (
        <p
          key={hypertable.name}
          className="mt-1 text-foreground"
          title="From timescaledb_information.hypertables and .chunks, hypertable_size() and approximate_row_count(). The row figure is TimescaleDB's estimate from chunk statistics, not a count."
        >
          Hypertable <span className="font-mono">{hypertable.name}</span>: about{" "}
          <strong>{wholeNumber(hypertable.approximateRowCount)} rows (estimate)</strong> in {wholeNumber(hypertable.chunkCount)}{" "}
          chunks, {byteSize(hypertable.totalSizeBytes)}, covering {day(hypertable.earliestChunkStart)} to{" "}
          {day(hypertable.latestChunkEnd)}.
        </p>
      ))}

      {tables.length > 0 && (
        <table className="mt-2 w-full text-left text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-0.5 pr-2 font-normal">table</th>
              <th
                className="py-0.5 pr-2 text-right font-normal"
                title="pg_stat_user_tables.n_live_tup: the planner's estimate of live rows, exact only right after the table was analysed."
              >
                rows (planner's estimate)
              </th>
              <th className="py-0.5 pr-2 text-right font-normal" title="pg_total_relation_size: the table with its indexes.">
                size with indexes
              </th>
              <th className="py-0.5 text-right font-normal">last analysed</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {shown.map((table) => (
              <tr key={table.name} className="border-t border-border/40">
                <td className="py-0.5 pr-2 font-mono text-foreground">{table.name}</td>
                {hypertables.some((hypertable) => hypertable.name === table.name) ? (
                  // A hypertable's rows live in its chunks, so the parent's own figures read 0.
                  <td className="py-0.5 pr-2 text-right text-muted-foreground" colSpan={2}>
                    a hypertable: its rows and size are in the sentence above
                  </td>
                ) : (
                  <>
                    <td className="py-0.5 pr-2 text-right">{wholeNumber(table.estimatedRowCount)}</td>
                    <td className="py-0.5 pr-2 text-right">{byteSize(table.totalSizeBytes)}</td>
                  </>
                )}
                <td className="py-0.5 text-right text-muted-foreground">{table.lastAnalyzedAt ? day(table.lastAnalyzedAt) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tables.length > 6 && (
        <button type="button" className="mt-1 text-[11px] text-[#56B4E9] hover:underline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the 6 largest tables" : `Show all ${wholeNumber(tables.length)} tables`}
        </button>
      )}
      {(facts.views ?? []).length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Views: <span className="font-mono">{(facts.views ?? []).join(", ")}</span>
        </p>
      )}
    </article>
  );
}

export function PostgresPanel() {
  const [open, setOpen] = useState(true);
  const facts = usePostgresFacts(true);

  return (
    <section className="shrink-0 border-b border-border" data-testid="postgres-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-foreground hover:bg-muted/30"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        What the PostgreSQL server holds, read from the server
        <span className="font-normal text-muted-foreground">(pgAdmin is below)</span>
      </button>
      {open && (
        <div className="max-h-[45vh] overflow-y-auto px-3 pb-3">
          {facts.isError && (
            <p className="text-xs text-[#D55E00]">✕ The server's facts could not be read: {(facts.error as Error).message}</p>
          )}
          {facts.isLoading && <p className="text-xs text-muted-foreground">Asking PostgreSQL what it holds…</p>}
          {facts.data && (
            <div className="grid gap-3 lg:grid-cols-2">
              {facts.data.databases.map((database) => (
                <DatabaseCard key={database.database} facts={database} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
