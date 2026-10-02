/**
 * Candles on top, one pane per chosen column beneath, all on one shared x
 * axis (bar index, so a feature value sits directly under the bar that
 * produced it). Hover any bar for the exact values of every pane. Up is
 * orange and filled, down is blue and hollow; positive bars are orange and
 * negative blue; overlays carry a label as well as a colour.
 */

import { useState, type PointerEvent } from "react";
import { OKABE, fmt } from "@/studies/kit";
import { BAR_COLUMNS, columnSpec, inSession, type WindowRow } from "@shared/studies/market-series-explorer";
import { axisLabels, clock, compact, evenIndices, linear, niceTicks, useWidth } from "./layout";

const LEFT = 64;
const RIGHT = 10;
const TOP = 8;
const CANDLE_HEIGHT = 250;
const PANE_HEIGHT = 92;
const PANE_GAP = 10;
const AXIS_HEIGHT = 24;
const LINE_COLORS = [OKABE.sky, OKABE.green, OKABE.yellow, OKABE.vermillion];
const UP = OKABE.orange;
const DOWN = OKABE.blue;
const ROLL = OKABE.purple;

function numberAt(row: WindowRow, column: string): number | null {
  const value = row[column];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface PriceAxis {
  y: (price: number) => number;
  ticks: number[];
}

function priceAxis(rows: readonly WindowRow[], logPrice: boolean, top: number, bottom: number): PriceAxis {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    low = Math.min(low, row.low);
    high = Math.max(high, row.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { y: () => top, ticks: [] };
  if (logPrice && low > 0) {
    const a = Math.log(low);
    const b = Math.log(high);
    const pad = (b - a) * 0.05 || 0.01;
    const scale = linear([a - pad, b + pad], [bottom, top]);
    const ticks = Array.from({ length: 5 }, (_unused, i) => Math.exp(a + ((b - a) * i) / 4));
    return { y: (price) => scale(Math.log(price)), ticks };
  }
  const pad = (high - low) * 0.05 || 1;
  const scale = linear([low - pad, high + pad], [bottom, top]);
  return { y: scale, ticks: niceTicks(low, high, 4) };
}

interface PaneData {
  column: string;
  label: string;
  kind: "bar" | "line";
  unit: string;
  color: string;
  values: Array<number | null>;
  nullCount: number;
  y: (value: number) => number;
  top: number;
  bottom: number;
  ticks: number[];
  zeroVisible: boolean;
}

function buildPane(rows: readonly WindowRow[], column: string, order: number, top: number): PaneData {
  const spec = columnSpec(column);
  const kind = spec?.kind ?? (BAR_COLUMNS.includes(column) ? "bar" : "line");
  const values = rows.map((row) => numberAt(row, column));
  const known = values.filter((value): value is number => value !== null);
  let low = known.length > 0 ? Math.min(...known) : -1;
  let high = known.length > 0 ? Math.max(...known) : 1;
  if (kind === "bar") {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const pad = (high - low) * 0.08 || 0.5;
  const bottom = top + PANE_HEIGHT;
  const y = linear([low - pad, high + pad], [bottom - 4, top + 4]);
  return {
    column,
    label: spec?.label ?? column,
    kind,
    unit: spec?.unit ?? "",
    color: LINE_COLORS[order % LINE_COLORS.length] as string,
    values,
    nullCount: values.length - known.length,
    y,
    top,
    bottom,
    ticks: niceTicks(low, high, 2),
    zeroVisible: low - pad < 0 && high + pad > 0,
  };
}

function linePath(pane: PaneData, x: (index: number) => number): string {
  let path = "";
  let pen = false;
  pane.values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${pane.y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

export interface AlignedPanesProps {
  rows: readonly WindowRow[];
  panes: readonly string[];
  title: string;
  logPrice: boolean;
  rollTimestamps: readonly number[];
  showRolls: boolean;
  showSession: boolean;
  sessionStart: number;
  sessionEnd: number;
}

export function AlignedPanes({ rows, panes, title, logPrice, rollTimestamps, showRolls, showSession, sessionStart, sessionEnd }: AlignedPanesProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const count = rows.length;
  const plotWidth = Math.max(width - LEFT - RIGHT, 50);
  const step = plotWidth / Math.max(count, 1);
  const x = (index: number) => LEFT + (index + 0.5) * step;

  const candleBottom = TOP + CANDLE_HEIGHT;
  const axis = priceAxis(rows, logPrice, TOP + 6, candleBottom - 6);
  const paneData = panes.map((column, order) => buildPane(rows, column, order, candleBottom + PANE_GAP + order * (PANE_HEIGHT + PANE_GAP)));
  const plotBottom = paneData.length > 0 ? (paneData[paneData.length - 1] as PaneData).bottom : candleBottom;
  const totalHeight = plotBottom + AXIS_HEIGHT;

  const timestamps = rows.map((row) => row.timestamp);
  const tickIndices = evenIndices(count, Math.max(Math.floor(plotWidth / 90), 2));
  const tickLabels = axisLabels(timestamps, tickIndices);

  const rollIndices = new Set<number>();
  if (showRolls) {
    for (const at of rollTimestamps) {
      const index = timestamps.findIndex((timestamp) => timestamp >= at);
      if (index >= 0) rollIndices.add(index);
    }
  }

  // Contiguous runs of in-session bars become one rectangle each.
  const sessionRuns: Array<[number, number]> = [];
  if (showSession) {
    let start = -1;
    rows.forEach((row, index) => {
      const inside = inSession(row.timestamp, sessionStart, sessionEnd);
      if (inside && start < 0) start = index;
      if (!inside && start >= 0) {
        sessionRuns.push([start, index - 1]);
        start = -1;
      }
    });
    if (start >= 0) sessionRuns.push([start, count - 1]);
  }

  const bodyWidth = Math.max(1, Math.min(step * 0.66, 14));
  const barWidth = Math.max(1, Math.min(step * 0.8, 16));

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - LEFT) / step);
    setHover(index >= 0 && index < count ? index : null);
  };

  const shown = hover ?? null;
  const readoutRow = shown === null ? undefined : rows[shown];

  if (count === 0) return <p className="py-6 text-center text-xs text-neutral-500">No bars in this span.</p>;

  return (
    <div ref={ref} className="min-w-0">
      <p className="text-[11px] text-neutral-300">{title}</p>
      <p className="mb-1 min-h-[2.4em] font-mono text-[10px] leading-snug text-neutral-400 tnum">
        {readoutRow ? (
          <>
            <span className="text-neutral-100">{clock(readoutRow.timestamp)}</span> {readoutRow.contract_symbol}
            {readoutRow.is_contract_roll_day ? " (roll day)" : ""} · open {fmt(readoutRow.open, 2)} high {fmt(readoutRow.high, 2)} low {fmt(readoutRow.low, 2)} close{" "}
            {fmt(readoutRow.close, 2)}
            {paneData.map((pane) => {
              const value = pane.values[shown as number];
              return (
                <span key={pane.column}>
                  {" "}· {pane.label} {value === null || value === undefined ? "unknown" : compact(value)}
                </span>
              );
            })}
          </>
        ) : (
          "Hover a bar for its exact values."
        )}
      </p>
      <svg
        width={width}
        height={totalHeight}
        role="img"
        aria-label={`${title}; candles with ${panes.length} aligned panes`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-none select-none"
      >
        {sessionRuns.map(([from, to]) => (
          <rect key={`session-${from}`} x={x(from) - step / 2} y={TOP} width={(to - from + 1) * step} height={plotBottom - TOP} fill="#9aa0a6" opacity={0.09} />
        ))}

        {axis.ticks.map((tick) => (
          <g key={`price-${tick}`}>
            <line x1={LEFT} x2={LEFT + plotWidth} y1={axis.y(tick)} y2={axis.y(tick)} stroke="#2a2a2a" strokeWidth={0.6} />
            <text x={LEFT - 6} y={axis.y(tick) + 3} textAnchor="end" fontSize={9} fill="#9a9a9a">
              {compact(tick)}
            </text>
          </g>
        ))}
        <text x={4} y={TOP + 10} fontSize={9} fill="#9a9a9a">
          {logPrice ? "price (log)" : "price"}
        </text>

        {rows.map((row, index) => {
          const up = row.close >= row.open;
          const color = up ? UP : DOWN;
          const top = axis.y(Math.max(row.open, row.close));
          const bottom = axis.y(Math.min(row.open, row.close));
          return (
            <g key={row.timestamp}>
              <line x1={x(index)} x2={x(index)} y1={axis.y(row.high)} y2={axis.y(row.low)} stroke={color} strokeWidth={1} />
              <rect
                x={x(index) - bodyWidth / 2}
                y={top}
                width={bodyWidth}
                height={Math.max(bottom - top, 1)}
                fill={up ? color : "#0c1f2e"}
                stroke={color}
                strokeWidth={1}
              />
            </g>
          );
        })}

        {paneData.map((pane) => (
          <g key={pane.column}>
            <rect x={LEFT} y={pane.top} width={plotWidth} height={PANE_HEIGHT} fill="none" stroke="#262626" strokeWidth={0.6} />
            {pane.zeroVisible && <line x1={LEFT} x2={LEFT + plotWidth} y1={pane.y(0)} y2={pane.y(0)} stroke="#6b6b6b" strokeWidth={0.8} strokeDasharray="3 3" />}
            {pane.ticks.map((tick) => (
              <text key={tick} x={LEFT - 6} y={pane.y(tick) + 3} textAnchor="end" fontSize={9} fill="#9a9a9a">
                {compact(tick)}
              </text>
            ))}
            <text x={LEFT + 6} y={pane.top + 11} fontSize={10} fill="#d4d4d4">
              {pane.kind === "bar" ? "▮ " : "▬ "}
              {pane.label}
              <tspan fill="#8a8a8a"> ({pane.unit})</tspan>
            </text>
            {pane.nullCount > 0 && (
              <text x={LEFT + plotWidth - 6} y={pane.top + 11} textAnchor="end" fontSize={10} fill={OKABE.yellow}>
                {pane.nullCount} null
              </text>
            )}
            {pane.kind === "bar"
              ? pane.values.map((value, index) =>
                  value === null ? null : (
                    <rect
                      key={index}
                      x={x(index) - barWidth / 2}
                      y={Math.min(pane.y(value), pane.y(0))}
                      width={barWidth}
                      height={Math.max(Math.abs(pane.y(value) - pane.y(0)), 0.5)}
                      fill={value >= 0 ? UP : DOWN}
                    />
                  ),
                )
              : <path d={linePath(pane, x)} fill="none" stroke={pane.color} strokeWidth={1.4} />}
          </g>
        ))}

        {[...rollIndices].map((index, order) => (
          <g key={`roll-${index}`}>
            <line x1={x(index)} x2={x(index)} y1={TOP} y2={plotBottom} stroke={ROLL} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.85} />
            <path d={`M${x(index)},${TOP} l4,5 l-4,5 l-4,-5 z`} fill={ROLL} />
            {order === 0 && (
              <text x={x(index) + 7} y={TOP + 10} fontSize={9} fill={ROLL}>
                roll
              </text>
            )}
          </g>
        ))}

        {shown !== null && <line x1={x(shown)} x2={x(shown)} y1={TOP} y2={plotBottom} stroke="#e5e5e5" strokeWidth={0.8} opacity={0.7} />}

        {tickIndices.map((index, order) => (
          <text key={index} x={x(index)} y={plotBottom + 15} textAnchor={x(index) > width - 36 ? "end" : "middle"} fontSize={9} fill="#9a9a9a">
            {tickLabels[order]}
          </text>
        ))}
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500">
        <span><span style={{ color: UP }}>■</span> up bar (filled) and positive value</span>
        <span><span style={{ color: DOWN }}>□</span> down bar (hollow) and negative value</span>
        {showRolls && <span><span style={{ color: ROLL }}>◆</span> first bar of a roll day</span>}
        {showSession && <span><span className="text-neutral-400">▒</span> session hours {sessionStart} to {sessionEnd} (stored clock)</span>}
      </p>
    </div>
  );
}
