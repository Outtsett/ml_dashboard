import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Compass } from "lucide-react";
import type { HilbertSeriesPoint } from "./types";

interface HilbertVectorProps {
  data: HilbertSeriesPoint[];
}

export function HilbertVector({ data }: HilbertVectorProps) {
  if (!data || data.length === 0) return null;

  // Use the last 50 points for the vector path
  const points = data.slice(-50);
  const latest = points[points.length - 1]!;
  
  const size = 300;
  const center = size / 2;
  const padding = 20;
  const radius = (size / 2) - padding;

  // Scale data to fit radius
  const maxAmp = Math.max(...points.map(p => Math.abs(p.signal), ...points.map(p => Math.abs(p.transformed ?? NaN)))) || 1;
  const scale = radius / maxAmp;

  return (
    <Card className="glass border-white/5 h-full">
      <CardHeader className="py-2 px-4 border-b border-white/5">
        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Compass className="h-3 w-3 text-primary" />
          Phase Space (Analytic Vector)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center p-4 h-[calc(100%-40px)]">
        <div className="relative">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Grid */}
            <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <circle cx={center} cy={center} r={radius * 0.66} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <circle cx={center} cy={center} r={radius * 0.33} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <line x1={center} y1={padding} x2={center} y2={size - padding} stroke="rgba(255,255,255,0.05)" />
            <line x1={padding} y1={center} x2={size - padding} y2={center} stroke="rgba(255,255,255,0.05)" />

            {/* Path */}
            <path
              d={points.map((p, i) => {
                const x = center + p.signal * scale;
                const y = center - (p.transformed ?? NaN) * scale;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="url(#vectorGradient)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Latest Vector */}
            <line
              x1={center}
              y1={center}
              x2={center + latest.signal * scale}
              y2={center - (latest.transformed ?? NaN) * scale}
              stroke="#fbbf24"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle
              cx={center + latest.signal * scale}
              cy={center - (latest.transformed ?? NaN) * scale}
              r="5"
              fill="#fbbf24"
              className="animate-pulse"
            />

            <defs>
              <linearGradient id="vectorGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(59, 130, 246, 0.1)" />
                <stop offset="100%" stopColor="rgba(59, 130, 246, 0.8)" />
              </linearGradient>
            </defs>
          </svg>

          {/* Legend */}
          <div className="absolute top-0 right-0 text-[10px] font-mono text-muted-foreground/60 space-y-1 bg-black/40 p-2 rounded border border-white/5">
            <div>Real: Signal</div>
            <div>Imag: Hilbert</div>
            <div className="text-amber-400 font-bold">Phase: {((latest.phase ?? NaN) * 180 / Math.PI).toFixed(1)}Â°</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
