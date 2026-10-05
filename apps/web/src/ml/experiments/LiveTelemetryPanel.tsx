import React from "react";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { Activity, Cpu, HardDrive } from "lucide-react";
import { trendTone, trendToneClass, trendGlyph } from "@/shared/theme/dataColors";
import { ProgressFill } from "@/shared/ui/progress-fill";

export function LiveTelemetryPanel() {
  const { metrics, isConnected } = useWebSocketMetrics();

  if (!isConnected || metrics.status === "idle") {
    return null;
  }

  return (
    <div className="mt-4 p-4 rounded-xl border border-neutral-800 bg-[#111] shadow-inner relative overflow-hidden">
      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-neutral-300 tracking-wide uppercase font-mono">
          <Activity className="h-4 w-4 text-(--color-accent)" />
          Live Telemetry
        </h3>
        <div className="flex gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-neutral-500" />
            <span className={metrics.cpuLoad > 80 ? "text-(--color-data-warn)" : "text-neutral-400"}>
              {metrics.cpuLoad > 80 ? <span aria-hidden="true">! </span> : null}
              CPU {metrics.cpuLoad}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-neutral-500" />
            <span className={metrics.gpuLoad > 50 ? "text-(--color-data-warn)" : "text-neutral-400"}>
              {metrics.gpuLoad > 50 ? <span aria-hidden="true">! </span> : null}
              GPU {metrics.gpuLoad}%
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative z-10">
        {/* Metric Cards */}
        <div className="bg-[#0a0a0a] border border-neutral-800 p-3 rounded-lg flex flex-col justify-between h-[80px]">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Loss</span>
          <span className="font-mono text-lg text-neutral-200">{metrics.loss.toFixed(4)}</span>
        </div>
        <div className="bg-[#0a0a0a] border border-neutral-800 p-3 rounded-lg flex flex-col justify-between h-[80px]">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Reward</span>
          <span className={`font-mono text-lg ${trendToneClass(trendTone(metrics.reward))}`}>
            <span aria-hidden="true">{trendGlyph(trendTone(metrics.reward))} </span>
            {metrics.reward.toFixed(4)}
          </span>
        </div>
        <div className="bg-[#0a0a0a] border border-neutral-800 p-3 rounded-lg flex flex-col justify-between h-[80px]">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">KL Divergence</span>
          <span className="font-mono text-lg text-neutral-200">{metrics.kl.toFixed(4)}</span>
        </div>
        <div className="bg-[#0a0a0a] border border-neutral-800 p-3 rounded-lg flex flex-col justify-between h-[80px]">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Entropy</span>
          <span className="font-mono text-lg text-neutral-200">{metrics.entropy.toFixed(4)}</span>
        </div>
        
        {/* Progress bar spans full width */}
        <div className="col-span-2 md:col-span-4 bg-[#0a0a0a] border border-neutral-800 p-3 rounded-lg mt-1">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Training Progress</span>
            <span className="font-mono text-xs text-neutral-400">{metrics.progress ?? 0}%</span>
          </div>
          <div className="w-full bg-neutral-900 rounded-full h-1 overflow-hidden">
            <ProgressFill value={metrics.progress ?? 0} className="bg-(--color-accent)" durationMs={300} />
          </div>
        </div>
      </div>
    </div>
  );
}
