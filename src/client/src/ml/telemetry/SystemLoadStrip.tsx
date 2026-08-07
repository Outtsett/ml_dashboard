/**
 * SystemLoadStrip — GPU and CPU load, live.
 *
 * Composes LoadGauge over the two system SSE channels. Both arrive on the same
 * endpoint (`/api/events/system`): `system.gpu` from nvidia-smi polling and
 * `system.matrix` for host CPU and memory.
 *
 * Renders nothing until a snapshot arrives. Zeroed gauges before the first
 * event would read as "idle hardware", which is a claim, not an absence.
 */

import { useMemo } from "react";
import { useGpuMetrics } from "@/system/lib/useGpuMetrics";
import { useSystemMatrix } from "@/system/lib/useSystemMatrix";
import { LoadGauge } from "./LoadGauge";

function gigabytes(mb: number): string {
  return (mb / 1024).toFixed(1);
}

export function SystemLoadStrip({ className = "" }: { className?: string }) {
  const { current: gpu, history: gpuHistory } = useGpuMetrics();
  const { current: system, history: systemHistory } = useSystemMatrix();

  const gpuTrail = useMemo(
    () => gpuHistory.map((s) => s.utilizationGpu),
    [gpuHistory],
  );
  const vramTrail = useMemo(
    () => gpuHistory.map((s) => s.memoryUsedPct),
    [gpuHistory],
  );
  const cpuTrail = useMemo(() => systemHistory.map((s) => s.cpu.load), [systemHistory]);

  if (!gpu && !system) return null;

  return (
    <div
      className={`flex items-center gap-5 overflow-x-auto scrollbar-hidden px-3 py-2 rounded-lg surface-sunken shrink-0 ${className}`}
      aria-label="System load"
    >
      {gpu && (
        <>
          <LoadGauge
            label="GPU"
            value={gpu.utilizationGpu}
            history={gpuTrail}
            detail={`${gpu.temperatureC.toFixed(0)} °C · ${gpu.powerDrawW.toFixed(0)} W`}
          />
          <LoadGauge
            label="VRAM"
            value={gpu.memoryUsedPct}
            history={vramTrail}
            detail={`${gigabytes(gpu.memoryUsedMB)} / ${gigabytes(gpu.memoryTotalMB)} GB`}
          />
        </>
      )}

      {system && (
        <LoadGauge
          label="CPU"
          value={system.cpu.load}
          history={cpuTrail}
          detail={
            system.cpu.temp > 0
              ? `${system.cpu.temp.toFixed(0)} °C · ${system.cpu.cores.length} cores`
              : `${system.cpu.cores.length} cores`
          }
        />
      )}
    </div>
  );
}
