import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Activity, BarChart3 } from 'lucide-react';
import { ResponsiveContainer, Line, XAxis, YAxis, Tooltip, ReferenceLine, Area, ComposedChart } from 'recharts';
import { indicatorApi } from '@/lib/apiService';

interface IndicatorPanelProps {
  symbol: string;
}

const PRESETS = {
  momentum: { label: 'Momentum', icon: TrendingUp },
  volatility: { label: 'Volatility', icon: Activity },
  oscillators: { label: 'Oscillators', icon: BarChart3 },
  full: { label: 'Full Suite', icon: Activity },
};

export function IndicatorPanel({ symbol }: IndicatorPanelProps) {
  const [preset, setPreset] = useState<string>('oscillators');
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ data: any[]; indicators: string[] }>({
    queryKey: ['indicators', symbol, preset],
    queryFn: () => indicatorApi.compute({ symbol, preset, limit: 500 }) as Promise<{ data: any[]; indicators: string[] }>,
    enabled: enabled && !!symbol,
    staleTime: 60000,
  });

  const chartData = data?.data?.slice(-200) || [];

  const getIndicatorColor = (key: string) => {
    if (key.includes('rsi')) return '#8b5cf6';
    if (key.includes('macd') && !key.includes('signal') && !key.includes('hist')) return '#22c55e';
    if (key.includes('signal')) return '#ef4444';
    if (key.includes('hist')) return '#6366f1';
    if (key.includes('stoch_k')) return '#f59e0b';
    if (key.includes('stoch_d')) return '#ec4899';
    if (key.includes('cci')) return '#06b6d4';
    if (key.includes('williams')) return '#a855f7';
    if (key.includes('bb_upper')) return '#ef4444';
    if (key.includes('bb_lower')) return '#22c55e';
    if (key.includes('bb_middle')) return '#6366f1';
    if (key.includes('atr')) return '#f97316';
    if (key.includes('sma')) return '#3b82f6';
    if (key.includes('ema')) return '#10b981';
    return '#94a3b8';
  };

  const indicatorKeys = data?.indicators || [];
  const latestValues = chartData.length > 0 ? chartData[chartData.length - 1] : {};

  const formatValue = (key: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    if (key.includes('rsi') || key.includes('stoch') || key.includes('williams')) {
      return value.toFixed(1);
    }
    return value.toFixed(4);
  };

  const getStatusColor = (key: string, value: number) => {
    if (key.includes('rsi')) {
      if (value > 70) return 'text-rose-400';
      if (value < 30) return 'text-emerald-400';
      return 'text-gray-400';
    }
    if (key.includes('stoch')) {
      if (value > 80) return 'text-rose-400';
      if (value < 20) return 'text-emerald-400';
      return 'text-gray-400';
    }
    if (key.includes('williams')) {
      if (value > -20) return 'text-rose-400';
      if (value < -80) return 'text-emerald-400';
      return 'text-gray-400';
    }
    if (key.includes('cci')) {
      if (value > 100) return 'text-rose-400';
      if (value < -100) return 'text-emerald-400';
      return 'text-gray-400';
    }
    return 'text-gray-300';
  };

  return (
    <Card className="bg-black/40 backdrop-blur-xl border-white/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-white/90 flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-400" />
            Technical Indicators
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-32 h-7 text-xs bg-white/5 border-white/10" data-testid="indicator-preset-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRESETS).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              size="sm" 
              variant={enabled ? "secondary" : "default"}
              className="h-7 text-xs"
              onClick={() => {
                setEnabled(true);
                refetch();
              }}
              disabled={isLoading}
              data-testid="button-compute-indicators"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Compute'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {!enabled ? (
          <div className="text-center py-8 text-white/40 text-sm">
            Select a preset and click Compute to calculate indicators
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
          </div>
        ) : chartData.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {indicatorKeys.map((key: string) => (
                <Badge 
                  key={key} 
                  variant="outline" 
                  className="text-[10px] border-white/10"
                  style={{ color: getIndicatorColor(key) }}
                  data-testid={`badge-indicator-${key}`}
                >
                  {key}: <span className={getStatusColor(key, latestValues[key])}>{formatValue(key, latestValues[key])}</span>
                </Badge>
              ))}
            </div>

            {indicatorKeys.some((k: string) => k.includes('rsi') || k.includes('stoch') || k.includes('williams') || k.includes('cci')) && (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      tick={{ fontSize: 9, fill: '#666' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 9, fill: '#666' }}
                      axisLine={false}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(0,0,0,0.9)', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontSize: 10,
                      }}
                      labelFormatter={(t) => new Date(t).toLocaleString()}
                    />
                    {indicatorKeys.includes('rsi_14') && (
                      <>
                        <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                        <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />
                        <Line type="monotone" dataKey="rsi_14" stroke="#8b5cf6" dot={false} strokeWidth={1.5} />
                      </>
                    )}
                    {indicatorKeys.includes('stoch_k_14') && (
                      <>
                        <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <Line type="monotone" dataKey="stoch_k_14" stroke="#f59e0b" dot={false} strokeWidth={1} />
                        <Line type="monotone" dataKey="stoch_d_14_3" stroke="#ec4899" dot={false} strokeWidth={1} />
                      </>
                    )}
                    {indicatorKeys.includes('cci_20') && (
                      <>
                        <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <ReferenceLine y={-100} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <Line type="monotone" dataKey="cci_20" stroke="#06b6d4" dot={false} strokeWidth={1} />
                      </>
                    )}
                    {indicatorKeys.includes('williams_r_14') && (
                      <>
                        <ReferenceLine y={-20} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <ReferenceLine y={-80} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
                        <Line type="monotone" dataKey="williams_r_14" stroke="#a855f7" dot={false} strokeWidth={1} />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {indicatorKeys.some((k: string) => k.includes('macd')) && (
              <div className="h-24">
                <div className="text-[10px] text-white/50 mb-1">MACD</div>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                    <XAxis dataKey="timestamp" hide />
                    <YAxis tick={{ fontSize: 9, fill: '#666' }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(0,0,0,0.9)', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontSize: 10,
                      }}
                    />
                    <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                    {indicatorKeys.includes('macd_hist_12_26_9') && (
                      <Area 
                        type="monotone" 
                        dataKey="macd_hist_12_26_9" 
                        fill="#6366f1" 
                        stroke="none"
                        fillOpacity={0.3}
                      />
                    )}
                    {indicatorKeys.includes('macd_12_26_9') && (
                      <Line type="monotone" dataKey="macd_12_26_9" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                    )}
                    {indicatorKeys.includes('macd_signal_12_26_9') && (
                      <Line type="monotone" dataKey="macd_signal_12_26_9" stroke="#ef4444" dot={false} strokeWidth={1} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-white/40 text-sm">
            No data available for {symbol}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
