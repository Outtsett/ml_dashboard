import { useMemo } from 'react';
import { 
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, ReferenceLine
} from 'recharts';

interface ForecastPoint {
  timestamp: number | string;
  actual?: number;
  predicted: number;
  lower?: number;
  upper?: number;
}

interface ForecastRibbonProps {
  data: ForecastPoint[] | null;
  showConfidenceBand?: boolean;
  forecastStart?: number;
  title?: string;
}

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

export function ForecastRibbon({ 
  data, 
  showConfidenceBand = true,
  forecastStart,
  title
}: ForecastRibbonProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const validData = data.map((pt, idx) => ({
      idx,
      timestamp: pt.timestamp,
      actual: pt.actual,
      predicted: pt.predicted,
      lower: pt.lower ?? pt.predicted * 0.95,
      upper: pt.upper ?? pt.predicted * 1.05,
    }));

    const hasActuals = validData.some(p => p.actual !== undefined);
    const forecastIdx = forecastStart ?? Math.floor(validData.length * 0.8);

    let mae = 0;
    let mape = 0;
    let count = 0;

    validData.forEach(p => {
      if (p.actual !== undefined && p.predicted !== undefined) {
        mae += Math.abs(p.actual - p.predicted);
        if (p.actual !== 0) {
          mape += Math.abs((p.actual - p.predicted) / p.actual);
        }
        count++;
      }
    });

    const stats = {
      mae: count > 0 ? mae / count : 0,
      mape: count > 0 ? (mape / count) * 100 : 0,
    };

    return { points: validData, hasActuals, forecastIdx, stats };
  }, [data, forecastStart]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
          <p className="text-xs">No forecast data</p>
          <p className="text-[10px] opacity-60">Requires time-series predictions</p>
        </div>
      </div>
    );
  }

  const { points, hasActuals, forecastIdx, stats } = processedData;

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
            MAE: <span className="text-emerald-400 font-mono">{stats.mae.toFixed(4)}</span>
          </span>
          <span className="text-muted-foreground">
            MAPE: <span className="text-emerald-400 font-mono">{stats.mape.toFixed(1)}%</span>
          </span>
        </div>
      </div>
      
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis 
              dataKey="idx" 
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              tickFormatter={() => ''}
            />
            <YAxis 
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              width={35}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [
                value?.toFixed(4) ?? '-',
                name === 'actual' ? 'Actual' : name === 'predicted' ? 'Forecast' : name
              ]}
            />
            
            {showConfidenceBand && (
              <>
                <Area 
                  type="monotone"
                  dataKey="upper"
                  fill="#22c55e"
                  fillOpacity={0.15}
                  stroke="none"
                  stackId="confidence"
                />
                <Area 
                  type="monotone"
                  dataKey="lower"
                  fill="transparent"
                  stroke="none"
                  stackId="confidence"
                />
              </>
            )}
            
            {hasActuals && (
              <Line 
                type="monotone" 
                dataKey="actual" 
                stroke="#3b82f6" 
                strokeWidth={1.5}
                dot={false}
                name="Actual"
              />
            )}
            
            <Line 
              type="monotone" 
              dataKey="predicted" 
              stroke="#22c55e" 
              strokeWidth={1.5}
              dot={false}
              strokeDasharray={hasActuals ? "3 3" : "0"}
              name="Forecast"
            />
            
            {forecastIdx > 0 && forecastIdx < points.length && (
              <ReferenceLine 
                x={forecastIdx}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex justify-center gap-4 text-[9px] mt-1">
        {hasActuals && (
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-blue-500" />
            <span className="text-muted-foreground">Actual</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-emerald-500" style={{ borderStyle: hasActuals ? 'dashed' : 'solid' }} />
          <span className="text-muted-foreground">Forecast</span>
        </div>
        {showConfidenceBand && (
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 bg-emerald-500/20" />
            <span className="text-muted-foreground">95% CI</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ForecastRibbon;
