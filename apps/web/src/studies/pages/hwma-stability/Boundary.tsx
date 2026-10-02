/**
 * The stability boundary: every (na, nb) pair at the chosen nc coloured by the
 * measured spectral radius (blue below 1, orange above, unstable cells also
 * hatched so colour is never the only signal), the rho = 1 contour drawn from
 * the eigenvalues, and a cross where the sliders sit. Beside it, what each nc
 * slice did on the real closes. Click a cell to move the na and nb sliders.
 */

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmtInt } from "@/studies/kit";
import { radiusContour, type AccelerationCounts, type HwmaGridRow } from "@shared/studies/hwma-stability";
import { fmtWide } from "./format";

const WIDTH = 440;
const HEIGHT = 410;
const MARGIN = { left: 46, right: 10, top: 10, bottom: 44 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const LOW = 0.025;
const SPAN = 0.95;

type Rgb = [number, number, number];

function mix(from: Rgb, to: Rgb, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (index: 0 | 1 | 2) => Math.round(from[index] + (to[index] - from[index]) * clamped);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

const PALE: Rgb = [236, 236, 236];
const BLUE: Rgb = [0, 114, 178];
const ORANGE: Rgb = [230, 159, 0];

/** Diverging about 1: the lowest radius is full blue, 1 is pale, the highest is full orange. */
function radiusColour(radius: number, minimum: number, maximum: number): string {
  if (radius < 1) return mix(PALE, BLUE, (1 - radius) / Math.max(1 - minimum, 1e-9));
  return mix(PALE, ORANGE, (radius - 1) / Math.max(maximum - 1, 1e-9));
}

const xOf = (value: number) => MARGIN.left + ((value - LOW) / SPAN) * PLOT_WIDTH;
const yOf = (value: number) => MARGIN.top + (1 - (value - LOW) / SPAN) * PLOT_HEIGHT;

export function BoundaryHeatmap({
  slice, nc, na, nb, onPick,
}: {
  slice: readonly HwmaGridRow[];
  nc: number;
  na: number;
  nb: number;
  onPick: (na: number, nb: number) => void;
}) {
  const [hovered, setHovered] = useState<HwmaGridRow | null>(null);
  const radii = slice.map((row) => row.spectral_radius);
  const minimum = radii.length > 0 ? Math.min(...radii) : 0;
  const maximum = radii.length > 0 ? Math.max(...radii) : 1;
  const step = 0.05;
  const cellWidth = PLOT_WIDTH * (step / SPAN);
  const cellHeight = PLOT_HEIGHT * (step / SPAN);
  const contour = radiusContour(nc);
  const path = contour.map(([x1, y1, x2, y2]) => `M${xOf(x1).toFixed(1)} ${yOf(y1).toFixed(1)}L${xOf(x2).toFixed(1)} ${yOf(y2).toFixed(1)}`).join("");
  const ticks = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
  const pivot = Math.max(1 - minimum, 1e-9) / Math.max(maximum - minimum, 1e-9);

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-neutral-100">Spectral radius at nc = {nc.toFixed(2)}</div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[520px]" role="img" aria-label={`Spectral radius over na and nb at nc ${nc.toFixed(2)}`}>
        <defs>
          <pattern id="hwma-unstable-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#1f1f1f" strokeWidth="1.6" strokeOpacity="0.55" />
          </pattern>
          <linearGradient id="hwma-ramp" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={radiusColour(minimum, minimum, maximum)} />
            <stop offset={`${pivot * 100}%`} stopColor={`rgb(${PALE.join(", ")})`} />
            <stop offset="1" stopColor={radiusColour(maximum, minimum, maximum)} />
          </linearGradient>
        </defs>
        {slice.map((row) => (
          <g key={`${row.na}-${row.nb}`} onMouseEnter={() => setHovered(row)} onMouseLeave={() => setHovered(null)} onClick={() => onPick(row.na, row.nb)} className="cursor-pointer">
            <rect x={xOf(row.na) - cellWidth / 2} y={yOf(row.nb) - cellHeight / 2} width={cellWidth} height={cellHeight} fill={radiusColour(row.spectral_radius, minimum, maximum)} stroke="#0a0a0a" strokeOpacity="0.35" strokeWidth="0.5" />
            {!row.spectrally_stable && (
              <rect x={xOf(row.na) - cellWidth / 2} y={yOf(row.nb) - cellHeight / 2} width={cellWidth} height={cellHeight} fill="url(#hwma-unstable-hatch)" pointerEvents="none" />
            )}
            <title>{`na ${row.na.toFixed(2)}  nb ${row.nb.toFixed(2)}  rho ${row.spectral_radius.toFixed(4)}`}</title>
          </g>
        ))}
        {path && <path d={path} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="4.5" fill="none" strokeLinecap="round" pointerEvents="none" />}
        {path && <path d={path} stroke="#000000" strokeWidth="2" fill="none" strokeLinecap="round" pointerEvents="none" />}
        <g pointerEvents="none">
          <line x1={xOf(na) - 9} x2={xOf(na) + 9} y1={yOf(nb) - 9} y2={yOf(nb) + 9} stroke="#ffffff" strokeWidth="5.5" />
          <line x1={xOf(na) - 9} x2={xOf(na) + 9} y1={yOf(nb) + 9} y2={yOf(nb) - 9} stroke="#ffffff" strokeWidth="5.5" />
          <line x1={xOf(na) - 9} x2={xOf(na) + 9} y1={yOf(nb) - 9} y2={yOf(nb) + 9} stroke="#000000" strokeWidth="3" />
          <line x1={xOf(na) - 9} x2={xOf(na) + 9} y1={yOf(nb) + 9} y2={yOf(nb) - 9} stroke="#000000" strokeWidth="3" />
        </g>
        {ticks.map((tick) => (
          <g key={tick} className="fill-neutral-400" fontSize="9">
            <text x={xOf(tick)} y={HEIGHT - MARGIN.bottom + 13} textAnchor="middle">{tick.toFixed(2)}</text>
            <text x={MARGIN.left - 6} y={yOf(tick) + 3} textAnchor="end">{tick.toFixed(2)}</text>
          </g>
        ))}
        <text x={MARGIN.left + PLOT_WIDTH / 2} y={HEIGHT - 18} textAnchor="middle" fontSize="10" className="fill-neutral-300">na, level correction</text>
        <text transform={`translate(11 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" className="fill-neutral-300">nb, velocity correction</text>
        <rect x={MARGIN.left} y={HEIGHT - 10} width={PLOT_WIDTH} height="6" fill="url(#hwma-ramp)" />
        <text x={MARGIN.left} y={HEIGHT - 12} fontSize="8" className="fill-neutral-400">{minimum.toFixed(3)}</text>
        <text x={MARGIN.left + PLOT_WIDTH} y={HEIGHT - 12} fontSize="8" textAnchor="end" className="fill-neutral-400">{maximum.toFixed(3)}</text>
      </svg>
      <p className="min-h-[2.5rem] font-mono text-[11px] text-neutral-300">
        {hovered ? (
          <>
            na {hovered.na.toFixed(2)}, nb {hovered.nb.toFixed(2)}: rho {hovered.spectral_radius.toFixed(4)} ({hovered.spectrally_stable ? "stable" : "unstable"}),{" "}
            {hovered.went_negative_unbounded ? "goes negative" : "stays positive"},{" "}
            {hovered.left_range_at_bar === null ? "never left the range" : `left the range at bar ${fmtInt(hovered.left_range_at_bar)}`}, unbounded minimum {fmtWide(hovered.unbounded_minimum)}
          </>
        ) : (
          <span className="text-neutral-500">
            Hover a cell for its measurement; click it to move the sliders. Blue decays; hatched orange compounds; the black line is rho = 1; the cross is the slider setting.
          </span>
        )}
      </p>
    </div>
  );
}

type ShapeKind = "circle" | "square" | "triangle";

function dotOf(kind: ShapeKind, color: string) {
  return function Dot(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy } = props;
    if (cx === undefined || cy === undefined) return <g key={`${kind}-${props.index}`} />;
    if (kind === "circle") return <circle key={`${kind}-${props.index}`} cx={cx} cy={cy} r={3.5} fill={color} />;
    if (kind === "square") return <rect key={`${kind}-${props.index}`} x={cx - 3.2} y={cy - 3.2} width={6.4} height={6.4} fill={color} />;
    return <polygon key={`${kind}-${props.index}`} points={`${cx},${cy - 4.2} ${cx + 4},${cy + 3.2} ${cx - 4},${cy + 3.2}`} fill={color} />;
  };
}

const UNSTABLE_DOT = dotOf("circle", OKABE.orange);
const NEGATIVE_DOT = dotOf("square", OKABE.blue);
const STOPPED_DOT = dotOf("triangle", "#d4d4d4");

export function OutcomeCounts({ counts, nc }: { counts: readonly AccelerationCounts[]; nc: number }) {
  const per = counts[0]?.combinations ?? 361;
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-neutral-100">What each nc slice does on the real closes (of {per} combinations per nc)</div>
      <ResponsiveContainer width="100%" height={HEIGHT - 18}>
        <LineChart data={counts as AccelerationCounts[]} margin={{ top: 8, right: 14, left: 4, bottom: 18 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="nc" type="number" domain={[0.05, 0.95]} ticks={[0.05, 0.25, 0.45, 0.65, 0.85, 0.95]} {...AXIS} label={{ value: "nc, acceleration correction", position: "insideBottom", offset: -10, fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis domain={[0, per]} {...AXIS} width={36} label={{ value: "combinations", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip {...TOOLTIP} labelFormatter={(label) => `nc = ${Number(label).toFixed(2)}`} />
          <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine x={nc} stroke={OKABE.sky} strokeDasharray="3 3" label={{ value: "your nc", position: "top", fontSize: 10, fill: OKABE.sky }} />
          <Line dataKey="unstable" name="unstable" stroke={OKABE.orange} strokeWidth={2} dot={UNSTABLE_DOT} isAnimationActive={false} />
          <Line dataKey="goesNegative" name="goes negative" stroke={OKABE.blue} strokeWidth={2} strokeDasharray="5 3" dot={NEGATIVE_DOT} isAnimationActive={false} />
          <Line dataKey="stoppedEarly" name="stopped early" stroke="#d4d4d4" strokeWidth={2} strokeDasharray="2 2" dot={STOPPED_DOT} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
