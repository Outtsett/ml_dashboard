import { cn } from "@/shared/utils/utils";

interface MetricRow {
  label: string;
  value: string;
  target?: string;
}

interface MetricsCardProps {
  title: string;
  metrics: MetricRow[];
  connected?: boolean;
}

export function MetricsCard({ title, metrics, connected }: MetricsCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </h3>
        {connected !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              connected ? "bg-[hsl(var(--data-pos))]" : "bg-neutral-500"
            )} />
            <span className="text-[10px] font-mono text-muted-foreground">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">{m.label}</span>
            <div className="flex items-center gap-2">
              <span className={cn("tabular-nums", m.value === "---" && "text-muted-foreground/30")}>
                {m.value}
              </span>
              {m.target && (
                <span className="text-[10px] text-muted-foreground/50">{m.target}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
