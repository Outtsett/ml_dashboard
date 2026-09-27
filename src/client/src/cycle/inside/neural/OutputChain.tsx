/**
 * The last step: the head's single number and what turns it into the output
 * the chart shows. Direction: head → logit → sigmoid → P(up) ▲/▼, beside a
 * small sigmoid curve with this bar's logit marked. Price: head → predicted
 * move in target units × the bar's volatility scale → points ▲/▼.
 *
 * The logit printed is `bar.neural.logit` and the probability is
 * `bar.output.probabilityUp` — the same numbers the chart and the engine
 * report; the sigmoid of the logit is printed beside it as the check.
 */
import type { CycleExplainBar, CycleExplainRole } from "@shared/cycle/explain";
import { CYCLE_COLORS } from "@/cycle/chartModel";
import { formatPercent } from "@/cycle/format";

import { formatActivation, sigmoid } from "./stages";

const CURVE_WIDTH = 150;
const CURVE_HEIGHT = 64;
const CURVE_RANGE = 6;

function Step({ title, value, testId, color }: { title: string; value: string; testId?: string; color?: string }) {
  return (
    <div className="rounded border border-neutral-700 px-2 py-1">
      <div className="text-[10px] text-neutral-400">{title}</div>
      <div data-testid={testId} className="font-mono text-xs tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="text-neutral-500">
      →
    </span>
  );
}

function SigmoidCurve({ logit }: { logit: number }) {
  const x = (value: number) => ((value + CURVE_RANGE) / (2 * CURVE_RANGE)) * CURVE_WIDTH;
  const y = (probability: number) => (1 - probability) * CURVE_HEIGHT;
  const points: string[] = [];
  for (let step = 0; step <= 60; step += 1) {
    const value = -CURVE_RANGE + (step / 60) * 2 * CURVE_RANGE;
    points.push(`${x(value).toFixed(1)},${y(sigmoid(value)).toFixed(1)}`);
  }
  const clamped = Math.max(-CURVE_RANGE, Math.min(CURVE_RANGE, logit));
  const probability = sigmoid(logit);
  const color = probability >= 0.5 ? CYCLE_COLORS.up : CYCLE_COLORS.down;
  return (
    <svg role="img" aria-label="The sigmoid curve with this bar's logit marked" width={CURVE_WIDTH} height={CURVE_HEIGHT + 12} className="block">
      <line x1={0} x2={CURVE_WIDTH} y1={y(0.5)} y2={y(0.5)} stroke={CYCLE_COLORS.neutral} strokeDasharray="2 3" strokeWidth={1} />
      <polyline points={points.join(" ")} fill="none" stroke={CYCLE_COLORS.neutral} strokeWidth={1.5} />
      <circle data-testid="sigmoid-point" cx={x(clamped)} cy={y(probability)} r={4} fill={color} />
      <text x={0} y={CURVE_HEIGHT + 11} fontSize={9} fill={CYCLE_COLORS.neutral}>
        logit −6
      </text>
      <text x={CURVE_WIDTH} y={CURVE_HEIGHT + 11} fontSize={9} fill={CYCLE_COLORS.neutral} textAnchor="end">
        +6
      </text>
    </svg>
  );
}

export function OutputChain({ bar, role }: { bar: CycleExplainBar; role: CycleExplainRole }) {
  const logit = bar.neural?.logit ?? bar.output.raw;
  if (role === "price") {
    const units = bar.output.targetUnits ?? logit;
    const points = bar.output.movePoints;
    const up = (points ?? units) >= 0;
    return (
      <div data-testid="neural-output" className="flex flex-wrap items-center gap-1.5">
        <Step title="Head output" value={formatActivation(logit)} testId="neural-logit" />
        <Arrow />
        <Step title="Predicted move (target units)" value={formatActivation(units)} />
        <Arrow />
        <Step title="× points per target unit" value={formatActivation(bar.output.scale)} />
        <Arrow />
        <Step
          title="Predicted move (points)"
          testId="neural-move"
          value={points === null ? "—" : `${up ? "▲ +" : "▼ "}${points.toFixed(2)} points`}
          color={up ? CYCLE_COLORS.up : CYCLE_COLORS.down}
        />
        {bar.output.predictedClose !== null && <Step title="Predicted close" value={bar.output.predictedClose.toFixed(2)} />}
      </div>
    );
  }
  const probability = bar.output.probabilityUp;
  const check = sigmoid(logit);
  const up = (probability ?? check) >= 0.5;
  const agrees = probability === null || Math.abs(check - probability) < 1e-6;
  return (
    <div data-testid="neural-output" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Step title="Head (weighs the last bar's numbers)" value="one number" />
        <Arrow />
        <Step title="Logit (log-odds of up)" value={formatActivation(logit)} testId="neural-logit" />
        <Arrow />
        <Step title="Sigmoid 1 ÷ (1 + e^−logit)" value={check.toFixed(6)} testId="neural-sigmoid" />
        <Arrow />
        <Step
          title="P(up)"
          testId="neural-probability"
          value={probability === null ? "—" : `${up ? "▲" : "▼"} ${formatPercent(probability, 2)} ${up ? "up" : "down"}`}
          color={up ? CYCLE_COLORS.up : CYCLE_COLORS.down}
        />
      </div>
      <SigmoidCurve logit={logit} />
      <p className="text-[10px] text-neutral-400">
        {agrees
          ? "The sigmoid of this logit is the P(up) the chart shows for this bar."
          : `The sigmoid of this logit differs from the reported P(up) by ${Math.abs(check - (probability ?? 0)).toExponential(2)}.`}
      </p>
    </div>
  );
}
