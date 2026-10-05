import React, { useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { useTrainingHUDStore } from '../store/trainingHUDStore';

export function TrainingHUD() {
  const { nllVariance, confidenceRmse, connect, disconnect, isConnected } = useTrainingHUDStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Institutional Palette:
  // Emerald-500: #10b981
  // Blue-500: #3b82f6
  // Amber-500: #f59e0b
  // Red-500: #ef4444

  return (
    <div className="absolute top-4 right-4 flex flex-col gap-4 text-xs font-mono w-[420px] pointer-events-none z-10">
      
      {/* NLL vs Variance */}
      <div className="bg-black/60 backdrop-blur-md rounded-xl p-4 shadow-xl border border-white/[0.04]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white/80 font-semibold tracking-widest uppercase text-[10px]">Gaussian NLL vs Variance</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#10b981]' : 'bg-[#ef4444]'}`} />
            <span className="text-white/40 text-[9px] font-bold">{isConnected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
        
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={nllVariance} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="epoch" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <RechartsTooltip 
                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                itemStyle={{ fontSize: 11, fontWeight: 500 }}
                labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.7, paddingTop: '10px' }} iconType="circle" iconSize={6} />
              <Line yAxisId="left" type="monotone" dataKey="nll" stroke="#3b82f6" name="NLL" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="variance" stroke="#f59e0b" name="Variance" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Confidence-Stratified RMSE */}
      <div className="bg-black/60 backdrop-blur-md rounded-xl p-4 shadow-xl border border-white/[0.04]">
        <h3 className="text-white/80 font-semibold tracking-widest uppercase text-[10px] mb-4">Confidence-Stratified RMSE</h3>
        
        <div className="h-[160px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={confidenceRmse} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="confidenceBin" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <RechartsTooltip 
                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                itemStyle={{ fontSize: 11, color: '#10b981', fontWeight: 500 }}
                labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              />
              <Bar dataKey="rmse" fill="#10b981" name="RMSE" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
