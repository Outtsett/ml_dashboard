/**
 * The network's 256-number embedding of 20,000 sampled real windows,
 * projected to its two directions of greatest spread (PCA, fitted in
 * packages/ml-engine/src/studies/chart_cnn_pattern_recognition/build.py with the notebook's
 * seeds). Colour by the window's target pattern (the notebook's view), its
 * sign, or how many bars it shows; every class also has its own marker.
 */

import { useState } from "react";
import { ControlBar, Finding, FormulaCard, OKABE, SegmentControl, SliderControl, fmt, fmtPercent } from "@/studies/kit";
import { correlationRatio, shortPatternName, type EmbeddingProjection } from "@shared/studies/chart-cnn-pattern-recognition";
import { MARKER_SHAPES, ProjectionScatter, type ScatterClass, type ScatterPoint } from "./ProjectionScatter";

export type ColorBy = "target" | "sign" | "barCount";

const TARGET_COLORS = [OKABE.blue, OKABE.orange, OKABE.sky, OKABE.green, OKABE.yellow, OKABE.vermillion, OKABE.purple, "#e5e5e5"];
const BAR_COUNT_COLORS = ["#00204D", "#414D6B", "#7C7B78", "#BCAF6F", "#FFEA46"]; // cividis, 1 to 5 bars

function classesFor(projection: EmbeddingProjection, colorBy: ColorBy, targetCount: number): { classes: ScatterClass[]; keyOf: (index: number) => string } {
  const counts = new Map<string, number>();
  const keyOf = (index: number): string => {
    if (colorBy === "target") return `t${projection.target[index]}`;
    if (colorBy === "sign") return `s${projection.sign[index]}`;
    return `b${projection.barCount[index]}`;
  };
  for (let index = 0; index < projection.windowId.length; index += 1) {
    const key = keyOf(index);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (colorBy === "target") {
    const classes = projection.targets.slice(0, targetCount).map((name, index): ScatterClass => ({
      key: `t${index}`,
      label: shortPatternName(name),
      color: TARGET_COLORS[index % TARGET_COLORS.length] as string,
      shape: MARKER_SHAPES[index % MARKER_SHAPES.length] as ScatterClass["shape"],
      count: counts.get(`t${index}`) ?? 0,
    }));
    return { classes, keyOf };
  }
  if (colorBy === "sign") {
    const all: ScatterClass[] = [
      { key: "s1", label: "bullish (+1)", color: OKABE.orange, shape: "triangleUp", count: counts.get("s1") ?? 0 },
      { key: "s-1", label: "bearish (-1)", color: OKABE.blue, shape: "triangleDown", count: counts.get("s-1") ?? 0 },
      { key: "s0", label: "no side (0)", color: "#b5b5b5", shape: "circle", count: counts.get("s0") ?? 0 },
    ];
    return { classes: all.filter((entry) => entry.count > 0), keyOf };
  }
  const classes = [1, 2, 3, 4, 5].map((bars): ScatterClass => ({
    key: `b${bars}`,
    label: `${bars} bar${bars > 1 ? "s" : ""}`,
    color: BAR_COUNT_COLORS[bars - 1] as string,
    shape: MARKER_SHAPES[bars - 1] as ScatterClass["shape"],
    count: counts.get(`b${bars}`) ?? 0,
  })).filter((entry) => entry.count > 0);
  return { classes, keyOf };
}

export function EmbeddingSection({
  projection, colorBy, onColorBy, targetCount, onTargetCount, pointSize, onPointSize,
}: {
  projection: EmbeddingProjection;
  colorBy: ColorBy;
  onColorBy: (value: ColorBy) => void;
  targetCount: number;
  onTargetCount: (value: number) => void;
  pointSize: number;
  onPointSize: (value: number) => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const { classes, keyOf } = classesFor(projection, colorBy, targetCount);
  const points: ScatterPoint[] = projection.windowId.map((windowId, index) => ({
    x: projection.principalComponent1[index] as number,
    y: projection.principalComponent2[index] as number,
    classKey: keyOf(index),
    detail: `window ${windowId}\ntarget ${projection.targets[projection.target[index] as number] ?? "?"}\nsign ${projection.sign[index]} · ${projection.barCount[index]} bars\nPC1 ${fmt(projection.principalComponent1[index], 4)}  PC2 ${fmt(projection.principalComponent2[index], 4)}`,
  }));
  const plotted = points.filter((point) => classes.some((entry) => entry.key === point.classKey) && !hidden.has(point.classKey)).length;
  const [first = 0, second = 0] = projection.explainedVarianceRatio;
  const share = (groups: readonly number[]) => [
    correlationRatio(projection.principalComponent1, groups),
    correlationRatio(projection.principalComponent2, groups),
  ];
  const [targetFirst, targetSecond] = share(projection.target);
  const [barsFirst, barsSecond] = share(projection.barCount);
  const [signFirst, signSecond] = share(projection.sign);
  const toggle = (key: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <ControlBar onReset={() => setHidden(new Set())}>
        <SegmentControl
          label="Colour by"
          value={colorBy}
          options={[{ value: "target", label: "target pattern" }, { value: "sign", label: "sign" }, { value: "barCount", label: "bars shown" }]}
          onChange={(value) => { setHidden(new Set()); onColorBy(value); }}
        />
        {colorBy === "target" && (
          <SliderControl label="Most frequent targets" value={targetCount} min={1} max={Math.min(24, projection.targets.length)} onChange={onTargetCount} hint="The notebook drew the 12 most frequent" />
        )}
        <SliderControl label="Point size" value={pointSize} min={1} max={6} step={0.5} onChange={onPointSize} />
      </ControlBar>
      <ProjectionScatter
        points={points}
        classes={classes}
        hidden={hidden}
        onToggle={toggle}
        pointSize={pointSize}
        xLabel={`principal component 1 (${fmtPercent(first, 1)} of variance)`}
        yLabel={`principal component 2 (${fmtPercent(second, 1)})`}
      />
      <p className="text-[11px] text-neutral-500">{plotted.toLocaleString("en-US")} of {projection.windowId.length.toLocaleString("en-US")} sampled windows drawn · hover a point for its values · click a legend entry to hide or show it</p>
      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={"z_i=W^{\\top}\\left(e_i-\\bar{e}\\right),\\qquad \\rho_k=\\frac{\\lambda_k}{\\sum_{j=1}^{d}\\lambda_j}"}
          caption="Principal components: rotate the embedding onto the directions it varies along most, keep two."
          symbols={[
            { tex: "e_i", name: "the numbers the network's last hidden layer gives window i", value: `${projection.embeddingDimensionCount} numbers` },
            { tex: "\\bar{e}", name: "their average over the sampled windows", value: `${projection.windowId.length.toLocaleString("en-US")} windows` },
            { tex: "W", name: "the two directions of greatest spread, one per column", value: `${projection.embeddingDimensionCount} × 2` },
            { tex: "z_i", name: "window i's position on the chart (PC1, PC2)", value: "hover a point" },
            { tex: "\\lambda_k", name: "spread along direction k", value: "" },
            { tex: "d", name: "embedding dimensions", value: String(projection.embeddingDimensionCount) },
            { tex: "\\rho_1", name: "share of all spread on component 1", value: fmtPercent(first, 2) },
            { tex: "\\rho_2", name: "share of all spread on component 2", value: fmtPercent(second, 2) },
          ]}
        />
        <Finding>
          The two components hold {fmtPercent(first + second, 1)} of the embedding's spread. Of the spread along PC1 and PC2, the window's target
          pattern explains {fmtPercent(targetFirst, 0)} and {fmtPercent(targetSecond, 0)}, the number of bars it shows {fmtPercent(barsFirst, 0)} and{" "}
          {fmtPercent(barsSecond, 0)}, and its sign only {fmtPercent(signFirst, 0)} and {fmtPercent(signSecond, 0)} (correlation ratio, between-group
          over total sum of squares). The embedding organises by shape, which is what recognition measures; whether a pattern firing pays after cost is the
          scorecard study's question.
        </Finding>
      </div>
    </div>
  );
}
