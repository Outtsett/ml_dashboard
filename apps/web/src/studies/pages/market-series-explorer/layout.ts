/** Size, scale and label helpers shared by the page's SVG charts. */

import { useEffect, useRef, useState, type RefObject } from "react";

/** The width of a container, following it as the side panel is dragged. */
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? fallback);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

export function linear(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const span = domain[1] - domain[0] || 1;
  return (value) => range[0] + ((value - domain[0]) / span) * (range[1] - range[0]);
}

/** About `count` round tick values between low and high. */
export function niceTicks(low: number, high: number, count = 4): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return [low];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** A number in as few digits as still tell neighbouring ticks apart. */
export function compact(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (magnitude >= 10) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  if (magnitude >= 0.01) return value.toFixed(3);
  return value.toExponential(1);
}

/** Stored-clock digits: the lake stamps futures in Pacific wall clock as if it were UTC, so these are the stamped digits. */
export function clock(timestamp: number, withTime = true): string {
  const iso = new Date(timestamp).toISOString();
  return withTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}

/** Axis labels for `indices` of `timestamps`: a date when they are all distinct days, else month-day and hour (the notebook's rule). */
export function axisLabels(timestamps: readonly number[], indices: readonly number[]): string[] {
  const dates = indices.map((index) => clock(timestamps[index] as number, false));
  const distinct = new Set(dates).size === dates.length;
  return indices.map((index) => (distinct ? clock(timestamps[index] as number, false) : clock(timestamps[index] as number).slice(5)));
}

export function evenIndices(count: number, wanted: number): number[] {
  if (count <= 0) return [];
  const step = Math.max(Math.floor(count / wanted), 1);
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}
