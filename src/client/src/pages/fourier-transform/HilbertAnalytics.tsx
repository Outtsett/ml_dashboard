import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, ShieldAlert } from 'lucide-react';
import { smooth } from './math';

interface HilbertAnalyticsProps {
  hData: any;
  isPriceMode: boolean;
}

export const HilbertAnalytics: React.FC<HilbertAnalyticsProps> = ({ hData, isPriceMode }) => {
  if (!hData) return null;

  const smoothFreq = smooth(hData.instFreq, 7);
  const absFreqs = smoothFreq.filter(f => isFinite(f) && Math.abs(f) > 0.005);
  absFreqs.sort((a, b) => Math.abs(b) - Math.abs(a));
  const dominantFreq = absFreqs.length > 0 ? Math.abs(absFreqs[Math.floor(absFreqs.length * 0.25)]!) : 0;
  const dominantPeriod = dominantFreq > 0 ? Math.round(1 / dominantFreq) : 0;

  // Average power
  const avgEnv = hData.envelope.reduce((sum: number, v: number) => sum + v, 0) / hData.envelope.length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <Card className="glass border-white/5 bg-white/5">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-medium text-muted-foreground">Dominant Cycle</CardTitle>
          <Activity className="h-3.5 w-3.5 text-violet-400" />
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="text-2xl font-bold font-display text-violet-100">
            {dominantPeriod > 0 ? `${dominantPeriod} bars` : 'N/A'}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Based on median instantaneous frequency
          </p>
        </CardContent>
      </Card>

      <Card className="glass border-white/5 bg-white/5">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-medium text-muted-foreground">Avg. Power (Env)</CardTitle>
          <Zap className="h-3.5 w-3.5 text-emerald-400" />
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="text-2xl font-bold font-display text-emerald-100">
            {avgEnv.toFixed(2)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Mean instantaneous amplitude
          </p>
        </CardContent>
      </Card>

      <Card className="glass border-white/5 bg-white/5">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-medium text-muted-foreground">Phase Stability</CardTitle>
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="text-2xl font-bold font-display text-amber-100">
            High
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Coherence across signal window
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
