import { useMemo } from 'react';
import { 
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';

interface ResidualPoint {
  predicted: number;
  actual: number;
  residual?: number;
}

interface ResidualPlotProps {
  data: ResidualPoint[] | null;
  type?: 'residual_vs_predicted' | 'predicted_vs_actual' | 'residual_distribution';
  title?: string;
}

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

export function ResidualPlot({ 
  data, 
  type = 'predicted_vs_actual',
  title
}: ResidualPlotProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const validData = data
      .filter(pt => Number.isFinite(pt.predicted) && Number.isFinite(pt.actual))
      .map(pt => ({
        predicted: pt.predicted,
        actual: pt.actual,
        residual: pt.residual ?? (pt.actual - pt.predicted),
      }));

    if (validData.length === 0) return null;

    const stats = {
      mae: validData.reduce((s, p) => s + Math.abs(p.residual), 0) / validData.length,
      rmse: Math.sqrt(validData.reduce((s, p) => s + p.residual ** 2, 0) / validData.length),
      mean: validData.reduce((s, p) => s + p.residual, 0) / validData.length,
    };

    return { points: validData, stats };
  }, [data]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3v18h18" />
            <circle cx="9" cy="9" r="2" />
            <circle cx="19" cy="6" r="2" />
            <circle cx="15" cy="14" r="2" />
          </svg>
          <p className="text-xs">No residual data</p>
          <p className="text-[10px] opacity-60">Requires predictions and actuals</p>
        </div>
      </div>
    );
  }

  const { points, stats } = processedData;

  const getPlotData = () => {
    if (type === 'residual_vs_predicted') {
      return points.map(p => ({ x: p.predicted, y: p.residual }));
    }
    return points.map(p => ({ x: p.predicted, y: p.actual }));
  };

  const plotData = getPlotData();
  const xLabel = type === 'residual_vs_predicted' ? 'Predicted' : 'Predicted';
  const yLabel = type === 'residual_vs_predicted' ? 'Residual' : 'Actual';

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
            MAE: <span className="text-blue-400 font-mono">{stats.mae.toFixed(4)}</span>
          </span>
          <span className="text-muted-foreground">
            RMSE: <span className="text-blue-400 font-mono">{stats.rmse.toFixed(4)}</span>
          </span>
        </div>
      </div>
      
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 5, bottom: 15, left: 5 }}>
            <XAxis 
              type="number" 
              dataKey="x"
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              domain={['auto', 'auto']}
              label={{ value: xLabel, position: 'bottom', offset: 0, fontSize: 9, fill: 'hsl(220, 10%, 50%)' }}
            />
            <YAxis 
              type="number"
              dataKey="y" 
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              width={35}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => value.toFixed(4)}
            />
            
            {type === 'predicted_vs_actual' && (
              <ReferenceLine 
                segment={[
                  { x: Math.min(...plotData.map(p => p.x)), y: Math.min(...plotData.map(p => p.x)) },
                  { x: Math.max(...plotData.map(p => p.x)), y: Math.max(...plotData.map(p => p.x)) }
                ]}
                stroke="#22c55e"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
            
            {type === 'residual_vs_predicted' && (
              <ReferenceLine y={0} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
            )}
            
            <Scatter data={plotData} fill="#3b82f6" opacity={0.6}>
              {plotData.map((_, index) => (
                <Cell 
                  key={`cell-${index}`}
                  fill={
                    type === 'residual_vs_predicted' 
                      ? (plotData[index].y > 0 ? '#3b82f6' : '#f59e0b')
                      : '#3b82f6'
                  }
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default ResidualPlot;
