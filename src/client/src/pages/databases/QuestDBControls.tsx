import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Power, RefreshCw, Activity, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export function QuestDBControls() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRestarting, setIsRestarting] = useState(false);

  const restartMutation = useMutation({
    mutationFn: async () => {
      setIsRestarting(true);
      const res = await fetch("/api/questdb/restart", { method: "POST" });
      if (!res.ok) throw new Error("Restart request failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "QuestDB Restarted", description: data.message });
      } else {
        toast({ title: "Restart Incomplete", description: data.message, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/databases/questdb/stats"] });
      setTimeout(() => setIsRestarting(false), 2000);
    },
    onError: (err: Error) => {
      toast({ title: "Restart Failed", description: err.message, variant: "destructive" });
      setIsRestarting(false);
    }
  });

  const maintenanceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/questdb/maintenance", { method: "POST" });
      if (!res.ok) throw new Error("Maintenance request failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Maintenance Triggered", description: "Syncing rollovers and checking views..." });
    },
    onError: (err: Error) => {
      toast({ title: "Maintenance Failed", description: err.message, variant: "destructive" });
    }
  });

  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Institutional Operations
        </CardTitle>
        <CardDescription>Automated lifecycle and maintenance controls</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-4">
        <Button 
          variant="outline" 
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          onClick={() => restartMutation.mutate()}
          disabled={isRestarting}
        >
          <Power className={`h-4 w-4 mr-2 ${isRestarting ? "animate-pulse" : ""}`} />
          {isRestarting ? "Restarting..." : "Force Restart"}
        </Button>

        <Button 
          variant="outline" 
          className="border-primary/30"
          onClick={() => maintenanceMutation.mutate()}
          disabled={maintenanceMutation.isPending}
        >
          <Activity className={`h-4 w-4 mr-2 ${maintenanceMutation.isPending ? "animate-spin" : ""}`} />
          Sync Rollovers
        </Button>

        <Button 
          variant="outline"
          className="border-accent/30"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/databases/questdb/stats"] })}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Verify Health
        </Button>
      </CardContent>
    </Card>
  );
}
