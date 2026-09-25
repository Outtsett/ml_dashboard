import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Activity, TrendingUp } from 'lucide-react';
import { useTrainingContext, useTrainingLogs } from '@/training/lib/TrainingContext';
import { useDashboard } from '@/shared/contexts/UnifiedDashboardContext';
import { LoggingTerminal, LogEntry } from '@/shared/quant-layout/LoggingTerminal';
import { useWebSocketMetrics } from '@/hooks/useWebSocketMetrics';
import { LossSurface3D } from '@/shared/quant-layout/LossSurface3D';

export default function LiveExecutionPage() {
  const training = useTrainingContext();
  const { logs } = useTrainingLogs();
  const dashboard = useDashboard();
  
  const [stats, setStats] = useState({ trades: 0, wins: 0, pnl: 0 });

  useEffect(() => {
    if (!training.isTraining || !training.overlayData) return;
    
    // Auto-sync predictions to chart
    if (training.overlayData.overlayType === 'prediction_markers') {
       const markers = training.overlayData.payload as Array<{ profit?: number }>;
       if (Array.isArray(markers)) {
          dashboard.setPredictionMarkers(markers as unknown as Parameters<typeof dashboard.setPredictionMarkers>[0]);
          // Update stats based on received markers
          setStats(() => ({
            trades: markers.length,
            wins: markers.filter(m => (m.profit ?? 0) > 0).length,
            pnl: markers.reduce((sum, m) => sum + (m.profit || 0), 0)
          }));
       }
    }
  }, [training.overlayData, training.isTraining, dashboard]);

  // Convert raw string logs to LogEntry format for the terminal
  const terminalLogs: LogEntry[] = useMemo(() => {
    return logs.map((log, idx) => {
      let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
      if (log.includes('[ERROR]') || log.toLowerCase().includes('traceback')) level = 'error';
      else if (log.includes('[WARN]')) level = 'warn';
      else if (log.includes('[DEBUG]')) level = 'debug';

      return {
        id: String(idx),
        timestamp: new Date().toISOString(),
        level,
        message: log
      };
    });
  }, [logs]);

  // Highlight the data range being trained on natively on the chart
  useEffect(() => {
    if (training.isTraining && training.dataRange) {
       dashboard.setHighlightRange({
          start: new Date(training.dataRange.start).getTime() / 1000,
          end: new Date(training.dataRange.end).getTime() / 1000,
          color: 'rgba(59, 130, 246, 0.15)', // Blue tint for training data
          label: 'Active Training Window'
       });
    } else {
       dashboard.setHighlightRange(undefined);
    }
  }, [training.isTraining, training.dataRange, dashboard]);

  const { metrics } = useWebSocketMetrics();

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Execution Terminal</h1>
          <p className="text-sm text-muted-foreground">Probabilistic Inference Stream</p>
        </div>
        <Badge variant={training.isTraining ? 'default' : 'secondary'} className={training.isTraining ? "animate-pulse bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : ""}>
          {training.isTraining ? 'LIVE STREAMING' : 'IDLE'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 shrink-0">
        <Card className="bg-black/40 border-white/10 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Expected Net Profit</CardTitle>
            <TrendingUp className="h-3 w-3 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold text-emerald-500">
              ${stats.pnl.toFixed(2)}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Accumulated OOS
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-black/40 border-white/10 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Current Loss</CardTitle>
            <Activity className="h-3 w-3 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold text-blue-500">
              {metrics.loss.toFixed(4)}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Gaussian NLL
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-h-0 flex flex-col 2xl:flex-row gap-4 pt-2">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <LoggingTerminal logs={terminalLogs} title="Training & Execution Logs" />
        </div>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold mb-2 pl-1">
            3D Loss Surface
          </div>
          <div className="flex-1 min-h-0">
            <LossSurface3D currentLoss={metrics.loss} />
          </div>
        </div>
      </div>
    </div>
  );
}
