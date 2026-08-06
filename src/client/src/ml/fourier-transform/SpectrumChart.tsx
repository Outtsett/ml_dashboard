import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell 
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BarChart3 } from "lucide-react";
import { SPECTRUM_COLORS } from "./constants";

interface SpectrumChartProps {
  data: any[];
}

export function SpectrumChart({ data }: SpectrumChartProps) {
  if (!data || data.length === 0) return null;

  // Show top 30 components
  const displayData = data.slice(0, 30);

  return (
    <Card className="glass border-white/5 h-full">
      <CardHeader className="py-2 px-4 border-b border-white/5">
        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          Power Spectral Density
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 h-[calc(100%-40px)]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={displayData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="period" 
              label={{ value: 'Period (Bars)', position: 'bottom', fontSize: 10, fill: '#666' }}
              tick={{ fontSize: 9, fill: '#666' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              label={{ value: 'Amplitude', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#666' }}
              tick={{ fontSize: 9, fill: '#666' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px' }}
              formatter={(value: number) => [value.toFixed(4), "Amplitude"]}
              labelFormatter={(period: number) => `Period: ${period} bars`}
            />
            <Bar dataKey="amp" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {displayData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={SPECTRUM_COLORS[index % SPECTRUM_COLORS.length]} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
