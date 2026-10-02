import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Play, RefreshCw } from "lucide-react";

interface QueryConsoleProps {
  queryDb: "lake" | "sqlite";
  customQuery: string;
  isPending: boolean;
  onQueryDbChange: (db: "lake" | "sqlite") => void;
  onCustomQueryChange: (query: string) => void;
  onRunQuery: () => void;
}

export function QueryConsole({
  queryDb,
  customQuery,
  isPending,
  onQueryDbChange,
  onCustomQueryChange,
  onRunQuery,
}: QueryConsoleProps) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5 text-primary" />
          SQL Query Console
        </CardTitle>
        <CardDescription>Execute queries against any database engine</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          <select
            value={queryDb}
            onChange={(e) => onQueryDbChange(e.target.value as "lake" | "sqlite")}
            className="glass rounded-lg px-4 py-2 text-sm font-mono bg-transparent border border-white/10"
            data-testid="query-db-select"
          >
            <option value="lake" className="bg-slate-900">lake (Speed)</option>
            <option value="sqlite" className="bg-slate-900">SQLite (Metadata)</option>
          </select>
        </div>
        <Textarea
          value={customQuery}
          onChange={(e) => onCustomQueryChange(e.target.value)}
          placeholder="SELECT * FROM your_table LIMIT 10;"
          className="font-mono text-sm min-h-[100px] glass"
          data-testid="query-input"
        />
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            {queryDb === "lake" && "Tip: Use SAMPLE BY for high-frequency data aggregation"}
            {queryDb === "sqlite" && "Tip: Access local development metadata and app config"}
          </p>
          <Button
            onClick={onRunQuery}
            disabled={!customQuery.trim() || isPending}
            data-testid="run-query"
          >
            {isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Query
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

