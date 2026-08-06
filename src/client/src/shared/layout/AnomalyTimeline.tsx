import { useMemo } from 'react';
import { 
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, ReferenceLine, Area
} from 'recharts';

interface AnomalyPoint {
  timestamp: number | string;
  value: number;
  anomalyScore: number;
  isAnomaly?: boolean;
}

interface AnomalyTimelineProps {
  data: AnomalyPoint[] | null;
  threshold?: number;
  showScores?: boolean;
  showThreshold?: boolean;
  title?: string;
}

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

export function AnomalyTimeline({ 
  data, 
  threshold = 0.5,
  showScores = true,
  showThreshold = true,
  title
}: AnomalyTimelineProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return null;

    return data.map((pt, idx) => ({
      idx,
      timestamp: pt.timestamp,
      value: pt.value,
      score: pt.anomalyScore,
      isAnomaly: pt.isAnomaly ?? (pt.anomalyScore >= threshold),
      anomalyMarker: (pt.isAnomaly ?? (pt.anomalyScore >= threshold)) ? pt.value : null,
    }));
  }, [data, threshold]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs">No anomaly data</p>
          <p className="text-[10px] opacity-60">Requires time-series with scores</p>
        </div>
      </div>
    );
  }

  const anomalyCount = processedData.filter(p => p.isAnomaly).length;
  const anomalyRate = (anomalyCount / processedData.length * 100).toFixed(1);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between px-1 mb-1">
        {title && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {title}
          </div>
        )}
        <div className="flex gap-3 text-[9px]">
          <span className="text-muted-foreground">
            Anomalies: <span className="text-amber-400 font-medium">{anomalyCount}</span>
          </span>
          <span className="text-muted-foreground">
            Rate: <span className="text-amber-400 font-medium">{anomalyRate}%</span>
          </span>
        </div>
      </div>
      
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={processedData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis 
              dataKey="idx" 
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              tickFormatter={(_v) => ''}
            />
            <YAxis 
              yAxisId="value"
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false} 
              width={30}
              domain={['auto', 'auto']}
            />
            {showScores && (
              <YAxis 
                yAxisId="score"
                orientation="right"
                stroke="hsl(220, 10%, 40%)" 
                fontSize={8} 
                tickLine={false} 
                axisLine={false} 
                width={25}
                domain={[0, 1]}
              />
            )}
            <Tooltip 
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [
                value.toFixed(4),
                name === 'score' ? 'Anomaly Score' : 'Value'
              ]}
            />
            
            <Line 
              yAxisId="value"
              type="monotone" 
              dataKey="value" 
              stroke="#3b82f6" 
              strokeWidth={1.5}
              dot={false}
              name="Value"
            />
            
            {showScores && (
              <Area 
                yAxisId="score"
                type="monotone" 
                dataKey="score" 
                fill="#f59e0b"
                fillOpacity={0.2}
                stroke="#f59e0b"
                strokeWidth={1}
                name="Anomaly Score"
              />
            )}
            
            <Bar 
              yAxisId="value"
              dataKey="anomalyMarker" 
              fill="#ef4444"
              opacity={0.8}
              barSize={3}
              name="Anomaly"
            />
            
            {showThreshold && (
              <ReferenceLine 
                yAxisId="score"
                y={threshold} 
                stroke="#ef4444" 
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default AnomalyTimeline;
