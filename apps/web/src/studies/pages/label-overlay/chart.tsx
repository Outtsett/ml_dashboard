/**
 * The one SVG frame every panel of the label-overlay page is drawn in.
 *
 * All panels (candles, direction strip, continuous targets) share an x axis of
 * bar slots: slot i is bar i, spanning [i, i + 1). A viewport `{ from, to }`
 * in slots is zoomed with the wheel, panned by dragging and reset by the
 * caller, and a hover index is shared so one crosshair runs down every panel.
 * Drawing is a function of the geometry handed to `children`, so a panel never
 * does its own scaling.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export interface Viewport {
  from: number;
  to: number;
}

export interface PlotGeometry {
  left: number;
  top: number;
  innerWidth: number;
  innerHeight: number;
  /** Pixel x of a slot (bar i spans slots i to i + 1; its centre is i + 0.5). */
  x: (slot: number) => number;
  /** Pixel y of a value on the left axis. */
  y: (value: number) => number;
  /** Pixel y of a value on the right axis (when one is given). */
  yRight: (value: number) => number;
  /** Width of one bar in pixels. */
  slotWidth: number;
  first: number;
  last: number;
}

const MARGIN = { left: 64, right: 14, rightWithAxis: 54, top: 8, bottom: 22 } as const;

export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function visibleRange(viewport: Viewport, length: number): { first: number; last: number } {
  return { first: Math.max(0, Math.floor(viewport.from)), last: Math.min(length - 1, Math.ceil(viewport.to) - 1) };
}

/** Round tick values covering [low, high]. */
export function niceTicks(low: number, high: number, count = 5): number[] {
  if (!(high > low)) return [low];
  const rough = (high - low) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** `MM-DD HH:mm` of an epoch-ms stamp (futures stamps are Pacific wall clock stored as UTC). */
export function clockLabel(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(5, 16).replace("T", " ");
}

export interface PlotProps {
  length: number;
  timestamps: readonly number[];
  viewport: Viewport;
  onViewport: (next: Viewport | null) => void;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  height: number;
  yDomain: [number, number];
  yFormat?: (value: number) => string;
  /** Replaces the numeric left ticks, e.g. horizon names for the strip. */
  yTickLabels?: ReadonlyArray<{ value: number; label: string }>;
  yTitle?: string;
  rightAxis?: { domain: [number, number]; format: (value: number) => string; title: string };
  ariaLabel: string;
  children: (geometry: PlotGeometry) => ReactNode;
}

const MIN_SPAN_SLOTS = 12;

export function Plot(props: PlotProps) {
  const { length, timestamps, viewport, onViewport, hoverIndex, onHover, height, yDomain, yFormat = (v) => String(v), yTickLabels, yTitle, rightAxis, ariaLabel, children } = props;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ startX: number; from: number; to: number } | null>(null);
  const clipId = `plot-${useId().replace(/[^A-Za-z0-9]/g, "")}`;
  const right = MARGIN.rightWithAxis; // every panel reserves the right axis so all share one x axis
  const innerWidth = Math.max(10, width - MARGIN.left - right);
  const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);
  const span = Math.max(1e-9, viewport.to - viewport.from);

  // The wheel needs preventDefault, which a React (passive) handler cannot do.
  const latest = useRef({ viewport, length, innerWidth, onViewport });
  useEffect(() => {
    latest.current = { viewport, length, innerWidth, onViewport };
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const { viewport: current, length: n, innerWidth: w, onViewport: emit } = latest.current;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left - MARGIN.left) / w));
      const currentSpan = current.to - current.from;
      const nextSpan = Math.min(n, Math.max(MIN_SPAN_SLOTS, currentSpan * 1.0018 ** event.deltaY));
      const anchor = current.from + fraction * currentSpan;
      let from = anchor - fraction * nextSpan;
      from = Math.min(Math.max(0, from), n - nextSpan);
      emit(nextSpan >= n ? null : { from, to: from + nextSpan });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const x = (slot: number) => MARGIN.left + ((slot - viewport.from) / span) * innerWidth;
  const [low, high] = yDomain;
  const yScale = (value: number) => MARGIN.top + (1 - (value - low) / Math.max(1e-12, high - low)) * innerHeight;
  const [rLow, rHigh] = rightAxis?.domain ?? [0, 1];
  const yRight = (value: number) => MARGIN.top + (1 - (value - rLow) / Math.max(1e-12, rHigh - rLow)) * innerHeight;
  const { first, last } = visibleRange(viewport, length);
  const geometry: PlotGeometry = { left: MARGIN.left, top: MARGIN.top, innerWidth, innerHeight, x, y: yScale, yRight, slotWidth: innerWidth / span, first, last };

  const indexAt = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg || length === 0) return null;
    const rect = svg.getBoundingClientRect();
    const slot = viewport.from + ((clientX - rect.left - MARGIN.left) / innerWidth) * span;
    return Math.min(length - 1, Math.max(0, Math.floor(slot)));
  };

  const leftTicks = yTickLabels ? [...yTickLabels] : niceTicks(low, high, Math.max(2, Math.floor(innerHeight / 36))).map((value) => ({ value, label: yFormat(value) }));
  const timeTicks: Array<{ index: number; label: string }> = [];
  const wanted = Math.max(2, Math.floor(innerWidth / 110));
  for (let k = 0; k < wanted; k += 1) {
    const index = Math.min(length - 1, Math.max(0, Math.round(viewport.from + ((k + 0.5) / wanted) * span - 0.5)));
    const stamp = timestamps[index];
    if (stamp !== undefined) timeTicks.push({ index, label: clockLabel(stamp) });
  }

  return (
    <div ref={ref} className="min-w-0 w-full select-none">
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block cursor-crosshair touch-none"
          onPointerDown={(event) => {
            (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
            drag.current = { startX: event.clientX, from: viewport.from, to: viewport.to };
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (state && Math.abs(event.clientX - state.startX) > 3) {
              const slots = state.to - state.from;
              const shift = -((event.clientX - state.startX) / innerWidth) * slots;
              const from = Math.min(Math.max(0, state.from + shift), length - slots);
              onViewport(slots >= length ? null : { from, to: from + slots });
            }
            onHover(indexAt(event.clientX));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerLeave={() => {
            drag.current = null;
            onHover(null);
          }}
          onDoubleClick={() => onViewport(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={MARGIN.left} y={MARGIN.top} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>
          <rect x={MARGIN.left} y={MARGIN.top} width={innerWidth} height={innerHeight} fill="#0a0a0a" stroke="#262626" />
          {leftTicks.map((tick) => (
            <g key={`y${tick.value}`}>
              <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={yScale(tick.value)} y2={yScale(tick.value)} stroke="#1f1f1f" />
              <text x={MARGIN.left - 6} y={yScale(tick.value) + 3} textAnchor="end" fontSize={10} fill="#a3a3a3" className="font-mono">
                {tick.label}
              </text>
            </g>
          ))}
          {rightAxis &&
            niceTicks(rLow, rHigh, 4).map((value) => (
              <text key={`r${value}`} x={MARGIN.left + innerWidth + 6} y={yRight(value) + 3} fontSize={10} fill="#56B4E9" className="font-mono">
                {rightAxis.format(value)}
              </text>
            ))}
          {timeTicks.map((tick) => (
            <text key={`t${tick.index}`} x={x(tick.index + 0.5)} y={height - 6} textAnchor="middle" fontSize={10} fill="#a3a3a3" className="font-mono">
              {tick.label}
            </text>
          ))}
          {yTitle && (
            <text transform={`translate(11 ${MARGIN.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="#a3a3a3">
              {yTitle}
            </text>
          )}
          {rightAxis && (
            <text transform={`translate(${width - 4} ${MARGIN.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="#56B4E9">
              {rightAxis.title}
            </text>
          )}
          <g clipPath={`url(#${clipId})`}>{children(geometry)}</g>
          {hoverIndex !== null && hoverIndex >= first && hoverIndex <= last && (
            <line x1={x(hoverIndex + 0.5)} x2={x(hoverIndex + 0.5)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} stroke="#e5e5e5" strokeOpacity={0.55} strokeDasharray="3 3" pointerEvents="none" />
          )}
        </svg>
      )}
    </div>
  );
}

/** A legend chip: a glyph (never colour alone) and a word. */
export function LegendChip({ glyph, colour, label }: { glyph: ReactNode; colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-300">
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        <g fill={colour} stroke={colour}>
          {glyph}
        </g>
      </svg>
      {label}
    </span>
  );
}
