/**
 * Pieces the regime-gated crossover page builds from that the study kit does
 * not carry: a slider that asks the server only when released, the regime
 * palette (colour and shape per regime, calm to stressed), the walk-forward
 * fold strip, the transition-matrix grid, and a horizontal interval plot.
 */

import { useState, type ReactNode } from "react";
import { Slider } from "@/shared/ui/slider";
import { OKABE, fmt, fmtInt, fmtTime } from "@/studies/kit";
import type { FoldRow, TransitionRow } from "@shared/studies/regime-gated-crossover";

/** Net returns are fractions per 5m bar; the page shows them in basis points (1 bp = 0.01%). */
export const BASIS_POINTS = 10_000;

export function bp(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${fmt(value * BASIS_POINTS, decimals)} bp`;
}

type ScatterShape = "circle" | "triangle" | "square" | "diamond" | "cross" | "star" | "wye";

/** Regime r, calm (0) to stressed (k-1): Okabe-Ito colour plus a shape and a glyph, so colour is never the only cue. */
const REGIME_STYLES: ReadonlyArray<{ color: string; shape: ScatterShape; glyph: string }> = [
  { color: OKABE.sky, shape: "circle", glyph: "●" },
  { color: OKABE.green, shape: "triangle", glyph: "▲" },
  { color: OKABE.yellow, shape: "square", glyph: "■" },
  { color: OKABE.orange, shape: "diamond", glyph: "◆" },
  { color: OKABE.vermillion, shape: "cross", glyph: "✚" },
  { color: OKABE.purple, shape: "star", glyph: "★" },
  { color: OKABE.blue, shape: "wye", glyph: "Y" },
  { color: OKABE.grey, shape: "circle", glyph: "○" },
];

export function regimeStyle(regime: number) {
  return REGIME_STYLES[regime % REGIME_STYLES.length] as (typeof REGIME_STYLES)[number];
}

export function regimeName(regime: number, regimeCount: number): string {
  if (regime === 0) return `regime 0 (calmest)`;
  if (regime === regimeCount - 1) return `regime ${regime} (most stressed)`;
  return `regime ${regime}`;
}

export function RegimeKey({ regimeCount }: { regimeCount: number }) {
  return (
    <p className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
      {Array.from({ length: regimeCount }, (_, regime) => (
        <span key={regime} style={{ color: regimeStyle(regime).color }}>
          {regimeStyle(regime).glyph} {regimeName(regime, regimeCount)}
        </span>
      ))}
    </p>
  );
}

/**
 * A labelled slider that shows its value while dragging and only reports it on
 * release, so one drag asks the server once rather than on every step.
 */
export function CommitSlider({
  label, value, min, max, step = 1, onCommit, format = (v) => String(v), hint,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onCommit: (value: number) => void; format?: (value: number) => string; hint?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return (
    <label className="flex w-44 flex-col gap-1" title={hint}>
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-neutral-200">{format(shown)}</span>
      </span>
      <Slider
        value={[shown]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => setDraft(next[0] ?? value)}
        onValueCommit={(next) => {
          setDraft(null);
          onCommit(next[0] ?? value);
        }}
      />
    </label>
  );
}

/** Toggle buttons, one per regime, for choosing a gate by hand. */
export function RegimeToggles({ regimeCount, chosen, onChange }: { regimeCount: number; chosen: number[]; onChange: (next: number[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Trade in</span>
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {Array.from({ length: regimeCount }, (_, regime) => {
          const on = chosen.includes(regime);
          return (
            <button
              key={regime}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? chosen.filter((r) => r !== regime) : [...chosen, regime].sort((a, b) => a - b))}
              className={`px-2 py-1 text-[11px] font-mono ${on ? "bg-neutral-700 text-neutral-50" : "text-neutral-500 hover:bg-neutral-800"}`}
              title={`${on ? "Trading" : "Sitting out"} ${regimeName(regime, regimeCount)}`}
            >
              <span style={{ color: regimeStyle(regime).color }}>{regimeStyle(regime).glyph}</span> {regime}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The six expanding walk-forward folds on one time axis: train (grey), embargo gap, test window (orange, the selected one outlined). */
export function FoldStrip({ folds, origin, selected, split }: { folds: FoldRow[]; origin: number; selected?: number; split?: number | null }) {
  const last = folds[folds.length - 1];
  if (!last) return null;
  const end = last.test_end_timestamp;
  const span = end - origin || 1;
  const x = (t: number) => `${((t - origin) / span) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0.3, ((b - a) / span) * 100)}%`;
  return (
    <div className="space-y-1">
      {folds.map((fold) => (
        <div key={fold.fold} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-right font-mono text-[10px] text-neutral-400">fold {fold.fold}</span>
          <div className="relative h-4 min-w-0 flex-1 rounded bg-neutral-900">
            <div
              className="absolute inset-y-0 rounded-l bg-neutral-600"
              style={{ left: x(origin), width: width(origin, fold.train_end_timestamp) }}
              title={`train: ${fmtInt(fold.train_bar_count)} bars to ${fmtTime(fold.train_end_timestamp)}`}
            />
            <div
              className="absolute inset-y-0"
              style={{
                left: x(fold.test_start_timestamp), width: width(fold.test_start_timestamp, fold.test_end_timestamp),
                background: OKABE.orange, outline: fold.fold === selected ? "2px solid #f5f5f5" : undefined,
              }}
              title={`test: ${fmtTime(fold.test_start_timestamp)} to ${fmtTime(fold.test_end_timestamp)}, ${fmtInt(fold.test_bar_count)} bars, out-of-sample Sharpe ${fmt(fold.out_of_sample_sharpe, 3)}`}
            />
            {split !== null && split !== undefined && <div className="absolute inset-y-[-3px] w-0.5 bg-neutral-100" style={{ left: x(split) }} title={`held-out split ${fmtTime(split)}`} />}
          </div>
        </div>
      ))}
      <p className="pl-14 text-[10px] text-neutral-500">
        <span className="text-neutral-400">▬ grey</span> train (expanding, ends 100 bars before the test window) ·{" "}
        <span style={{ color: OKABE.orange }}>▬ orange</span> test window · axis {fmtTime(origin)} to {fmtTime(end)} (lake stamp)
      </p>
    </div>
  );
}

/** Cividis-like sequential ramp (dark blue to yellow), readable without red or green. */
function ramp(t: number): string {
  const stops: Array<[number, number, number]> = [[0, 32, 77], [87, 92, 109], [166, 157, 117], [255, 234, 70]];
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const f = position - index;
  const a = stops[index] as [number, number, number];
  const b = stops[index + 1] as [number, number, number];
  return `rgb(${a.map((value, i) => Math.round(value + ((b[i] as number) - value) * f)).join(",")})`;
}

/** P(next regime | this regime) for one fold's training labels; each cell carries its probability and count. */
export function TransitionGrid({ rows, regimeCount }: { rows: TransitionRow[]; regimeCount: number }) {
  const cell = (from: number, to: number) => rows.find((row) => row.from_regime === from && row.to_regime === to);
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="inline-grid gap-px text-[10px] font-mono" style={{ gridTemplateColumns: `auto repeat(${regimeCount}, minmax(38px, 1fr))` }}>
        <div className="px-1 text-neutral-500">from ↓ to →</div>
        {Array.from({ length: regimeCount }, (_, to) => (
          <div key={`h${to}`} className="px-1 text-center" style={{ color: regimeStyle(to).color }}>{regimeStyle(to).glyph} {to}</div>
        ))}
        {Array.from({ length: regimeCount }, (_, from) => (
          <div key={`r${from}`} className="contents">
            <div className="px-1 text-right" style={{ color: regimeStyle(from).color }}>{regimeStyle(from).glyph} {from}</div>
            {Array.from({ length: regimeCount }, (_, to) => {
              const value = cell(from, to);
              const probability = value?.probability ?? 0;
              return (
                <div
                  key={`${from}-${to}`}
                  className="px-1 py-1.5 text-center"
                  style={{ background: ramp(probability / 0.8), color: probability > 0.45 ? "#111" : "#eee", outline: from === to ? "1px solid #f5f5f5" : undefined }}
                  title={`from regime ${from} to regime ${to}: probability ${fmt(probability, 4)}, ${fmtInt(value?.transition_count)} transitions`}
                >
                  {fmt(probability, 2)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-neutral-500">Colour: dark blue 0 → yellow 0.8 or more. Outlined cells are the diagonal (staying in the same regime).</p>
    </div>
  );
}

/** One row of an interval plot: a point with its whisker on a shared axis, zero marked. */
export interface IntervalRow {
  label: ReactNode;
  point: number | null;
  low: number | null;
  high: number | null;
  color: string;
  glyph: string;
  detail?: string;
}

export function IntervalPlot({ rows, format = bp, axisLabel }: { rows: IntervalRow[]; format?: (value: number) => string; axisLabel: string }) {
  const values = rows.flatMap((row) => [row.point, row.low, row.high]).filter((v): v is number => v !== null && Number.isFinite(v));
  const lowest = Math.min(0, ...values);
  const highest = Math.max(0, ...values);
  const pad = (highest - lowest) * 0.08 || 1e-6;
  const min = lowest - pad;
  const max = highest + pad;
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="space-y-1">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2" title={row.detail}>
          <div className="w-28 shrink-0 truncate text-right text-[11px] text-neutral-300 sm:w-40">{row.label}</div>
          <div className="relative h-5 min-w-0 flex-1 rounded bg-neutral-900">
            <div className="absolute inset-y-0 w-px bg-neutral-500" style={{ left: x(0) }} />
            {row.low !== null && row.high !== null && (
              <div className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: x(row.low), width: `calc(${x(row.high)} - ${x(row.low)})`, background: row.color }} />
            )}
            {row.low !== null && <div className="absolute inset-y-1 w-0.5" style={{ left: x(row.low), background: row.color }} />}
            {row.high !== null && <div className="absolute inset-y-1 w-0.5" style={{ left: x(row.high), background: row.color }} />}
            {row.point !== null && (
              <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] leading-none" style={{ left: x(row.point), color: row.color }}>
                {row.glyph}
              </span>
            )}
          </div>
          <div className="hidden w-52 shrink-0 text-right font-mono text-[10px] text-neutral-400 lg:block">
            {row.point === null ? "—" : format(row.point)} [{row.low === null ? "—" : format(row.low)}, {row.high === null ? "—" : format(row.high)}]
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 font-mono text-[10px] text-neutral-500">
        <div className="w-28 shrink-0 sm:w-40" />
        <div className="flex min-w-0 flex-1 justify-between gap-2">
          <span>{format(min)}</span>
          <span className="truncate">{axisLabel} · line at 0</span>
          <span>{format(max)}</span>
        </div>
        <div className="hidden w-52 shrink-0 lg:block" />
      </div>
    </div>
  );
}
