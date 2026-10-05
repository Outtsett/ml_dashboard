/**
 * Training Center — Reusable Micro-Components
 *
 * Small, focused UI building blocks shared across the Training Center:
 * Sparkline, PendingValue, FitGauge, MiniProgress, QualityScoreRing
 */

import { ProgressFill } from "@/shared/ui/progress-fill";

// ─── SVG Sparkline ───────────────────────────────────────────────────────────

export function Sparkline({ data, strokeColor = 'hsl(260, 80%, 70%)', fillColor = 'hsla(260, 80%, 70%, 0.06)', className = '' }: {
  data: number[];
  strokeColor?: string;
  fillColor?: string;
  className?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * 100},${16 - ((v - min) / range) * 14}`
  ).join(' ');
  return (
    <svg viewBox="0 0 100 16" className={`w-full h-4 ${className}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,16 ${pts} 100,16`} fill={fillColor} stroke="none" />
    </svg>
  );
}

// ─── Animated Pending Placeholder ────────────────────────────────────────────

export function PendingValue({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="animate-pulse">—</span>
      <span className={`text-[10px] font-normal ${color}`}>{label}</span>
    </span>
  );
}

// ─── Signal-Strength Gauge (1-5 bars) ────────────────────────────────────────

export function FitGauge({ level, label = 'fit' }: { level: number; label?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex gap-0.5 flex-1">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < level ? 'bg-violet-500/60' : 'bg-white/5'}`} />
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground/40">{label}</span>
    </div>
  );
}

// ─── Compact Progress Bar ────────────────────────────────────────────────────

export function MiniProgress({ value, max }: {
  value: number; max: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
      <ProgressFill value={pct} className="bg-violet-500/60" durationMs={500} />
    </div>
  );
}

// ─── Quality Score Ring (SVG arc) ────────────────────────────────────────────

export function QualityScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = size * 0.375;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#E69F00' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#0072B2';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeOpacity={0.05} strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={size * 0.23} fontWeight="bold" fontFamily="monospace">
          {Math.round(score)}
        </text>
      </svg>
    </div>
  );
}
