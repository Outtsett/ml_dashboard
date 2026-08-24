import { useGpuMetrics } from "@/system/lib/useGpuMetrics";
import { useSystemManifest } from "@/system/lib/useSystemManifest";
import { Activity, Cpu, HardDrive } from "lucide-react";

function statusColor(value: number, thresholds: [number, number] = [50, 80]): string {
  if (value < thresholds[0]) return "#10b981"; // Emerald-500
  if (value < thresholds[1]) return "#3b82f6"; // Blue-500 (Institutional)
  return "#ef4444"; // Red-500
}

function MiniGauge({ value, max, color, label }: {
  value: number; max: number; color: string; label: string;
}) {
  const size = 28;
  const r = 11;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct * 0.5); 
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: size, height: size / 2 + 6 }}>
        <svg width={size} height={size} className="transform rotate-[180deg]" style={{ marginTop: -size / 2 + 6 }}>
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={2.5}
            strokeDasharray={`${circumference * 0.5} ${circumference * 0.5}`}
            strokeLinecap="round"
          />
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeDasharray={`${circumference * 0.5} ${circumference * 0.5}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center">        
          <span className="text-[9px] font-mono font-bold opacity-80" style={{ color }}>
            {Math.round(value)}
          </span>
        </div>
      </div>
      <span className="text-[7px] text-muted-foreground uppercase tracking-tighter opacity-50">{label}</span>
    </div>
  );
}

export const SystemStats = ({ collapsed }: { collapsed: boolean }) => {
  const { current: gpu } = useGpuMetrics();
  const { data: manifest } = useSystemManifest();

  if (collapsed) return null;

  const gpuUtil = gpu?.utilizationGpu ?? 0;
  const cpuThreads = manifest?.hardware?.threads ?? 0;
  const ramUsed = manifest ? manifest.hardware.total_ram_gb - manifest.hardware.free_ram_gb : 0;
  const ramPct = manifest ? (ramUsed / manifest.hardware.total_ram_gb) * 100 : 0;
  
  const diskFree = manifest?.infrastructure?.storage?.free_gb ?? 0;
  const diskPct = Math.max(0, 100 - (diskFree / 2000 * 100)); // Assuming 2TB drive for visualization

  return (
    <div className="p-1.5 space-y-1.5 border-t border-white/5">
      {/* GPU Block */}
      <div className="bg-white/[0.02] rounded-lg p-2 space-y-1.5 border border-white/[0.03]">
        <div className="flex items-center justify-between opacity-60">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-primary/80" />
            <span className="text-[8px] font-black uppercase tracking-widest">NVIDIA GPU</span>
          </div>
          <span className="text-[8px] font-mono font-bold">{gpu?.temperatureC ?? '--'}°C</span>
        </div>
        <div className="flex items-end justify-around">
          <MiniGauge value={gpuUtil} max={100} color={statusColor(gpuUtil)} label="Load" />
          <MiniGauge value={gpu?.memoryUsedPct ?? 0} max={100} color={statusColor(gpu?.memoryUsedPct ?? 0, [50, 75])} label="VRAM" />
        </div>
      </div>

      {/* CPU / RAM Block */}
      <div className="bg-white/[0.02] rounded-lg p-2 space-y-1.5 border border-white/[0.03]">
        <div className="flex items-center justify-between opacity-60">
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-emerald-400/80" />
            <span className="text-[8px] font-black uppercase tracking-widest">System Load</span>
          </div>
          <span className="text-[8px] font-mono font-bold">{cpuThreads}T</span>
        </div>
        <div className="flex items-end justify-around">
          <MiniGauge value={manifest?.hardware?.load_avg?.[0] ? (manifest.hardware.load_avg[0] / cpuThreads * 100) : 0} max={100} color={statusColor(50)} label="CPU" />
          <MiniGauge value={ramPct} max={100} color={statusColor(ramPct, [60, 85])} label="RAM" />
        </div>
      </div>

      {/* Storage Block */}
      <div className="bg-white/[0.02] rounded-lg p-2 space-y-1.5 border border-white/[0.03]">
        <div className="flex items-center justify-between opacity-60">
          <div className="flex items-center gap-1">
            <HardDrive className="w-3 h-3 text-amber-400/80" />
            <span className="text-[8px] font-black uppercase tracking-widest">Storage</span>
          </div>
          <span className="text-[8px] font-mono font-bold">{diskFree}G</span>
        </div>
        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
           <div className="h-full bg-amber-500/40 rounded-full transition-all duration-1000" style={{ width: `${diskPct}%` }} />
        </div>
      </div>

    </div>
  );
};
