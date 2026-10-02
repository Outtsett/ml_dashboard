/**
 * The control, drawn: the AUC of each arithmetic pattern beside the direction
 * experiment's AUC on the same images and the same windows, with its bootstrap
 * interval. Patterns that are a pure function of the last one to three bars
 * sit near 1; direction sits on the chance line.
 */

import { Bar, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { patternLabel, type DirectionPairing, type PatternScoreRow } from "@shared/studies/chart-cnn-arithmetic-patterns";

const DOMAIN_LOW = 0.45;

export function ControlComparison({ rows, direction, selected, tag }: { rows: readonly PatternScoreRow[]; direction: DirectionPairing | null; selected: string; tag: string }) {
  const data = [...rows]
    .sort((a, b) => a.area_under_curve - b.area_under_curve)
    .map((row) => ({ label: patternLabel(row.pattern_name), pattern: row.pattern_name, auc: row.area_under_curve, row }));
  const lowest = data[0];
  const highest = data[data.length - 1];

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={Math.max(260, 20 * data.length + 50)}>
        <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 18 }} barCategoryGap={3}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={[DOMAIN_LOW, 1]}
            allowDataOverflow
            {...AXIS}
            tickFormatter={(value: number) => fmt(value, 2)}
            label={{ value: "AUC on the test windows", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }}
          />
          <YAxis type="category" dataKey="label" width={108} {...AXIS} interval={0} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const item = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!item) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="px-2 py-1 font-mono text-[11px]">
                  <div className="font-semibold">{item.label}</div>
                  <div>AUC {fmt(item.auc, 4)}</div>
                  <div>{fmtInt(item.row.positive_window_count)} positives</div>
                </div>
              );
            }}
          />
          <ReferenceLine x={0.5} stroke={OKABE.grey} strokeDasharray="5 4" label={{ value: "chance 0.50", fill: "#a3a3a3", fontSize: 10, position: "insideBottomRight" }} />
          {direction && (
            <ReferenceArea x1={direction.intervalLow} x2={direction.intervalHigh} fill={OKABE.vermillion} fillOpacity={0.35} stroke={OKABE.vermillion} ifOverflow="visible" />
          )}
          {direction && (
            <ReferenceLine x={direction.areaUnderCurve} stroke={OKABE.vermillion} strokeWidth={2} label={{ value: `direction ${fmt(direction.areaUnderCurve, 3)}`, fill: OKABE.vermillion, fontSize: 10, position: "insideTopRight" }} />
          )}
          <Bar dataKey="auc" name="AUC" isAnimationActive={false} fill={OKABE.blue} shape={(props: unknown) => {
            const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: { pattern: string } };
            const chosen = payload.pattern === selected;
            return <rect x={x} y={y} width={Math.max(0, width)} height={height} fill={chosen ? OKABE.purple : OKABE.blue} stroke={chosen ? "#fff" : "none"} />;
          }} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>■ pattern AUC</span> · <span style={{ color: OKABE.purple }}>■ the pattern picked in section B</span> ·{" "}
        <span style={{ color: OKABE.vermillion }}>┃ direction AUC of the same network family (2D image), shaded = 95% bootstrap interval</span> · ┅ chance
      </p>
      <Finding>
        {direction
          ? `On the same ${fmtInt(direction.testObservationCount)} ${tag} test windows, the direction label gives AUC ${fmt(direction.areaUnderCurve, 4)} (${fmt(direction.intervalLow, 4)} to ${fmt(direction.intervalHigh, 4)}), while the ${rows.length} arithmetic patterns give ${fmt(lowest?.auc, 3)} (${lowest?.label}) to ${fmt(highest?.auc, 3)} (${highest?.label}). `
          : `The direction result is not landed for this tag, so only the pattern side is drawn: AUC ${fmt(lowest?.auc, 3)} (${lowest?.label}) to ${fmt(highest?.auc, 3)} (${highest?.label}). `}
        Same images, same network, same chronological split: only the label changed. The network sees candle shape almost perfectly, so the direction result near 0.50 is a statement about the market, not the model.
      </Finding>
    </div>
  );
}
