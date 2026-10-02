/**
 * The HNSW demo: 220 real bars of the chosen feature pair, sized AND shaped by
 * the highest layer each lives on, the walk so far, the true nearest neighbour
 * and the query. Glyphs: ● layer 0, ■ layer 1, ▲ layer 2, ✕ the query,
 * ◇ the exact nearest, an orange trail the walk.
 */

import { OKABE, fmt } from "@/studies/kit";
import type { WalkResult, WalkWorld } from "@shared/studies/vector-space-explained";

const SIZE = 440;
const PAD = 46;
const INNER = SIZE - PAD - 12;

function marker(layer: number, x: number, y: number, key: number) {
  if (layer >= 2) return <path key={key} d={`M${x} ${y - 6.5}L${x + 6} ${y + 4.5}L${x - 6} ${y + 4.5}Z`} fill={OKABE.blue} opacity="0.65" />;
  if (layer === 1) return <rect key={key} x={x - 3.6} y={y - 3.6} width="7.2" height="7.2" fill={OKABE.blue} opacity="0.55" />;
  return <circle key={key} cx={x} cy={y} r="2.2" fill={OKABE.blue} opacity="0.45" />;
}

export function WalkPlot({
  world, layerOf, links, walk, step, showLinks, featureX, featureY,
}: {
  world: WalkWorld; layerOf: readonly number[]; links: readonly number[][]; walk: WalkResult; step: number;
  showLinks: boolean; featureX: string; featureY: string;
}) {
  let limit = 0.5;
  for (let i = 0; i < world.x.length; i += 1) limit = Math.max(limit, Math.abs(world.x[i] as number), Math.abs(world.y[i] as number));
  limit = Math.max(limit, Math.abs(world.queryX), Math.abs(world.queryY)) * 1.08;
  const px = (value: number) => PAD + ((value + limit) / (2 * limit)) * INNER;
  const py = (value: number) => 12 + (1 - (value + limit) / (2 * limit)) * INNER;
  const visited = walk.path.slice(0, step + 1).map((entry) => entry.node);
  const trail = visited.map((node) => `${px(world.x[node] as number)},${py(world.y[node] as number)}`).join(" ");
  const nearest = walk.exactNearest;
  const nearestX = px(world.x[nearest] as number);
  const nearestY = py(world.y[nearest] as number);
  const here = walk.path[Math.min(step, walk.path.length - 1)];
  const tickValues = [-limit * 0.75, -limit * 0.375, 0, limit * 0.375, limit * 0.75];

  return (
    <div className="w-full max-w-[520px]">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label={`HNSW walk over ${world.x.length} bars, step ${step}`}>
        <defs><clipPath id="walk-clip"><rect x={PAD} y={12} width={INNER} height={INNER} /></clipPath></defs>
        <rect x={PAD} y={12} width={INNER} height={INNER} fill="none" stroke="#404040" />
        {tickValues.map((value) => (
          <g key={value}>
            <text x={px(value)} y={12 + INNER + 12} fontSize="9" textAnchor="middle" className="fill-neutral-500">{fmt(value, 1)}</text>
            <text x={PAD - 4} y={py(value) + 3} fontSize="9" textAnchor="end" className="fill-neutral-500">{fmt(value, 1)}</text>
          </g>
        ))}
        <text x={PAD + INNER / 2} y={SIZE - 2} fontSize="10" textAnchor="middle" className="fill-neutral-300">{featureX} (centred z-score)</text>
        <text x={10} y={12 + INNER / 2} fontSize="10" textAnchor="middle" transform={`rotate(-90 10 ${12 + INNER / 2})`} className="fill-neutral-300">{featureY} (centred z-score)</text>
        <g clipPath="url(#walk-clip)">
          {showLinks && links.map((row, from) => row.map((to) => (
            <line key={`${from}-${to}`} x1={px(world.x[from] as number)} y1={py(world.y[from] as number)} x2={px(world.x[to] as number)} y2={py(world.y[to] as number)} stroke="#737373" strokeWidth="0.4" opacity="0.4" />
          )))}
          {Array.from(world.x, (_, i) => marker(layerOf[i] ?? 0, px(world.x[i] as number), py(world.y[i] as number), i))}
          <polyline points={trail} fill="none" stroke={OKABE.orange} strokeWidth="2" />
          {visited.map((node, order) => (
            <circle key={`v${order}`} cx={px(world.x[node] as number)} cy={py(world.y[node] as number)} r="3.2" fill={OKABE.orange} stroke="#0a0a0a" strokeWidth="0.8" />
          ))}
          <path d={`M${nearestX} ${nearestY - 9}L${nearestX + 9} ${nearestY}L${nearestX} ${nearestY + 9}L${nearestX - 9} ${nearestY}Z`} fill="none" stroke={OKABE.sky} strokeWidth="2.5" />
          <g stroke={OKABE.vermillion} strokeWidth="3">
            <line x1={px(world.queryX) - 7} y1={py(world.queryY) - 7} x2={px(world.queryX) + 7} y2={py(world.queryY) + 7} />
            <line x1={px(world.queryX) - 7} y1={py(world.queryY) + 7} x2={px(world.queryX) + 7} y2={py(world.queryY) - 7} />
          </g>
          {here && <circle cx={px(world.x[here.node] as number)} cy={py(world.y[here.node] as number)} r="7" fill="none" stroke="#f5f5f5" strokeWidth="1.5" />}
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-neutral-400">
        <span><span style={{ color: OKABE.blue }}>●</span> layer 0</span>
        <span><span style={{ color: OKABE.blue }}>■</span> up to layer 1</span>
        <span><span style={{ color: OKABE.blue }}>▲</span> up to layer 2</span>
        <span><span style={{ color: OKABE.vermillion }}>✕</span> the query</span>
        <span><span style={{ color: OKABE.sky }}>◇</span> the true nearest</span>
        <span><span style={{ color: OKABE.orange }}>━</span> the walk</span>
      </div>
    </div>
  );
}
