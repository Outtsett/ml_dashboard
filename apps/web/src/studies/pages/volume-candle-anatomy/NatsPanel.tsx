/**
 * Panel C2: what a nat is, and what 0.06 of one is worth. An
 * information-unit converter: drag the nats and read the bits, the
 * correlation that would carry that much information, and a cloud of 1,200
 * standard-normal pairs drawn at that correlation (the same points every
 * time, so only the slider reshapes it). Clicking a row of the table sets
 * the slider to that pairing's measured nats.
 */

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, fmt } from "@/studies/kit";
import { correlatedCloud, equivalentCorrelation, fitLine, natsToBits, type BoardOverallRow } from "@shared/studies/volume-candle-anatomy";
import { SHORT_MEASURE, type Controls, type SetControl } from "./controls";

export function NatsPanel({ rows, controls, set }: { rows: readonly BoardOverallRow[]; controls: Controls; set: SetControl }) {
  const nats = Math.max(controls.nats, 1e-9);
  const bits = natsToBits(nats);
  const rho = equivalentCorrelation(nats);
  const cloud = correlatedCloud(rho);
  const line = fitLine(cloud);
  const fit = [-4, 4].map((x) => ({ x, y: line.intercept + line.slope * x }));

  const table = rows
    .filter((row) => row.timeframe === "5m" && row.bar_population === "closes_inside_range" && row.volume_encoding === "volume_rank_trailing" && row.mutual_information_nats !== null && row.pearson_correlation !== null)
    .map((row) => {
      const measured = row.mutual_information_nats as number;
      const equivalent = equivalentCorrelation(measured);
      return { row, nats: measured, bits: natsToBits(measured), equivalent, pearson: row.pearson_correlation as number, hidden: equivalent - Math.abs(row.pearson_correlation as number) };
    })
    .sort((a, b) => b.nats - a.nats);
  const extreme = table.find((entry) => entry.row.anatomy_measure === "body_signed_in_average_ranges");

  return (
    <Section
      title="C2. What a nat is, and what 0.06 of one is worth"
      question="A nat is a bit measured with the natural logarithm: 1 nat = 1.4427 bits. The useful question is what correlation would carry this much information."
    >
      <div className="space-y-3">
        <ControlBar onReset={() => set("nats", 0.0616)}>
          <SliderControl label="Mutual information (nats)" value={controls.nats} min={0} max={0.3} step={0.002} onChange={(v) => set("nats", v)} format={(v) => v.toFixed(4)} hint="Drag to see what an amount of information looks like as a correlation" />
        </ControlBar>
        <div className="space-y-3">
          <div className="min-w-0 space-y-3">
            <FormulaCard
              tex={"1\\ \\text{nat} = \\frac{1}{\\ln 2}\\ \\text{bits} = 1.4427\\ \\text{bits},\\qquad I = -\\tfrac{1}{2}\\ln\\!\\left(1-\\rho^{2}\\right)\\ \\Longrightarrow\\ \\rho_{\\text{equivalent}} = \\sqrt{1-e^{-2I}}"}
              caption={`${fmt(nats, 4)} nats is ${fmt(bits, 4)} bits (${fmt(bits, 3)} of one yes/no answer), which is the information a straight-line correlation of ${fmt(rho, 3)} would carry.`}
              symbols={[
                { tex: "I", name: "mutual information, in nats (the slider)", value: `${fmt(nats, 4)} nats` },
                { tex: "\\text{bits}", name: "the same quantity in base-2 units: nats divided by ln 2", value: fmt(bits, 4) },
                { tex: "\\rho_{\\text{equivalent}}", name: "the Pearson correlation of a bivariate normal that carries exactly I nats", value: fmt(rho, 4) },
                { tex: "e", name: "Euler's number, the base of the natural logarithm", value: "2.7183" },
              ]}
            />
            <FormulaCard
              tex={"I(V;A) = H(A) - H(A \\mid V)"}
              caption="Mutual information is how much your uncertainty about one thing drops once you are told the other. 0 means the volume told you nothing at all."
              symbols={[
                { tex: "H(A)", name: "entropy of the candle part: uncertainty about it knowing nothing else", value: "not stored" },
                { tex: "H(A \\mid V)", name: "conditional entropy: uncertainty left after being told the volume reading", value: "not stored" },
                { tex: "I(V;A)", name: "their difference: what the volume actually told you", value: `${fmt(nats, 4)} nats` },
                { tex: "V", name: "the volume reading (one of five encodings)", value: "one of five" },
                { tex: "A", name: "the candle part (upper wick, lower wick, body or one of the ratios)", value: "one of eight" },
              ]}
            />
          </div>
          <div className="mx-auto min-w-0 max-w-xl">
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="x" domain={[-4, 4]} {...AXIS} label={{ value: "a volume reading (standardised)", position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis type="number" dataKey="y" domain={[-4, 4]} {...AXIS} label={{ value: "a candle part (standardised)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <ZAxis range={[16, 16]} />
                <Scatter data={cloud} fill={OKABE.orange} fillOpacity={0.45} isAnimationActive={false} />
                <Line data={fit} dataKey="y" stroke="#f5f5f5" strokeWidth={2} dot={false} isAnimationActive={false} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">Correlation {fmt(rho, 3)}. A measure can sit at a measured correlation of almost exactly zero and still carry this much: the cloud shows the dependence&apos;s strength with none of its actual shape.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <p className="mb-1 text-[11px] text-neutral-400">This study&apos;s numbers, translated: volume_rank_trailing, 5-minute bars, bars closing strictly inside their range. Click a row to set the slider to its nats.</p>
          <table className="w-full text-[11px]">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="pr-3 font-normal">candle part</th>
                <th className="pr-3 text-right font-normal">nats</th>
                <th className="pr-3 text-right font-normal">bits</th>
                <th className="pr-3 text-right font-normal">correlation that would carry it</th>
                <th className="pr-3 text-right font-normal">correlation measured</th>
                <th className="text-right font-normal">hidden</th>
              </tr>
            </thead>
            <tbody className="font-mono tnum text-neutral-200">
              {table.map((entry) => (
                <tr key={entry.row.anatomy_measure} className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-800/50" onClick={() => set("nats", Math.min(0.3, Math.round(entry.nats / 0.002) * 0.002))}>
                  <td className="py-1 pr-3 font-sans text-neutral-100">{SHORT_MEASURE[entry.row.anatomy_measure] ?? entry.row.anatomy_measure}</td>
                  <td className="pr-3 text-right">{fmt(entry.nats, 4)}</td>
                  <td className="pr-3 text-right">{fmt(entry.bits, 4)}</td>
                  <td className="pr-3 text-right">{fmt(entry.equivalent, 3)}</td>
                  <td className="pr-3 text-right">{entry.pearson >= 0 ? "+" : ""}{fmt(entry.pearson, 4)}</td>
                  <td className="text-right font-semibold">{fmt(entry.hidden, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {extreme && (
          <Finding>
            The last column is the gap between the dependence that is there and the dependence a linear coefficient can see. The signed body is the extreme case: its measured correlation is {fmt(extreme.pearson, 3)}, indistinguishable from zero, yet it carries as much information as a <strong>{fmt(extreme.equivalent, 3)}</strong> correlation would. High volume means a big body in either direction, and a correlation coefficient averages those two halves away to nothing.
          </Finding>
        )}
      </div>
    </Section>
  );
}
