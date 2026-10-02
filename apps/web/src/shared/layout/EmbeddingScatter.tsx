import { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface EmbeddingPoint {
  x: number;
  y: number;
  label?: string | number;
  cluster?: number;
  anomalyScore?: number;
}

interface EmbeddingScatterProps {
  data: EmbeddingPoint[] | null;
  colorBy?: 'cluster' | 'anomaly' | 'label' | 'none';
  showTrajectory?: boolean;
  trajectoryData?: { x: number; y: number }[];
  title?: string;
}

const CLUSTER_COLORS = [
  '#8b5cf6', '#06b6d4', '#f59e0b', '#E69F00', 
  '#0072B2', '#ec4899', '#3b82f6', '#84cc16'
];

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

function getAnomalyColor(score: number): string {
  if (score >= 0.8) return '#0072B2';
  if (score >= 0.6) return '#f59e0b';
  if (score >= 0.4) return '#eab308';
  return '#E69F00';
}

export function EmbeddingScatter({ 
  data, 
  colorBy = 'cluster',
  showTrajectory = false,
  trajectoryData,
  title
}: EmbeddingScatterProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const validData = data.filter(pt => 
      Number.isFinite(pt.x) && Number.isFinite(pt.y)
    );

    if (validData.length === 0) return null;

    if (colorBy === 'cluster') {
      const grouped = new Map<number, EmbeddingPoint[]>();
      validData.forEach(pt => {
        const cluster = pt.cluster ?? 0;
        if (!grouped.has(cluster)) grouped.set(cluster, []);
        grouped.get(cluster)!.push(pt);
      });
      return { type: 'clustered' as const, groups: grouped };
    }

    return { type: 'single' as const, points: validData };
  }, [data, colorBy]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <circle cx="8" cy="10" r="2" />
            <circle cx="16" cy="10" r="2" />
            <circle cx="12" cy="16" r="2" />
          </svg>
          <p className="text-xs">No embedding data</p>
          <p className="text-[10px] opacity-60">Requires 2D projection</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      {title && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={title ? "90%" : "100%"}>
        <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis 
            type="number" 
            dataKey="x" 
            stroke="hsl(220, 10%, 40%)" 
            fontSize={8} 
            tickLine={false} 
            axisLine={false}
            domain={['auto', 'auto']}
          />
          <YAxis 
            type="number" 
            dataKey="y" 
            stroke="hsl(220, 10%, 40%)" 
            fontSize={8} 
            tickLine={false} 
            axisLine={false} 
            width={25}
            domain={['auto', 'auto']}
          />
          <ZAxis range={[15, 40]} />
          <Tooltip 
            contentStyle={chartTooltipStyle} 
            formatter={(val: number) => val.toFixed(3)}
            labelFormatter={() => ''}
          />
          
          {processedData.type === 'clustered' ? (
            Array.from(processedData.groups.entries()).map(([clusterId, points]) => (
              <Scatter 
                key={clusterId}
                name={`Cluster ${clusterId + 1}`}
                data={points}
                fill={CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length]}
                opacity={0.7}
              />
            ))
          ) : (
            <Scatter data={processedData.points} opacity={0.7}>
              {processedData.points.map((point, index) => (
                <Cell 
                  key={`cell-${index}`}
                  fill={
                    colorBy === 'anomaly' && point.anomalyScore !== undefined
                      ? getAnomalyColor(point.anomalyScore)
                      : '#8b5cf6'
                  }
                />
              ))}
            </Scatter>
          )}
          
          {showTrajectory && trajectoryData && trajectoryData.length > 1 && (
            <Scatter 
              data={trajectoryData} 
              line={{ stroke: '#E69F00', strokeWidth: 1.5 }}
              shape="circle"
              fill="#E69F00"
              opacity={0.9}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default EmbeddingScatter;
