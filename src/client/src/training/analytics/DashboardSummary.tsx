import { useQuery } from "@tanstack/react-query";
import {
  Database, Brain, Zap,
} from "lucide-react";

function useDashboardMetrics() {
  const { data: health } = useQuery({
    queryKey: ['dashboard-summary', 'health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      return res.ok ? res.json() : null;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: cacheStats } = useQuery({
    queryKey: ['dashboard-summary', 'cache'],
    queryFn: async () => {
      const res = await fetch('/api/cache/stats');
      return res.ok ? res.json() : null;
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const { data: dbStats } = useQuery({
    queryKey: ['dashboard-summary', 'db-stats'],
    queryFn: async () => {
      const res = await fetch('/api/questdb/status');
      return res.ok ? res.json() : null;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: instruments } = useQuery({
    queryKey: ['dashboard-summary', 'instruments'],
    queryFn: async () => {
      const res = await fetch('/api/instruments');
      return res.ok ? res.json() as Promise<any[]> : [];
    },
    staleTime: 300000,
  });

  const { data: modelsData } = useQuery({
    queryKey: ['dashboard-summary', 'models'],
    queryFn: async () => {
      const res = await fetch('/api/training/models');
      if (!res.ok) return { models: [] };
      return res.json();
    },
    staleTime: 60000,
  });
  const models = modelsData?.models || [];

  const { data: featureConfig } = useQuery({
    queryKey: ['dashboard-summary', 'features'],
    queryFn: async () => {
      const res = await fetch('/api/training/config');
      if (!res.ok) return null;
      const cfg = await res.json();
      return cfg?.featurePipeline ?? cfg?.features ?? null;
    },
    staleTime: 300000,
  });

  const { data: questdbHealth } = useQuery({
    queryKey: ['dashboard-summary', 'questdb-health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      return res.ok ? res.json() : null;
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  return { health, cacheStats, dbStats, instruments, models, featureConfig, questdbHealth };
}

export function DashboardSummary() {
  const { health, cacheStats, dbStats, instruments, models, featureConfig, questdbHealth } = useDashboardMetrics();

  const modelList = Array.isArray(models) ? models : [];
  const ohlcvCache = cacheStats?.ohlcv;
  const questdbConnected = dbStats?.connected || (questdbHealth?.status === 'ok');

  return (
    <div className="space-y-8 animate-in fade-in duration-1000">
      {/* Ultra-Minimal History HUD */}
      {modelList.length > 0 && (
        <div className="flex flex-wrap gap-4 py-4 border-y border-white/5">
          {modelList.slice(0, 4).map((model: any) => (
            <div key={model.id} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors group cursor-default">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Brain className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] font-black text-foreground/80 uppercase tracking-tighter">{model.id}</div>
                <div className="text-[9px] font-mono text-muted-foreground/40">{model.symbol} Â· {model.quality_score?.toFixed(1)}% Edge</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Institutional Health HUD (Integrated, no cards) */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-cyan-400/60" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">QuestDB</span>
            <span className={`text-[10px] font-bold font-mono ${questdbConnected ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
              {questdbConnected ? 'NOMINAL' : 'DISCONNECTED'}
            </span>
          </div>
          <div className="flex items-center gap-2 border-l border-white/5 pl-8">
            <Zap className="w-3.5 h-3.5 text-amber-400/60" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Cache</span>
            <span className="text-[10px] font-bold font-mono text-foreground/60">
              {ohlcvCache?.hitRate || '0.0%'}
            </span>
          </div>
          <div className="flex items-center gap-2 border-l border-white/5 pl-8 text-muted-foreground/20 italic">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Institutional Grade Pipeline Active</span>
          </div>
        </div>
        
        <div className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-widest animate-pulse">
          Monitoring Live System Entropy...
        </div>
      </div>
    </div>
  );
}
