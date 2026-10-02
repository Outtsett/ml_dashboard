/**
 * Part 1: PC1 and PC2. A feature pair and the shadows on a direction; the
 * variance sum, stepped bar by bar; the spectrum of the whole vector; what
 * each component is made of.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import {
  blockShares, componentsForShare, isAtBest, pairAnalysis, termSum, unitDirection, varianceAtAngle,
  type LoadingRow,
} from "@shared/studies/vector-space-explained";
import { asBasis, featureIndex, type PartProps } from "./controls";
import { BLOCKS, blockColour, blockGlyph } from "./blocks";
import { PairScatter } from "./PairScatter";

function BasisControl({ controls, set, bases }: Pick<PartProps, "controls" | "set" | "bases">) {
  return (
    <SelectControl
      label="Basis (which blocks form the space)"
      value={asBasis(controls.basis)}
      options={[
        { value: "continuous", label: `continuous (${bases.continuous.names.length} dimensions)` },
        { value: "full", label: `full (${bases.full.names.length} dimensions, adds the pattern flags)` },
      ]}
      onChange={(value) => set("basis", value)}
      hint="continuous drops the 13 pattern_multihot flags; full keeps them"
    />
  );
}

export function PairSection({ body, controls, set, reset, bases }: PartProps) {
  const xi = featureIndex(body, controls.featureX, 0);
  const yi = featureIndex(body, controls.featureY, 1);
  const featureX = body.featureNames[xi] as string;
  const featureY = body.featureNames[yi] as string;
  const pair = pairAnalysis(body.values[xi] ?? [], body.values[yi] ?? []);
  const here = varianceAtAngle(pair, controls.angle);
  const share = pair.bestVariance > 0 ? here / pair.bestVariance : 0;
  const atBest = isAtBest(controls.angle, pair.bestAngleDegrees);
  const plotStride = Math.max(1, Math.floor(pair.count / 900));
  const rayStride = Math.max(1, Math.floor(pair.count / 110));
  const termLimit = Math.min(400, pair.count);
  const k = Math.min(Math.max(1, Math.round(controls.terms)), termLimit);
  const sum = termSum(pair, controls.angle, k, 400);
  const [c, s] = unitDirection(controls.angle);
  const options = body.featureNames.map((name, index) => ({ value: name, label: `${blockGlyph(body.featureBlocks[index] as string)} ${name}` }));

  const rows: Array<[string, string, boolean]> = [
    [`spread at ${controls.angle}°`, fmt(here, 4), false],
    ["best any direction can do", fmt(pair.bestVariance, 4), false],
    ["you are capturing", fmtPercent(share, 1), atBest],
    ["PC1 of this pair", `${fmt(pair.bestAngleDegrees, 1)}°`, false],
    ["correlation of the pair", `${pair.correlation >= 0 ? "+" : ""}${fmt(pair.correlation, 3)}`, false],
  ];

  const termData = sum.terms.map((term, index) => ({ i: index + 1, bar: body.barIndex[index] ?? index, term, included: index < k }));

  return (
    <div className="space-y-3">
      <Section
        title="1A. The whole idea, on two of your own features"
        question="Every dot is one real MNQ bar placed by two features. Swing a line through the cloud and watch each dot's shadow land on it: spread out means the direction separates your bars, bunched up means it throws the difference away. PC1 is the angle where the shadows are most spread out."
      >
        <ControlBar onReset={reset}>
          <SelectControl label="Horizontal feature" value={featureX} options={options} onChange={(v) => set("featureX", v)} />
          <SelectControl label="Vertical feature" value={featureY} options={options} onChange={(v) => set("featureY", v)} />
          <SliderControl label="Direction" value={controls.angle} min={0} max={179} onChange={(v) => set("angle", v)} format={(v) => `${v}°`} hint="the angle of the line through the cloud" />
          <SwitchControl label="Reveal the best direction" checked={controls.showBest} onChange={(v) => set("showBest", v)} hint="draws PC1 of this pair as a dashed line" />
        </ControlBar>
        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <PairScatter pair={pair} angle={controls.angle} bars={body.barIndex} featureX={featureX} featureY={featureY} plotStride={plotStride} rayStride={rayStride} showBest={controls.showBest} />
          <div className="min-w-0 space-y-3">
            <table className="w-full max-w-[340px] border-collapse text-[13px]">
              <tbody>
                {rows.map(([label, value, highlight]) => (
                  <tr key={label}>
                    <td className="py-0.5 pr-3 text-neutral-400">{label}</td>
                    <td className="w-[92px] py-0.5 text-right font-mono font-semibold tnum" style={{ color: highlight ? OKABE.orange : undefined }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="min-h-[2.2rem] text-[13px]" style={{ color: atBest ? OKABE.orange : "#a3a3a3" }}>
              {atBest ? <><b>That is PC1.</b> No direction does better. ◆</> : "Keep turning — the spread is still climbing."}
            </p>
            <Finding>
              Every one of the <b>{fmtInt(pair.count)}</b> bars went into the numbers above. The plot draws every {plotStride}th bar as a dot and every {rayStride}th
              bar&apos;s shadow, so it redraws inside a frame.
            </Finding>
            <Finding>
              <b>Why PC1 keeps landing on 45° or 135°.</b> Both features are z-scored, so each axis has variance near 1 (here {fmt(pair.varianceX, 3)} and {fmt(pair.varianceY, 3)}) and
              the covariance matrix is about [[1, r], [r, 1]]. Its top eigenvector is (1, 1), 45°, when the correlation is positive and (1, −1), 135°, when it is negative,
              whatever pair you pick. What changes is how much spread that direction captures: 1 + |r| = {fmt(1 + Math.abs(pair.correlation), 3)} here, against 1.0 for two unrelated
              features. That degeneracy belongs to two equal-variance axes; with {fmtInt(body.featureNames.length)} of them PC1 is free to point anywhere, which is why the real one below
              is a specific mixture of features.
            </Finding>
          </div>
        </div>
      </Section>

      <Section title="1B. The formula behind that slider" question="The spread of the shadows is the variance along the direction w. PC1 is the w that makes this sum as large as possible; PC2 is the next largest, at right angles to PC1.">
        <div className="grid gap-3 xl:grid-cols-2">
          <FormulaCard
            tex={String.raw`\operatorname{Var}(w)\;=\;\frac{1}{n-1}\sum_{i=1}^{n}\bigl(\mathbf{x}_i\cdot w\bigr)^2`}
            caption="Step the index below to watch the sum fill in, bar by bar."
            symbols={[
              { tex: String.raw`\operatorname{Var}(w)`, name: "spread of the shadows (variance along the direction)", value: fmt(here, 4) },
              { tex: String.raw`\frac{1}{n-1}`, name: "sample-variance divisor", value: `1 / ${fmtInt(pair.count - 1)}` },
              { tex: String.raw`\sum`, name: "sum over: add one term per bar", value: `first ${fmtInt(k)} of ${fmtInt(pair.count)}` },
              { tex: "i", name: "bar index, 1 … n", value: `1 … ${fmtInt(k)}` },
              { tex: "n", name: "bar count: every bar in this run", value: fmtInt(pair.count) },
              { tex: String.raw`\mathbf{x}_i`, name: "the bar's vector: its two z-scored features, centred", value: `${featureX.split(".")[1] ?? featureX}, ${featureY.split(".")[1] ?? featureY}` },
              { tex: "w", name: "the direction: a unit vector, the line you swing", value: `(${fmt(c, 3)}, ${fmt(s, 3)}) at ${controls.angle}°` },
              { tex: String.raw`\mathbf{x}_i\cdot w`, name: "the shadow: how far along the line bar i lands", value: `largest so far ${fmt(Math.sqrt(sum.peak), 3)}` },
            ]}
          />
          <FormulaCard
            tex={String.raw`C\,w_k=\lambda_k\,w_k,\qquad \text{share}_k=\frac{\lambda_k}{\sum_{j=1}^{d}\lambda_j}`}
            caption="The directions that make Var(w) stationary are the eigenvectors of the covariance matrix; each eigenvalue IS the variance along its direction."
            symbols={[
              { tex: "C", name: "covariance matrix of the z-scored features", value: `${fmtInt(body.featureNames.length)} × ${fmtInt(body.featureNames.length)} (full)` },
              { tex: "w_k", name: "the k-th principal component: a unit direction, a recipe over features", value: "PC1, PC2, …" },
              { tex: String.raw`\lambda_k`, name: "its eigenvalue: variance along it", value: "see the scree below" },
              { tex: "d", name: "dimensions: features in the basis", value: `${fmtInt(bases.full.names.length)} full, ${fmtInt(bases.continuous.names.length)} continuous` },
              { tex: String.raw`\text{share}_k`, name: "share of the total spread component k carries", value: "see the scree below" },
            ]}
          />
        </div>
        <div className="mt-3 space-y-2">
          <ControlBar>
            <SliderControl label="Bars included (i = 1 … )" value={k} min={1} max={termLimit} onChange={(v) => set("terms", v)} hint="how many of the first bars the running sum has added" />
          </ControlBar>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={termData} margin={{ top: 4, right: 12, left: 8, bottom: 16 }} barCategoryGap={0}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="i" {...AXIS} interval={49} label={{ value: "bar index i", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis {...AXIS} width={52} tickFormatter={(v: number) => fmt(v, 2)} label={{ value: "(xᵢ · w)²", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof termData)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div>i = {row.i} (bar {row.bar})</div>
                      <div>(xᵢ · w)² = {fmt(row.term, 5)}</div>
                      <div>{row.included ? "included in the sum" : "not yet included"}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="term" isAnimationActive={false}>
                {termData.map((row) => <Cell key={row.i} fill={row.included ? OKABE.orange : "#3f3f46"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-neutral-400"><span style={{ color: OKABE.orange }}>■</span> included (i ≤ {k}) · <span style={{ color: "#71717a" }}>■</span> not yet included</p>
          <Finding>
            Running total after <b>{fmtInt(k)}</b> of {fmtInt(pair.count)} bars: <b>{fmt(sum.running, 4)}</b> · all {fmtInt(pair.count)} bars: <b>{fmt(sum.full, 4)}</b> · largest term so far:{" "}
            <b>{fmt(sum.peak, 4)}</b>, from <b>bar {fmtInt(body.barIndex[sum.peakPosition] ?? sum.peakPosition)}</b>. A handful of bars far from the centre dominate the sum, which is why one wild bar
            can swing a principal component and why every feature is z-scored before any of this runs.
          </Finding>
        </div>
      </Section>
    </div>
  );
}

export function ComponentsSection({ body, controls, set, bases }: PartProps) {
  const basis = asBasis(controls.basis);
  const current = bases[basis];
  const pcs = current.principal;
  const dimensions = pcs.eigenvalues.length;
  const kept = Math.min(Math.max(1, Math.round(controls.kept)), dimensions);
  const component = Math.min(Math.max(1, Math.round(controls.component)), dimensions);
  const at = pcs.cumulativeShares[kept - 1] ?? 0;
  const ninety = componentsForShare(pcs.cumulativeShares, 0.9);

  const landed = body.spectrum.filter((row) => row.basis === basis).sort((a, b) => a.component_number - b.component_number);
  const landedGap = landed.reduce((worst, row) => Math.max(worst, Math.abs(row.variance_share - (pcs.shares[row.component_number - 1] ?? NaN))), 0);

  const scree = pcs.shares.map((share, index) => ({
    component: index + 1, label: `PC${index + 1}`, share, cumulative: pcs.cumulativeShares[index] ?? 0, eigenvalue: pcs.eigenvalues[index] ?? 0, kept: index < kept,
  }));

  const loadings = (pcs.components[component - 1] ?? []).map((loading, index) => ({
    name: current.names[index] as string, block: current.blocks[index] as string, loading,
  }));
  loadings.sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading));
  const chartRows = loadings.map((row) => ({ ...row, label: `${blockGlyph(row.block)} ${row.name}` }));
  const shares = blockShares(pcs.components[component - 1] ?? [], current.blocks);
  const top = loadings[0];

  const landedLoadings: LoadingRow[] = body.loadings.filter((row) => row.basis === basis && row.component_number === component);
  const loadingGap = landedLoadings.length === 0 ? null : landedLoadings.reduce((worst, row) => {
    const index = current.names.indexOf(row.feature_name);
    const mine = index >= 0 ? (pcs.components[component - 1]?.[index] ?? NaN) : NaN;
    return Math.max(worst, Math.abs(row.loading - mine));
  }, 0);

  const patternBlock = shares.find((entry) => entry.block === "pattern_multihot");
  const patternDimensions = bases.full.blocks.filter((block) => block === "pattern_multihot").length;

  return (
    <div className="space-y-3">
      <Section
        title="1C. Your actual run: how much am I not seeing?"
        question={`${dimensions} dimensions means ${dimensions} principal components, not 2. They are ranked by how much spread each one carries; the Lens panel draws the first two.`}
      >
        <ControlBar>
          <BasisControl controls={controls} set={set} bases={bases} />
          <SliderControl label="Components kept" value={kept} min={1} max={dimensions} onChange={(v) => set("kept", v)} hint="adds components to the cumulative curve" />
        </ControlBar>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">How much each component carries</p>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={scree} margin={{ top: 4, right: 12, left: 8, bottom: 16 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="component" {...AXIS} label={{ value: "component (PC1, PC2, …)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmtPercent(v, 0)} label={{ value: "share of total spread", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as (typeof scree)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">{row.label} {row.kept ? "(kept)" : "(dropped)"}</div>
                        <div>share {fmtPercent(row.share, 2)}</div>
                        <div>eigenvalue {fmt(row.eigenvalue, 4)}</div>
                        <div>cumulative {fmtPercent(row.cumulative, 2)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="share" isAnimationActive={false}>
                  {scree.map((row) => <Cell key={row.component} fill={row.kept ? OKABE.orange : "#3f3f46"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">Running total, components kept</p>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={scree} margin={{ top: 4, right: 12, left: 8, bottom: 16 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="component" {...AXIS} label={{ value: "components kept, cumulative", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} width={48} domain={[0, 1]} tickFormatter={(v: number) => fmtPercent(v, 0)} label={{ value: "running total", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip {...TOOLTIP} formatter={(value) => fmtPercent(Number(value), 2)} labelFormatter={(label) => `first ${label} components`} />
                <ReferenceLine y={0.9} stroke={OKABE.grey} strokeDasharray="3 3" label={{ value: "90%", fill: "#a3a3a3", fontSize: 10, position: "right" }} />
                <ReferenceLine x={kept} stroke={OKABE.sky} strokeWidth={2} strokeDasharray="4 3" />
                <Line dataKey="cumulative" name="cumulative share" stroke={OKABE.blue} strokeWidth={2} dot={{ r: 3, fill: OKABE.blue }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <Finding>
          <b>{kept}</b> of <b>{dimensions}</b> components carry <b>{fmtPercent(at, 1)}</b> of the spread.{" "}
          {kept === 2
            ? "The Lens panel shows exactly this: two axes, and the rest is off-screen."
            : `To reach 90% you would need ${ninety} components, more than a screen has axes.`}{" "}
          This is why two neighbours can look far apart in the panel and still be genuinely close: the distance that matters lives in the <b>{dimensions - kept}</b> directions the picture had to drop.
        </Finding>
        <p className="mt-1 text-[10px] text-neutral-500">
          Recomputed here from the {fmtInt(body.barIndex.length)} z-scored bars (cyclic Jacobi). Against the landed spectrum the largest difference in any component&apos;s share is{" "}
          {landed.length > 0 ? landedGap.toExponential(1) : "n/a (not landed)"}.
        </p>
      </Section>

      <Section title="1D. What each component is made of" question="A component is a recipe over your features: a weight, a loading, on each one. A big weight means that feature drives the axis.">
        <ControlBar>
          <SelectControl
            label="Component"
            value={String(component)}
            options={Array.from({ length: dimensions }, (_, index) => ({ value: String(index + 1), label: `PC${index + 1} (${fmtPercent(pcs.shares[index] ?? 0, 1)})` }))}
            onChange={(v) => set("component", Number(v))}
          />
          <BasisControl controls={controls} set={set} bases={bases} />
        </ControlBar>
        <p className="mt-2 flex flex-wrap gap-x-4 text-[10px] text-neutral-400">
          {Object.values(BLOCKS).map((block) => (
            <span key={block.label}><span style={{ color: block.colour }}>{block.glyph}</span> {block.label}</span>
          ))}
        </p>
        <ResponsiveContainer width="100%" height={Math.max(220, 19 * chartRows.length + 40)}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 16 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} label={{ value: "loading (weight on this feature)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis type="category" dataKey="label" width={250} {...AXIS} interval={0} />
            <ReferenceLine x={0} stroke={OKABE.grey} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof chartRows)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.name}</div>
                    <div>{blockGlyph(row.block)} {row.block}</div>
                    <div>loading {fmt(row.loading, 4)}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="loading" isAnimationActive={false}>
              {chartRows.map((row) => <Cell key={row.name} fill={blockColour(row.block)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <Finding>
          <b>Block share of PC{component} ({basis}):</b> {shares.map((entry) => `${blockGlyph(entry.block)} ${entry.block} ${fmtPercent(entry.share, 0)}`).join(" · ")}. Largest single loading:{" "}
          <b>{top?.name}</b> at <b>{top ? `${top.loading >= 0 ? "+" : ""}${fmt(top.loading, 3)}` : "n/a"}</b>.
        </Finding>
        <Finding>
          {basis === "full" && patternBlock
            ? `This is the dominance problem: pattern_multihot is ${patternDimensions} of ${dimensions} dimensions (${fmtPercent(patternDimensions / dimensions, 0)} of the budget before anything is measured) and takes ${fmtPercent(patternBlock.share, 0)} of PC${component}. That is not the patterns being important; it is sheer count. The continuous basis drops them, which is why it is the default.`
            : `On the continuous basis the ${patternDimensions} pattern flags are dropped. Switch to full and look at PC1: pattern_multihot owns ${patternDimensions} of ${bases.full.names.length} dimensions (${fmtPercent(patternDimensions / Math.max(bases.full.names.length, 1), 0)}) before anything is measured, which is why continuous is the default.`}
        </Finding>
        <p className="text-[10px] text-neutral-500">
          {loadingGap === null
            ? `Loadings for PC${component} were not landed (the landed table holds components 1 to ${body.run?.loading_components_landed ?? 4}); this component is recomputed from the z-scored bars.`
            : `Largest difference from the landed loadings for PC${component}: ${loadingGap.toExponential(1)}.`}
        </p>
      </Section>
    </div>
  );
}
