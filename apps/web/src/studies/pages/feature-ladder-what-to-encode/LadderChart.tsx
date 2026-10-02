/**
 * The ladder for one target: the real score at each rung (orange circles,
 * filled when the block earns its place, hollow when it does not) against the
 * best of five shuffled copies (purple dashed, triangle down).
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Empty, GRID, OKABE, TOOLTIP, fmtInt } from "@/studies/kit";
import { blockLabel, isEarned, metricLabel, rungsOf, signed, type LadderRow } from "@shared/studies/feature-ladder-what-to-encode";

interface Point {
  block: string;
  row: LadderRow;
  score: number;
  shuffled: number | null;
  earned: boolean;
}

type DotProps = { cx?: number; cy?: number; key?: string; payload?: Point };

function RealDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return <g />;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill={payload.earned ? OKABE.orange : "#0a0a0a"}
      stroke={OKABE.orange}
      strokeWidth={2.5}
    />
  );
}

function ShuffleDot({ cx, cy }: DotProps) {
  if (cx === undefined || cy === undefined) return <g />;
  return <path d={`M ${cx - 5} ${cy - 4} L ${cx + 5} ${cy - 4} L ${cx} ${cy + 5} Z`} fill={OKABE.purple} />;
}

export function LadderChart({
  rows,
  target,
  showShuffle,
  minimumIncrement,
  highlightRung,
}: {
  rows: readonly LadderRow[];
  target: string;
  showShuffle: boolean;
  minimumIncrement: number;
  highlightRung?: number;
}) {
  const rungs = rungsOf(rows, "derivatives_first", target);
  if (rungs.length === 0) return <Empty>The ladder for this target is not landed.</Empty>;

  const data: Point[] = rungs.map((row) => ({
    block: blockLabel(row.block_added),
    row,
    score: row.score_holdout,
    shuffled: row.shuffled_block_score_best_of_five,
    earned: isEarned(row, minimumIncrement),
  }));
  const metric = metricLabel(rungs[0]?.metric ?? "");
  const values = data.flatMap((point) => [point.score, ...(showShuffle && point.shuffled !== null ? [point.shuffled] : [])]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.1 || 0.005;
  const highlighted = highlightRung === undefined ? undefined : data.find((point) => point.row.rung_index === highlightRung)?.block;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="block" {...AXIS} interval={0} angle={-18} textAnchor="end" height={64} />
        <YAxis
          {...AXIS}
          width={62}
          domain={[low - pad, high + pad]}
          tickFormatter={(value: number) => value.toFixed(3)}
          label={{ value: `${metric} on 2025, scored once`, angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, dx: -4 }}
        />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const point = payload?.[0]?.payload as Point | undefined;
            if (!point) return null;
            const row = point.row;
            return (
              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                <div className="font-semibold">
                  rung {row.rung_index}: {point.block}
                </div>
                <div>features so far {fmtInt(row.feature_count)}</div>
                <div>
                  score {signed(row.score_holdout, 5)} · increment {signed(row.score_increment_over_previous_rung, 5)}
                </div>
                <div>best of five shuffles {signed(row.shuffled_block_score_best_of_five, 5)}</div>
                <div>{point.earned ? "✓ earns its place" : row.rung_index === 0 ? "the intercept: nothing to beat" : "○ does not earn its place"}</div>
                <div>test rows {fmtInt(row.test_row_count)}</div>
              </div>
            );
          }}
        />
        {highlighted && <ReferenceLine x={highlighted} stroke={OKABE.sky} strokeDasharray="2 3" />}
        {metric === "area under the curve" && <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "0.5 = coin flip", fill: "#a3a3a3", fontSize: 10, position: "insideTopRight" }} />}
        {metric === "R squared" && low < 0 && high > 0 && <ReferenceLine y={0} stroke={OKABE.grey} strokeDasharray="4 3" />}
        <Line
          dataKey="score"
          name="real score"
          stroke={OKABE.orange}
          strokeWidth={3}
          isAnimationActive={false}
          dot={(props: DotProps) => <RealDot key={props.key} cx={props.cx} cy={props.cy} payload={props.payload} />}
          activeDot={false}
        />
        {showShuffle && (
          <Line
            dataKey="shuffled"
            name="best of five shuffles"
            stroke={OKABE.purple}
            strokeWidth={2}
            strokeDasharray="6 4"
            connectNulls
            isAnimationActive={false}
            dot={(props: DotProps) => <ShuffleDot key={props.key} cx={props.cx} cy={props.cy} />}
            activeDot={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The blocks that earn their place on one target, as "name (+increment)". */
export function earnedList(rows: readonly LadderRow[], target: string, minimumIncrement: number): Array<{ block: string; increment: number }> {
  return rungsOf(rows, "derivatives_first", target)
    .filter((row) => isEarned(row, minimumIncrement))
    .map((row) => ({ block: row.block_added, increment: row.score_increment_over_previous_rung as number }));
}

export function scoreRange(rows: readonly LadderRow[], target: string): { first: number | null; best: number | null } {
  const rungs = rungsOf(rows, "derivatives_first", target);
  return { first: rungs[0]?.score_holdout ?? null, best: rungs.length > 0 ? Math.max(...rungs.map((row) => row.score_holdout)) : null };
}
