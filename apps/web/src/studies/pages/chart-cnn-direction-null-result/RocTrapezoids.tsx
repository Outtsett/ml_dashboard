/**
 * The ROC curve a model's score bins imply, walked from the highest-scoring bin down. Each bin adds one
 * trapezoid (shaded sky blue; the step being read is orange); their areas sum to the AUC rebuilt from bins.
 */

import { OKABE, fmt } from "@/studies/kit";
import type { RocFromBins } from "@shared/studies/chart-cnn-direction-null-result";
import { useWidth } from "./useWidth";

export function RocTrapezoids({ roc, currentStep }: { roc: RocFromBins; currentStep: number }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const size = Math.min(Math.max(measured, 240), 420);
  const margin = { left: 40, right: 12, top: 10, bottom: 34 };
  const plotWidth = size - margin.left - margin.right;
  const plotHeight = size - margin.top - margin.bottom;
  const x = (value: number) => margin.left + value * plotWidth;
  const y = (value: number) => margin.top + (1 - value) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const path = [`M ${x(0)} ${y(0)}`, ...roc.steps.map((step) => `L ${x(step.falsePositiveRate)} ${y(step.truePositiveRate)}`)].join(" ");

  return (
    <div ref={ref} className="min-w-0">
      <svg width={size} height={size} role="img" aria-label="ROC curve built from score bins, one trapezoid per bin">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={y(0)} y2={y(1)} stroke="#404040" strokeOpacity={0.4} />
            <line x1={x(0)} x2={x(1)} y1={y(tick)} y2={y(tick)} stroke="#404040" strokeOpacity={0.4} />
            <text x={x(tick)} y={y(0) + 13} textAnchor="middle" fontSize={10} fill="#a3a3a3">{tick}</text>
            <text x={x(0) - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#a3a3a3">{tick}</text>
          </g>
        ))}
        {roc.steps.map((step) => {
          if (step.step > currentStep) return null;
          const points = [
            [step.previousFalsePositiveRate, 0],
            [step.previousFalsePositiveRate, step.previousTruePositiveRate],
            [step.falsePositiveRate, step.truePositiveRate],
            [step.falsePositiveRate, 0],
          ] as const;
          const active = step.step === currentStep;
          return (
            <polygon
              key={step.step}
              points={points.map(([px, py]) => `${x(px)},${y(py)}`).join(" ")}
              fill={active ? OKABE.orange : OKABE.sky}
              fillOpacity={active ? 0.55 : 0.28}
              stroke={active ? OKABE.orange : "none"}
            >
              <title>{`step ${step.step} (bin ${step.binNumber}): area ${fmt(step.area, 5)}, running total ${fmt(step.cumulativeArea, 5)}`}</title>
            </polygon>
          );
        })}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#d4d4d4" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke="#f5f5f5" strokeWidth={1.4} />
        {roc.steps.map((step) => (
          <circle
            key={step.step}
            cx={x(step.falsePositiveRate)}
            cy={y(step.truePositiveRate)}
            r={step.step === currentStep ? 4.5 : 2.6}
            fill={step.step <= currentStep ? OKABE.orange : "#737373"}
            stroke="#0a0a0a"
            strokeWidth={0.6}
          >
            <title>{`after bin ${step.binNumber}: false-positive rate ${fmt(step.falsePositiveRate, 4)}, true-positive rate ${fmt(step.truePositiveRate, 4)}`}</title>
          </circle>
        ))}
        <text x={x(0.5)} y={size - 4} textAnchor="middle" fontSize={10} fill="#a3a3a3">false-positive rate (not-up rows called up)</text>
        <text transform={`translate(11 ${y(0.5)}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="#a3a3a3">true-positive rate</text>
      </svg>
      <p className="text-[11px] text-neutral-400">
        dashed = coin flip (area 0.5) · circles = cumulative bins · <span style={{ color: OKABE.orange }}>orange</span> = the step being read
      </p>
    </div>
  );
}
