import { Database } from "lucide-react";
import { PageShell } from "@/backtest/components/PageShell";

export default function DatabasesPage() {
  return (
    <PageShell
      title="Data & Databases"
      subtitle="TimescaleDB & PostgreSQL Administration via pgAdmin. All legacy Iceberg/DuckDB tables have been retired."
      icon={Database}
    >
      <div className="flex-1 w-full h-full min-h-0 flex flex-col bg-neutral-950 rounded-lg border border-white/5 overflow-hidden p-1">
        <div className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-white/5 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span><strong>pgAdmin URL:</strong> http://localhost:5050</span>
            <span><strong>Email:</strong> admin@admin.com</span>
            <span><strong>Password:</strong> admin</span>
            <span><strong>TimescaleDB Host:</strong> quant_timescaledb / host.docker.internal</span>
            <span><strong>Port:</strong> 5432 (or 5433 from host)</span>
          </div>
        </div>
        <iframe 
          src="http://localhost:5050" 
          title="pgAdmin"
          className="w-full flex-1 border-none bg-white"
        />
      </div>
    </PageShell>
  );
}
