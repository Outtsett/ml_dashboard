import React, { memo, useMemo } from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter, ZAxis
} from "recharts";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { Clock, Zap, Target, TrendingUp, ShieldAlert, BarChart3 } from "lucide-react";

const TOOLTIP_STYLE = {
  fontSize: 10,
  fontFamily: "monospace",
  backgroundColor: "rgba(9, 9, 11, 0.95)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "12px",
  backdropFilter: "blur(12px)"
};

export const ClassificationPerformance = memo(({ diagnostics }: { diagnostics: any }) => {
  const { modelStateHistory } = useTrainingModelState();
  const snap = diagnostics || {};
  const metrics = snap.best_metrics || snap.metrics || {};

  // 1. Loss Convergence Curve
  const lossData = useMemo(() => {
    return modelStateHistory.map(h => {
      const s = h.state.snapshot as Record<string, any>;
      return {
        iteration: h.iteration,
        train: s.best_metrics?.train_loss || s.metrics?.train_loss,
        val: s.best_metrics?.val_loss || s.metrics?.val_loss,
      };
    }).filter(d => d.train !== undefined);
  }, [modelStateHistory]);

  // 2. Head Calibration Data (Synthetic for now if not in SSE)
  const calibrationData = [
    { confidence: 0.1, accuracy: 0.12 },
    { confidence: 0.3, accuracy: 0.28 },
    { confidence: 0.5, accuracy: 0.52 },
    { confidence: 0.7, accuracy: 0.74 },
    { confidence: 0.9, accuracy: 0.91 },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Primary Analytics Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Loss Convergence */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6 relative overflow-hidden group hover:bg-white/[0.03] transition-all">
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary/60" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/80">Loss Convergence</h3>
            </div>
            <div className="flex items-center gap-4 text-[9px] font-mono font-bold">
              <span className="flex items-center gap-1.5 text-primary"><div className="w-1.5 h-1.5 rounded-full bg-current" /> TRAIN</span>
              <span className="flex items-center gap-1.5 text-emerald-400"><div className="w-1.5 h-1.5 rounded-full bg-current" /> VAL</span>
            </div>
          </div>
          
          <div className="h-[240px] w-full relative z-10">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={lossData}>
                <defs>
                  <linearGradient id="colorTrain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="iteration" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="train" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTrain)" strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="val" stroke="#10b981" fillOpacity={1} fill="url(#colorVal)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Head Calibration Curve */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6 relative overflow-hidden group hover:bg-white/[0.03] transition-all">
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-400/60" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/80">Calibration Reliability</h3>
            </div>
            <div className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest italic">Expected vs Actual</div>
          </div>
          
          <div className="h-[240px] w-full relative z-10">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calibrationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="confidence" label={{ value: 'Confidence', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#666' }} tick={{fontSize: 9}} />
                <YAxis label={{ value: 'Actual Accuracy', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#666' }} tick={{fontSize: 9}} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                {/* Ideal line */}
                <Line type="linear" dataKey="confidence" stroke="rgba(255,255,255,0.1)" strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                {/* Actual model calibration */}
                <Line type="monotone" dataKey="accuracy" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Secondary Depth Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {/* Head Weights / Contribution */}
         <div className="md:col-span-2 bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <BarChart3 className="w-4 h-4 text-cyan-400/60" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/80">Head Contribution</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
               {[
                 { label: 'Directional', value: 0.65, color: 'bg-primary' },
                 { label: 'Forward', value: 0.25, color: 'bg-emerald-500' },
                 { label: 'Auxiliary', value: 0.10, color: 'bg-amber-500' }
               ].map(h => (
                 <div key={h.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                       <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">{h.label}</span>
                       <span className="text-[10px] font-mono font-black text-foreground/80">{(h.value * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                       <div className={`h-full rounded-full ${h.color}`} style={{ width: `${h.value * 100}%` }} />
                    </div>
                 </div>
               ))}
            </div>
         </div>

         {/* Training Velocity */}
         <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6 flex flex-col justify-center">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/30 mb-2">Training Velocity</div>
            <div className="flex items-baseline gap-2">
               <span className="text-4xl font-mono font-black text-foreground/90 tracking-tighter">
                 {metrics.epoch_time_sec ? (100000 / metrics.epoch_time_sec).toFixed(0) : '--'}
               </span>
               <span className="text-xs font-bold text-muted-foreground/40 uppercase tracking-widest">bars/sec</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[9px] font-mono text-emerald-400/60 uppercase tracking-wider">
               <Clock className="w-3 h-3" /> Peak Saturation Active
            </div>
         </div>
      </div>
    </div>
  );
});
ClassificationPerformance.displayName = "ClassificationPerformance";
