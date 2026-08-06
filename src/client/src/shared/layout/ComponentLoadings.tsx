import { useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';

interface LoadingData {
  feature: string;
  loadings: number[];
}

interface ComponentLoadingsProps {
  data: LoadingData[] | null;
  selectedComponent?: number;
  maxFeatures?: number;
  title?: string;
}

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

export function ComponentLoadings({ 
  data, 
  selectedComponent = 0,
  maxFeatures = 15,
  title
}: ComponentLoadingsProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const componentData = data
      .map(d => ({
        feature: d.feature,
        loading: d.loadings[selectedComponent] ?? 0,
        absLoading: Math.abs(d.loadings[selectedComponent] ?? 0),
      }))
      .sort((a, b) => b.absLoading - a.absLoading)
      .slice(0, maxFeatures);

    return componentData;
  }, [data, selectedComponent, maxFeatures]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 12h4l3 8 4-16 3 8h4" />
          </svg>
          <p className="text-xs">No loading data</p>
          <p className="text-[10px] opacity-60">Requires component loadings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {title && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">
          {title} - PC{selectedComponent + 1}
        </div>
      )}
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart 
            data={processedData} 
            layout="vertical"
            margin={{ top: 5, right: 10, bottom: 5, left: 5 }}
          >
            <XAxis 
              type="number" 
              domain={[-1, 1]}
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
            />
            <YAxis 
              type="category"
              dataKey="feature" 
              stroke="hsl(220, 10%, 40%)" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false}
              width={60}
              tickFormatter={(v: string) => v.length > 8 ? v.slice(0, 8) + '...' : v}
            />
            <Tooltip 
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [value.toFixed(4), 'Loading']}
            />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
            <Bar dataKey="loading" radius={[0, 2, 2, 0]}>
              {processedData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`}
                  fill={entry.loading >= 0 ? '#06b6d4' : '#f59e0b'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default ComponentLoadings;
