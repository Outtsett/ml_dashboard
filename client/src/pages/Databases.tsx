import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Table2, Layers, HardDrive, RefreshCw, Play, ChevronDown, ChevronRight, Eye, BarChart3, Clock, Cpu, Upload, FileText, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { extractSymbolFromFilename, detectAssetType } from "@/lib/uploadUtils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface TableInfo {
  name: string;
  rowCount: number;
  type?: string;
  partitions?: number;
  columns?: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

interface DatabaseStats {
  connected: boolean;
  tables: number;
  tableDetails: TableInfo[];
  error?: string;
}

interface FileUploadItem {
  file: File;
  symbol: string;
  assetType: "futures" | "forex";
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number;
}

export default function Databases() {
  const [activeTab, setActiveTab] = useState("postgres");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState("");
  const [queryDb, setQueryDb] = useState<"postgres" | "questdb" | "duckdb">("postgres");
  const [selectedFiles, setSelectedFiles] = useState<FileUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const { data: duckdbStats, isLoading: duckLoading, refetch: refetchDuck } = useQuery<DatabaseStats>({
    queryKey: ["/api/databases/duckdb/stats"],
    refetchInterval: 30000,
  });

  const { data: tablePreview, isLoading: previewLoading } = useQuery({
    queryKey: ["/api/databases/preview", activeTab, previewTable],
    enabled: !!previewTable,
  });

  const runQueryMutation = useMutation({
    mutationFn: async (params: { db: string; sql: string }) => {
      const response = await fetch("/api/databases/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Query executed successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
    },
    onError: (error: Error) => {
      toast({ title: "Query failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: uploads = [] } = useQuery<any[]>({
    queryKey: ["/api/uploads"],
    refetchInterval: 5000,
  });

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
      if (fileItem.status !== "pending") continue;

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

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const renderTableList = (tables: TableInfo[], dbType: string) => (
    <div className="space-y-2">
      {tables.map((table) => (
        <Collapsible key={table.name} open={expandedTables.has(table.name)}>
          <div className="glass rounded-lg overflow-hidden">
            <CollapsibleTrigger 
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
              onClick={() => toggleTable(table.name)}
              data-testid={`table-${table.name}`}
            >
              <div className="flex items-center gap-3">
                {expandedTables.has(table.name) ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Table2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-sm">{table.name}</span>
                {table.type && (
                  <Badge variant="outline" className="text-xs">
                    {table.type}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4">
                {table.partitions && (
                  <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {table.partitions} partitions
                  </span>
                )}
                <span className="text-xs text-accent font-mono">
                  {formatNumber(table.rowCount)} rows
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewTable(table.name);
                    setActiveTab(dbType);
                  }}
                  data-testid={`preview-${table.name}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Preview
                </Button>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-3 pt-1 border-t border-white/5">
                {table.columns && table.columns.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {table.columns.map((col) => (
                      <div key={col.name} className="flex items-center gap-2 font-mono text-muted-foreground">
                        <span className="text-foreground">{col.name}</span>
                        <span className="text-primary/70">{col.type}</span>
                        {col.nullable === false && <Badge variant="outline" className="text-[10px] px-1">NOT NULL</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Click to load column info...</p>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );

  const renderStats = (stats: DatabaseStats | undefined, loading: boolean, dbName: string) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }

    if (!stats?.connected) {
      return (
        <Card className="glass border-destructive/50">
          <CardContent className="p-6 text-center">
            <p className="text-destructive font-medium">Connection Failed</p>
            <p className="text-sm text-muted-foreground mt-2">{stats?.error || `Unable to connect to ${dbName}`}</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold">{stats.tables}</p>
              <p className="text-xs text-muted-foreground">Tables</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-accent/20 to-primary/20 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold">
                {formatNumber(stats.tableDetails.reduce((sum, t) => sum + (t.rowCount || 0), 0))}
              </p>
              <p className="text-xs text-muted-foreground">Total Rows</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-green-500/20 to-accent/20 flex items-center justify-center">
              <div className="h-3 w-3 rounded-full bg-green-500 pulse-slow" />
            </div>
            <div>
              <p className="text-lg font-display font-bold text-green-400">Connected</p>
              <p className="text-xs text-muted-foreground">Status</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const totalRows = (postgresStats?.tableDetails || []).reduce((sum, t) => sum + t.rowCount, 0) +
    (questdbStats?.tableDetails || []).reduce((sum, t) => sum + t.rowCount, 0) +
    (duckdbStats?.tableDetails || []).reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center">
              <Database className="h-5 w-5 text-emerald-300" />
            </div>
            <span className="text-sm font-medium text-emerald-300/80">Data Infrastructure</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Database Explorer</h1>
          <p className="text-muted-foreground text-sm mt-1">PostgreSQL, QuestDB, and DuckDB instances</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl px-4 py-2 border border-emerald-500/20 text-center">
            <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider mb-0.5">Tables</div>
            <div className="text-xl font-bold text-emerald-300">{(postgresStats?.tables || 0) + (questdbStats?.tables || 0) + (duckdbStats?.tables || 0)}</div>
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
            value="duckdb"
            className="rounded-lg px-5 py-2.5 data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300"
            data-testid="tab-duckdb"
          >
            <Cpu className="h-4 w-4 mr-2" />
            DuckDB
            <Badge className="ml-2 text-[10px] bg-cyan-500/20 text-cyan-300">{duckdbStats?.tables || 0}</Badge>
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

          {renderStats(postgresStats, pgLoading, "PostgreSQL")}

          {postgresStats?.tableDetails && (
            <ScrollArea className="h-[500px]">
              {renderTableList(postgresStats.tableDetails, "postgres")}
            </ScrollArea>
          )}
        </TabsContent>

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

          {renderStats(questdbStats, qdbLoading, "QuestDB")}

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
              {renderTableList(questdbStats.tableDetails, "questdb")}
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="duckdb" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">DuckDB</h2>
              <p className="text-sm text-muted-foreground">In-memory OLAP for Parquet analytics and ML feature engineering</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchDuck()} data-testid="refresh-duckdb">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {renderStats(duckdbStats, duckLoading, "DuckDB")}

          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm font-mono">DuckDB Capabilities</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <HardDrive className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-xs font-medium">Parquet Native</p>
                <p className="text-[10px] text-muted-foreground">Direct file queries</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <Cpu className="h-6 w-6 mx-auto text-accent mb-2" />
                <p className="text-xs font-medium">Vectorized</p>
                <p className="text-[10px] text-muted-foreground">SIMD execution</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <BarChart3 className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-xs font-medium">Analytics</p>
                <p className="text-[10px] text-muted-foreground">10-100x faster</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <Layers className="h-6 w-6 mx-auto text-accent mb-2" />
                <p className="text-xs font-medium">ML Ready</p>
                <p className="text-[10px] text-muted-foreground">Feature engineering</p>
              </div>
            </CardContent>
          </Card>

          {duckdbStats?.tableDetails && (
            <ScrollArea className="h-[400px]">
              {renderTableList(duckdbStats.tableDetails, "duckdb")}
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="upload" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-semibold">Upload Data</h2>
              <p className="text-sm text-muted-foreground">Upload CSV, Parquet, DBN, or JSON files to PostgreSQL</p>
            </div>
            {selectedFiles.length > 0 && (
              <Button
                onClick={uploadAllFiles}
                disabled={pendingCount === 0 || isUploading}
                className="bg-gradient-to-r from-emerald-600 to-cyan-500 text-white hover:opacity-90"
                data-testid="button-upload-all"
              >
                {isUploading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Upload {pendingCount} Files</>
                )}
              </Button>
            )}
          </div>

          {/* Dropzone */}
          <Card className="glass border-2 border-dashed border-white/20 hover:border-emerald-500/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-emerald-500'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('border-emerald-500'); }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('border-emerald-500');
              handleFilesSelected(e.dataTransfer.files);
            }}
            data-testid="upload-dropzone"
          >
            <CardContent className="p-8 text-center">
              <Upload className="h-10 w-10 mx-auto mb-3 text-emerald-400/60" />
              <p className="text-sm font-medium text-muted-foreground">Drop files here or click to browse</p>
              <p className="text-xs text-muted-foreground/60 mt-1">CSV, Parquet, DBN, JSON (max 500MB per file)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.zst,.parquet,.dbn,.json"
                multiple
                onChange={(e) => handleFilesSelected(e.target.files)}
                className="hidden"
                data-testid="upload-file-input"
              />
            </CardContent>
          </Card>

          {/* File Queue */}
          {selectedFiles.length > 0 && (
            <Card className="glass">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    File Queue
                    <Badge variant="outline" className="text-xs">{selectedFiles.length}</Badge>
                  </span>
                  <Button variant="ghost" size="sm" onClick={clearCompleted} className="text-xs h-7">
                    Clear Completed
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedFiles.map((fileItem, index) => (
                  <div key={index} className={`p-3 rounded-lg flex items-center gap-3 ${
                    fileItem.status === 'completed' ? 'bg-green-500/10' :
                    fileItem.status === 'failed' ? 'bg-rose-500/10' :
                    fileItem.status === 'uploading' ? 'bg-primary/10' : 'bg-white/5'
                  }`} data-testid={`upload-file-${index}`}>
                    <FileText className={`h-4 w-4 shrink-0 ${
                      fileItem.status === 'completed' ? 'text-green-400' :
                      fileItem.status === 'failed' ? 'text-rose-400' :
                      fileItem.status === 'uploading' ? 'text-primary' : 'text-muted-foreground'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{fileItem.file.name}</p>
                      <p className="text-[10px] text-muted-foreground">{(fileItem.file.size / 1024 / 1024).toFixed(1)} MB</p>
                      {fileItem.status === 'uploading' && <Progress value={fileItem.progress} className="h-1 mt-1" />}
                    </div>
                    <Input
                      value={fileItem.symbol}
                      onChange={(e) => updateFileSymbol(index, e.target.value)}
                      className="w-20 h-7 text-xs font-mono rounded bg-white/10 border-white/10 px-2"
                      disabled={fileItem.status !== 'pending'}
                      data-testid={`upload-symbol-${index}`}
                    />
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${
                      fileItem.assetType === 'futures' ? 'border-violet-500/30 text-violet-400' : 'border-teal-500/30 text-teal-400'
                    }`}>{fileItem.assetType}</Badge>
                    {fileItem.status === 'pending' && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFile(index)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                    {fileItem.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />}
                    {fileItem.status === 'failed' && <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
                    {fileItem.status === 'uploading' && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Upload History */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4" />
                Upload History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {uploads.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No uploads yet</p>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {uploads.map((upload: any) => (
                      <div key={upload.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5" data-testid={`upload-history-${upload.id}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold">{upload.symbol}</span>
                            <Badge variant="outline" className={`text-[10px] h-4 rounded-full px-1.5 ${
                              upload.status === 'completed' ? 'border-green-500/30 text-green-400' :
                              upload.status === 'processing' ? 'border-primary/30 text-primary' : 'border-rose-500/30 text-rose-400'
                            }`}>{upload.status}</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{upload.filename}</p>
                        </div>
                        <span className="font-mono text-xs text-primary shrink-0">{(upload.recordCount || 0).toLocaleString()} rows</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            SQL Query Console
          </CardTitle>
          <CardDescription>Execute queries against any database</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <select
              value={queryDb}
              onChange={(e) => setQueryDb(e.target.value as any)}
              className="glass rounded-lg px-4 py-2 text-sm font-mono bg-transparent border border-white/10"
              data-testid="query-db-select"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="questdb">QuestDB</option>
              <option value="duckdb">DuckDB</option>
            </select>
          </div>
          <Textarea
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            placeholder="SELECT * FROM your_table LIMIT 10;"
            className="font-mono text-sm min-h-[100px] glass"
            data-testid="query-input"
          />
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              {queryDb === "questdb" && "Tip: Use SAMPLE BY 1h for time aggregation"}
              {queryDb === "duckdb" && "Tip: Query Parquet files directly with read_parquet()"}
              {queryDb === "postgres" && "Tip: Query metadata tables for instrument info"}
            </p>
            <Button
              onClick={() => runQueryMutation.mutate({ db: queryDb, sql: customQuery })}
              disabled={!customQuery.trim() || runQueryMutation.isPending}
              data-testid="run-query"
            >
              {runQueryMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Query
            </Button>
          </div>
        </CardContent>
      </Card>

      {previewTable && (
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-mono">{previewTable}</CardTitle>
              <CardDescription>Preview (first 100 rows)</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewTable(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            {previewLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <pre className="text-xs font-mono text-muted-foreground">
                  {JSON.stringify(tablePreview, null, 2)}
                </pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
