import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CandlestickChart, Info } from 'lucide-react';
import { SPECTRUM_COLORS } from './constants';

interface PriceFourierInfoProps {
  priceDFT: any;
  numTerms: number;
}

export const PriceFourierInfo: React.FC<PriceFourierInfoProps> = ({ priceDFT, numTerms }) => {
  if (!priceDFT) return null;

  const topTerms = priceDFT.coeffs.slice(0, 5);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <Card className="glass border-white/5 bg-white/5">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-medium text-muted-foreground">Dominant Cycles (DFT)</CardTitle>
          <CandlestickChart className="h-3.5 w-3.5 text-amber-400" />
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-wrap gap-2 mt-2">
            {topTerms.map((c: any, i: number) => {
              const period = Math.round(priceDFT.closes.length / c.freq);
              const color = SPECTRUM_COLORS[i % SPECTRUM_COLORS.length];
              return (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/10">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs font-medium text-white/90">{period} bars</span>
                  <span className="text-[10px] text-muted-foreground">({c.amp.toFixed(1)}a)</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Top 5 frequency components ranked by amplitude
          </p>
        </CardContent>
      </Card>

      <Card className="glass border-white/5 bg-white/5">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-medium text-muted-foreground">Analysis Context</CardTitle>
          <Info className="h-3.5 w-3.5 text-blue-400" />
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">Sample Window:</span>
              <span className="text-[10px] font-medium text-white/80">{priceDFT.closes.length} bars</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">Harmonic Terms:</span>
              <span className="text-[10px] font-medium text-white/80">{numTerms}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">DC Offset:</span>
              <span className="text-[10px] font-medium text-white/80">{priceDFT.dc.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
