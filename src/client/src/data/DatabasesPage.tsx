import { useState } from "react";
import type { Upload as UploadRecord } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Upload, RefreshCw, Server, FileCode } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Badge } from "@/shared/ui/badge";
import { useToast } from "@/shared/hooks/use-toast";
import { databaseApi } from "@/infrastructure/api/api_service";
import { extractSymbolFromFilename, detectAssetType } from "@/data/lib/upload_utils";
import type { DatabaseStats, FileUploadItem } from "@/shared/utils/types";
import { formatNumber } from "@/shared/utils/types";
import { TableList } from "./TableList";
import { StatsCards } from "./StatsCards";
import { UploadTab } from "./UploadTab";
import { QueryConsole } from "./QueryConsole";
import { TablePreview } from "./TablePreview";
import { QuestDBControls } from "./QuestDBControls";


export default function Databases() {
  const [activeTab, setActiveTab] = useState("questdb");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState("");
  const [queryDb, setQueryDb] = useState<"questdb" | "sqlite">("questdb");
  const [selectedFiles, setSelectedFiles] = useState<FileUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sqliteStats, isLoading: sqliteLoading, refetch: refetchSqlite } = useQuery<DatabaseStats>({
    queryKey: ["/api/databases/sqlite/stats"],
    staleTime: 60_000,
  });

  const { data: questdbStats, isLoading: qdbLoading, refetch: refetchQdb } = useQuery<DatabaseStats>({
    queryKey: ["/api/databases/questdb/stats"],
    staleTime: 60_000,
  });

  const { data: tablePreview, isLoading: previewLoading } = useQuery({
    queryKey: ["/api/databases/preview", activeTab, previewTable],
    enabled: !!previewTable,
  });

  const runQueryMutation = useMutation({
    mutationFn: async (params: { db: string; sql: string }) => {
      return databaseApi.query(params);
    },
    onSuccess: () => {
      toast({ title: "Query executed successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
    },
    onError: (error: Error) => {
      toast({ title: "Query failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: uploads = [] } = useQuery<UploadRecord[]>({
    queryKey: ["/api/uploads"],
    staleTime: 10_000,
    refetchInterval: isUploading ? 5000 : 30_000,
  });

  // ── File upload handlers ──
  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const newFiles: FileUploadItem[] = Array.from(files).map(file => {
      const sym = extractSymbolFromFilename(file.name);
      return {
        file,
        symbol: sym,
        assetType: detectAssetType(sym),
        status: "pending" as const,
        progress: 0,
      };
    });
    setSelectedFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const updateFileSymbol = (index: number, newSymbol: string) => {
    const upper = newSymbol.toUpperCase();
    setSelectedFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, symbol: upper, assetType: detectAssetType(upper) } : f
    ));
  };

  const uploadAllFiles = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);

    for (let i = 0; i < selectedFiles.length; i++) {
      const fileItem = selectedFiles[i];
      if (!fileItem || fileItem.status !== "pending") continue;

      setSelectedFiles(prev => prev.map((f, idx) =>
        idx === i ? { ...f, status: "uploading", progress: 0 } : f
      ));

      try {
        const formData = new FormData();
        formData.append("file", fileItem.file);
        formData.append("symbol", fileItem.symbol);

        let response: Response | null = null;
        let retries = 0;
        while (retries < 3) {
          response = await fetch("/api/upload/ohlcv", { method: "POST", body: formData });
          if (response.status === 429) {
            const data = await response.json();
            await new Promise(r => setTimeout(r, (data.retryAfter || 10) * 1000));
            retries++;
          } else break;
        }

        if (!response?.ok) throw new Error(`Upload failed: ${response?.statusText}`);

        setSelectedFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, status: "completed", progress: 100 } : f
        ));
      } catch (error) {
        console.error("Upload error:", error);
        setSelectedFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, status: "failed", progress: 0 } : f
        ));
      }

      if (i < selectedFiles.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    setIsUploading(false);
    toast({ title: "Upload batch complete", description: `Processed ${selectedFiles.length} files` });
    queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
  };

  const clearCompleted = () => {
    setSelectedFiles(prev => prev.filter(f => f.status !== "completed"));
  };

  const pendingCount = selectedFiles.filter(f => f.status === "pending").length;

  const toggleTable = (tableName: string) => {
    const newExpanded = new Set(expandedTables);
    if (newExpanded.has(tableName)) {
      newExpanded.delete(tableName);
    } else {
      newExpanded.add(tableName);
    }
    setExpandedTables(newExpanded);
  };

  const handlePreview = (tableName: string, dbType: string) => {
    setPreviewTable(tableName);
    setActiveTab(dbType);
  };

  const totalRows = 
    (sqliteStats?.tableDetails || []).reduce((sum, t) => sum + (t.rowCount || 0), 0) +
    (questdbStats?.tableDetails || []).reduce((sum, t) => sum + (t.rowCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
              <Server className="h-5 w-5 text-foreground/80" />
            </div>
            <span className="text-sm font-medium text-foreground/80/80">Institutional Data Architecture</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-foreground/90 to-foreground/40 bg-clip-text text-transparent">Database Explorer</h1>
          <p className="text-muted-foreground text-sm mt-1">QuestDB (Speed) and SQLite (Metadata)</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white/[0.02] border-white/[0.05] rounded-xl px-4 py-2 border border-[hsl(var(--data-pos)/0.2)] text-center">
            <div className="text-[10px] text-foreground/80/70 uppercase tracking-wider mb-0.5">Active Tables</div>
            <div className="text-xl font-bold text-foreground/80">
              {(sqliteStats?.tables || 0) + (questdbStats?.tables || 0)}
            </div>
          </div>
          <div className="bg-white/[0.02] border-white/[0.05] rounded-xl px-4 py-2 border border-cyan-500/20 text-center">
            <div className="text-[10px] text-foreground/80/70 uppercase tracking-wider mb-0.5">Active Rows</div>
            <div className="text-xl font-bold text-foreground/80">{formatNumber(totalRows)}</div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-black/30 backdrop-blur-xl border border-white/10 rounded-xl p-1 h-auto">
          <TabsTrigger
            value="questdb"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-foreground"
            data-testid="tab-questdb"
          >
            <Clock className="h-4 w-4 mr-2" />
            QuestDB (Speed)
            <Badge className="ml-2 text-[10px] bg-white/5 text-muted-foreground/60 border-white/5">{questdbStats?.tables || 0}</Badge>
          </TabsTrigger>
          
          <TabsTrigger
            value="sqlite"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-foreground"
            data-testid="tab-sqlite"
          >
            <FileCode className="h-4 w-4 mr-2" />
            SQLite (Meta)
            <Badge className="ml-2 text-[10px] bg-white/5 text-muted-foreground/60 border-white/5">{sqliteStats?.tables || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="upload"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-[hsl(var(--data-pos)/0.2)] data-[state=active]:text-foreground/80"
            data-testid="tab-upload"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
            {selectedFiles.length > 0 && (
              <Badge className="ml-2 text-[10px] bg-[hsl(var(--data-pos)/0.2)] text-foreground/80">{selectedFiles.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* QuestDB Tab */}
        <TabsContent value="questdb" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">QuestDB Speed Layer</h2>
              <p className="text-sm text-muted-foreground">High-frequency tick data, OHLCV, and MBP-10</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={() => refetchQdb()} data-testid="refresh-questdb">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
          
          <QuestDBControls />
          
          <StatsCards stats={questdbStats} loading={qdbLoading} dbName="QuestDB" />

          {questdbStats?.tableDetails && (
            <ScrollArea className="h-[500px]">
              <TableList tables={questdbStats.tableDetails} dbType="questdb" expandedTables={expandedTables} onToggleTable={toggleTable} onPreview={handlePreview} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* SQLite Tab */}
        <TabsContent value="sqlite" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">SQLite Metadata Layer</h2>
              <p className="text-sm text-muted-foreground">Local development state and configuration</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchSqlite()} data-testid="refresh-sqlite">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <StatsCards stats={sqliteStats} loading={sqliteLoading} dbName="SQLite" />
          {sqliteStats?.tableDetails && (
            <ScrollArea className="h-[500px]">
              <TableList tables={sqliteStats.tableDetails} dbType="sqlite" expandedTables={expandedTables} onToggleTable={toggleTable} onPreview={handlePreview} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Upload Tab */}
        <TabsContent value="upload" className="space-y-6">
          <UploadTab
            selectedFiles={selectedFiles}
            isUploading={isUploading}
            pendingCount={pendingCount}
            uploads={uploads}
            onFilesSelected={handleFilesSelected}
            onRemoveFile={removeFile}
            onUpdateFileSymbol={updateFileSymbol}
            onUploadAll={uploadAllFiles}
            onClearCompleted={clearCompleted}
          />
        </TabsContent>
      </Tabs>

      {/* SQL Query Console */}
      <QueryConsole
        queryDb={queryDb}
        customQuery={customQuery}
        isPending={runQueryMutation.isPending}
        onQueryDbChange={setQueryDb}
        onCustomQueryChange={setCustomQuery}
        onRunQuery={() => runQueryMutation.mutate({ db: queryDb, sql: customQuery })}
      />

      {/* Table Preview */}
      {previewTable && (
        <TablePreview
          tableName={previewTable}
          data={tablePreview}
          isLoading={previewLoading}
          onClose={() => setPreviewTable(null)}
        />
      )}
    </div>
  );
}
