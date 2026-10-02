/**
 * Inside the model — the right-hand end of the flow: how the model's raw
 * output becomes what the chart shows.
 *
 *   direction: raw → link → P(up) → ▲ up / ▼ down  (P(up) ≥ 0.5 is up, the engine's rule)
 *   price:     target units × scale = move in points → predicted close
 *
 * The numbers are the explainer's (`bar.output`), never recomputed here;
 * `linkProbability` exists so the running-total views can show the chance of
 * up part-way through (after 12 of 300 trees) with the same link the model uses.
 */
import type { ReactNode } from "react";
import type { CycleExplainBar, CycleExplainLink, CycleExplainRole, CycleExplainStructure } from "@shared/cycle/explain";

import { cn } from "@/shared/utils/utils";

import { CYCLE_COLORS } from "../chartModel";
import { formatPercent } from "../format";

// ─── link math (pure) ───────────────────────────────────────────────────────

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26 error function, error < 1.5e-7). */
export function standardNormalCumulative(value: number): number {
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const errorFunction = 1 - polynomial * Math.exp(-x * x);
  return value >= 0 ? 0.5 * (1 + errorFunction) : 0.5 * (1 - errorFunction);
}

/**
 * P(up) from a raw value, for links that are a function of the raw value
 * alone; null for the ones that are not (identity = a price, posterior, vote,
 * calibration map — those read `bar.output.probabilityUp`).
 */
export function linkProbability(link: CycleExplainLink, raw: number, structure: Pick<CycleExplainStructure, "logisticCurve">): number | null {
  switch (link) {
    case "logistic":
      return sigmoid(raw);
    case "probit":
      return standardNormalCumulative(raw);
    case "mean_probability":
      return raw;
    case "logistic_curve":
      return structure.logisticCurve ? sigmoid(structure.logisticCurve.slope * raw + structure.logisticCurve.intercept) : null;
    default:
      return null;
  }
}

/** The value that separates up from down on the raw scale, where the link has one (drawn as the 50% line). */
export function linkBoundary(link: CycleExplainLink, structure: Pick<CycleExplainStructure, "logisticCurve">): number | null {
  switch (link) {
    case "logistic":
    case "probit":
    case "identity":
      return 0;
    case "mean_probability":
    case "vote":
      return 0.5;
    case "logistic_curve":
      return structure.logisticCurve && structure.logisticCurve.slope !== 0 ? -structure.logisticCurve.intercept / structure.logisticCurve.slope : null;
    default:
      return null;
  }
}

/** The raw value that gives a probability, for drawing a P(up) axis beside a raw axis; null when the link has no inverse here. */
export function linkInverse(link: CycleExplainLink, probability: number, structure: Pick<CycleExplainStructure, "logisticCurve">): number | null {
  if (probability <= 0 || probability >= 1) return null;
  const logit = Math.log(probability / (1 - probability));
  switch (link) {
    case "logistic":
      return logit;
    case "mean_probability":
      return probability;
    case "logistic_curve":
      return structure.logisticCurve && structure.logisticCurve.slope !== 0
        ? (logit - structure.logisticCurve.intercept) / structure.logisticCurve.slope
        : null;
    default:
      return null;
  }
}

const RAW_WORDS: Record<CycleExplainLink, string> = {
  logistic: "log-odds of up",
  identity: "the move in target units",
  mean_probability: "the trees' average vote for up",
  probit: "probit score",
  logistic_curve: "the model's score",
  posterior: "log evidence for up minus down",
  vote: "the neighbours' vote",
  calibration_map: "the base model's score",
};

const LINK_WORDS: Record<CycleExplainLink, string> = {
  logistic: "logistic: 1 ÷ (1 + e^(−raw))",
  identity: "none — the raw output is already the move",
  mean_probability: "none — the average vote is already the chance of up",
  probit: "probit: the normal curve's area below raw",
  logistic_curve: "logistic curve fitted on the validation bars",
  posterior: "softmax of the two class scores",
  vote: "share of the neighbours that went up",
  calibration_map: "the fitted calibration map",
};

export function linkWords(link: CycleExplainLink, structure: Pick<CycleExplainStructure, "logisticCurve">): string {
  if (link === "logistic_curve" && structure.logisticCurve) {
    const { slope, intercept } = structure.logisticCurve;
    return `logistic curve fitted on the validation bars: 1 ÷ (1 + e^(−(${formatNumber(slope)} × raw ${intercept < 0 ? "−" : "+"} ${formatNumber(Math.abs(intercept))})))`;
  }
  return LINK_WORDS[link];
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1_000_000)) return value.toExponential(2);
  return Number(value.toPrecision(4)).toString();
}

function formatSignedNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = formatNumber(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 1 up, -1 down — the engine's rule (P(up) ≥ 0.5 is up). */
export function directionOf(probabilityUp: number | null | undefined): 1 | -1 | null {
  if (probabilityUp === null || probabilityUp === undefined || !Number.isFinite(probabilityUp)) return null;
  return probabilityUp >= 0.5 ? 1 : -1;
}

// ─── view ───────────────────────────────────────────────────────────────────

export interface ChartReading {
  probabilityUp: number | null;
  direction: 1 | 0 | -1 | null;
}

export interface OutputChainProps {
  bar: CycleExplainBar;
  structure: CycleExplainStructure;
  role: CycleExplainRole;
  /** What the chart drew at this bar (from the run's bars), when the bar is on the chart. */
  chart?: ChartReading | null;
}

function Step({ label, value, detail, title, testId }: { label: string; value: ReactNode; detail?: ReactNode; title?: string; testId?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2" title={title} data-testid={testId}>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="font-mono text-sm tabular-nums text-neutral-100">{value}</div>
      {detail && <div className="mt-0.5 text-[11px] leading-snug text-neutral-400">{detail}</div>}
    </div>
  );
}

function Arrow() {
  return (
    <div className="text-center text-xs text-neutral-500" aria-hidden="true">
      ↓
    </div>
  );
}

function DirectionChip({ direction, testId }: { direction: 1 | -1 | null; testId?: string }) {
  if (direction === null) return <span className="text-neutral-400">—</span>;
  const up = direction === 1;
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold"
      style={{ color: up ? CYCLE_COLORS.up : CYCLE_COLORS.down, borderColor: up ? CYCLE_COLORS.up : CYCLE_COLORS.down }}
    >
      {up ? "▲ up" : "▼ down"}
    </span>
  );
}

function ProbabilityTrack({ probabilityUp }: { probabilityUp: number }) {
  const position = Math.max(0, Math.min(1, probabilityUp)) * 100;
  const color = probabilityUp >= 0.5 ? CYCLE_COLORS.up : CYCLE_COLORS.down;
  return (
    <div className="relative mt-1 h-2 rounded-full bg-white/10" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/40" />
      <div className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm" style={{ left: `${position}%`, background: color }} />
    </div>
  );
}

export function OutputChain({ bar, structure, role, chart }: OutputChainProps) {
  const { output } = bar;

  if (role === "price") {
    const moveSign = output.movePoints === null ? null : output.movePoints >= 0 ? 1 : -1;
    return (
      <section className="flex min-w-[180px] flex-1 flex-col gap-1" aria-label="From output to prediction" data-testid="inside-output-chain">
        <h3 className="text-xs font-semibold text-neutral-200">Output → predicted close</h3>
        <p className="text-[11px] text-neutral-500">The model predicts a move in volatility units; the bar's volatility turns it into points.</p>
        <Step label="Target units" value={formatSignedNumber(output.targetUnits)} title={`Target units: ${output.targetUnits ?? "—"}`} detail="the predicted move ÷ the bar's trailing volatility" />
        <Arrow />
        <Step label="× scale" value={`${formatNumber(output.scale)} points per unit`} title={`Scale: ${output.scale ?? "—"} points per unit`} />
        <Arrow />
        <Step
          label="= move in points"
          testId="inside-output-move"
          title={`Move: ${output.movePoints ?? "—"} points`}
          value={
            <span style={{ color: moveSign === 1 ? CYCLE_COLORS.up : moveSign === -1 ? CYCLE_COLORS.down : undefined }}>
              {moveSign === 1 ? "▲ " : moveSign === -1 ? "▼ " : ""}
              {formatSignedNumber(output.movePoints)} points
            </span>
          }
        />
        <Arrow />
        <Step
          label="Predicted close"
          testId="inside-output-predicted-close"
          value={formatPrice(output.predictedClose)}
          detail={`this bar closed at ${formatPrice(output.close)}`}
          title={`Predicted close: ${output.predictedClose ?? "—"}; close ${output.close}`}
        />
      </section>
    );
  }

  const probabilityUp = output.probabilityUp;
  const direction = directionOf(probabilityUp);
  const chartDirection = chart?.direction === 1 || chart?.direction === -1 ? chart.direction : null;
  const matchesChart = chartDirection !== null && direction !== null ? chartDirection === direction : null;

  return (
    <section className="flex min-w-[180px] flex-1 flex-col gap-1" aria-label="From output to prediction" data-testid="inside-output-chain">
      <h3 className="text-xs font-semibold text-neutral-200">Output → prediction</h3>
      <p className="text-[11px] text-neutral-500">The raw number goes through the link to become the chance of up; 50% or more is a ▲.</p>
      <Step label="Raw output" value={formatSignedNumber(output.raw)} detail={RAW_WORDS[bar.link]} title={`Raw output: ${output.raw}`} testId="inside-output-raw" />
      <Arrow />
      <Step label="Link" value={<span className="font-sans text-xs">{linkWords(bar.link, structure)}</span>} />
      <Arrow />
      <Step
        label="P(up), the chance of up"
        testId="inside-output-probability"
        title={`P(up): ${probabilityUp ?? "—"}`}
        value={formatPercent(probabilityUp)}
        detail={probabilityUp !== null ? <ProbabilityTrack probabilityUp={probabilityUp} /> : undefined}
      />
      <Arrow />
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
        <DirectionChip direction={direction} testId="inside-output-direction" />
        {chart && (
          <span className={cn("text-[11px]", matchesChart === false ? "text-[#D55E00]" : "text-neutral-400")}>
            {chartDirection === null
              ? "The chart has no prediction at this bar."
              : matchesChart
                ? `Same as the chart: ${chartDirection === 1 ? "▲" : "▼"} at ${formatPercent(chart.probabilityUp)}.`
                : `✗ The chart shows ${chartDirection === 1 ? "▲ up" : "▼ down"} at ${formatPercent(chart.probabilityUp)}.`}
          </span>
        )}
      </div>
    </section>
  );
}
