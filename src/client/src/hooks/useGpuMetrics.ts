import { useState, useCallback, useMemo } from 'react';
import { useSSEConnection } from './useSSEConnection';
import { useQuery } from '@tanstack/react-query';

// ── Types ────────────────────────────────────────────────────

export interface GpuSnapshot {
  name: string;
  temperatureC: number;
  utilizationGpu: number;
  utilizationMemory: number;
  memoryUsedMB: number;
  memoryFreeMB: number;
  memoryTotalMB: number;
  memoryUsedPct: number;
  powerDrawW: number;
  powerLimitW: number;
  fanSpeedPct: number;
  clockGraphicsMHz: number;
  clockMemoryMHz: number;
  timestamp: number;
}

export interface GpuDeviceInfo {
  name: string;
  driverVersion: string;
  cudaVersion: string;
  computeCapability: string;
  memoryTotalMB: number;
  pciBusId: string;
  architecture: string;
}

const MAX_HISTORY = 300; // 10 minutes at 2s intervals

// ── Hook: live GPU metrics via SSE ───────────────────────────

export function useGpuMetrics() {
  const [current, setCurrent] = useState<GpuSnapshot | null>(null);
  const [history, setHistory] = useState<GpuSnapshot[]>([]);

  const handleGpuEvent = useCallback((data: unknown) => {
    const event = data as { data?: GpuSnapshot };
    const snapshot = event.data ?? (data as GpuSnapshot);
    if (!snapshot?.timestamp) return;

    setCurrent(snapshot);
    setHistory((prev) => {
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, []);

  const eventMap = useMemo(() => ({
    'system.gpu': handleGpuEvent,
    'connected': () => {},
  }), [handleGpuEvent]);

  const { connected, error } = useSSEConnection({
    url: '/api/events/system',
    enabled: true,
    eventMap,
  });

  return { current, history, connected, error };
}

// ── Hook: static GPU device info (one-shot fetch) ────────────

export function useGpuDeviceInfo() {
  return useQuery<GpuDeviceInfo>({
    queryKey: ['gpu', 'info'],
    queryFn: async () => {
      const res = await fetch('/api/system/gpu/info');
      if (!res.ok) throw new Error(`GPU info failed: ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1 hour — device info rarely changes
    retry: 2,
  });
}

// ── Hook: on-demand GPU snapshot (REST poll fallback) ─────────

export function useGpuSnapshot() {
  return useQuery<GpuSnapshot>({
    queryKey: ['gpu', 'snapshot'],
    queryFn: async () => {
      const res = await fetch('/api/system/gpu');
      if (!res.ok) throw new Error(`GPU snapshot failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 3000,
    staleTime: 2000,
  });
}
