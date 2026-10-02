import { Card, CardContent } from "@/shared/ui/card";
import { Database, BarChart3, RefreshCw } from "lucide-react";
import type { DatabaseStats } from "@/shared/utils/types";
import { formatNumber } from "@/shared/utils/types";

interface StatsCardsProps {
  stats: DatabaseStats | undefined;
  loading: boolean;
  dbName: string;
}

export function StatsCards({ stats, loading, dbName }: StatsCardsProps) {
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
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-[hsl(var(--data-pos)/0.2)] to-accent/20 flex items-center justify-center">
            <div className="h-3 w-3 rounded-full bg-[hsl(var(--data-pos))] pulse-slow" />
          </div>
          <div>
            <p className="text-lg font-display font-bold text-[hsl(var(--data-pos))]">Connected</p>
            <p className="text-xs text-muted-foreground">Status</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
