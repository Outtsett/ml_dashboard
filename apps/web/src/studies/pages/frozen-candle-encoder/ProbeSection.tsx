/**
 * Reason 3, the measurement that decides it: five feature blocks fitted on
 * 2024 and scored once on 2025 for "is price higher k candles from now?".
 * `embedding_shuffled` (the same 256 numbers, rows permuted) carries no
 * information by construction and is the yardstick; each block also carries its
 * own label-permutation null, and its 95th percentile (black tick) is the bar
 * to clear, not 0.5. Encoder orange solid, control purple hatched, comparison
 * blue, so the role never rests on colour.
 */

import { useState } from "react";
import { useMeasuredWidth } from "@/market/regression/ScatterPlot";
import {
  AXIS, ControlBar, Finding, FormulaCard, OKABE, SegmentControl, Stat, SummaryTable, SwitchControl,
  eightNumberSummary, fmt, fmtInt,
} from "@/studies/kit";
import {
  BLOCK_LABEL, DIRECTION_BLOCK_ORDER, RECORDED_FIGURES, blockRole, horizonVerdicts, winnersAtHorizon,
  type BlockRole, type DirectionRow,
} from "@shared/studies/frozen-candle-encoder";

const DOMAIN_FLOOR = 0.48;
const DOMAIN_CEILING = 0.52;
const ROW = 38;
const MARGIN = { top: 26, right: 16, bottom: 30, left: 190 };

const ROLE_COLOUR: Record<BlockRole, string> = { encoder: OKABE.orange, control: OKABE.purple, comparison: OKABE.blue };
const ROLE_NAME: Record<BlockRole, string> = { encoder: "the encoder under test", control: "information-free control", comparison: "comparison" };

interface Props {
  direction: readonly DirectionRow[];
  horizon: number;
  showNull: boolean;
  onHorizon: (value: number) => void;
  onShowNull: (value: boolean) => void;
}

function DirectionBars({ rows, showNull }: { rows: readonly DirectionRow[]; showNull: boolean }) {
  const [wrapper, width] = useMeasuredWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const ordered = DIRECTION_BLOCK_ORDER.flatMap((block) => rows.filter((row) => row.feature_block === block));
  const values = ordered.flatMap((row) => [row.area_under_curve_test, row.permutation_null_95th_percentile]).filter((v): v is number => v !== null);
  const low = Math.min(DOMAIN_FLOOR, ...values);
  const high = Math.max(DOMAIN_CEILING, ...values);
  const plotWidth = Math.max(80, width - MARGIN.left - MARGIN.right);
  const height = MARGIN.top + ROW * ordered.length + MARGIN.bottom;
  const x = (value: number) => MARGIN.left + (plotWidth * (value - low)) / (high - low);
  const ticks = Array.from({ length: 5 }, (_, i) => low + ((high - low) * i) / 4);
  const active = ordered.find((row) => row.feature_block === hovered);

  return (
    <div ref={wrapper} className="min-w-0">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Area under the curve per feature block, with permutation null ticks" onMouseLeave={() => setHovered(null)}>
          <defs>
            <pattern id="control-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={OKABE.purple} fillOpacity={0.35} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.purple} strokeWidth="3" />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={MARGIN.top - 6} y2={height - MARGIN.bottom} stroke="#262626" />
              <text x={x(tick)} y={height - 12} textAnchor="middle" fontSize={10} fill={AXIS.stroke}>{tick.toFixed(3)}</text>
            </g>
          ))}
          <line x1={x(0.5)} x2={x(0.5)} y1={MARGIN.top - 8} y2={height - MARGIN.bottom} stroke="#ffffff" strokeWidth={2} />
          <text x={x(0.5)} y={MARGIN.top - 12} textAnchor="middle" fontSize={10} fill="#ffffff">coin flip 0.5</text>
          {ordered.map((row, index) => {
            const role = blockRole(row.feature_block);
            const centre = MARGIN.top + ROW * index + ROW / 2;
            const score = row.area_under_curve_test ?? 0.5;
            const left = Math.min(x(0.5), x(score));
            const barWidth = Math.abs(x(score) - x(0.5));
            const nullX = row.permutation_null_95th_percentile;
            return (
              <g key={row.feature_block} onMouseEnter={() => setHovered(row.feature_block)}>
                <rect x={0} y={centre - ROW / 2} width={width} height={ROW} fill={hovered === row.feature_block ? "#ffffff10" : "transparent"} />
                <text x={MARGIN.left - 8} y={centre + 4} textAnchor="end" fontSize={11} fill="#d4d4d4">{BLOCK_LABEL[row.feature_block as keyof typeof BLOCK_LABEL] ?? row.feature_block}</text>
                <rect x={left} y={centre - 9} width={Math.max(1.5, barWidth)} height={18} fill={role === "control" ? "url(#control-hatch)" : ROLE_COLOUR[role]} stroke={ROLE_COLOUR[role]} strokeWidth={role === "control" ? 1.5 : 0} />
                <text x={score >= 0.5 ? left + barWidth + 4 : left - 4} y={centre + 4} textAnchor={score >= 0.5 ? "start" : "end"} fontSize={10} fill="#e5e5e5">{fmt(score, 4)}</text>
                {showNull && nullX !== null && <line x1={x(nullX)} x2={x(nullX)} y1={centre - 14} y2={centre + 14} stroke="#000000" strokeWidth={3} />}
                {showNull && nullX !== null && <line x1={x(nullX)} x2={x(nullX)} y1={centre - 14} y2={centre + 14} stroke="#ffffff" strokeWidth={1} />}
                {row.beats_permutation_null === true && <text x={width - MARGIN.right} y={centre + 4} textAnchor="end" fontSize={10} fill={OKABE.yellow}>✓ clears null</text>}
              </g>
            );
          })}
        </svg>
      )}
      <p className="min-h-[2.25rem] font-mono text-[11px] text-neutral-300">
        {active
          ? `${active.feature_block}: ${fmtInt(active.feature_count)} features, ${fmtInt(active.train_row_count)} train / ${fmtInt(active.test_row_count)} test rows, area ${fmt(active.area_under_curve_test, 4)}, null 95th percentile ${fmt(active.permutation_null_95th_percentile, 4)} (median ${fmt(active.permutation_null_median, 4)}), up rate ${fmt(active.test_up_rate, 4)}, clears its null: ${active.beats_permutation_null ? "yes" : "no"}`
          : "Hover a row for its feature count, row counts, null and verdict."}
      </p>
    </div>
  );
}

export function ProbeSection({ direction, horizon, showNull, onHorizon, onShowNull }: Props) {
  if (direction.length === 0) {
    return <p className="text-xs text-neutral-500">The direction probe rows are not in the lake yet.</p>;
  }
  const horizons = [...new Set(direction.map((row) => row.forward_candle_count))].sort((a, b) => a - b);
  const horizonNow = horizons.includes(horizon) ? horizon : (horizons[0] ?? 1);
  const rows = direction.filter((row) => row.forward_candle_count === horizonNow);
  const verdicts = horizonVerdicts(direction);
  const current = verdicts.find((entry) => entry.forward_candle_count === horizonNow);
  const winners = winnersAtHorizon(direction, horizonNow);
  const encoderClearsAnywhere = verdicts.some((entry) => entry.encoderBeatsNull === true);
  const advantages = verdicts.map((entry) => entry.advantage).filter((v): v is number => v !== null);
  const bestAdvantage = advantages.length > 0 ? Math.max(...advantages) : null;
  const negativeCount = advantages.filter((v) => v < 0).length;
  const clearCount = verdicts.filter((entry) => entry.encoderBeatsNull === true).length;
  const scores = direction.map((row) => row.area_under_curve_test).filter((v): v is number => v !== null);
  const testRows = rows[0]?.test_row_count ?? null;
  const trainRows = rows[0]?.train_row_count ?? null;

  return (
    <div className="space-y-3">
      <Finding>
        The embeddings for all 126,624 held-out windows were already on disk, so nothing was retrained. Joined to the forward returns in <code>mnq_next_candles_5m</code>, fitted on 2024 and scored once on 2025, five feature blocks were asked the same question. The block that matters is <strong>embedding_shuffled</strong>: the same 256 numbers with their rows permuted, identical shape and distribution and zero information by construction. A block that does not clearly beat it carries no signal, whatever its raw score. Each block also has its own label-permutation null, because 256 correlated columns on 40,000 rows can clear 0.50 out of sample by overfitting alone: the 95th percentile of that null, not 0.50, is the bar.
      </Finding>

      <ControlBar>
        <SegmentControl label="Forward horizon" value={horizonNow} options={horizons.map((value) => ({ value, label: `${value} candle${value > 1 ? "s" : ""} ahead` }))} onChange={onHorizon} />
        <SwitchControl label="Draw each block's permutation null" checked={showNull} onChange={onShowNull} />
      </ControlBar>

      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Encoder area (2025)" value={fmt(current?.encoder, 4)} tone={OKABE.orange} hint={`${horizonNow} candle(s) ahead`} />
        <Stat label="Shuffled control area" value={fmt(current?.control, 4)} tone={OKABE.purple} />
        <Stat label="Encoder advantage" value={current?.advantage === null || current?.advantage === undefined ? "—" : `${current.advantage >= 0 ? "▲ +" : "▼ "}${fmt(current.advantage, 4)}`} tone={current?.advantage !== undefined && current.advantage !== null && current.advantage >= 0 ? OKABE.orange : OKABE.blue} />
        <Stat label="Encoder clears its null" value={current?.encoderBeatsNull === null || current?.encoderBeatsNull === undefined ? "—" : current.encoderBeatsNull ? "yes" : "no"} hint={`null 95th percentile ${fmt(current?.encoderNull95, 4)}`} />
      </div>

      <DirectionBars rows={rows} showNull={showNull} />
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>■ encoder under test</span> · <span style={{ color: OKABE.purple }}>▨ information-free control (hatched)</span> · <span style={{ color: OKABE.blue }}>■ comparison</span> · black tick = that block's permutation null (95th percentile) · bars run from the coin flip at 0.5 · {fmtInt(trainRows)} train rows, {fmtInt(testRows)} test rows.
      </p>
      <Finding>
        {horizonNow} candle{horizonNow > 1 ? "s" : ""} ahead.{" "}
        {winners.length === 0
          ? "No block clears its own null."
          : `Blocks clearing their null: ${winners.join(", ")}.${winners.includes("embedding_shuffled") ? " That includes the information-free control, which is what a null being cleared by chance looks like." : ""}`}
      </Finding>

      <FormulaCard
        tex={"\\text{advantage}_k \\;=\\; \\mathrm{AUC}_{\\text{encoder}}(k) - \\mathrm{AUC}_{\\text{shuffled}}(k), \\qquad \\text{clears its null} \\iff \\mathrm{AUC}(k) > q_{0.95}\\!\\left(\\mathrm{AUC}_{\\text{permuted target}}(k)\\right)"}
        caption={`At k = ${horizonNow}: ${fmt(current?.encoder, 4)} − ${fmt(current?.control, 4)} = ${fmt(current?.advantage, 4)}. The encoder's null bar is ${fmt(current?.encoderNull95, 4)}, so it ${current?.encoderBeatsNull ? "clears" : "does not clear"} it.`}
        symbols={[
          { tex: "k", name: "forward horizon: the number of 5-minute candles ahead that direction is predicted", value: String(horizonNow) },
          { tex: "\\mathrm{AUC}(k)", name: "area under the ROC curve on 2025: the chance a random up window is ranked above a random down window; 0.5 is a coin flip", value: "0.5 = no skill" },
          { tex: "\\mathrm{AUC}_{\\text{encoder}}(k)", name: "score of the 256-number embedding", value: fmt(current?.encoder, 4) },
          { tex: "\\mathrm{AUC}_{\\text{shuffled}}(k)", name: "score of the same 256 numbers with rows permuted (zero information)", value: fmt(current?.control, 4) },
          { tex: "\\text{advantage}_k", name: "encoder minus control: skill attributable to the embedding", value: fmt(current?.advantage, 4) },
          { tex: "q_{0.95}", name: "95th percentile of the score reached when the target itself is shuffled", value: fmt(current?.encoderNull95, 4) },
        ]}
      />

      <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="py-0.5 text-left font-normal">candles ahead</th>
              <th className="py-0.5 text-right font-normal">frozen encoder (256)</th>
              <th className="py-0.5 text-right font-normal">shuffled control (256)</th>
              <th className="py-0.5 text-right font-normal">encoder's advantage</th>
              <th className="py-0.5 text-right font-normal">encoder clears null</th>
            </tr>
          </thead>
          <tbody>
            {verdicts.map((entry) => (
              <tr key={entry.forward_candle_count} className={`border-t border-neutral-900 ${entry.forward_candle_count === horizonNow ? "bg-neutral-900/60" : ""}`}>
                <td className="py-0.5">{entry.forward_candle_count}</td>
                <td className="py-0.5 text-right">{fmt(entry.encoder, 4)}</td>
                <td className="py-0.5 text-right">{fmt(entry.control, 4)}</td>
                <td className="py-0.5 text-right">{entry.advantage === null ? "—" : `${entry.advantage >= 0 ? "▲ +" : "▼ "}${fmt(entry.advantage, 4)}`}</td>
                <td className="py-0.5 text-right">{entry.encoderBeatsNull === null ? "—" : entry.encoderBeatsNull ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Finding>
        <strong>{encoderClearsAnywhere ? "The encoder clears its null at some horizon; read the table." : "The frozen encoder does not beat a feature block built to contain nothing."}</strong>{" "}
        Its best advantage over the control is {fmt(bestAdvantage, 4)}, the advantage is negative at {negativeCount} of {verdicts.length} horizons, and it clears its own permutation null at {clearCount} of {verdicts.length}. Not a close call that better tuning would flip: it agrees with two independent results in the workspace (recorded figures): the direction CNN on these same images scored {RECORDED_FIGURES.directionCnn.imageAreaUnderCurve} out of sample against {RECORDED_FIGURES.directionCnn.numericControlAreaUnderCurve} for its 1-D numeric control, so the picture added nothing over the numbers, and every candle-shape statistic correlates with next return at under {RECORDED_FIGURES.candleShapeCorrelationBound.absoluteCorrelationBelow} in magnitude across {fmtInt(RECORDED_FIGURES.candleShapeCorrelationBound.barCount)} bars.
      </Finding>

      <SummaryTable columns={[{ name: "area under the curve, every block and horizon", summary: eightNumberSummary(scores) }]} />
    </div>
  );
}
