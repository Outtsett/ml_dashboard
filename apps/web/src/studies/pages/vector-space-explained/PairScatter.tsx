/**
 * A feature pair as a cloud of real bars, with a line swinging through it and
 * each bar's shadow on that line. Drawn as SVG: about a thousand dots, a
 * hundred rays and one line redraw in well under a frame.
 *
 * Glyphs: ● a bar, ◆ its shadow on the line, a solid line the direction you
 * chose, a dashed line the best direction (PC1 of the pair) when revealed.
 */

import { useState, type MouseEvent } from "react";
import { OKABE, fmt } from "@/studies/kit";
import { shadows, unitDirection, type PairAnalysis } from "@shared/studies/vector-space-explained";

const SIZE = 440;
const PAD = 46;
const INNER = SIZE - PAD - 12;

function ticks(limit: number): number[] {
  const step = limit >= 4 ? 2 : limit >= 2 ? 1 : 0.5;
  const out: number[] = [];
  for (let value = -Math.floor(limit / step) * step; value <= limit + 1e-9; value += step) out.push(Number(value.toFixed(4)));
  return out;
}

export function PairScatter({
  pair, angle, bars, featureX, featureY, plotStride, rayStride, showBest,
}: {
  pair: PairAnalysis; angle: number; bars: readonly number[]; featureX: string; featureY: string;
  plotStride: number; rayStride: number; showBest: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const limit = pair.axisLimit;
  const px = (value: number) => PAD + ((value + limit) / (2 * limit)) * INNER;
  const py = (value: number) => 12 + (1 - (value + limit) / (2 * limit)) * INNER;
  const [c, s] = unitDirection(angle);
  const projected = shadows(pair, angle);
  const [bc, bs] = unitDirection(pair.bestAngleDegrees);
  const plotted: number[] = [];
  for (let i = 0; i < pair.count; i += plotStride) plotted.push(i);
  const rayed: number[] = [];
  for (let i = 0; i < pair.count; i += rayStride) rayed.push(i);
  const axis = ticks(limit);

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const scale = SIZE / box.width;
    const mx = (event.clientX - box.left) * scale;
    const my = (event.clientY - box.top) * scale;
    let best = -1;
    let bestDistance = 12 * 12;
    for (const i of plotted) {
      const d = (px(pair.x[i] as number) - mx) ** 2 + (py(pair.y[i] as number) - my) ** 2;
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    setHover(best === -1 ? null : best);
  };

  const hovered = hover === null ? null : { i: hover, x: pair.x[hover] as number, y: pair.y[hover] as number, along: projected[hover] as number };

  return (
    <div className="relative w-full max-w-[520px]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full"
        role="img"
        aria-label={`${featureX} against ${featureY}, ${pair.count} bars, direction ${angle} degrees`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="pair-clip"><rect x={PAD} y={12} width={INNER} height={INNER} /></clipPath>
        </defs>
        <rect x={PAD} y={12} width={INNER} height={INNER} fill="none" stroke="#404040" />
        {axis.map((value) => (
          <g key={value}>
            <line x1={px(value)} x2={px(value)} y1={12} y2={12 + INNER} stroke="#262626" />
            <line x1={PAD} x2={PAD + INNER} y1={py(value)} y2={py(value)} stroke="#262626" />
            <text x={px(value)} y={12 + INNER + 12} fontSize="9" textAnchor="middle" className="fill-neutral-500">{value}</text>
            <text x={PAD - 4} y={py(value) + 3} fontSize="9" textAnchor="end" className="fill-neutral-500">{value}</text>
          </g>
        ))}
        <text x={PAD + INNER / 2} y={SIZE - 2} fontSize="10" textAnchor="middle" className="fill-neutral-300">{featureX} (z-score)</text>
        <text x={10} y={12 + INNER / 2} fontSize="10" textAnchor="middle" transform={`rotate(-90 10 ${12 + INNER / 2})`} className="fill-neutral-300">{featureY} (z-score)</text>
        <g clipPath="url(#pair-clip)">
          {rayed.map((i) => {
            const a = projected[i] as number;
            return <line key={`r${i}`} x1={px(pair.x[i] as number)} y1={py(pair.y[i] as number)} x2={px(a * c)} y2={py(a * s)} stroke="#9a9a9a" strokeWidth="0.5" opacity="0.45" />;
          })}
          {plotted.map((i) => (
            <circle key={i} cx={px(pair.x[i] as number)} cy={py(pair.y[i] as number)} r="1.7" fill={OKABE.blue} opacity="0.35" />
          ))}
          {showBest && (
            <line x1={px(-limit * bc)} y1={py(-limit * bs)} x2={px(limit * bc)} y2={py(limit * bs)} stroke={OKABE.vermillion} strokeWidth="1.5" strokeDasharray="6 4" />
          )}
          <line x1={px(-limit * c)} y1={py(-limit * s)} x2={px(limit * c)} y2={py(limit * s)} stroke={OKABE.orange} strokeWidth="2.5" />
          {rayed.map((i) => {
            const a = projected[i] as number;
            const x = px(a * c), y = py(a * s);
            return <path key={`s${i}`} d={`M${x} ${y - 3.2}L${x + 3.2} ${y}L${x} ${y + 3.2}L${x - 3.2} ${y}Z`} fill={OKABE.sky} opacity="0.95" />;
          })}
          {hovered && (
            <g>
              <circle cx={px(hovered.x)} cy={py(hovered.y)} r="5" fill="none" stroke="#f5f5f5" strokeWidth="1.5" />
              <line x1={px(hovered.x)} y1={py(hovered.y)} x2={px(hovered.along * c)} y2={py(hovered.along * s)} stroke="#f5f5f5" strokeWidth="1" />
            </g>
          )}
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-neutral-400">
        <span><span style={{ color: OKABE.blue }}>●</span> a bar (every {plotStride}th drawn)</span>
        <span><span style={{ color: OKABE.sky }}>◆</span> its shadow on the line (every {rayStride}th drawn)</span>
        <span><span style={{ color: OKABE.orange }}>━</span> your direction</span>
        {showBest && <span><span style={{ color: OKABE.vermillion }}>╍</span> best direction (PC1 of the pair)</span>}
      </div>
      <p className="min-h-4 font-mono text-[10px] text-neutral-400">
        {hovered
          ? `bar ${bars[hovered.i] ?? hovered.i}: ${featureX} ${fmt(hovered.x, 3)}, ${featureY} ${fmt(hovered.y, 3)} (centred); shadow ${fmt(hovered.along, 3)} along the line`
          : "Hover a dot for the bar and its shadow."}
      </p>
    </div>
  );
}
