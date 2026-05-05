import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

interface AnalysisChartProps {
  data: Array<Record<string, unknown>>;
  isHilbert?: boolean;
}

export function AnalysisChart({ data, isHilbert }: AnalysisChartProps) {
  if (!data || data.length === 0) return null;

  return (
    <Card className="glass border-white/5 h-full">
      <CardHeader className="py-2 px-4 border-b border-white/5">
        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Activity className="h-3 w-3 text-primary" />
          {isHilbert ? "Analytic Signal Decomposition" : "Time-Domain Cycle Reconstruction"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 h-[calc(100%-40px)]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="index" 
              hide 
            />
            <YAxis 
              domain={['auto', 'auto']} 
              tick={{ fontSize: 10, fill: '#666' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px' }}
              labelStyle={{ display: 'none' }}
            />
            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
            
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

            {isHilbert ? (
              <>
                <Line 
                  type="monotone" 
                  dataKey="signal" 
                  name="Input (Detrended)" 
                  stroke="#fbbf24" 
                  strokeWidth={2} 
                  dot={false} 
                  isAnimationActive={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="transformed" 
                  name="Hilbert Transform" 
                  stroke="#f472b6" 
                  strokeWidth={1.5} 
                  strokeDasharray="4 4"
                  dot={false} 
                  isAnimationActive={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="envelope" 
                  name="Envelope" 
                  stroke="#34d399" 
                  strokeWidth={2} 
                  dot={false} 
                  isAnimationActive={false}
                />
              </>
            ) : (
              <>
                <Line 
                  type="monotone" 
                  dataKey="input" 
                  name="Input (Detrended)" 
                  stroke="#94a3b8" 
                  strokeWidth={1.5} 
                  dot={false} 
                  isAnimationActive={false}
                  opacity={0.5}
                />
                <Line
                  type="monotone"
                  dataKey="reconstructed"
                  name="Reconstructed Cycle"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="residual" 
                  name="Residual (Noise)" 
                  stroke="#ef4444" 
                  strokeWidth={1} 
                  dot={false} 
                  isAnimationActive={false}
                  opacity={0.3}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
