import { cn } from "@/lib/utils";
import { useGpuSnapshot } from "@/hooks/useGpuMetrics";

function statusColor(value: number, thresholds: [number, number] = [50, 80]): string {
  if (value < thresholds[0]) return "#22c55e";
  if (value < thresholds[1]) return "#f59e0b";
  return "#ef4444";
}

function tempClass(temp: number): string {
  if (temp < 50) return "text-emerald-400";
  if (temp < 70) return "text-amber-400";
  return "text-red-400";
}

/** Mini radial gauge for the sidebar — 40px diameter, 180-degree arc */
function MiniGauge({ value, max, color, label }: {
  value: number; max: number; color: string; label: string;
}) {
  const size = 40;
  const r = 15;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct * 0.5); // 180-degree arc
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: size, height: size / 2 + 8 }}>
        <svg width={size} height={size} className="transform rotate-[180deg]" style={{ marginTop: -size / 2 + 8 }}>
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke="hsl(220, 15%, 15%)"
            strokeWidth={3}
            strokeDasharray={`${circumference * 0.5} ${circumference * 0.5}`}
            strokeLinecap="round"
          />
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeDasharray={`${circumference * 0.5} ${circumference * 0.5}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
            style={{ filter: `drop-shadow(0 0 3px ${color}50)` }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center">
          <span className="text-[10px] font-mono font-bold" style={{ color }}>
            {Math.round(value)}
          </span>
        </div>
      </div>
      <span className="text-[8px] text-muted-foreground uppercase tracking-wider leading-none">{label}</span>
    </div>
  );
}

function GradientBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] text-muted-foreground font-medium">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(1)}%</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: "hsl(220, 15%, 12%)" }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${Math.min(value, 100)}%`,
            background: `linear-gradient(90deg, ${color}60, ${color})`,
            boxShadow: `0 0 6px -1px ${color}40`,
          }}
        />
      </div>
    </div>
  );
}

export const SystemStats = ({ collapsed }: { collapsed: boolean }) => {
  const { data: gpu } = useGpuSnapshot();

  if (collapsed) return null;

  const gpuUtil = gpu?.utilizationGpu ?? 0;
  const vramPct = gpu?.memoryUsedPct ?? 0;
  const temp = gpu?.temperatureC ?? 0;
  const power = gpu?.powerDrawW ?? 0;
  const vramUsed = gpu ? `${(gpu.memoryUsedMB / 1024).toFixed(1)}G` : "--";
  const vramTotal = gpu ? `${(gpu.memoryTotalMB / 1024).toFixed(1)}G` : "--";

  return (
    <div className="p-3 border-t border-border/30">
      <div
        className="glass rounded-lg p-3 space-y-2.5"
        style={{
          boxShadow: gpu ? `0 0 20px -8px ${statusColor(gpuUtil)}15` : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest">GPU</span>
          </div>
          <div className="flex items-center gap-1.5">
            {gpu && (
              <span className={cn("text-[9px] font-mono font-bold", tempClass(temp))}>
                {temp}°C
              </span>
            )}
            {gpu ? (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
            )}
          </div>
        </div>

        {/* Mini gauges row */}
        <div className="flex items-end justify-around">
          <MiniGauge value={gpuUtil} max={100} color={statusColor(gpuUtil)} label="Util" />
          <MiniGauge value={vramPct} max={100} color={statusColor(vramPct, [50, 75])} label="VRAM" />
          <MiniGauge value={power} max={gpu?.powerLimitW ?? 180} color={statusColor(power / (gpu?.powerLimitW ?? 180) * 100, [60, 85])} label="Power" />
        </div>

        {/* VRAM bar */}
        <GradientBar label="VRAM" value={vramPct} color={statusColor(vramPct, [50, 75])} />

        {/* Footer stats */}
        <div className="flex justify-between text-[8px] text-muted-foreground/60 font-mono">
          <span>{vramUsed} / {vramTotal}</span>
          {gpu && <span>{power.toFixed(0)}W</span>}
        </div>
      </div>
    </div>
  );
};
