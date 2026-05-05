import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import type { DashboardLog } from './dashboardTypes';

// ── Context interface ──────────────────────────────────────────────────────

export interface DashboardLogContextType {
  logs: DashboardLog[];
  addLog: (entry: Omit<DashboardLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

// ── Provider ───────────────────────────────────────────────────────────────

const DashboardLogContext = createContext<DashboardLogContextType | null>(null);

export function DashboardLogProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<DashboardLog[]>([]);
  const logIdRef = useRef(0);

  const addLog = useCallback((entry: Omit<DashboardLog, 'id' | 'timestamp'>) => {
    const log: DashboardLog = {
      ...entry,
      id: `log-${++logIdRef.current}`,
      timestamp: Date.now(),
    };
    setLogs(prev => [log, ...prev].slice(0, 500));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const value = useMemo(() => ({ logs, addLog, clearLogs }), [logs, addLog, clearLogs]);

  return <DashboardLogContext.Provider value={value}>{children}</DashboardLogContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDashboardLogContext(): DashboardLogContextType {
  const ctx = useContext(DashboardLogContext);
  if (!ctx) throw new Error('useDashboardLogContext must be used within DashboardLogProvider');
  return ctx;
}
