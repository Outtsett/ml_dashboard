import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface RadialGaugeProps {
  value: number;
  min?: number;
  max: number;
  label: string;
  sublabel?: string;
  color?: string;
  unit?: string;
}

export function RadialGauge({ 
  value, 
  min = 0, 
  max, 
  label, 
  sublabel, 
  color = "#3b82f6", 
  unit = "" 
}: RadialGaugeProps) {
  const clampedValue = Math.min(Math.max(value, min), max);
  const data = [
    { value: clampedValue - min },
    { value: max - clampedValue },
  ];

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-white/[0.01] rounded-2xl relative overflow-hidden group transition-all duration-500">
      <div className="w-full h-32 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="55%" /* Higher ring position to clear space for numbers below */
              startAngle={180}
              endAngle={0}
              innerRadius={48}
              outerRadius={62}
              paddingAngle={0}
              dataKey="value"
              stroke="none"
              isAnimationActive={true}
              animationDuration={1000}
            >
              <Cell 
                fill={color} 
                style={{ 
                  filter: `drop-shadow(0 0 12px ${color}50)`,
                  opacity: 0.85 
                }} 
              />
              <Cell fill="rgba(255,255,255,0.03)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        
        {/* Value Overlay - Centered exactly in the gap created by high cy */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-12">
          <div className="flex items-baseline gap-0.5">
            <span className="text-3xl font-black font-mono tracking-tighter text-foreground group-hover:scale-110 transition-transform duration-500 metric-glow" style={{ color }}>
              {value.toFixed(value < 10 ? 2 : 1)}
            </span>
            <span className="text-xs font-bold text-muted-foreground/60">{unit}</span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40 mt-1 text-center">
            {label}
          </span>
        </div>
      </div>
      
      {sublabel && (
        <div className="text-[8px] font-black text-muted-foreground/20 mt-2 uppercase tracking-[0.3em] flex items-center gap-2">
          <div className="w-6 h-[1px] bg-current opacity-10" />
          {sublabel}
          <div className="w-6 h-[1px] bg-current opacity-10" />
        </div>
      )}
    </div>
  );
}
