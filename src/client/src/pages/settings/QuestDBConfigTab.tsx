import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Database } from "lucide-react";
import { 
  ServerConfig, 
  ConnectionTestResult, 
  ConnectionBadge 
} from "./types";

interface QuestDBConfigTabProps {
  config?: ServerConfig;
  connectionTestMutation: any; // ReturnType of useMutation
}

export function QuestDBConfigTab({
  config,
  connectionTestMutation,
}: QuestDBConfigTabProps) {
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
