import { useState, useCallback, useMemo } from 'react';
import { useSSEConnection } from "@/infrastructure/lib/useSSEConnection";

export interface SystemSnapshot {
  cpu: {
    load: number;
    cores: number[];
    temp: number;
    speed: number;
  };
  mem: {
    total: number;
    active: number;
    used: number;
    swaptotal: number;
    swapused: number;
  };
  network: {
    tx_sec: number;
    rx_sec: number;
  };
  processes?: Array<{
    pid: number;
    name: string;
    cpu: number;
    mem: number;
  }>;
  timestamp: number;
}

const MAX_HISTORY = 300;

export function useSystemMatrix() {
  const [current, setCurrent] = useState<SystemSnapshot | null>(null);
  const [history, setHistory] = useState<SystemSnapshot[]>([]);

  const handleSystemEvent = useCallback((data: unknown) => {
    const event = data as { data?: SystemSnapshot };
    const snapshot = event.data ?? (data as SystemSnapshot);
    if (!snapshot?.timestamp) return;

    setCurrent(snapshot);
    setHistory((prev) => {
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, []);

  const eventMap = useMemo(() => ({
    'system.matrix': handleSystemEvent,
  }), [handleSystemEvent]);

  const { connected, error } = useSSEConnection({
    url: '/api/events/system',
    enabled: true,
    eventMap,
  });

  return { current, history, connected, error };
}
