import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import useSpeedAudit from "@/hooks/useSpeedAudit";
import { SpeedAuditContent } from "@/components/SpeedAuditPanel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  Server,
  FlaskConical,
  BarChart3,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Activity,
  Gauge,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ServerConfig {
  questdb: { host: string; httpPort: number; pgPort: number };
  training: {
    pythonExe: string;
    modelsDir: string;
    maxConcurrentJobs: number;
    maxBarsDefault: number;
    maxTrainingDurationSec: number;
  };
  nodeEnv: string;
  port: number;
}

interface ConnectionTestResult {
  connected: boolean;
  type: string;
  host?: string;
  port?: number;
  error?: string;
  note?: string;
}

type Preferences = Record<string, Record<string, unknown>>;

const AVAILABLE_TIMEFRAMES = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "240", label: "4H" },
  { value: "1440", label: "1D" },
  { value: "10080", label: "1W" },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const speedMetrics = useSpeedAudit();

  const { data: config, isLoading: configLoading } = useQuery<ServerConfig>({
    queryKey: ["/api/settings/config"],
  });

  const { data: preferences } = useQuery<Preferences>({
    queryKey: ["/api/settings"],
  });

  const saveMutation = useMutation({
    mutationFn: async (updates: Array<{ key: string; value: unknown; category?: string }>) => {
      const res = await apiRequest("PUT", "/api/settings", updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Your preferences have been updated." }); 
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });      
    },
  });

  const connectionTestMutation = useMutation({
    mutationFn: async (type: "questdb" | "sqlite") => {
      const res = await apiRequest("POST", "/api/settings/test-connection", { type });        
      return res.json() as Promise<ConnectionTestResult>;
    },
  });

  const savePreference = (key: string, value: unknown, category: string) => {
    saveMutation.mutate([{ key, value, category }]);
  };

  const getPref = (key: string, fallback: unknown = "") => {
    if (!preferences) return fallback;
    for (const cat of Object.values(preferences)) {
      if (key in cat) return cat[key];
    }
    return fallback;
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings2 className="h-6 w-6" />
          Settings & Infrastructure
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage database connections, training configuration, system restart/reloads, and UI preferences.
        </p>
      </div>

      <Tabs defaultValue="database" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="database" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Database
          </TabsTrigger>
          <TabsTrigger value="training" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            Training
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            System
          </TabsTrigger>
          <TabsTrigger value="ui" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            UI
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="database">
          <DatabaseTab
            config={config}
            connectionTestMutation={connectionTestMutation}
          />
        </TabsContent>

        <TabsContent value="training">
          <TrainingTab
            config={config}
            preferences={preferences}
            getPref={getPref}
            savePreference={savePreference}
            saving={saveMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>

        <TabsContent value="ui">
          <UIPreferencesTab
            getPref={getPref}
            savePreference={savePreference}
            saving={saveMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="performance">
          <SpeedAuditContent metrics={speedMetrics} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── System Tab ─────────────────────────────────────────────────────────────

function SystemTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const restartQuestDB = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/questdb/restart");
      if (!res.ok) throw new Error("Failed to restart QuestDB");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "QuestDB Restarted", description: data.message || "QuestDB service restarted successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Restart failed", description: err.message, variant: "destructive" });
    }
  });

  const runMaintenance = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/questdb/maintenance");
      if (!res.ok) throw new Error("Failed to trigger maintenance");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Maintenance Triggered", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Maintenance failed", description: err.message, variant: "destructive" });
    }
  });

  const clearCache = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cache/clear");
      if (!res.ok) throw new Error("Failed to clear cache");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Cache Cleared", description: "In-memory OHLCV cache cleared successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Clear Cache failed", description: err.message, variant: "destructive" });
    }
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Infrastructure Management</CardTitle>
          <CardDescription>Direct control over backend services and pipelines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Restart QuestDB Service</h4>
              <p className="text-xs text-muted-foreground">Issues a fast restart to the underlying QuestDB Windows service via nssm.</p>
            </div>
            <Button onClick={() => restartQuestDB.mutate()} disabled={restartQuestDB.isPending} variant="outline">
              {restartQuestDB.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2 text-blue-500" />}
              Restart QuestDB
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Run Daily Maintenance</h4>
              <p className="text-xs text-muted-foreground">Triggers rollover sync and materialized view refresh.</p>
            </div>
            <Button onClick={() => runMaintenance.mutate()} disabled={runMaintenance.isPending} variant="outline">
              {runMaintenance.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2 text-emerald-500" />}
              Run Maintenance
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Clear OHLCV Cache</h4>
              <p className="text-xs text-muted-foreground">Purges the in-memory Node.js cache, forcing fresh queries from the database.</p>
            </div>
            <Button onClick={() => clearCache.mutate()} disabled={clearCache.isPending} variant="outline">
              {clearCache.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2 text-amber-500" />}
              Clear Cache
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Database Tab ───────────────────────────────────────────────────────────

function DatabaseTab({
  config,
  connectionTestMutation,
}: {
  config?: ServerConfig;
  connectionTestMutation: ReturnType<typeof useMutation<ConnectionTestResult, Error, "questdb" | "sqlite">>;
}) {
  const [questdbResult, setQuestdbResult] = useState<ConnectionTestResult | null>(null);      
  const [sqliteResult, setSqliteResult] = useState<ConnectionTestResult | null>(null);        

  const testConnection = async (type: "questdb" | "sqlite") => {
    try {
      const result = await connectionTestMutation.mutateAsync(type);
      if (type === "questdb") setQuestdbResult(result);
      else setSqliteResult(result);
    } catch {
      const failed = { connected: false, type, error: "Request failed" };
      if (type === "questdb") setQuestdbResult(failed);
      else setSqliteResult(failed);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">QuestDB Connection</CardTitle>
              <CardDescription>Time-series database for market data storage</CardDescription> 
            </div>
            <ConnectionBadge result={questdbResult} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Host</Label>
              <Input value={config?.questdb.host ?? "localhost"} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>HTTP Port</Label>
              <Input value={config?.questdb.httpPort ?? 9000} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>PG Wire Port</Label>
              <Input value={config?.questdb.pgPort ?? 8812} readOnly className="bg-muted" />  
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Connection settings are configured via environment variables (QUESTDB_HOST, QUESTDB_HTTP_PORT, QUESTDB_PG_PORT).
          </p>
          <Separator />
          <Button
            onClick={() => testConnection("questdb")}
            disabled={connectionTestMutation.isPending}
            variant="outline"
            size="sm"
          >
            {connectionTestMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Database className="h-4 w-4 mr-2" />
            )}
            Test Connection
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">SQLite Database</CardTitle>
              <CardDescription>Local database for preferences, models, and training metadata</CardDescription>
            </div>
            <ConnectionBadge result={sqliteResult} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Database Path</Label>
            <Input value="ml_dashboard.db" readOnly className="bg-muted" />
          </div>
          <p className="text-xs text-muted-foreground">
            SQLite database is co-located with the server in the project root.
          </p>
          <Separator />
          <Button
            onClick={() => testConnection("sqlite")}
            disabled={connectionTestMutation.isPending}
            variant="outline"
            size="sm"
          >
            {connectionTestMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Database className="h-4 w-4 mr-2" />
            )}
            Test Connection
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Training Tab ───────────────────────────────────────────────────────────

function TrainingTab({
  config,
  preferences,
  getPref,
  savePreference,
  saving,
}: {
  config?: ServerConfig;
  preferences?: Preferences;
  getPref: (key: string, fallback?: unknown) => unknown;
  savePreference: (key: string, value: unknown, category: string) => void;
  saving: boolean;
}) {
  const training = config?.training;
  const [pythonExe, setPythonExe] = useState("");
  const [maxJobs, setMaxJobs] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !training) return;
    setPythonExe((getPref("training.pythonExe", training.pythonExe) as string) || training.pythonExe);
    setMaxJobs(String(getPref("training.maxConcurrentJobs", training.maxConcurrentJobs) ?? training.maxConcurrentJobs));
    setMaxDuration(String(getPref("training.maxDurationSec", training.maxTrainingDurationSec) ?? training.maxTrainingDurationSec));
    const savedTf = getPref("training.defaultTimeframes", []) as string[];
    setSelectedTimeframes(savedTf.length > 0 ? savedTf : ["5", "15", "60", "240"]);
    setInitialized(true);
  }, [training, initialized, getPref]);

  const toggleTimeframe = (value: string) => {
    setSelectedTimeframes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleSave = () => {
    savePreference("training.pythonExe", pythonExe, "training");
    savePreference("training.maxConcurrentJobs", parseInt(maxJobs) || 1, "training");
    savePreference("training.maxDurationSec", parseInt(maxDuration) || 7200, "training");     
    savePreference("training.defaultTimeframes", selectedTimeframes, "training");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Training Configuration</CardTitle>
        <CardDescription>
          Configure Python environment and training job limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="pythonExe">Python Executable Path</Label>
          <Input
            id="pythonExe"
            value={pythonExe}
            onChange={(e) => setPythonExe(e.target.value)}
            placeholder=".venv/Scripts/python.exe"
          />
          <p className="text-xs text-muted-foreground">
            Path to the Python interpreter used for training scripts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="maxJobs">Max Concurrent Jobs</Label>
            <Input
              id="maxJobs"
              type="number"
              min={1}
              max={16}
              value={maxJobs}
              onChange={(e) => setMaxJobs(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxDuration">Max Training Duration (seconds)</Label>
            <Input
              id="maxDuration"
              type="number"
              min={60}
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Default Timeframes</Label>
          <div className="flex flex-wrap gap-3">
            {AVAILABLE_TIMEFRAMES.map((tf) => (
              <div key={tf.value} className="flex items-center gap-2">
                <Checkbox
                  id={`tf-${tf.value}`}
                  checked={selectedTimeframes.includes(tf.value)}
                  onCheckedChange={() => toggleTimeframe(tf.value)}
                />
                <Label htmlFor={`tf-${tf.value}`} className="text-sm font-normal cursor-pointer">
                  {tf.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Training Settings
          </Button>
          {training && (
            <span className="text-xs text-muted-foreground">
              Server default: {training.maxConcurrentJobs} job(s), {training.maxTrainingDurationSec}s max
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── UI Preferences Tab ─────────────────────────────────────────────────────

function UIPreferencesTab({
  getPref,
  savePreference,
  saving,
}: {
  getPref: (key: string, fallback?: unknown) => unknown;
  savePreference: (key: string, value: unknown, category: string) => void;
  saving: boolean;
}) {
  const [theme, setTheme] = useState((getPref("ui.theme", "dark") as string) || "dark");      
  const [defaultTimeframe, setDefaultTimeframe] = useState(
    (getPref("ui.defaultChartTimeframe", "15") as string) || "15"
  );
  const [refreshInterval, setRefreshInterval] = useState(
    String(getPref("ui.refreshInterval", 30) ?? 30)
  );
  const [notifyTrainingComplete, setNotifyTrainingComplete] = useState(
    (getPref("ui.notifyTrainingComplete", true) as boolean)
  );
  const [notifyConnectionLost, setNotifyConnectionLost] = useState(
    (getPref("ui.notifyConnectionLost", true) as boolean)
  );

  const handleSave = () => {
    savePreference("ui.theme", theme, "ui");
    savePreference("ui.defaultChartTimeframe", defaultTimeframe, "ui");
    savePreference("ui.refreshInterval", parseInt(refreshInterval) || 30, "ui");
    savePreference("ui.notifyTrainingComplete", notifyTrainingComplete, "ui");
    savePreference("ui.notifyConnectionLost", notifyConnectionLost, "ui");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">UI Preferences</CardTitle>
        <CardDescription>Customize the dashboard appearance and behavior.</CardDescription>   
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Chart Timeframe</Label>
            <Select value={defaultTimeframe} onValueChange={setDefaultTimeframe}>
              <SelectTrigger>
                <SelectValue placeholder="Select timeframe" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.value} value={tf.value}>
                    {tf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="refreshInterval">Data Refresh Interval (seconds)</Label>
          <Input
            id="refreshInterval"
            type="number"
            min={5}
            max={300}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            How often to auto-refresh market data and training status. Set 0 to disable.      
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <Label className="text-sm font-medium">Notifications</Label>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal">Training Complete</Label>
              <p className="text-xs text-muted-foreground">
                Show a notification when a training job finishes.
              </p>
            </div>
            <Switch checked={notifyTrainingComplete} onCheckedChange={setNotifyTrainingComplete} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal">Connection Lost</Label>
              <p className="text-xs text-muted-foreground">
                Alert when database or server connection is interrupted.
              </p>
            </div>
            <Switch checked={notifyConnectionLost} onCheckedChange={setNotifyConnectionLost} />
          </div>
        </div>

        <Separator />

        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save UI Preferences
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function ConnectionBadge({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return <Badge variant="outline">Not tested</Badge>;

  return result.connected ? (
    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 gap-1">
      <CheckCircle2 className="h-3 w-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      {result.error || "Failed"}
    </Badge>
  );
}
