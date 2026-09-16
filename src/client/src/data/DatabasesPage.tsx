/**
 * Data — the three stores this dashboard actually reads, and their contents.
 *
 *   Iceberg lake   the system of record at E:\lake, served by AIStor
 *   DuckDB         in-process, in-memory; defines a view per table of the
 *                  frozen serving snapshot, and runs every query on this page
 *   SQLite         the dashboard's own metadata
 *
 * QuestDB was retired on 2026-09-10 and is not part of this stack. Pick any
 * object and read its rows here — paging, sorting and filtering are controls,
 * not SQL you have to write.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Upload as UploadRecord } from "@shared/schema";
import { Database, HardDrive, RefreshCw, Table2, Upload } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Input } from "@/shared/ui/input";
import { PageShell } from "@/backtest/components";
import { LensFrame } from "@/lens/Frame";
import { cn } from "@/shared/utils/utils";
import { UploadTab } from "./UploadTab";
import { useToast } from "@/shared/hooks/use-toast";
import { databaseApi } from "@/infrastructure/api/api_service";
import { extractSymbolFromFilename, detectAssetType } from "@/data/lib/upload_utils";
import type { FileUploadItem } from "@/shared/utils/types";
import { QueryConsole } from "./QueryConsole";
import { StoreBrowser, type StoreKey } from "./stores/StoreBrowser";
import { ColumnProfiles } from "./stores/ColumnProfiles";
import { DuckDbPanel, IcebergPanel } from "./stores/StorePanels";

interface StoreObject {
  name: string;
  kind: string;
  rowCount?: number;
}

interface Overview {
  lake: {
    label: string;
    role: string;
    catalog: string;
    namespace: string;
    objectCount: number;
    objects: StoreObject[];
  };
  duckdb: {
    label: string;
    role: string;
    version: string;
    extensions: Array<{ name: string; loaded: boolean; installed: boolean }>;
    vectorSearch: { available: boolean; loaded: boolean; note: string };
  };
  sqlite: {
    label: string;
    role: string;
    path: string;
    objectCount: number;
    objects: StoreObject[];
  };
}

function ObjectList({
  objects,
  selected,
  onSelect,
  filter,
  onFilterChange,
}: {
  objects: StoreObject[];
  selected: string | null;
  onSelect: (name: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? objects.filter((o) => o.name.toLowerCase().includes(needle)) : objects;
  }, [objects, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <Input
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder={`Search ${objects.length} objects…`}
        className="h-7 text-xs"
        data-testid="object-filter"
      />
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((object) => (
          <li key={object.name}>
            <button
              type="button"
              onClick={() => onSelect(object.name)}
              className={cn(
                "flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors",
                selected === object.name ? "bg-muted text-foreground" : "hover:bg-muted/50 text-muted-foreground",
              )}
            >
              <span className="flex items-baseline gap-1.5 truncate">
                <span aria-hidden className="text-[10px]">
                  {selected === object.name ? "▸" : "·"}
                </span>
                <span className="truncate font-mono">{object.name}</span>
              </span>
              <span className="shrink-0 text-[10px] tnum">
                {object.rowCount !== undefined ? object.rowCount.toLocaleString() : object.kind}
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">Nothing matches.</li>}
      </ul>
    </div>
  );
}

export default function Databases() {
  const [activeTab, setActiveTab] = useState("lake");
  const [lakeObject, setLakeObject] = useState<string | null>(null);
  const [sqliteObject, setSqliteObject] = useState<string | null>(null);
  const [lakeFilter, setLakeFilter] = useState("");
  // Profiles are scoped to one symbol; unscoped, a billion-row table takes minutes.
  const [profileSymbol, setProfileSymbol] = useState("MNQ");
  const [sqliteFilter, setSqliteFilter] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<FileUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [queryDb, setQueryDb] = useState<"questdb" | "sqlite">("questdb");
  const [customQuery, setCustomQuery] = useState("");

  const { data: uploads = [] } = useQuery<UploadRecord[]>({
    queryKey: ["/api/uploads"],
    staleTime: 10_000,
    refetchInterval: isUploading ? 5000 : 30_000,
  });

  const runQuery = useMutation({
    mutationFn: (params: { db: string; sql: string }) => databaseApi.query(params),
    onSuccess: () => {
      toast({ title: "Query ran" });
      queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: (error: Error) => toast({ title: "Query failed", description: error.message, variant: "destructive" }),
  });

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    setSelectedFiles((prev) => [
      ...prev,
      ...Array.from(files).map((file) => {
        const symbol = extractSymbolFromFilename(file.name);
        return { file, symbol, assetType: detectAssetType(symbol), status: "pending" as const, progress: 0 };
      }),
    ]);
  };

  const uploadAllFiles = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    for (let i = 0; i < selectedFiles.length; i += 1) {
      const item = selectedFiles[i];
      if (!item || item.status !== "pending") continue;
      setSelectedFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: "uploading", progress: 0 } : f)));
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("symbol", item.symbol);
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await fetch("/api/upload/ohlcv", { method: "POST", body: form });
          if (response.status !== 429) break;
          const body = await response.json();
          await new Promise((resolve) => setTimeout(resolve, (body.retryAfter || 10) * 1000));
        }
        if (!response?.ok) throw new Error(`Upload failed: ${response?.statusText}`);
        setSelectedFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: "completed", progress: 100 } : f)));
      } catch (error) {
        console.error("Upload error:", error);
        setSelectedFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: "failed", progress: 0 } : f)));
      }
    }
    setIsUploading(false);
    toast({ title: "Upload batch complete", description: `Processed ${selectedFiles.length} files` });
    queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
  };

  const overview = useQuery({
    queryKey: ["stores", "overview"],
    queryFn: ({ signal }) =>
      fetch("/api/stores/overview", { signal }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `${r.status}`);
        return body as Overview;
      }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!lakeObject && overview.data?.lake.objects.length) {
      setLakeObject(overview.data.lake.objects.find((o) => o.name === "bars")?.name ?? overview.data.lake.objects[0]!.name);
    }
    if (!sqliteObject && overview.data?.sqlite.objects.length) {
      const busiest = [...overview.data.sqlite.objects].sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))[0];
      setSqliteObject(busiest?.name ?? null);
    }
  }, [overview.data, lakeObject, sqliteObject]);

  const data = overview.data;
  const store: StoreKey = activeTab === "sqlite" ? "sqlite" : "lake";
  const selected = store === "lake" ? lakeObject : sqliteObject;

  return (
    <PageShell
      title="Data"
      subtitle="The Iceberg lake, the DuckDB layer that serves it, and the dashboard's own SQLite — with every table browsable"
      icon={Database}
      actions={[{ label: "Refresh", icon: RefreshCw, onClick: () => overview.refetch(), variant: "ghost" }]}
      kpis={
        data
          ? [
              { label: "LAKE OBJECTS", value: data.lake.objectCount.toLocaleString(), hint: data.lake.role },
              { label: "DUCKDB", value: data.duckdb.version, hint: data.duckdb.role },
              {
                label: "VECTOR SEARCH",
                value: data.duckdb.vectorSearch.loaded ? "loaded" : data.duckdb.vectorSearch.available ? "installed" : "absent",
                hint: data.duckdb.vectorSearch.note,
              },
              { label: "SQLITE TABLES", value: data.sqlite.objectCount.toLocaleString(), hint: data.sqlite.role },
            ]
          : undefined
      }
    >
      <div className="flex flex-col gap-3" data-testid="data-page">
        {overview.error && (
          <LensFrame title="Stores" unavailableReason={(overview.error as Error).message} />
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="lake" data-testid="tab-lake">
              <HardDrive className="mr-1.5 h-3.5 w-3.5" />
              Iceberg lake &amp; DuckDB
              <span className="ml-1.5 text-[10px] text-muted-foreground tnum">{data?.lake.objectCount ?? ""}</span>
            </TabsTrigger>
            <TabsTrigger value="sqlite" data-testid="tab-sqlite">
              <Table2 className="mr-1.5 h-3.5 w-3.5" />
              SQLite metadata
              <span className="ml-1.5 text-[10px] text-muted-foreground tnum">{data?.sqlite.objectCount ?? ""}</span>
            </TabsTrigger>
            <TabsTrigger value="query" data-testid="tab-query">SQL console</TabsTrigger>
            <TabsTrigger value="upload" data-testid="tab-upload">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Upload
            </TabsTrigger>
          </TabsList>

          {/* ── Lake + DuckDB ─────────────────────────────────────── */}
          <TabsContent value="lake" className="mt-3 flex flex-col gap-3">
            <LensFrame
              title="Browse the lake"
              question="What is actually in this table? Sort, filter and page through it — no SQL."
              basis={
                data
                  ? `${data.lake.role} · catalog ${data.lake.catalog} · served through DuckDB ${data.duckdb.version}, which defines one view per table of the frozen snapshot`
                  : undefined
              }
              resizeKey="stores-lake-browser"
              defaultHeight={620}
              fillBody
            >
              <div className="flex min-h-0 flex-1 gap-3">
                <div className="w-64 shrink-0">
                  <ObjectList
                    objects={data?.lake.objects ?? []}
                    selected={lakeObject}
                    onSelect={setLakeObject}
                    filter={lakeFilter}
                    onFilterChange={setLakeFilter}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  {selected && store === "lake" ? (
                    <StoreBrowser store="lake" objectName={selected} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Choose an object to read its rows.</p>
                  )}
                </div>
              </div>
            </LensFrame>

            {selected && store === "lake" && (
              <ColumnProfiles
                objectName={selected}
                symbol={profileSymbol}
                onSymbolChange={setProfileSymbol}
              />
            )}

            <IcebergPanel table="bars" />
            <DuckDbPanel />
          </TabsContent>

          {/* ── SQLite ────────────────────────────────────────────── */}
          <TabsContent value="sqlite" className="mt-3">
            <LensFrame
              title="Browse the dashboard's metadata"
              question="What is in the app's own database — models, training runs, instruments?"
              basis={data ? `${data.sqlite.role} · ${data.sqlite.path}` : undefined}
              resizeKey="stores-sqlite-browser"
              defaultHeight={620}
              fillBody
            >
              <div className="flex min-h-0 flex-1 gap-3">
                <div className="w-64 shrink-0">
                  <ObjectList
                    objects={data?.sqlite.objects ?? []}
                    selected={sqliteObject}
                    onSelect={setSqliteObject}
                    filter={sqliteFilter}
                    onFilterChange={setSqliteFilter}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  {sqliteObject ? (
                    <StoreBrowser store="sqlite" objectName={sqliteObject} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Choose a table to read its rows.</p>
                  )}
                </div>
              </div>
            </LensFrame>
          </TabsContent>

          {/* ── Console (still here for the cases a control cannot express) ── */}
          <TabsContent value="query" className="mt-3">
            <LensFrame
              title="SQL console"
              question="For the question the controls above cannot express."
              basis="Read-only. Runs on the same in-process DuckDB, or on SQLite."
              resizeKey="stores-console"
              defaultHeight={420}
            >
              <QueryConsole
                queryDb={queryDb}
                customQuery={customQuery}
                isPending={runQuery.isPending}
                onQueryDbChange={setQueryDb}
                onCustomQueryChange={setCustomQuery}
                onRunQuery={() => runQuery.mutate({ db: queryDb, sql: customQuery })}
              />
            </LensFrame>
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <UploadTab
              selectedFiles={selectedFiles}
              isUploading={isUploading}
              pendingCount={selectedFiles.filter((f) => f.status === "pending").length}
              uploads={uploads}
              onFilesSelected={handleFilesSelected}
              onRemoveFile={(index) => setSelectedFiles((prev) => prev.filter((_, i) => i !== index))}
              onUpdateFileSymbol={(index, symbol) =>
                setSelectedFiles((prev) =>
                  prev.map((f, i) =>
                    i === index
                      ? { ...f, symbol: symbol.toUpperCase(), assetType: detectAssetType(symbol.toUpperCase()) }
                      : f,
                  ),
                )
              }
              onUploadAll={uploadAllFiles}
              onClearCompleted={() => setSelectedFiles((prev) => prev.filter((f) => f.status !== "completed"))}
            />
          </TabsContent>
        </Tabs>

        {data && (
          <p className="text-[11px] text-muted-foreground">
            QuestDB was retired on 2026-09-10; nothing on this page reads it. The lake is the system of record, the
            DuckDB views are a frozen serving snapshot of it, and SQLite holds only this dashboard&apos;s own records.
          </p>
        )}
      </div>
    </PageShell>
  );
}
