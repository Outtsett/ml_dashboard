/**
 * MotiveWave Settings & Status Tab
 *
 * SRP: Handles ONLY the MotiveWave integration UI — config, status, imports.
 * Uses motiveWaveApi from apiService for all backend calls.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Square,
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Zap,
  Settings2,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { motiveWaveApi, type MwStatus, type MwImportRecord } from "@/lib/apiService";

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ running, enabled }: { running: boolean; enabled: boolean }) {
  if (running) {
    return (
      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse gap-1">
        <Zap className="h-3 w-3" />
        Watching
      </Badge>
    );
  }
  if (enabled) {
    return (
      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 gap-1">
        <AlertTriangle className="h-3 w-3" />
        Enabled (Stopped)
      </Badge>
    );
  }
  return (
    <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 gap-1">
      <Square className="h-3 w-3" />
      Disabled
    </Badge>
  );
}

// ── Import Row ───────────────────────────────────────────────────────────────

function ImportRow({ record }: { record: MwImportRecord }) {
  const isError = record.status === "error";
  const time = new Date(record.timestamp).toLocaleTimeString();

  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
      isError ? "bg-red-500/5 border border-red-500/10" : "bg-white/[0.02] border border-white/5"
    }`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isError ? (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        )}
        <span className="font-mono truncate">{record.filename}</span>
      </div>
      <div className="flex items-center gap-3 ml-3 shrink-0">
        <Badge variant="outline" className="text-[10px] font-mono">
          {record.symbol}
        </Badge>
        <span className="text-muted-foreground text-xs">{record.timeframe}</span>
        {!isError && (
          <span className="text-emerald-300/80 text-xs font-mono">
            +{record.rowsImported.toLocaleString()} rows
          </span>
        )}
        {record.rowsSkipped > 0 && (
          <span className="text-zinc-500 text-xs font-mono">
            ({record.rowsSkipped} skipped)
          </span>
        )}
        <span className="text-muted-foreground text-xs">{record.durationMs}ms</span>
        <span className="text-muted-foreground text-xs">{time}</span>
      </div>
    </div>
  );
}

// ── Setup Guide ──────────────────────────────────────────────────────────────

function SetupGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="bg-gradient-to-br from-violet-500/5 to-purple-500/5 border-violet-500/20">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-violet-300" />
            MotiveWave Setup Guide
          </CardTitle>
          <Button variant="ghost" size="sm" className="text-xs text-violet-300">
            {expanded ? "Collapse" : "Show Steps"}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="text-sm space-y-3 text-muted-foreground">
          <p className="text-violet-200 font-medium">Configure MotiveWave Auto-Export to stream data to the dashboard:</p>
          <ol className="list-decimal list-inside space-y-2 pl-2">
            <li>
              Open MotiveWave → <span className="text-white/80">Configure → Settings → Historical Data</span>
            </li>
            <li>
              Click the <span className="text-white/80">Data Export</span> tab
            </li>
            <li>
              Click <span className="font-mono text-violet-300">+</span> to create a new Export Group
            </li>
            <li>
              Set Data Format: <span className="font-mono text-xs bg-black/30 px-1.5 py-0.5 rounded">
                CSV – MM/dd/yyyy HH:mm:ss, O, H, L, C, V
              </span>
            </li>
            <li>
              Set the <span className="text-white/80">Export Directory</span> to the watch directory configured below
            </li>
            <li>
              Check <span className="text-white/80">"Auto Export"</span> and set the interval (1–60 seconds)
            </li>
            <li>
              Add the instruments and bar sizes you want to sync
            </li>
            <li>
              Restart MotiveWave to activate auto-export
            </li>
          </ol>
          <p className="text-xs text-zinc-500 mt-3">
            The dashboard watcher will automatically detect new/changed CSV files and ingest them into QuestDB.
            Incremental ingest skips previously-imported rows. QuestDB deduplication prevents duplicate data.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function MotiveWaveTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Local form state for pending changes
  const [localWatchDir, setLocalWatchDir] = useState<string | null>(null);
  const [localDebounce, setLocalDebounce] = useState<number | null>(null);

  const { data: status, isLoading, refetch } = useQuery<MwStatus>({
    queryKey: ["/api/motivewave/status"],
    queryFn: motiveWaveApi.getStatus,
    refetchInterval: 5_000, // poll every 5s for live status updates
  });

  const configureMutation = useMutation({
    mutationFn: motiveWaveApi.configure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/motivewave/status"] });
      toast({ title: "Configuration saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Config failed", description: err.message, variant: "destructive" });
    },
  });

  const startMutation = useMutation({
    mutationFn: motiveWaveApi.start,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/motivewave/status"] });
      toast({ title: "Watcher started" });
    },
    onError: (err: Error) => {
      toast({ title: "Start failed", description: err.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: motiveWaveApi.stop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/motivewave/status"] });
      toast({ title: "Watcher stopped" });
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ filePath, symbol }: { filePath: string; symbol?: string }) =>
      motiveWaveApi.importPath(filePath, symbol),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/motivewave/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/databases/questdb/stats"] });
      toast({ title: "Import complete", description: `${data.rowsImported} rows imported` });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleBrowse = useCallback(async () => {
    // Use Electron file dialog if available, otherwise fall back to prompt
    if (window.electronAPI?.showOpenDialog) {
      const result = await window.electronAPI.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select MotiveWave Export Directory",
      });
      if (!result.canceled && result.filePaths[0]) {
        setLocalWatchDir(result.filePaths[0]);
      }
    } else {
      const dir = prompt("Enter the MotiveWave export directory path:");
      if (dir) setLocalWatchDir(dir);
    }
  }, []);

  const handleImportFile = useCallback(async () => {
    if (window.electronAPI?.showOpenDialog) {
      const result = await window.electronAPI.showOpenDialog({
        properties: ["openFile"],
        title: "Select MotiveWave CSV to Import",
        filters: [{ name: "CSV Files", extensions: ["csv", "txt"] }],
      });
      if (!result.canceled && result.filePaths[0]) {
        importMutation.mutate({ filePath: result.filePaths[0] });
      }
    } else {
      const path = prompt("Enter the file path to import:");
      if (path) importMutation.mutate({ filePath: path });
    }
  }, [importMutation]);

  const handleSaveConfig = useCallback(() => {
    const update: Record<string, any> = {};
    if (localWatchDir !== null) update.watchDir = localWatchDir;
    if (localDebounce !== null) update.debounceMs = localDebounce;
    configureMutation.mutate(update);
    setLocalWatchDir(null);
    setLocalDebounce(null);
  }, [localWatchDir, localDebounce, configureMutation]);

  const handleToggleAutoStart = useCallback((checked: boolean) => {
    configureMutation.mutate({ autoStart: checked });
  }, [configureMutation]);

  const handleToggleEnabled = useCallback((checked: boolean) => {
    configureMutation.mutate({ enabled: checked });
  }, [configureMutation]);

  // ── Derived values ──────────────────────────────────────────────────────

  const config = status?.config;
  const running = status?.running ?? false;
  const watchDir = localWatchDir ?? config?.watchDir ?? "";
  const debounceMs = localDebounce ?? config?.debounceMs ?? 200;
  const hasUnsavedChanges = localWatchDir !== null || localDebounce !== null;
  const imports = status?.recentImports ?? [];
  const successCount = imports.filter(r => r.status === "success").length;
  const errorCount = imports.filter(r => r.status === "error").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading MotiveWave status…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Status & Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-semibold">MotiveWave Live Sync</h2>
          <p className="text-sm text-muted-foreground">
            Auto-import CSV exports from MotiveWave into QuestDB
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge running={running} enabled={config?.enabled ?? false} />
          {running ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="border-red-500/30 text-red-300 hover:bg-red-500/10"
            >
              <Square className="h-4 w-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !config?.watchDir}
              className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
            >
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Setup Guide */}
      <SetupGuide />

      {/* Configuration Card */}
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-cyan-300" />
            Watcher Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Watch Directory */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Watch Directory</Label>
            <div className="flex gap-2">
              <Input
                value={watchDir}
                onChange={e => setLocalWatchDir(e.target.value)}
                placeholder="C:\Users\tyler\MotiveWave Exports"
                className="font-mono text-sm bg-black/30 border-white/10"
              />
              <Button variant="outline" size="sm" onClick={handleBrowse} className="shrink-0">
                <FolderOpen className="h-4 w-4 mr-1" />
                Browse
              </Button>
            </div>
          </div>

          {/* Debounce Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Debounce Delay</Label>
              <span className="text-xs font-mono text-cyan-300">{debounceMs}ms</span>
            </div>
            <Slider
              value={[debounceMs]}
              onValueChange={([v]) => setLocalDebounce(v ?? debounceMs)}
              min={50}
              max={2000}
              step={50}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground">
              Wait this long after a file change before importing (handles MotiveWave incremental writes)
            </p>
          </div>

          {/* Toggles Row */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={config?.enabled ?? false}
                onCheckedChange={handleToggleEnabled}
              />
              <Label className="text-xs">Enabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={config?.autoStart ?? false}
                onCheckedChange={handleToggleAutoStart}
              />
              <Label className="text-xs">Auto-Start on Launch</Label>
            </div>
          </div>

          {/* Save Changes */}
          {hasUnsavedChanges && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setLocalWatchDir(null); setLocalDebounce(null); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveConfig}
                disabled={configureMutation.isPending}
                className="bg-cyan-600 hover:bg-cyan-500"
              >
                Save Changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="bg-black/20 border-white/10">
          <CardContent className="py-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tracked Files</div>
            <div className="text-2xl font-bold text-white/90">{status?.trackedFiles ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardContent className="py-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Imports</div>
            <div className="text-2xl font-bold text-emerald-300">{successCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardContent className="py-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Errors</div>
            <div className="text-2xl font-bold text-red-400">{errorCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-black/20 border-white/10">
          <CardContent className="py-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Debounce</div>
            <div className="text-2xl font-bold text-cyan-300">{config?.debounceMs ?? 0}ms</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Imports */}
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-300" />
              Recent Imports
              {imports.length > 0 && (
                <Badge variant="outline" className="text-[10px] ml-1">{imports.length}</Badge>
              )}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportFile}
              disabled={importMutation.isPending}
              className="text-xs"
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              Import File
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No imports yet. Start the watcher or import a file manually.
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-1.5">
                {[...imports].reverse().map((record, i) => (
                  <ImportRow key={`${record.filename}-${record.timestamp}-${i}`} record={record} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
