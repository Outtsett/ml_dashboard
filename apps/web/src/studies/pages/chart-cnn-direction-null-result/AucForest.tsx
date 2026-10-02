/**
 * Every (dataset, model) out-of-sample AUC with its 95% DeLong interval, drawn over the notebook's three verdict
 * bands (below 0.53 null, 0.53 to 0.58 weak, above 0.58 real). Image CNN = orange circle, sequence CNN = blue
 * square, so the two models differ by shape as well as colour.
 */

import { OKABE, fmt, fmtInt } from "@/studies/kit";
import type { ModelResultRow } from "@shared/studies/chart-cnn-direction-null-result";
import { MODEL_IMAGE } from "@shared/studies/chart-cnn-direction-null-result";
import { useWidth } from "./useWidth";

const LOW = 0.48;
const HIGH = 0.6;
const ROW = 26;
const TOP = 22;
const BOTTOM = 30;

export function AucForest({ rows, selectedTag, showIntervals }: { rows: readonly ModelResultRow[]; selectedTag: string; showIntervals: boolean }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = Math.max(measured, 280);
  const left = width < 420 ? 112 : 150;
  const right = 12;
  const plot = width - left - right;
  const x = (value: number) => left + ((Math.min(Math.max(value, LOW), HIGH) - LOW) / (HIGH - LOW)) * plot;
  const height = TOP + rows.length * ROW + BOTTOM;
  const axisY = TOP + rows.length * ROW;
  const ticks = [0.48, 0.5, 0.52, 0.54, 0.56, 0.58, 0.6];

  return (
    <div ref={ref} className="min-w-0">
      <svg width={width} height={height} role="img" aria-label="Out-of-sample AUC by dataset and model with 95% intervals over the null, weak and real bands">
        <rect x={x(LOW)} y={TOP - 6} width={x(0.53) - x(LOW)} height={rows.length * ROW + 6} fill={OKABE.grey} fillOpacity={0.1} />
        <rect x={x(0.53)} y={TOP - 6} width={x(0.58) - x(0.53)} height={rows.length * ROW + 6} fill={OKABE.yellow} fillOpacity={0.1} />
        <rect x={x(0.58)} y={TOP - 6} width={x(HIGH) - x(0.58)} height={rows.length * ROW + 6} fill={OKABE.orange} fillOpacity={0.12} />
        <text x={(x(LOW) + x(0.53)) / 2} y={11} textAnchor="middle" fontSize={10} fill="#a3a3a3">null (below 0.53)</text>
        <text x={(x(0.53) + x(0.58)) / 2} y={11} textAnchor="middle" fontSize={10} fill="#a3a3a3">weak</text>
        <text x={(x(0.58) + x(HIGH)) / 2} y={11} textAnchor="middle" fontSize={10} fill="#a3a3a3">real</text>
        <line x1={x(0.5)} x2={x(0.5)} y1={TOP - 6} y2={axisY} stroke="#d4d4d4" strokeDasharray="4 3" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={axisY} y2={axisY + 4} stroke="#737373" />
            <text x={x(tick)} y={axisY + 16} textAnchor="middle" fontSize={10} fill="#a3a3a3">{tick.toFixed(2)}</text>
          </g>
        ))}
        <text x={left + plot / 2} y={height - 3} textAnchor="middle" fontSize={10} fill="#a3a3a3">out-of-sample area under the ROC curve (0.50 = coin flip)</text>
        {rows.map((row, index) => {
          const y = TOP + index * ROW + ROW / 2 - 3;
          const image = row.model_name === MODEL_IMAGE;
          const colour = image ? OKABE.orange : OKABE.blue;
          const emphasised = row.dataset_tag === selectedTag;
          return (
            <g key={`${row.dataset_tag}-${row.model_name}`} opacity={emphasised ? 1 : 0.6}>
              <title>
                {`${row.dataset_tag} · ${row.model_name}: AUC ${fmt(row.area_under_curve, 4)}, 95% interval ${fmt(row.area_under_curve_interval_low, 4)} to ${fmt(row.area_under_curve_interval_high, 4)}, n ${fmtInt(row.test_observation_count)}`}
              </title>
              <text x={left - 8} y={y + 3} textAnchor="end" fontSize={10} fill={emphasised ? "#f5f5f5" : "#a3a3a3"}>
                {row.dataset_tag} · {row.model_name}
              </text>
              {showIntervals && (
                <g stroke={colour} strokeWidth={1.6}>
                  <line x1={x(row.area_under_curve_interval_low)} x2={x(row.area_under_curve_interval_high)} y1={y} y2={y} />
                  <line x1={x(row.area_under_curve_interval_low)} x2={x(row.area_under_curve_interval_low)} y1={y - 4} y2={y + 4} />
                  <line x1={x(row.area_under_curve_interval_high)} x2={x(row.area_under_curve_interval_high)} y1={y - 4} y2={y + 4} />
                </g>
              )}
              {image ? (
                <circle cx={x(row.area_under_curve)} cy={y} r={4.5} fill={colour} stroke="#0a0a0a" strokeWidth={0.8} />
              ) : (
                <rect x={x(row.area_under_curve) - 4} y={y - 4} width={8} height={8} fill={colour} stroke="#0a0a0a" strokeWidth={0.8} />
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>● 2D image CNN</span> · <span style={{ color: OKABE.blue }}>■ 1D sequence CNN (control)</span> · whiskers are 95% DeLong intervals
      </p>
    </div>
  );
}
