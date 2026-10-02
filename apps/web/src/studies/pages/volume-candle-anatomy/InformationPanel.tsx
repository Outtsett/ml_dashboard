/**
 * Panel C: where the relationship is not linear. Each pairing's measured
 * mutual information against its absolute Pearson correlation, with the
 * Gaussian-equivalent curve: distance above it is dependence a linear
 * coefficient cannot see.
 */

import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { AXIS, FormulaCard, Finding, GRID, Section, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  ENCODING_ORDER, gaussianEquivalentNats, pairingPoints,
  type BoardOverallRow, type PairingPoint,
} from "@shared/studies/volume-candle-anatomy";
import { ENCODING_STYLE, POPULATION_LABEL, SHORT_ENCODING, SHORT_MEASURE, type Controls } from "./controls";
import { selectRows } from "./ReadingsPanel";

function PairingTip({ payload }: { payload?: ReadonlyArray<{ payload?: PairingPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!point || !point.pairing) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="font-semibold">{point.pairing}</div>
      <div>|Pearson| {fmt(point.absoluteCorrelation, 4)} · measured {fmt(point.nats, 4)} nats</div>
      <div>Gaussian equivalent {fmt(point.gaussianNats, 4)} nats · excess ratio {fmt(point.excessRatio, 2)}</div>
      <div>{fmtInt(point.barCount)} bars{point.hidden ? " · hidden from linear features" : ""}</div>
    </div>
  );
}

export function InformationPanel({ rows, controls }: { rows: readonly BoardOverallRow[]; controls: Controls }) {
  const scope = selectRows(rows, { ...controls, hideTautology: false });
  const points = pairingPoints(scope, controls.hideTautology);
  const hidden = points.filter((point) => point.hidden).sort((a, b) => b.nats - a.nats);
  const maximumX = Math.max(0.05, ...points.map((point) => point.absoluteCorrelation)) * 1.05;
  const curve = Array.from({ length: 41 }, (_, i) => {
    const x = (maximumX * i) / 40;
    return { x, y: gaussianEquivalentNats(x) };
  });
  const maximumY = Math.max(0.01, ...points.map((point) => point.nats), gaussianEquivalentNats(maximumX)) * 1.08;
  const example = points.find((point) => point.hidden) ?? points[0];

  return (
    <Section
      title="C. Where the relationship is not linear"
      question="A correlation only sees a straight line; mutual information sees any dependence. Distance above the dashed curve is structure the correlation cannot see."
    >
      <div className="space-y-3">
        <FormulaCard
          tex={"\\text{excess} = \\frac{I(V;A)}{I_{\\text{Gaussian}}(\\rho)},\\qquad I_{\\text{Gaussian}}(\\rho) = -\\tfrac{1}{2}\\ln\\!\\left(1-\\rho^{2}\\right)"}
          caption="Read the nats, not the ratio: the ratio divides by a quantity that collapses toward zero as the correlation does (at a correlation of -0.011 the denominator is 0.000063 nats and the ratio reads 980 times, a division artefact)."
          symbols={[
            { tex: "I(V;A)", name: "measured mutual information between the volume reading and the candle part (nats, k-nearest-neighbour estimate with k = 3)", value: example ? `${fmt(example.nats, 4)} nats` : "—" },
            { tex: "\\rho", name: "Pearson correlation: the straight-line part of the dependence", value: example ? fmt(example.absoluteCorrelation, 4) : "—" },
            { tex: "I_{\\text{Gaussian}}(\\rho)", name: "what a bivariate normal with the same correlation would carry, in nats", value: example ? `${fmt(example.gaussianNats, 4)} nats` : "—" },
            { tex: "\\text{excess}", name: "the ratio: 1.0 means the correlation said everything", value: example ? fmt(example.excessRatio, 2) : "—" },
          ]}
        />
        <Finding>
          <strong>{hidden.length} of {points.length} pairings carry real dependence at a correlation below 0.15</strong> (measured nats above three times the Gaussian equivalent), which is invisible to every linear feature on {controls.timeframe}, {POPULATION_LABEL[controls.population]}.
          {hidden.length > 0 && (
            <> Largest: {hidden.slice(0, 3).map((point) => `${SHORT_MEASURE[point.anatomy_measure] ?? point.anatomy_measure} × ${SHORT_ENCODING[point.volume_encoding] ?? point.volume_encoding} (${fmt(point.nats, 4)} nats at |rho| ${fmt(point.absoluteCorrelation, 3)})`).join("; ")}.</>
          )}
          {" "}The valuable corner is the upper left.
        </Finding>
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="x" name="|Pearson|" domain={[0, maximumX]} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} label={{ value: "|Pearson correlation|: what a linear feature captures", position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis type="number" dataKey="y" name="nats" domain={[0, maximumY]} {...AXIS} tickFormatter={(v: number) => v.toFixed(3)} label={{ value: "measured mutual information (nats)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
            <ZAxis range={[70, 70]} />
            <ReferenceLine x={0.15} stroke="#8a8a8a" strokeDasharray="2 4" label={{ value: "0.15", fill: "#8a8a8a", fontSize: 9, position: "top" }} />
            <Tooltip {...TOOLTIP} content={(props) => <PairingTip payload={props.payload as ReadonlyArray<{ payload?: PairingPoint }> | undefined} />} />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
            <Line data={curve} dataKey="y" name="Gaussian equivalent" stroke="#f5f5f5" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} legendType="plainline" />
            {ENCODING_ORDER.map((encoding) => {
              const style = ENCODING_STYLE[encoding];
              const data = points.filter((point) => point.volume_encoding === encoding).map((point) => ({ ...point, x: point.absoluteCorrelation, y: point.nats }));
              if (!style || data.length === 0) return null;
              return <Scatter key={encoding} name={SHORT_ENCODING[encoding]} data={data} fill={style.color} shape={style.shape} legendType={style.shape} isAnimationActive={false} />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}
