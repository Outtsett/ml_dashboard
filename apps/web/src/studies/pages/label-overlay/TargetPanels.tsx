/**
 * The direction strip and the three panels of continuous targets, each on the
 * same bar axis as the master chart.
 *
 * Strip: one row per horizon, one cell per bar. An UP label fills the top half
 * of its row (orange), a DOWN label the bottom half (blue), and a bar with no
 * label (the tail of the dataset) a thin grey line, so the answer is in the
 * position as well as the colour.
 */

import { OKABE, fmt } from "@/studies/kit";
import { DIRECTION_HORIZONS, directionColumn, forwardReturnColumn, type WindowRow } from "@shared/studies/label-overlay";
import { LegendChip, Plot, visibleRange, type Viewport } from "./chart";
import { DOWN, UP } from "./MasterChart";

interface SharedProps {
  rows: readonly WindowRow[];
  viewport: Viewport;
  onViewport: (next: Viewport | null) => void;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

const stamps = (rows: readonly WindowRow[]): number[] => rows.map((row) => row.timestamp);

export function DirectionStrip({ rows, viewport, onViewport, hoverIndex, onHover }: SharedProps) {
  const { first, last } = visibleRange(viewport, rows.length);
  const horizons = DIRECTION_HORIZONS;
  return (
    <Plot
      length={rows.length}
      timestamps={stamps(rows)}
      viewport={viewport}
      onViewport={onViewport}
      hoverIndex={hoverIndex}
      onHover={onHover}
      height={190}
      yDomain={[-0.5, horizons.length - 0.5]}
      yTickLabels={horizons.map((horizon, row) => ({ value: horizons.length - 1 - row, label: String(horizon) }))}
      yTitle="bars ahead"
      ariaLabel="Direction labels by forward horizon: orange up, blue down"
    >
      {(g) => (
        <>
          {horizons.map((horizon, row) => {
            const key = directionColumn(horizon);
            const centre = horizons.length - 1 - row;
            const top = g.y(centre + 0.42);
            const middle = g.y(centre);
            const bottom = g.y(centre - 0.42);
            // Runs of one value become one rectangle: 2,000 bars x 7 rows stay a few hundred elements.
            const cells: Array<{ from: number; to: number; value: number | null }> = [];
            for (let i = first; i <= last; i += 1) {
              const value = rows[i]?.[key] ?? null;
              const previous = cells[cells.length - 1];
              if (previous && previous.value === value) previous.to = i;
              else cells.push({ from: i, to: i, value });
            }
            return cells.map((cell) => {
              const x0 = g.x(cell.from);
              const width = Math.max(0.6, g.x(cell.to + 1) - x0);
              if (cell.value === 1) return <rect key={`${row}-${cell.from}`} x={x0} y={top} width={width} height={middle - top} fill={UP} />;
              if (cell.value === 0) return <rect key={`${row}-${cell.from}`} x={x0} y={middle} width={width} height={bottom - middle} fill={DOWN} />;
              return <rect key={`${row}-${cell.from}`} x={x0} y={middle - 0.5} width={width} height={1} fill="#525252" />;
            });
          })}
        </>
      )}
    </Plot>
  );
}

export function DirectionLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <LegendChip colour={UP} label="up (1): close ahead is above this close, drawn in the top half" glyph={<rect x="1" y="1" width="12" height="5" />} />
      <LegendChip colour={DOWN} label="down (0): drawn in the bottom half" glyph={<rect x="1" y="6" width="12" height="5" />} />
      <LegendChip colour="#737373" label="no label (tail of the dataset)" glyph={<rect x="1" y="5.5" width="12" height="1" />} />
    </div>
  );
}

function extent(rows: readonly WindowRow[], first: number, last: number, pick: (row: WindowRow) => Array<number | null>): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (let i = first; i <= last; i += 1) {
    const row = rows[i];
    if (!row) continue;
    for (const value of pick(row)) {
      if (value === null || !Number.isFinite(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  const pad = (high - low) * 0.08 || 1;
  return [low - pad, high + pad];
}

function polyline(g: { x: (slot: number) => number; y: (v: number) => number }, rows: readonly WindowRow[], first: number, last: number, key: string, step = false): string {
  let d = "";
  let open = false;
  let previousY = 0;
  for (let i = first; i <= last; i += 1) {
    const value = rows[i]?.[key] ?? null;
    if (value === null || !Number.isFinite(value)) {
      open = false;
      continue;
    }
    const px = g.x(i + 0.5);
    const py = g.y(value);
    if (!open) d += `M${px.toFixed(1)} ${py.toFixed(1)} `;
    else if (step) d += `L${px.toFixed(1)} ${previousY.toFixed(1)} L${px.toFixed(1)} ${py.toFixed(1)} `;
    else d += `L${px.toFixed(1)} ${py.toFixed(1)} `;
    previousY = py;
    open = true;
  }
  return d;
}

/** Panel 1: the volatility target is the same series one bar earlier. */
export function VolatilityPanel({ rows, viewport, onViewport, hoverIndex, onHover }: SharedProps) {
  const { first, last } = visibleRange(viewport, rows.length);
  const domain = extent(rows, first, last, (row) => [row.log_bar_range, row.log_bar_range_1_bars_ahead]);
  return (
    <Plot
      length={rows.length}
      timestamps={stamps(rows)}
      viewport={viewport}
      onViewport={onViewport}
      hoverIndex={hoverIndex}
      onHover={onHover}
      height={150}
      yDomain={domain}
      yFormat={(v) => fmt(v, 1)}
      yTitle="log range"
      ariaLabel="Log bar range now against the volatility target, which is the same series one bar earlier"
    >
      {(g) => (
        <>
          <path d={polyline(g, rows, first, last, "log_bar_range")} fill="none" stroke="#a3a3a3" strokeWidth={1.4} />
          <path d={polyline(g, rows, first, last, "log_bar_range_1_bars_ahead")} fill="none" stroke={UP} strokeWidth={1.6} strokeDasharray="1 3" strokeLinecap="round" />
          {rows.slice(first, last + 1).map((row, offset) =>
            row.zero_range_bar === 1 ? (
              <path key={row.row_number} d={`M${g.x(first + offset + 0.5) - 3} ${g.y(domain[0]) - 3} l6 -6 m-6 0 l6 6`} stroke={OKABE.vermillion} strokeWidth={2} fill="none">
                <title>{`bar ${first + offset}: zero range, masked (no log range, no label)`}</title>
              </path>
            ) : null,
          )}
        </>
      )}
    </Plot>
  );
}

/** Panel 2: the next-bar close change as bars, its 21-bucket class as a step line on the right axis. */
export function DeltaPanel({ rows, viewport, onViewport, hoverIndex, onHover }: SharedProps) {
  const { first, last } = visibleRange(viewport, rows.length);
  const [low, high] = extent(rows, first, last, (row) => [row.close_change_points_after_1_bars, 0]);
  return (
    <Plot
      length={rows.length}
      timestamps={stamps(rows)}
      viewport={viewport}
      onViewport={onViewport}
      hoverIndex={hoverIndex}
      onHover={onHover}
      height={150}
      yDomain={[low, high]}
      yFormat={(v) => fmt(v, 0)}
      yTitle="close change (points)"
      rightAxis={{ domain: [-0.5, 20.5], format: (v) => fmt(v, 0), title: "range bucket (0 to 20)" }}
      ariaLabel="Next-bar close change in points and the 21-bucket range class of the next bar"
    >
      {(g) => (
        <>
          <line x1={g.left} x2={g.left + g.innerWidth} y1={g.y(0)} y2={g.y(0)} stroke="#525252" />
          {rows.slice(first, last + 1).map((row, offset) => {
            const value = row.close_change_points_after_1_bars;
            if (value === null) return null;
            const i = first + offset;
            const width = Math.max(1, g.slotWidth * 0.7);
            const y0 = g.y(0);
            const y1 = g.y(value);
            return <rect key={row.row_number} x={g.x(i + 0.5) - width / 2} y={Math.min(y0, y1)} width={width} height={Math.max(0.5, Math.abs(y1 - y0))} fill={value >= 0 ? UP : DOWN} />;
          })}
          <path d={polyline({ x: g.x, y: g.yRight }, rows, first, last, "next_bar_range_bucket", true)} fill="none" stroke={OKABE.sky} strokeWidth={1.3} />
        </>
      )}
    </Plot>
  );
}

const FORWARD_STYLES = [
  { horizon: 15, colour: OKABE.orange, dash: undefined, word: "solid" },
  { horizon: 60, colour: OKABE.sky, dash: undefined, word: "solid" },
  { horizon: 240, colour: OKABE.purple, dash: "6 3", word: "dashed" },
  { horizon: 1440, colour: OKABE.grey, dash: "1 3", word: "dotted" },
] as const;

export type ForwardToggles = Record<15 | 60 | 240 | 1440, boolean>;

/** Panel 3: forward log returns at four horizons with a zero rule. */
export function ForwardPanel({ rows, viewport, onViewport, hoverIndex, onHover, shown }: SharedProps & { shown: ForwardToggles }) {
  const { first, last } = visibleRange(viewport, rows.length);
  const active = FORWARD_STYLES.filter((style) => shown[style.horizon]);
  const domain = extent(rows, first, last, (row) => [0, ...active.map((style) => row[forwardReturnColumn(style.horizon)] ?? null)]);
  return (
    <Plot
      length={rows.length}
      timestamps={stamps(rows)}
      viewport={viewport}
      onViewport={onViewport}
      hoverIndex={hoverIndex}
      onHover={onHover}
      height={170}
      yDomain={domain}
      yFormat={(v) => `${fmt(v * 100, 2)}%`}
      yTitle="forward log return"
      ariaLabel="Forward log returns at 15, 60, 240 and 1440 bars ahead"
    >
      {(g) => (
        <>
          <line x1={g.left} x2={g.left + g.innerWidth} y1={g.y(0)} y2={g.y(0)} stroke="#737373" strokeDasharray="2 3" />
          {active.map((style) => (
            <path key={style.horizon} d={polyline(g, rows, first, last, forwardReturnColumn(style.horizon))} fill="none" stroke={style.colour} strokeWidth={1.4} strokeDasharray={style.dash} />
          ))}
        </>
      )}
    </Plot>
  );
}

export function ForwardLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {FORWARD_STYLES.map((style) => (
        <LegendChip
          key={style.horizon}
          colour={style.colour}
          label={`${style.horizon} bars ahead (${style.word})`}
          glyph={<line x1="1" x2="13" y1="6" y2="6" strokeWidth="2" strokeDasharray={style.dash} />}
        />
      ))}
    </div>
  );
}
