import { useState } from "react";
import type { Upload as UploadRecord } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Clock, Upload, Layers, HardDrive, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { databaseApi } from "@/lib/apiService";
import { extractSymbolFromFilename, detectAssetType } from "@/lib/uploadUtils";
import type { DatabaseStats, FileUploadItem } from "./types";
import { formatNumber } from "./types";
import { TableList } from "./TableList";
import { StatsCards } from "./StatsCards";
import { UploadTab } from "./UploadTab";
import { QueryConsole } from "./QueryConsole";
import { TablePreview } from "./TablePreview";

export default function Databases() {
  const [activeTab, setActiveTab] = useState("postgres");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState("");
  const [queryDb, setQueryDb] = useState<"postgres" | "questdb">("postgres");
  const [selectedFiles, setSelectedFiles] = useState<FileUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: postgresStats, isLoading: pgLoading, refetch: refetchPg } = useQuery<DatabaseStats>({
    queryKey: ["/api/databases/postgres/stats"],
    refetchInterval: 30000,
  });

  const { data: questdbStats, isLoading: qdbLoading, refetch: refetchQdb } = useQuery<DatabaseStats>({
    queryKey: ["/api/databases/questdb/stats"],
    refetchInterval: 30000,
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
    refetchInterval: 5000,
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

  const totalRows = (postgresStats?.tableDetails || []).reduce((sum, t) => sum + t.rowCount, 0) +
    (questdbStats?.tableDetails || []).reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center">
              <Database className="h-5 w-5 text-emerald-300" />
            </div>
            <span className="text-sm font-medium text-emerald-300/80">Data Infrastructure</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Database Explorer</h1>
          <p className="text-muted-foreground text-sm mt-1">PostgreSQL and QuestDB instances</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl px-4 py-2 border border-emerald-500/20 text-center">
            <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider mb-0.5">Tables</div>
            <div className="text-xl font-bold text-emerald-300">{(postgresStats?.tables || 0) + (questdbStats?.tables || 0)}</div>
          </div>
          <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl px-4 py-2 border border-cyan-500/20 text-center">
            <div className="text-[10px] text-cyan-300/70 uppercase tracking-wider mb-0.5">Rows</div>
            <div className="text-xl font-bold text-cyan-300">{formatNumber(totalRows)}</div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-black/30 backdrop-blur-xl border border-white/10 rounded-xl p-1 h-auto">
          <TabsTrigger
            value="postgres"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300"
            data-testid="tab-postgres"
          >
            <Database className="h-4 w-4 mr-2" />
            PostgreSQL
            <Badge className="ml-2 text-[10px] bg-violet-500/20 text-violet-300">{postgresStats?.tables || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="questdb"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300"
            data-testid="tab-questdb"
          >
            <Clock className="h-4 w-4 mr-2" />
            QuestDB
            <Badge className="ml-2 text-[10px] bg-amber-500/20 text-amber-300">{questdbStats?.tables || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="upload"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300"
            data-testid="tab-upload"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
            {selectedFiles.length > 0 && (
              <Badge className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-300">{selectedFiles.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* PostgreSQL Tab */}
        <TabsContent value="postgres" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">PostgreSQL</h2>
              <p className="text-sm text-muted-foreground">Metadata storage: instruments, contracts, models, uploads</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchPg()} data-testid="refresh-postgres">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <StatsCards stats={postgresStats} loading={pgLoading} dbName="PostgreSQL" />
          {postgresStats?.tableDetails && (
            <ScrollArea className="h-[500px]">
              <TableList tables={postgresStats.tableDetails} dbType="postgres" expandedTables={expandedTables} onToggleTable={toggleTable} onPreview={handlePreview} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* QuestDB Tab */}
        <TabsContent value="questdb" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">QuestDB</h2>
              <p className="text-sm text-muted-foreground">Time-series OHLCV data with SAMPLE BY, partitioning, WAL</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchQdb()} data-testid="refresh-questdb">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <StatsCards stats={questdbStats} loading={qdbLoading} dbName="QuestDB" />

          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm font-mono">QuestDB Features</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <Clock className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-xs font-medium">SAMPLE BY</p>
                <p className="text-[10px] text-muted-foreground">Time aggregation</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <Layers className="h-6 w-6 mx-auto text-accent mb-2" />
                <p className="text-xs font-medium">Daily Partitions</p>
                <p className="text-[10px] text-muted-foreground">Optimized storage</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <HardDrive className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-xs font-medium">WAL Enabled</p>
                <p className="text-[10px] text-muted-foreground">Write-ahead log</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <Database className="h-6 w-6 mx-auto text-accent mb-2" />
                <p className="text-xs font-medium">Deduplication</p>
                <p className="text-[10px] text-muted-foreground">Auto dedup keys</p>
              </div>
            </CardContent>
          </Card>

          {questdbStats?.tableDetails && (
            <ScrollArea className="h-[400px]">
              <TableList tables={questdbStats.tableDetails} dbType="questdb" expandedTables={expandedTables} onToggleTable={toggleTable} onPreview={handlePreview} />
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
