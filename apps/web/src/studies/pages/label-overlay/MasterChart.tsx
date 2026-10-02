/**
 * The master chart: candles with the marker-style labels drawn on them.
 *
 *   swing pivots   up-triangle below the bar (next pivot is a HIGH), down-triangle
 *                  above it (a LOW), hollow circle at the middle (timeout)
 *   barrier boxes  entry close +/- the band, five bars wide, outline by outcome,
 *                  an X at the exit bar
 *   regime shading a band behind the bars, plus a labelled ribbon on top
 *
 * Orange is up / take-profit, blue is down / stop-loss, purple is timeout.
 * Every encoding also carries a shape, a dash pattern or a word.
 */

import { OKABE, fmt } from "@/studies/kit";
import { BARRIER_BOX_BARS, type BarrierBox, type RegimeRun, type WindowRow } from "@shared/studies/label-overlay";
import { LegendChip, Plot, visibleRange, type Viewport } from "./chart";

export const UP = OKABE.orange;
export const DOWN = OKABE.blue;
export const TIMEOUT = OKABE.purple;

const REGIME_FILL: Record<number, string> = { 0: "rgba(86,180,233,0.10)", 1: "rgba(148,163,184,0.06)", 2: "rgba(230,159,0,0.13)" };
const REGIME_WORD: Record<number, string> = { 0: "low volatility", 1: "middle volatility", 2: "high volatility" };
const OUTCOME_COLOUR: Record<number, string> = { 1: UP, [-1]: DOWN, 0: TIMEOUT };
const OUTCOME_DASH: Record<number, string> = { 1: "2 2", [-1]: "6 2", 0: "1 3" };
const OUTCOME_WORD: Record<number, string> = { 1: "take-profit first (+1)", [-1]: "stop-loss first (-1)", 0: "vertical barrier (0)" };

export interface MasterShow {
  regime: boolean;
  swing: boolean;
  barriers: boolean;
}

export interface MasterChartProps {
  rows: readonly WindowRow[];
  boxes: readonly BarrierBox[];
  runs: readonly RegimeRun[];
  show: MasterShow;
  viewport: Viewport;
  onViewport: (next: Viewport | null) => void;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

export function MasterChart({ rows, boxes, runs, show, viewport, onViewport, hoverIndex, onHover }: MasterChartProps) {
  const { first, last } = visibleRange(viewport, rows.length);
  let low = Infinity;
  let high = -Infinity;
  for (let i = first; i <= last; i += 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.low < low) low = row.low;
    if (row.high > high) high = row.high;
  }
  if (show.barriers) {
    for (const box of boxes) {
      if (box.rightIndex < first || box.index > last) continue;
      low = Math.min(low, box.lower);
      high = Math.max(high, box.upper);
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const pad = (high - low) * 0.06 || 1;
  const swingPad = (high - low) * 0.012;

  return (
    <Plot
      length={rows.length}
      timestamps={rows.map((row) => row.timestamp)}
      viewport={viewport}
      onViewport={onViewport}
      hoverIndex={hoverIndex}
      onHover={onHover}
      height={420}
      yDomain={[low - pad, high + pad]}
      yFormat={(value) => fmt(value, 0)}
      yTitle="price (points)"
      ariaLabel="Candlesticks with swing pivots, triple-barrier boxes and volatility regime shading"
    >
      {(g) => (
        <>
          {show.regime &&
            runs.map((run) => {
              if (run.to < first || run.from > last) return null;
              const x0 = g.x(run.from + 0.5);
              const x1 = g.x(run.to + 0.5);
              return (
                <g key={`${run.from}-${run.regime}`}>
                  <rect x={x0} y={g.top} width={Math.max(0, x1 - x0)} height={g.innerHeight} fill={REGIME_FILL[run.regime] ?? "transparent"} />
                  <rect x={x0} y={g.top} width={Math.max(0, x1 - x0)} height={5} fill={REGIME_FILL[run.regime] ?? "transparent"} stroke="#525252" strokeWidth={0.5}>
                    <title>{`${REGIME_WORD[run.regime] ?? `regime ${run.regime}`}: bars ${run.from} to ${run.to}`}</title>
                  </rect>
                  {x1 - x0 > 44 && (
                    <text x={x0 + 3} y={g.top + 14} fontSize={9} fill="#a3a3a3">
                      {run.regime === 0 ? "low vol" : run.regime === 1 ? "mid vol" : "high vol"}
                    </text>
                  )}
                </g>
              );
            })}
          {rows.slice(first, last + 1).map((row, offset) => {
            const i = first + offset;
            const up = row.close >= row.open;
            const colour = up ? UP : DOWN;
            const cx = g.x(i + 0.5);
            const bodyTop = g.y(Math.max(row.open, row.close));
            const bodyBottom = g.y(Math.min(row.open, row.close));
            const bodyWidth = Math.max(1, g.slotWidth * 0.7);
            return (
              <g key={row.row_number}>
                <line x1={cx} x2={cx} y1={g.y(row.high)} y2={g.y(row.low)} stroke={colour} strokeWidth={1} />
                <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={Math.max(1, bodyBottom - bodyTop)} fill={up ? colour : "#0a0a0a"} stroke={colour} strokeWidth={1} />
              </g>
            );
          })}
          {show.barriers &&
            boxes.map((box) => {
              if (box.rightIndex < first || box.index > last) return null;
              const colour = OUTCOME_COLOUR[box.outcome] ?? TIMEOUT;
              const x0 = g.x(box.index + 0.5);
              const x1 = g.x(box.rightIndex + 0.5);
              const ex = g.x(box.exitIndex + 0.5);
              const row = rows[box.exitIndex];
              const ey = g.y(row?.close ?? box.entry);
              return (
                <g key={`box${box.index}`}>
                  <rect x={x0} y={g.y(box.upper)} width={Math.max(1, x1 - x0)} height={Math.abs(g.y(box.lower) - g.y(box.upper))} fill="none" stroke={colour} strokeWidth={1.2} strokeDasharray={OUTCOME_DASH[box.outcome]}>
                    <title>{`${OUTCOME_WORD[box.outcome] ?? "barrier"}: entry ${fmt(box.entry, 2)}, band ${fmt(box.upper - box.entry, 2)} points, exit at bar ${box.exitIndex}`}</title>
                  </rect>
                  <path d={`M${ex - 4} ${ey - 4} L${ex + 4} ${ey + 4} M${ex - 4} ${ey + 4} L${ex + 4} ${ey - 4}`} stroke={colour} strokeWidth={2} fill="none" />
                </g>
              );
            })}
          {show.swing &&
            rows.slice(first, last + 1).map((row, offset) => {
              const i = first + offset;
              const label = row.next_swing_pivot_direction;
              if (label === null) return null;
              const cx = g.x(i + 0.5);
              if (label === 1) {
                const cy = g.y(row.low - swingPad);
                return <path key={`s${row.row_number}`} d={`M${cx} ${cy - 6} L${cx - 4.5} ${cy + 2} L${cx + 4.5} ${cy + 2} Z`} fill={UP} stroke={UP}><title>{`bar ${i}: next pivot is a HIGH (+1)`}</title></path>;
              }
              if (label === -1) {
                const cy = g.y(row.high + swingPad);
                return <path key={`s${row.row_number}`} d={`M${cx} ${cy + 6} L${cx - 4.5} ${cy - 2} L${cx + 4.5} ${cy - 2} Z`} fill={DOWN} stroke={DOWN}><title>{`bar ${i}: next pivot is a LOW (-1)`}</title></path>;
              }
              return <circle key={`s${row.row_number}`} cx={cx} cy={g.y((row.high + row.low) / 2)} r={4} fill="none" stroke={TIMEOUT} strokeWidth={1.5}><title>{`bar ${i}: swing timeout (0)`}</title></circle>;
            })}
        </>
      )}
    </Plot>
  );
}

export function MasterLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <LegendChip colour={UP} label="swing: next pivot is a HIGH (+1)" glyph={<path d="M7 1 L2.5 10 L11.5 10 Z" />} />
      <LegendChip colour={DOWN} label="swing: next pivot is a LOW (-1)" glyph={<path d="M7 11 L2.5 2 L11.5 2 Z" />} />
      <LegendChip colour={TIMEOUT} label="swing: timeout (0)" glyph={<circle cx="7" cy="6" r="4" fill="none" strokeWidth="1.5" />} />
      {([1, -1, 0] as const).map((outcome) => (
        <LegendChip
          key={outcome}
          colour={OUTCOME_COLOUR[outcome] as string}
          label={`barrier: ${OUTCOME_WORD[outcome]}`}
          glyph={<rect x="1.5" y="2.5" width="11" height="7" fill="none" strokeWidth="1.2" strokeDasharray={OUTCOME_DASH[outcome]} />}
        />
      ))}
      <LegendChip colour="#a3a3a3" label={`X marks the exit bar; boxes are ${BARRIER_BOX_BARS} bars wide`} glyph={<path d="M3 2 L11 10 M3 10 L11 2" strokeWidth="2" fill="none" />} />
      <LegendChip colour={OKABE.sky} label="shaded: low / high volatility regime (causal tercile)" glyph={<rect x="1" y="2" width="12" height="8" fillOpacity="0.3" />} />
    </div>
  );
}
