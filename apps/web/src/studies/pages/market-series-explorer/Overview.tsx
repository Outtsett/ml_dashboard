/**
 * The full-history strip: daily mean range z-score (where the volatile spans
 * are), with the chosen span shaded. The span is chosen three ways that agree:
 * drag across the strip, move either end of the range slider, or press a
 * preset. One change commits when the pointer is released (the notebook's
 * debounce), so a drag is one request, not one per pixel.
 */

import { useRef, useState, type PointerEvent } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { OKABE, fmt } from "@/studies/kit";
import type { Overview as OverviewData } from "@shared/studies/market-series-explorer";
import { clock, evenIndices, linear, useWidth } from "./layout";

const HEIGHT = 110;
const LEFT = 40;
const RIGHT = 8;
const TOP = 6;
const BOTTOM = 20;

export interface OverviewProps {
  overview: OverviewData;
  startIndex: number;
  endIndex: number;
  onCommit: (startIndex: number, endIndex: number) => void;
}

export function Overview({ overview, startIndex, endIndex, onCommit }: OverviewProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const anchor = useRef<number | null>(null);
  const days = overview.dayTimestamps.length;
  const last = Math.max(days - 1, 1);
  const shown: [number, number] = draft ?? [startIndex, endIndex];

  const plotWidth = Math.max(width - LEFT - RIGHT, 50);
  const x = linear([0, last], [LEFT, LEFT + plotWidth]);
  const values = overview.rangeZscoreMean;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const y = linear([low, high || 1], [HEIGHT - BOTTOM, TOP]);
  const area = values.length > 0
    ? `M${x(0)},${y(0)} ${values.map((value, index) => `L${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ")} L${x(values.length - 1)},${y(0)} Z`
    : "";
  const ticks = evenIndices(days, 8);

  const indexAt = (event: PointerEvent<SVGSVGElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left - LEFT) / plotWidth;
    return Math.min(Math.max(Math.round(fraction * last), 0), days - 1);
  };

  const commit = (range: readonly number[]) => {
    const a = range[0] ?? 0;
    const b = range[1] ?? a;
    setDraft(null);
    onCommit(Math.min(a, b), Math.max(a, b));
  };

  if (days === 0) return <p className="text-xs text-neutral-500">No days with a known range z-score.</p>;

  const dayLabel = (index: number) => clock(overview.dayTimestamps[Math.min(Math.max(index, 0), days - 1)] as number, false);
  const preset = (count: number) => commit([Math.max(days - count, 0), days - 1]);

  return (
    <div ref={ref} className="min-w-0 space-y-2">
      <p className="text-xs text-neutral-300">
        <span className="font-mono text-neutral-100">{dayLabel(shown[0])} to {dayLabel(shown[1])}</span> ({shown[1] - shown[0] + 1} days). Drag across the strip, or move either end of the slider; everything below follows.
      </p>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Daily mean range z-score over the full history with the chosen span shaded"
        className="block touch-none select-none cursor-crosshair"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          anchor.current = indexAt(event);
          setDraft([anchor.current, anchor.current]);
        }}
        onPointerMove={(event) => {
          if (anchor.current === null) return;
          const at = indexAt(event);
          setDraft([Math.min(anchor.current, at), Math.max(anchor.current, at)]);
        }}
        onPointerUp={(event) => {
          if (anchor.current === null) return;
          const at = indexAt(event);
          const from = anchor.current;
          anchor.current = null;
          commit([Math.min(from, at), Math.max(from, at)]);
        }}
      >
        <rect x={x(shown[0])} y={TOP} width={Math.max(x(shown[1]) - x(shown[0]), 2)} height={HEIGHT - BOTTOM - TOP} fill={OKABE.orange} opacity={0.3} />
        <path d={area} fill={OKABE.blue} opacity={0.8} />
        <line x1={LEFT} x2={LEFT + plotWidth} y1={y(0)} y2={y(0)} stroke="#6b6b6b" strokeWidth={0.6} strokeDasharray="3 3" />
        <text x={LEFT - 6} y={y(high || 1) + 8} textAnchor="end" fontSize={9} fill="#9a9a9a">{fmt(high, 1)}</text>
        <text x={LEFT - 6} y={y(low)} textAnchor="end" fontSize={9} fill="#9a9a9a">{fmt(low, 1)}</text>
        <text x={LEFT + 6} y={TOP + 9} fontSize={9} fill="#cfcfcf">daily mean range z-score</text>
        {ticks.map((index) => (
          <text key={index} x={x(index)} y={HEIGHT - 6} textAnchor={x(index) > width - 36 ? "end" : "middle"} fontSize={9} fill="#9a9a9a">
            {dayLabel(index)}
          </text>
        ))}
      </svg>
      <SliderPrimitive.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        min={0}
        max={last}
        step={1}
        minStepsBetweenThumbs={0}
        value={shown}
        onValueChange={(next) => setDraft([next[0] ?? 0, next[1] ?? next[0] ?? 0])}
        onValueCommit={commit}
        aria-label="Span of days"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-neutral-800">
          <SliderPrimitive.Range className="absolute h-full bg-[#E69F00]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label="Span start" className="block h-4 w-4 rounded-full border border-neutral-400 bg-neutral-950 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-300" />
        <SliderPrimitive.Thumb aria-label="Span end" className="block h-4 w-4 rounded-full border border-neutral-400 bg-neutral-950 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-300" />
      </SliderPrimitive.Root>
      <div className="flex flex-wrap gap-1 text-[11px]">
        {[{ label: "last 30 days", count: 30 }, { label: "last 90 days", count: 90 }, { label: "last year", count: 365 }, { label: "all days", count: days }].map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => preset(option.count)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
