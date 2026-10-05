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
  color = "#E69F00", 
  unit = "" 
}: RadialGaugeProps) {
  const clampedValue = Math.min(Math.max(value, min), max);
  const data = [
    { value: clampedValue - min },
    { value: max - clampedValue },
  ];

  return (
    <div className="flex flex-col items-center justify-center p-3 bg-transparent relative overflow-hidden group transition-colors duration-500">
      <div className="w-full h-28 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="52%" /* Raised half-ring position to center values cleanly below */
              startAngle={180}
              endAngle={0}
              innerRadius={46}
              outerRadius={58}
              paddingAngle={0}
              dataKey="value"
              stroke="none"
              isAnimationActive={true}
              animationDuration={800}
            >
              <Cell 
                fill={color} 
                style={{ 
                  opacity: 0.95 
                }} 
              />
              <Cell fill="rgba(255,255,255,0.06)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        
        {/* Value Overlay - Centered below the raised half-ring */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-10">
          <div className="flex items-baseline gap-0.5">
            <span 
              className="text-2xl font-black font-mono tracking-tighter text-foreground transition-transform duration-300"
              style={{ color, textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
            >
              {value.toFixed(value < 10 ? 2 : 1)}
            </span>
            <span className="text-[10px] font-bold text-muted-foreground/60">{unit}</span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 mt-0.5 text-center">
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
