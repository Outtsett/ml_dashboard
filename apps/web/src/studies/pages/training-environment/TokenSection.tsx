/**
 * Section 3: the token being assembled. Each block is projected to the model
 * dimension and the projections are summed into one token per bar; the norm
 * of each block's contribution is what a single wide projection could not
 * report. Left: each block's contribution at the newest epoch, largest first.
 * Right: how every block's share moves epoch by epoch. Series differ by colour,
 * marker shape and dash.
 */

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, FormulaCard, GRID, Section, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { BlockNormRow, TrainingRunRow } from "@shared/studies/training-environment";
import { SERIES_STYLES, markerDot } from "./shared";

export function TokenSection({ norms, run }: { norms: readonly BlockNormRow[]; run: TrainingRunRow | null }) {
  if (norms.length === 0) {
    return (
      <Section title="3 · The token being assembled" question="Six blocks, six projections, summed into one token per bar.">
        <p className="py-4 text-xs text-neutral-400">Waiting for the first epoch: no block norms yet.</p>
      </Section>
    );
  }
  const newest = Math.max(...norms.map((row) => row.epoch));
  const latest = norms.filter((row) => row.epoch === newest).sort((a, b) => (b.token_norm ?? 0) - (a.token_norm ?? 0));
  const order = latest.map((row) => row.block);
  const styleOf = (block: string) => SERIES_STYLES[order.indexOf(block) % SERIES_STYLES.length] ?? SERIES_STYLES[0]!;
  const epochs = [...new Set(norms.map((row) => row.epoch))].sort((a, b) => a - b);
  const wide = epochs.map((epoch) => ({
    epoch,
    ...Object.fromEntries(norms.filter((row) => row.epoch === epoch).map((row) => [row.block, row.token_norm])),
  }));
  const total = latest.reduce((sum, row) => sum + (row.token_norm ?? 0), 0);
  const top = latest[0];

  return (
    <Section title="3 · The token being assembled" question="The bars are each block's mean contribution to the summed token: the quantity a single wide projection cannot report, and why the blocks are kept separate.">
      <div className="space-y-3">
        <Finding>
          At epoch {fmtInt(newest)}, {top?.block} contributes the most ({fmt(top?.token_norm, 4)}, {fmt(total > 0 ? ((top?.token_norm ?? 0) / total) * 100 : null, 1)}% of the norms' total) and {latest[latest.length - 1]?.block} the least ({fmt(latest[latest.length - 1]?.token_norm, 4)}).
        </Finding>
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={latest} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} label={{ value: `mean token norm contributed, epoch ${newest}`, position: "insideBottom", offset: -2, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis type="category" dataKey="block" width={110} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 4), "token norm"]} />
                <Bar dataKey="token_norm" isAnimationActive={false} label={{ position: "right", fontSize: 10, fill: "#d4d4d4", formatter: (value: number) => fmt(value, 3) }}>
                  {latest.map((row) => (
                    <Cell key={row.block} fill={styleOf(row.block).colour} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={wide} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...AXIS} label={{ value: "epoch", position: "insideBottom", offset: -2, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis {...AXIS} width={44} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 4), name]} labelFormatter={(label) => `epoch ${label}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {order.map((block) => {
                  const style = styleOf(block);
                  return <Line key={block} dataKey={block} name={block} type="monotone" stroke={style.colour} strokeDasharray={style.dash} strokeWidth={2} dot={markerDot(style)} legendType="plainline" isAnimationActive={false} />;
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <FormulaCard
          tex={String.raw`t_i=\mathrm{LN}\Big(\sum_{b} P_b\big(\mathrm{LN}_b(x_{i,b})\big)\Big),\qquad c_b=\frac{1}{N}\sum_{i=1}^{N}\big\lVert P_b(\mathrm{LN}_b(x_{i,b}))\big\rVert_2`}
          caption="Each block is normalised, projected to the model dimension and added; c_b is what this section draws."
          symbols={[
            { tex: "b", name: "a modality block (geometry, kinematics, volume, structure, pattern)", value: `${latest.length} blocks` },
            { tex: "x_{i,b}", name: "block b's features at bar i (section 2)", value: "the numbers in the heatmap" },
            { tex: "\\mathrm{LN}_b", name: "layer normalisation of that block's input", value: "per block" },
            { tex: "P_b", name: "the block's learned linear projection to the model dimension", value: `${fmtInt(run?.model_dimension)} dimensions` },
            { tex: "t_i", name: "the token for bar i: the sum of the block projections, layer-normalised", value: `${fmtInt(run?.model_dimension)}-dimensional` },
            { tex: "c_b", name: "mean norm of block b's contribution", value: `${top?.block} ${fmt(top?.token_norm, 4)} (largest)` },
            { tex: "N", name: "bars in the probed test batch", value: "the run's test split" },
          ]}
        />
      </div>
    </Section>
  );
}
