import { Cpu, Server, Zap } from "lucide-react";

interface DiagnosticsPanelProps {
  metrics: Record<string, number>;
}

export function DiagnosticsPanel({ metrics }: DiagnosticsPanelProps) {
  const queueDepth = metrics["epoch"] || 0;
  const fps = metrics["fps"] || 0;
  const gpuUtil = metrics["gpu_util"] || 0;
  
  // Health calculation
  let healthLabel = "Healthy";
  let healthColor = "text-emerald-500";
  if (queueDepth > 100) {
    healthLabel = "Lagging";
    healthColor = "text-amber-500";
  }
  if (queueDepth > 500) {
    healthLabel = "Critical";
    healthColor = "text-red-500";
  }

  return (
    <div className="flex flex-col bg-zinc-950/50">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-zinc-900/50">
        <span className="text-[10px] font-mono text-indigo-400 font-semibold uppercase tracking-widest">Processing Health</span>
        <span className={"text-[10px] font-mono ml-auto uppercase " + healthColor}>{healthLabel}</span>
      </div>
      <div className="p-3 grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            <Server className="h-3 w-3 text-blue-400" />
            Queue Depth
          </div>
          <div className="text-sm font-mono font-bold text-zinc-200">{queueDepth.toFixed(0)}</div>
        </div>
        <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            <Zap className="h-3 w-3 text-amber-400" />
            Frame Rate
          </div>
          <div className="text-sm font-mono font-bold text-zinc-200">{fps.toFixed(1)} fps</div>
        </div>
        <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            <Cpu className="h-3 w-3 text-purple-400" />
            GPU Util
          </div>
          <div className="text-sm font-mono font-bold text-zinc-200">{gpuUtil.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
