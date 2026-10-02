import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/infrastructure/api/query_client";
import { useToast } from "@/shared/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { 
  Loader2, 
  RefreshCw, 
  Database, 
  Trash2 
} from "lucide-react";

export function ServerStatusTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const restartLake = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lake/restart");
      if (!res.ok) throw new Error("Failed to Restart Lake");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Lake Restarted", description: data.message || "Lake Service restarted successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Restart failed", description: err.message, variant: "destructive" });
    }
  });

  const runMaintenance = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lake/maintenance");
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
              <h4 className="text-sm font-medium">Restart Lake Service</h4>
              <p className="text-xs text-muted-foreground">Issues a fast restart to the underlying Lake Windows service via nssm.</p>
            </div>
            <Button onClick={() => restartLake.mutate()} disabled={restartLake.isPending} variant="outline">
              {restartLake.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2 text-blue-500" />}
              Restart Lake
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Run Daily Maintenance</h4>
              <p className="text-xs text-muted-foreground">Runs daily health checks and cleanup tasks.</p>
            </div>
            <Button onClick={() => runMaintenance.mutate()} disabled={runMaintenance.isPending} variant="outline">
              {runMaintenance.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2 text-[hsl(var(--data-pos))]" />}
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

