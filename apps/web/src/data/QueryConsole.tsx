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
        <CardDescription>
          Runs one read-only statement on the lake (DuckDB) or on SQLite and shows the rows it returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          <select
            value={queryDb}
            onChange={(e) => onQueryDbChange(e.target.value as "lake" | "sqlite")}
            className="glass rounded-lg px-4 py-2 text-sm font-mono bg-transparent border border-white/10"
            data-testid="query-db-select"
          >
            <option value="lake" className="bg-slate-900">Lake (DuckDB)</option>
            <option value="sqlite" className="bg-slate-900">SQLite (the dashboard's own record)</option>
          </select>
        </div>
        <Textarea
          value={customQuery}
          onChange={(e) => onCustomQueryChange(e.target.value)}
          placeholder="SELECT * FROM bars WHERE symbol = 'MNQ' LIMIT 10"
          className="font-mono text-sm min-h-[100px] glass"
          data-testid="query-input"
        />
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            {queryDb === "lake" &&
              "The server accepts a statement that starts with SELECT, WITH, SHOW or EXPLAIN and refuses the rest. At most 1,000 rows come back; scope a lake query to one symbol."}
            {queryDb === "sqlite" &&
              "The server accepts a statement that starts with SELECT, WITH, SHOW or EXPLAIN and refuses the rest. It adds a limit of 1,000 rows, so leave LIMIT off the statement."}
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

