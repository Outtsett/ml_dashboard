/**
 * Mini SVG charts for RegimeAnalytics: QualityScoreRing, BICChart, ConvergenceCurve
 */

import type { ModelSelection } from "@/ml/components/regime-analytics/types";

// ─── Quality Score Ring ──────────────────────────────────────────────────────

export function QualityScoreRing({ score }: { score: number }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#E69F00" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#0072B2";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={48} height={48} viewBox="0 0 48 48">
        <circle cx={24} cy={24} r={r} fill="none" stroke="white" strokeOpacity={0.05} strokeWidth={3} />
        <circle
          cx={24} cy={24} r={r}
          fill="none" stroke={color} strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
        />
        <text x={24} y={24} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={11} fontWeight="bold" fontFamily="monospace">
          {Math.round(score)}
        </text>
      </svg>
    </div>
  );
}

// ─── Mini BIC Chart (SVG) ────────────────────────────────────────────────────

export function BICChart({ data, bestN, bicBestK, cvBestK }: {
  data: ModelSelection[];
  bestN: number;
  bicBestK?: number;
  cvBestK?: number;
}) {
  if (!data || data.length === 0) return null;

  const w = 240, h = 70, pad = { t: 8, r: 12, b: 18, l: 38 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const bics = data.map(d => d.bic);
  const minBIC = Math.min(...bics);
  const maxBIC = Math.max(...bics);
  const range = maxBIC - minBIC || 1;

  const points = data.map((d, i) => ({
    x: pad.l + (i / Math.max(data.length - 1, 1)) * iw,
    y: pad.t + ((d.bic - minBIC) / range) * ih,
    n: d.n_components,
    bic: d.bic,
    isBest: d.n_components === bestN,
    isBicBest: d.n_components === bicBestK,
    isCvBest: d.n_components === cvBestK,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px]">
      {/* Grid lines */}
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={pad.l} y1={pad.t + f * ih} x2={pad.l + iw} y2={pad.t + f * ih}
          stroke="white" strokeOpacity={0.05} />
      ))}

      {/* BIC line */}
      <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth={1.5} />

      {/* Points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.isBest ? 4 : 2.5}
            fill={p.isBest ? "#E69F00" : p.isBicBest ? "#f59e0b" : "#06b6d4"}
            stroke={p.isBest ? "#E69F00" : "none"}
            strokeWidth={p.isBest ? 1 : 0}
            opacity={p.isBest ? 1 : 0.7}
          />
          {/* N label */}
          <text x={p.x} y={h - 3} textAnchor="middle" fill="white" fillOpacity={0.4} fontSize={8}>
            {p.n}
          </text>
        </g>
      ))}

      {/* Best label */}
      {points.filter(p => p.isBest).map(p => (
        <text key="best" x={p.x} y={p.y - 7} textAnchor="middle" fill="#E69F00" fontSize={7} fontWeight="bold">
          Final
        </text>
      ))}
      {points.filter(p => p.isBicBest && !p.isBest).map(p => (
        <text key="bic" x={p.x} y={p.y - 7} textAnchor="middle" fill="#f59e0b" fontSize={6}>
          BIC
        </text>
      ))}

      {/* Y-axis labels */}
      <text x={pad.l - 3} y={pad.t + 4} textAnchor="end" fill="white" fillOpacity={0.3} fontSize={7}>
        {(maxBIC / 1000).toFixed(0)}k
      </text>
      <text x={pad.l - 3} y={pad.t + ih + 3} textAnchor="end" fill="white" fillOpacity={0.3} fontSize={7}>
        {(minBIC / 1000).toFixed(0)}k
      </text>

      <text x={pad.l + iw / 2} y={h - 0} textAnchor="middle" fill="white" fillOpacity={0.25} fontSize={7}>
        # Regimes
      </text>
    </svg>
  );
}

// ─── Convergence Curve Chart ─────────────────────────────────────────────────

export function ConvergenceCurve({ data, label }: { data: Array<{ iter: number; log_likelihood: number; delta: number }>; label: string }) {
  if (!data || data.length < 2) return null;

  const w = 240, h = 55, pad = { t: 6, r: 8, b: 14, l: 38 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const lls = data.map(d => d.log_likelihood);
  const minLL = Math.min(...lls);
  const maxLL = Math.max(...lls);
  const range = maxLL - minLL || 1;

  const points = data.map((d, i) => ({
    x: pad.l + (i / Math.max(data.length - 1, 1)) * iw,
    y: pad.t + ih - ((d.log_likelihood - minLL) / range) * ih,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="space-y-0.5">
      <p className="text-[8px] text-muted-foreground/70 font-mono">{label} ({data.length} iters)</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[55px]">
        <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth={1.2} />
        <circle cx={points[points.length - 1]!.x} cy={points[points.length - 1]!.y} r={2} fill="#8b5cf6" />
        <text x={pad.l - 3} y={pad.t + 5} textAnchor="end" fill="white" fillOpacity={0.25} fontSize={6}>
          {(maxLL / 1000).toFixed(0)}k
        </text>
        <text x={pad.l - 3} y={pad.t + ih + 3} textAnchor="end" fill="white" fillOpacity={0.25} fontSize={6}>
          {(minLL / 1000).toFixed(0)}k
        </text>
        <text x={pad.l + iw / 2} y={h - 1} textAnchor="middle" fill="white" fillOpacity={0.2} fontSize={6}>
          EM Iteration
        </text>
      </svg>
    </div>
  );
}
