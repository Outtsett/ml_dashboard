/**
 * Section 4 of the audit: next-bar range-bucket occupancy at any bucket size,
 * against the notebook's pinned 21 buckets of 2.0 points.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import { bucketIndex, type LabelAuditBody } from "@shared/studies/label-audit-1m";
import { DataTable, Legend, Pill } from "./parts";

type Range = LabelAuditBody["range"];

export function RangeSection({ range, bucketSize, bucketCount, probe, set }: {
  range: Range;
  bucketSize: number;
  bucketCount: number;
  probe: number;
  set: { bucketSize: (value: number) => void; bucketCount: (value: number) => void; probe: (value: number) => void };
}) {
  const summary = range.summary;
  const centreIndex = (bucketCount - 1) / 2;
  const half = (bucketCount - 1) / 2;
  const reach = half * bucketSize;
  const median = range.quantiles.find((row) => row.quantile === 0.5)?.points ?? null;
  const probeIndex = bucketIndex(probe, bucketSize, bucketCount);
  const probeRow = range.occupancy[probeIndex];
  const pinnedCentre = range.pinned.find((row) => row.bucket_index === 10)?.share ?? null;
  const isPinnedScheme = Math.abs(bucketSize - 2) < 1e-9 && bucketCount === 21;

  return (
    <Section title="4 · Range buckets: heavily concentrated at 1m, but not empty" question="Label = the bucket of close[t+1] − close[t]. Specified for a candle where a 2-point move is ordinary; at 1m most bars do not move 2 points.">
      <ControlBar>
        <SliderControl label="Bucket size (points)" value={bucketSize} min={0.25} max={5} step={0.25} onChange={set.bucketSize} format={(value) => `${fmt(value, 2)} pts`} hint="The notebook pinned 2.0; the fix set the default to 1.0" />
        <SliderControl label="Bucket count (odd)" value={bucketCount} min={3} max={41} step={2} onChange={set.bucketCount} format={(value) => String(value)} />
        <SliderControl label="Probe a move (points)" value={probe} min={-reach - bucketSize} max={reach + bucketSize} step={0.25} onChange={set.probe} format={(value) => `${fmt(value, 2)} pts`} hint="Which bucket does a one-bar move of this size land in?" />
      </ControlBar>

      <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Centre bucket share" value={fmtPercent(summary.centre_share, 1)} tone={OKABE.orange} hint="Bars whose next close sits in the bucket around zero" />
        <Stat label="Free majority accuracy vs chance" value={`${fmt(summary.majority_share, 4)} vs ${fmt(summary.chance_share, 4)}`} />
        <Stat label="Buckets under 0.1 % of bars" value={`${fmtInt(summary.sparse_bucket_count)} of ${fmtInt(bucketCount)}`} />
        <Stat label="Suggested bucket size (q68 / 3)" value={range.suggestedBucketSize === null ? "—" : `${fmt(range.suggestedBucketSize, 2)} pts`} hint="A third of the one-sigma 1m move" />
      </div>

      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Legend items={[
            { glyph: "■", label: "centre bucket (≈ no move)", color: OKABE.orange },
            { glyph: "■", label: "other buckets", color: OKABE.sky },
            { glyph: "┄", label: `uniform 1/${bucketCount}`, color: OKABE.grey },
            { glyph: "│", label: `probe → bucket ${probeIndex}`, color: OKABE.purple },
          ]} />
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={range.occupancy} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="bucket_centre_points" {...AXIS} tickFormatter={(value: number) => fmt(value, bucketSize < 1 ? 2 : 1)} label={{ value: "bucket centre, points (outer buckets are open-ended)", position: "insideBottom", offset: -2, fill: "#737373", fontSize: 10 }} height={32} />
              <YAxis tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} width={40} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof range.occupancy)[number] | undefined;
                  if (!row) return null;
                  const lower = row.bucket_index === 0 ? "−∞" : fmt(row.bucket_centre_points - bucketSize / 2, 2);
                  const upper = row.bucket_index === bucketCount - 1 ? "+∞" : fmt(row.bucket_centre_points + bucketSize / 2, 2);
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">bucket {row.bucket_index}: [{lower}, {upper}) points</div>
                      <div>{fmtInt(row.bar_count)} bars · {fmtPercent(row.share, 3)}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={1 / bucketCount} stroke={OKABE.grey} strokeDasharray="4 3" />
              {probeRow && <ReferenceLine x={probeRow.bucket_centre_points} stroke={OKABE.purple} />}
              <Bar dataKey="share" isAnimationActive={false}>
                {range.occupancy.map((row) => <Cell key={row.bucket_index} fill={row.bucket_index === centreIndex ? OKABE.orange : OKABE.sky} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            At {fmt(bucketSize, 2)} points the centre bucket alone hands a model {fmtPercent(summary.majority_share, 1)} accuracy against a chance rate of {fmtPercent(summary.chance_share, 2)}; the median one-minute move is {fmt(median, 2)} points. Grade the head against the majority share, never 1/{bucketCount}, and size buckets so the median move spans several (the fix set bucket_size_pts to 1.0).
          </Finding>
          {isPinnedScheme && pinnedCentre !== null && (
            <div className="flex flex-wrap gap-2">
              <Pill label="centre share, live SQL" value={fmtPercent(summary.centre_share, 3)} />
              <Pill label="centre share, notebook generator (landed)" value={fmtPercent(pinnedCentre, 3)} />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <FormulaCard
            tex={"k = \\min\\!\\Big(\\max\\!\\Big(\\Big\\lfloor \\frac{\\Delta}{b} + \\frac{N-1}{2} + \\tfrac12 \\Big\\rfloor,\\ 0\\Big),\\ N-1\\Big)"}
            caption={`A move of ${fmt(probe, 2)} points lands in bucket ${probeIndex} (centre ${fmt(probeRow?.bucket_centre_points, 2)}), which holds ${fmtPercent(probeRow?.share, 2)} of bars.`}
            symbols={[
              { tex: "\\Delta", name: "close[t+1] − close[t], points (the probe)", value: fmt(probe, 2) },
              { tex: "b", name: "bucket width, points", value: fmt(bucketSize, 2) },
              { tex: "N", name: "number of buckets (odd, so zero has its own)", value: String(bucketCount) },
              { tex: "\\tfrac{N-1}{2}", name: "index of the centre bucket", value: String(half) },
              { tex: "k", name: "bucket index the label takes (np.digitize against edges halfway between centres)", value: String(probeIndex) },
              { tex: "\\pm\\tfrac{N-1}{2}\\,b", name: "the labelable range; moves beyond it pile into the outer buckets", value: `±${fmt(reach, 2)} pts` },
            ]}
          />
          <DataTable
            rows={range.quantiles}
            rowKey={(row) => String(row.quantile)}
            columns={[
              { header: "quantile of |close[t+1] − close[t]|", cell: (row) => `q${fmt(row.quantile, 2)}` },
              { header: "points", cell: (row) => fmt(row.points, 2), align: "right" },
              { header: "ticks", cell: (row) => fmt(row.points === null ? null : row.points / 0.25, 0), align: "right" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
