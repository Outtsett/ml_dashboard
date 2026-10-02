/**
 * A stepped waterfall: a constant, then one signed term at a time, each bar
 * drawn from the running sum before it to the running sum after it, ending on
 * the model's raw output. Shared by the linear (weight × input), naive Bayes
 * (per-feature evidence), support-vector (dual coefficient × kernel) and
 * stacking (weight × base model answer) views.
 *
 * `useWaterfall` owns the order and step state so a view can hand the running
 * sum to its link curve; `Waterfall` only draws it. Orange + "+" + ▲ pushes
 * up, blue + "−" + ▼ pushes down, the constant is neutral grey.
 */
import { useEffect, useState } from "react";

import { cn } from "@/shared/utils/utils";

import { INSIDE_COLORS, directionColor, directionGlyph, formatSigned } from "./link";

export interface WaterfallTerm {
  key: string;
  /** Full-word name of what this term is (a feature, a support vector, a base model). */
  label: string;
  /** Its contribution to the raw output. */
  value: number;
  /** The arithmetic behind it, in words, for the hover readout. */
  detail: string;
}

export interface WaterfallBase {
  label: string;
  value: number;
  detail: string;
}

export type WaterfallOrder = "magnitude" | "given";

export interface WaterfallState {
  base: WaterfallBase | null;
  /** Terms in display order. */
  ordered: WaterfallTerm[];
  order: WaterfallOrder;
  setOrder: (order: WaterfallOrder) => void;
  /** How many terms have been added (0 = only the constant). */
  step: number;
  setStep: (step: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  /** The constant plus the first `step` terms. */
  running: number;
  /** The constant plus every term — the model's raw output. */
  total: number;
  /** The term added last, or null at step 0. */
  current: WaterfallTerm | null;
}

const PLAY_INTERVAL_MILLISECONDS = 700;

export function orderTerms(terms: WaterfallTerm[], order: WaterfallOrder): WaterfallTerm[] {
  if (order === "given") return terms;
  return [...terms].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** base + Σ terms, summed in the order given (the order the model's library summed them). */
export function waterfallTotal(base: WaterfallBase | null, terms: WaterfallTerm[]): number {
  let total = base?.value ?? 0;
  for (const term of terms) total += term.value;
  return total;
}

export function useWaterfall(base: WaterfallBase | null, terms: WaterfallTerm[], initialOrder: WaterfallOrder = "magnitude"): WaterfallState {
  const [order, setOrder] = useState<WaterfallOrder>(initialOrder);
  const [rawStep, setRawStep] = useState<number>(terms.length);
  const [playRequested, setPlayRequested] = useState(false);
  const ordered = orderTerms(terms, order);
  const step = Math.max(0, Math.min(rawStep, ordered.length));
  // Playing stops by itself at the last term; pressing Play there starts over.
  const playing = playRequested && step < ordered.length;
  const termCount = ordered.length;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setRawStep((previous) => Math.min(previous + 1, termCount));
    }, PLAY_INTERVAL_MILLISECONDS);
    return () => clearInterval(timer);
  }, [playing, termCount]);

  let running = base?.value ?? 0;
  for (let index = 0; index < step; index += 1) running += ordered[index]?.value ?? 0;

  return {
    base,
    ordered,
    order,
    setOrder,
    step,
    setStep: (next: number) => setRawStep(Math.max(0, Math.min(next, ordered.length))),
    playing,
    setPlaying: (next: boolean) => {
      if (next && step >= ordered.length) setRawStep(0);
      setPlayRequested(next);
    },
    running,
    total: waterfallTotal(base, terms),
    current: step > 0 ? (ordered[step - 1] ?? null) : null,
  };
}

// ─── drawing ─────────────────────────────────────────────────────────────────

const BAR_WIDTH = 1000;
const BAR_HEIGHT = 14;

function ControlButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] leading-4 text-neutral-200 disabled:opacity-40",
        pressed ? "border-white/40 bg-white/15" : "border-white/15 bg-white/[0.04] hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

interface WaterfallProps {
  state: WaterfallState;
  /** Singular and plural of what one step adds: ["feature", "features"]. */
  noun: [string, string];
  /** What the sum is, in words (e.g. "log-odds of up"). */
  totalName: string;
  /** Offer the "largest effect first" / "original order" toggle. */
  sortable?: boolean;
  givenOrderName?: string;
  /** A term the view has selected (e.g. the feature whose bell curves are shown). */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  testId?: string;
}

export function Waterfall({ state, noun, totalName, sortable = true, givenOrderName = "Feature order", selectedKey = null, onSelect, testId = "waterfall" }: WaterfallProps) {
  const [hover, setHover] = useState<string | null>(null);
  const { base, ordered, step, total } = state;

  // One horizontal scale for every row: zero, the constant and every running sum fit.
  const points: number[] = [0, base?.value ?? 0];
  let cumulative = base?.value ?? 0;
  const before: number[] = [];
  for (const term of ordered) {
    before.push(cumulative);
    cumulative += term.value;
    points.push(cumulative);
  }
  const low = Math.min(...points);
  const high = Math.max(...points);
  const span = high - low || 1;
  const x = (value: number) => ((value - low) / span) * BAR_WIDTH;

  const bar = (from: number, to: number, fill: string, highlighted: boolean) => (
    <svg viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`} preserveAspectRatio="none" className="h-3.5 w-full" aria-hidden>
      <line x1={x(0)} x2={x(0)} y1={0} y2={BAR_HEIGHT} stroke={INSIDE_COLORS.neutral} strokeOpacity={0.5} strokeWidth={3} />
      <rect
        x={Math.min(x(from), x(to))}
        width={Math.max(3, Math.abs(x(to) - x(from)))}
        y={2}
        height={BAR_HEIGHT - 4}
        fill={fill}
        stroke={highlighted ? INSIDE_COLORS.step : "none"}
        strokeWidth={highlighted ? 6 : 0}
      />
    </svg>
  );

  const [singular, plural] = noun;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1">
        {sortable && (
          <>
            <ControlButton label="Sort by the largest effect first" pressed={state.order === "magnitude"} onClick={() => state.setOrder("magnitude")}>
              Largest effect first
            </ControlButton>
            <ControlButton label={`Show in ${givenOrderName.toLowerCase()}`} pressed={state.order === "given"} onClick={() => state.setOrder("given")}>
              {givenOrderName}
            </ControlButton>
            <span className="mx-1 h-3 w-px bg-white/15" />
          </>
        )}
        <ControlButton label="Reset to only the constant" onClick={() => state.setStep(0)} disabled={step === 0}>
          ⏮ Reset
        </ControlButton>
        <ControlButton label={`Take back the last ${singular}`} onClick={() => state.setStep(step - 1)} disabled={step === 0}>
          ◀ Back
        </ControlButton>
        <ControlButton label={`Add the next ${singular}`} onClick={() => state.setStep(step + 1)} disabled={step >= ordered.length}>
          Add next ▶
        </ControlButton>
        <ControlButton label={state.playing ? "Pause" : `Play: add one ${singular} at a time`} onClick={() => state.setPlaying(!state.playing)}>
          {state.playing ? "❚❚ Pause" : "▶ Play"}
        </ControlButton>
        <ControlButton label={`Add every ${singular}`} onClick={() => state.setStep(ordered.length)} disabled={step >= ordered.length}>
          Add all ⏭
        </ControlButton>
      </div>

      <p className="text-[11px] text-neutral-300" data-testid={`${testId}-running`} data-value={state.running} data-step={step}>
        Added {step} of {ordered.length} {ordered.length === 1 ? singular : plural} — running sum{" "}
        <span style={{ color: directionColor(state.running) }}>
          {directionGlyph(state.running)} {formatSigned(state.running, 4)}
        </span>{" "}
        ({totalName})
        {state.current && (
          <>
            {" "}— last added: <span className="text-neutral-100">{state.current.label}</span> {formatSigned(state.current.value, 4)}
          </>
        )}
      </p>

      <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-0.5 text-[11px]" role="list">
        {base && (
          <div
            role="listitem"
            className="contents"
            data-testid={`${testId}-base`}
            onMouseEnter={() => setHover(`${base.label}: ${base.detail}`)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-neutral-300" title={`${base.label}: ${base.detail}`}>
              {base.label}
            </span>
            {bar(0, base.value, INSIDE_COLORS.neutral, step === 0)}
            <span className="text-right tabular-nums text-neutral-200">
              {directionGlyph(base.value)} {formatSigned(base.value, 4)}
            </span>
          </div>
        )}
        {ordered.map((term, index) => {
          const added = index < step;
          const from = before[index] ?? 0;
          const to = from + term.value;
          const selected = selectedKey === term.key;
          return (
            <div
              key={term.key}
              role="listitem"
              className="contents"
              data-testid={`${testId}-term`}
              data-term={term.key}
              data-added={added}
              onMouseEnter={() => setHover(`${term.label}: ${term.detail}`)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(term.key) : undefined}
            >
              <span
                className={cn("truncate", added ? "text-neutral-200" : "text-neutral-500", selected && "underline decoration-dotted", onSelect && "cursor-pointer")}
                title={`${term.label}: ${term.detail}`}
              >
                {term.label}
              </span>
              <div className={cn(!added && "opacity-25", onSelect && "cursor-pointer")}>{bar(from, to, directionColor(term.value), added && index === step - 1)}</div>
              <span className={cn("text-right tabular-nums", !added && "opacity-40")} style={{ color: directionColor(term.value) }}>
                {directionGlyph(term.value)} {formatSigned(term.value, 4)}
              </span>
            </div>
          );
        })}
        <div role="listitem" className="contents" data-testid="inside-sum" data-value={total}>
          <span className="truncate font-medium text-neutral-100" title={`The sum of everything above: the model's ${totalName}`}>
            Sum ({totalName})
          </span>
          {bar(0, total, INSIDE_COLORS.bar, false)}
          <span className="text-right font-medium tabular-nums" style={{ color: directionColor(total) }}>
            {directionGlyph(total)} {formatSigned(total, 4)}
          </span>
        </div>
      </div>

      <p className="min-h-4 text-[10px] text-neutral-400" data-testid="inside-hover-readout">
        {hover ?? "Hover a row for its exact arithmetic."}
      </p>
    </div>
  );
}
