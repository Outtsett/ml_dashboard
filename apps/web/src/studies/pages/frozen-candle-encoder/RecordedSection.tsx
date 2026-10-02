/**
 * The notebook's closing argument: what should happen to the checkpoint, and
 * the label-free encoders that lost to raw numbers. Every figure here was typed
 * into the notebook's prose (its sources are listed); none is recomputed or
 * landed, and the section says so.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { RECORDED_FIGURES } from "@shared/studies/frozen-candle-encoder";

export function RecordedSection() {
  const figures = RECORDED_FIGURES;
  const comparison = figures.labelFreeEncoders.map((entry) => ({
    encoder: entry.encoder,
    learned: entry.learned,
    control: entry.control,
    controlName: entry.controlName,
  }));

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-[11px] text-neutral-400">
        Recorded figures: typed into the notebook from {figures.sources.join("; ")}. They are shown as written and are not recomputed by this page.
      </p>

      <Finding>
        <strong>Not a frozen encoder for direction.</strong> Two uses survive, because neither depends on the embedding carrying forecast information.
      </Finding>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">1. A soft-margin instrument</h4>
          <Finding>
            TA-Lib emits a hard 0 or ±100; the recogniser emits a continuous probability per pattern on every bar. Of {fmtInt(figures.ruleMargins.firingCount)} firings, <strong>{(figures.ruleMargins.withinTenPercentShare * 100).toFixed(1)}%</strong> sit within 10% of the threshold that defines them and <strong>{(figures.ruleMargins.withinOnePercentShare * 100).toFixed(1)}%</strong> within 1%, so the hard label is brittle exactly where it matters and the soft output is that margin, already computed. A data-quality instrument, not a feature.
          </Finding>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">2. If a candle encoder is wanted, use the raw candle-part numbers</h4>
          <Finding>
            The label-free encoders of <code>build_mnq_shape_embedding.py</code> (autoencoder, vector-quantised, masked-candle, last-three-candle variants) were each scored against a raw-number control at the same scale, and they lost.
          </Finding>
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">Linear-probe average precision: label-free encoder against its raw control</h4>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={comparison} margin={{ top: 14, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="encoder" {...AXIS} interval={0} height={56} tick={{ fontSize: 10, fill: "#a3a3a3" }} tickFormatter={(value: string) => (value.length > 28 ? `${value.slice(0, 27)}…` : value)} />
            <YAxis {...AXIS} domain={[0, 0.6]} width={36} />
            <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="learned" name="learned encoder" fill={OKABE.purple} isAnimationActive={false} label={{ position: "top", fontSize: 10, fill: "#d4d4d4", formatter: (v: unknown) => fmt(Number(v), 4) }} />
            <Bar dataKey="control" name="raw-number control" fill={OKABE.sky} isAnimationActive={false} label={{ position: "top", fontSize: 10, fill: "#d4d4d4", formatter: (v: unknown) => fmt(Number(v), 4) }} />
          </BarChart>
        </ResponsiveContainer>
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="py-0.5 text-left font-normal">encoder</th>
              <th className="py-0.5 text-right font-normal">learned</th>
              <th className="py-0.5 text-right font-normal">its raw control</th>
              <th className="py-0.5 text-right font-normal">learned minus control</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((row) => (
              <tr key={row.encoder} className="border-t border-neutral-900">
                <td className="py-0.5 pr-2 text-left font-sans text-neutral-300">{row.encoder} vs {row.controlName}</td>
                <td className="py-0.5 text-right">{fmt(row.learned, 4)}</td>
                <td className="py-0.5 text-right">{fmt(row.control, 4)}</td>
                <td className="py-0.5 text-right">▼ {fmt(row.learned - row.control, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Finding>
        The autoencoder scored below a random untrained encoder ({fmt(figures.untrainedAutoencoderAveragePrecision, 4)}) on hammer. Neighbour purity gives the same ordering: autoencoder {figures.neighbourPurityLift.autoencoderShootingStar}x lift over chance on shooting star against {figures.neighbourPurityLift.rawSixtyFourShootingStar}x for the raw 64 numbers. The masked-candle variant failed its volatility check: one of its 16 coordinates correlates {fmt(figures.maskedCandleVolatilityCorrelation.maskedCoordinate, 4)} (Spearman) with the ATR-14 percentile against at most {fmt(figures.maskedCandleVolatilityCorrelation.worstControl, 4)} for any control, so it spent its capacity on volatility rather than shape. The single case where a learned method beat its strongest control is the last-three-candle vocabulary on cluster agreement, adjusted mutual information {fmt(figures.adjustedMutualInformation.learned, 4)} against {fmt(figures.adjustedMutualInformation.control, 4)}: one narrow win across dozens of comparisons.
      </Finding>
      <Finding>
        None of those five embeddings was ever scored for direction. The one direction test that exists used the raw vectors and returned a null: median area under the curve {fmt(figures.rawVectorDirectionTest.medianAreaUnderCurve, 4)} across {figures.rawVectorDirectionTest.testCount} tests, {figures.rawVectorDirectionTest.significantAfterBenjaminiHochberg} of {figures.rawVectorDirectionTest.testCount} significant under Benjamini-Hochberg at a 10% false-discovery rate.
      </Finding>
      <Finding>
        <strong>Both mistakes behind this page are one mistake:</strong> recommending an encoder from plausible reasoning about training objectives instead of from the scores already in the workspace. Freezing the recogniser was recommended first; the reason given for doubting it ("the embedding is just the 61 labels") is only about 25% right; then the label-free encoders were recommended as the alternative without checking that they had already been measured and had lost to the raw numbers. On this data, every learned candle representation built so far is beaten by the arithmetic you would write by hand.
      </Finding>
    </div>
  );
}
