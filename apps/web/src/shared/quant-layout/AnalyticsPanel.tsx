import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { paletteColorDark } from '@/shared/theme/dataColors';

export interface TelemetryHistory {
  iteration: number;
  reward?: number;
  loss?: number;
  value_loss?: number;
  kl?: number;
  entropy?: number;
}

interface AnalyticsPanelProps {
  data: TelemetryHistory[];
  title?: string;
}

export function AnalyticsPanel({ data, title = "Live Telemetry" }: AnalyticsPanelProps) {
  const ChartWidget = ({ dataKey, name, strokeColor }: { dataKey: string, name: string, strokeColor: string }) => (
    <div className="flex flex-col bg-[#0a0a0a] border border-neutral-800 rounded p-2 relative h-[180px]">
      <span className="absolute top-2 left-3 text-xs font-mono text-neutral-400 z-10">{name}</span>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
          <XAxis 
            dataKey="iteration" 
            stroke="#525252" 
            tick={{ fill: '#737373', fontSize: 10 }}
            tickMargin={8}
            minTickGap={30}
          />
          <YAxis 
            stroke="#525252" 
            tick={{ fill: '#737373', fontSize: 10 }} 
            domain={['auto', 'auto']}
            width={40}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', color: '#e5e5e5' }}
            itemStyle={{ fontSize: 12 }}
            labelStyle={{ fontSize: 12, color: '#a3a3a3', marginBottom: 4 }}
          />
          <Area type="monotone" dataKey={dataKey} stroke={strokeColor} strokeWidth={2} fillOpacity={1} fill={`url(#grad-${dataKey})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#111111] border border-neutral-800 rounded shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <h3 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">{title}</h3>
      </div>
      
      <div className="flex-grow p-4 min-h-[400px] overflow-y-auto">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-neutral-500 text-sm font-mono">
            Waiting for telemetry stream...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
            <ChartWidget dataKey="reward" name="REWARD" strokeColor={paletteColorDark(1)} />
            <ChartWidget dataKey="loss" name="ACTOR LOSS" strokeColor={paletteColorDark(0)} />
            <ChartWidget dataKey="value_loss" name="CRITIC LOSS" strokeColor={paletteColorDark(5)} />
            <ChartWidget dataKey="entropy" name="ENTROPY" strokeColor={paletteColorDark(2)} />
            <ChartWidget dataKey="kl" name="KL DIVERGENCE" strokeColor={paletteColorDark(4)} />
          </div>
        )}
      </div>
    </div>
  );
}
