/**
 * The two panels that describe the stack itself: what the Iceberg catalog says
 * about a table, and what DuckDB says about itself — including whether its
 * vector-search extension is here and whether anything uses it.
 */

import { useQuery } from "@tanstack/react-query";
import { LensFrame } from "@/lens/Frame";

interface IcebergSnapshot {
  snapshotId: number | string;
  parentSnapshotId: number | string | null;
  sequenceNumber: number | null;
  timestampMs: number | null;
  summary: Record<string, string>;
}

interface IcebergResponse {
  table: string;
  tablesInNamespace: string[];
  metadataLocation: string | null;
  location: string | null;
  formatVersion: number | null;
  currentSnapshotId: number | string | null;
  snapshots: IcebergSnapshot[];
  snapshotCount: number;
  partitionSpecs: Array<{ "spec-id"?: number; fields?: Array<{ name?: string; transform?: string }> }>;
  sortOrders: unknown[];
  schema: { fields?: Array<{ id: number; name: string; type: unknown; required?: boolean }> };
  properties: Record<string, string>;
}

interface DuckDbResponse {
  version: string;
  extensions: Array<{ name: string; loaded: boolean; installed: boolean; description: string }>;
  settings: Array<{ name: string; value: string; description: string }>;
}

function utc(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

function typeName(type: unknown): string {
  return typeof type === "string" ? type : JSON.stringify(type);
}

export function IcebergPanel({ table }: { table: string }) {
  const iceberg = useQuery({
    queryKey: ["stores", "iceberg", table],
    queryFn: ({ signal }) =>
      fetch(`/api/stores/iceberg?table=${encodeURIComponent(table)}`, { signal }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `${r.status}`);
        return body as IcebergResponse;
      }),
    staleTime: 60_000,
  });

  if (iceberg.error) {
    return (
      <LensFrame
        title="Iceberg catalog"
        question="What does the system of record say about this table?"
        unavailableReason={(iceberg.error as Error).message}
        resizeKey="stores-iceberg"
        defaultHeight={420}
      />
    );
  }

  const data = iceberg.data;
  const fields = data?.schema.fields ?? [];
  const partitionFields = data?.partitionSpecs?.[0]?.fields ?? [];

  return (
    <LensFrame
      title="Iceberg catalog"
      question="What does the system of record say about this table — its schema, its partitioning, and every commit?"
      basis={
        data
          ? `namespace market · format version ${data.formatVersion} · ${data.snapshotCount.toLocaleString()} snapshots · ${fields.length} columns · read from ${data.metadataLocation ?? "the catalog"}`
          : undefined
      }
      resizeKey="stores-iceberg"
      defaultHeight={420}
      testId="iceberg-panel"
    >
      {!data ? (
        <p className="text-xs text-muted-foreground">Reading the catalog…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Latest commits
            </h4>
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-1 pr-2 font-normal">when (UTC)</th>
                  <th className="py-1 pr-2 font-normal">operation</th>
                  <th className="py-1 pr-2 text-right font-normal">rows after</th>
                  <th className="py-1 text-right font-normal">files added</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {data.snapshots.slice(0, 8).map((snapshot) => (
                  <tr key={String(snapshot.snapshotId)} className="border-t border-border/40">
                    <td className="py-1 pr-2 font-mono">{utc(snapshot.timestampMs)}</td>
                    <td className="py-1 pr-2">{snapshot.summary.operation ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">
                      {snapshot.summary["total-records"]
                        ? Number(snapshot.summary["total-records"]).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-1 text-right">{snapshot.summary["added-data-files"] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {partitionFields.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Partitioned by{" "}
                <span className="font-mono text-foreground">
                  {partitionFields.map((f) => `${f.name} (${f.transform})`).join(", ")}
                </span>
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Schema ({fields.length} columns)
            </h4>
            <div className="max-h-56 overflow-auto rounded border border-border/60">
              <table className="w-full text-left text-[11px]">
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.id} className="border-b border-border/30">
                      <td className="px-2 py-0.5 font-mono text-foreground">{field.name}</td>
                      <td className="px-2 py-0.5 text-muted-foreground">{typeName(field.type)}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">
                        {field.required ? "required" : "optional"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </LensFrame>
  );
}

export function DuckDbPanel() {
  const duckdb = useQuery({
    queryKey: ["stores", "duckdb"],
    queryFn: ({ signal }) =>
      fetch("/api/stores/duckdb", { signal }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `${r.status}`);
        return body as DuckDbResponse;
      }),
    staleTime: 60_000,
  });

  const data = duckdb.data;
  const loaded = (data?.extensions ?? []).filter((e) => e.loaded);
  const installedOnly = (data?.extensions ?? []).filter((e) => e.installed && !e.loaded);
  const vss = (data?.extensions ?? []).find((e) => e.name === "vss");

  return (
    <LensFrame
      title="DuckDB"
      question="What actually runs the queries on this page, and what can it do?"
      basis={data ? `${data.version} · in-process, in-memory · ${loaded.length} extensions loaded, ${installedOnly.length} installed but not loaded` : undefined}
      unavailableReason={duckdb.error ? (duckdb.error as Error).message : undefined}
      resizeKey="stores-duckdb"
      defaultHeight={360}
      testId="duckdb-panel"
    >
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vector search (vss)
            </h4>
            <p className="text-xs text-foreground">
              <span aria-hidden>{vss?.loaded ? "●" : vss?.installed ? "◐" : "○"} </span>
              {vss?.loaded
                ? "loaded — HNSW indexes and array distance functions are available on this connection"
                : vss?.installed
                  ? "installed, not loaded on this connection"
                  : "not installed on this connection"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Nothing in the lake stores embeddings today, so there is no vector index to show. The extension is
              what a candle-shape or pattern embedding would be searched with once one is landed.
            </p>

            <h4 className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </h4>
            <table className="w-full text-left text-[11px]">
              <tbody className="tnum">
                {data.settings.map((setting) => (
                  <tr key={setting.name} className="border-b border-border/30">
                    <td className="py-0.5 pr-2 font-mono text-foreground">{setting.name}</td>
                    <td className="py-0.5 text-muted-foreground">{setting.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Extensions
            </h4>
            <div className="max-h-56 overflow-auto rounded border border-border/60">
              <table className="w-full text-left text-[11px]">
                <tbody>
                  {data.extensions.map((extension) => (
                    <tr key={extension.name} className="border-b border-border/30">
                      <td className="px-2 py-0.5 font-mono text-foreground">{extension.name}</td>
                      <td className="px-2 py-0.5 text-muted-foreground">
                        <span aria-hidden>{extension.loaded ? "● " : extension.installed ? "◐ " : "○ "}</span>
                        {extension.loaded ? "loaded" : extension.installed ? "installed" : "available"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </LensFrame>
  );
}
