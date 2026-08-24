import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/infrastructure/api/query_client";
import useSpeedAudit from "@/system/lib/useSpeedAudit";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { useToast } from "@/shared/hooks/use-toast";
import {
  Database,
  Server,
  FlaskConical,
  Settings2,
  Loader2,
  Activity,
  Gauge,
  Monitor,
} from "lucide-react";

import {
  QuestDBConfigTab,
  TrainingSettingsTab,
  ServerStatusTab,
  PreferencesTab,
  PerformanceTab,
  DesktopTab,
  ServerConfig,
  Preferences,
  ConnectionTestResult,
} from "./settings/index";

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
          <TabsTrigger value="desktop" className="gap-1.5">
            <Monitor className="h-3.5 w-3.5" />
            Desktop
          </TabsTrigger>
        </TabsList>

        <TabsContent value="database">
          <QuestDBConfigTab
            config={config}
            connectionTestMutation={connectionTestMutation}
          />
        </TabsContent>

        <TabsContent value="training">
          <TrainingSettingsTab
            config={config}
            preferences={preferences}
            getPref={getPref}
            savePreference={savePreference}
            saving={saveMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="system">
          <ServerStatusTab />
        </TabsContent>

        <TabsContent value="ui">
          <PreferencesTab
            getPref={getPref}
            savePreference={savePreference}
            saving={saveMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab metrics={speedMetrics} />
        </TabsContent>

        <TabsContent value="desktop">
          <DesktopTab
            getPref={getPref}
            savePreference={savePreference}
            saving={saveMutation.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
