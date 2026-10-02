/**
 * One pattern, up close: its ROC with the point a chosen threshold lands on,
 * the confusion counts at that threshold, the true-positive fraction in each
 * score group (the notebook's deciles, split the way numpy.array_split
 * splits), the score distribution by TA-Lib verdict with its eight numbers,
 * and the formulas behind AUC, average precision and a group's fraction with
 * every symbol carrying its current value.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, SliderControl, Stat, SummaryTable, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import type { PatternBody } from "@shared/studies/chart-cnn-pattern-recognition";

const LOG_FLOOR = 1e-5;

export interface PatternControls {
  thresholdIndex: number;
  groups: number;
  bins: number;
  highlightGroup: number;
  logFalsePositiveRate: boolean;
}

export function PatternSection({
  body, controls, set,
}: {
  body: PatternBody;
  controls: PatternControls;
  set: <K extends keyof PatternControls>(key: K, value: PatternControls[K]) => void;
}) {
  const positives = body.positiveWindowCount;
  const negatives = body.visibleWindowCount - positives;
  const prevalence = body.visibleWindowCount > 0 ? positives / body.visibleWindowCount : null;
  const thresholdIndex = Math.min(Math.max(0, controls.thresholdIndex), Math.max(0, body.thresholds.length - 1));
  const atThreshold = body.thresholds[thresholdIndex];
  const truePositives = atThreshold?.truePositives ?? 0;
  const falsePositives = atThreshold?.falsePositives ?? 0;
  const falseNegatives = positives - truePositives;
  const trueNegatives = negatives - falsePositives;
  const truePositiveRate = positives > 0 ? truePositives / positives : null;
  const falsePositiveRate = negatives > 0 ? falsePositives / negatives : null;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
  const hasRoc = body.roc.length > 0;

  const roc = body.roc.map((point) => ({
    falsePositiveRate: controls.logFalsePositiveRate ? Math.max(point.falsePositiveRate, LOG_FLOOR) : point.falsePositiveRate,
    truePositiveRate: point.truePositiveRate,
    threshold: point.threshold,
  }));
  const chance = controls.logFalsePositiveRate
    ? [LOG_FLOOR, 1e-4, 1e-3, 1e-2, 1e-1, 1].map((value) => ({ falsePositiveRate: value, chance: value }))
    : [{ falsePositiveRate: 0, chance: 0 }, { falsePositiveRate: 1, chance: 1 }];

  const highlight = Math.min(Math.max(1, controls.highlightGroup), Math.max(1, body.groups.length));
  const group = body.groups[highlight - 1];
  const top = body.groups[body.groups.length - 1];
  const histogram = body.histogram.map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2 }));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Windows scored" value={fmtInt(body.visibleWindowCount)} hint={`windows showing at least the ${body.patternBarCount} bars ${body.pattern} needs`} />
        <Stat label="TA-Lib positives" value={fmtInt(positives)} hint={`prevalence ${fmt(prevalence, 6)}`} />
        <Stat label="AUC (recomputed)" value={fmt(body.areaUnderCurve, 4)} tone={OKABE.blue} hint="trapezoid rule over every distinct score, in the lake's DuckDB" />
        <Stat label="Average precision" value={fmt(body.averagePrecision, 4)} tone={OKABE.orange} hint={`against a prevalence baseline of ${fmt(prevalence, 4)}`} />
      </div>

      <ControlBar>
        <SliderControl
          label="Score threshold"
          value={thresholdIndex}
          min={0}
          max={Math.max(0, body.thresholds.length - 1)}
          onChange={(value) => set("thresholdIndex", value)}
          format={() => fmt(atThreshold?.threshold, 4)}
          hint="Flag a window as the pattern when the network's score is at least this"
        />
        <SliderControl label="Score groups" value={controls.groups} min={2} max={50} onChange={(value) => set("groups", value)} hint="The notebook used 10 (deciles)" />
        <SliderControl label="Step group g" value={highlight} min={1} max={Math.max(1, body.groups.length)} onChange={(value) => set("highlightGroup", value)} />
        <SliderControl label="Histogram bins" value={controls.bins} min={5} max={100} onChange={(value) => set("bins", value)} />
        <SwitchControl label="Log false-positive rate" checked={controls.logFalsePositiveRate} onChange={(value) => set("logFalsePositiveRate", value)} hint="Rare patterns rise within the first 0.1% of false positives" />
      </ControlBar>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">
            ROC on real 2024+ windows ({fmtInt(positives)} positives of {fmtInt(body.visibleWindowCount)})
          </h4>
          {hasRoc ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} />
                <XAxis
                  type="number"
                  dataKey="falsePositiveRate"
                  scale={controls.logFalsePositiveRate ? "log" : "linear"}
                  domain={controls.logFalsePositiveRate ? [LOG_FLOOR, 1] : [0, 1]}
                  allowDataOverflow
                  {...AXIS}
                  tickFormatter={(value: number) => (controls.logFalsePositiveRate ? value.toExponential(0) : fmt(value, 1))}
                  label={{ value: "false positive rate", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }}
                />
                <YAxis type="number" domain={[0, 1]} {...AXIS} label={{ value: "true positive rate", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const point = payload?.[0]?.payload as { falsePositiveRate: number; truePositiveRate?: number; threshold?: number } | undefined;
                    if (!point || point.truePositiveRate === undefined) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="px-2 py-1 font-mono text-[11px]">
                        <div>score ≥ {fmt(point.threshold, 5)}</div>
                        <div>false positive rate {fmt(point.falsePositiveRate, 5)}</div>
                        <div>true positive rate {fmt(point.truePositiveRate, 5)}</div>
                      </div>
                    );
                  }}
                />
                <Line data={chance} dataKey="chance" name="chance" stroke={OKABE.grey} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line data={roc} dataKey="truePositiveRate" name="network" stroke={OKABE.blue} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                {truePositiveRate !== null && falsePositiveRate !== null && (
                  <ReferenceDot
                    x={controls.logFalsePositiveRate ? Math.max(falsePositiveRate, LOG_FLOOR) : falsePositiveRate}
                    y={truePositiveRate}
                    r={5}
                    fill={OKABE.orange}
                    stroke="#fff"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="rounded border border-neutral-800 px-3 py-8 text-center text-[11px] text-neutral-500">
              No ROC: TA-Lib never fires {body.pattern} on these windows, so there is no true-positive rate to draw.
            </p>
          )}
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.blue }}>━ network</span> · <span className="text-neutral-400">┅ chance</span> ·{" "}
            <span style={{ color: OKABE.orange }}>● score ≥ {fmt(atThreshold?.threshold, 4)}</span>
          </p>
        </div>

        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">True-positive fraction by score group ({body.groups.length} = most confident)</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={body.groups} margin={{ top: 16, right: 12, left: 0, bottom: 14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="group" {...AXIS} label={{ value: "score group (sorted by score, equal counts)", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
              <YAxis domain={[0, 1]} {...AXIS} label={{ value: "fraction truly the pattern", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof body.groups)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="px-2 py-1 font-mono text-[11px]">
                      <div>group {row.group}: {fmtInt(row.windowCount)} windows</div>
                      <div>fraction truly {body.pattern} {fmt(row.positiveFraction, 4)}</div>
                      <div>scores {fmt(row.lowestScore, 5)} to {fmt(row.highestScore, 5)}</div>
                    </div>
                  );
                }}
              />
              {prevalence !== null && <ReferenceLine y={prevalence} stroke={OKABE.grey} strokeDasharray="5 4" label={{ value: "prevalence", fill: "#a3a3a3", fontSize: 10, position: "insideTopLeft" }} />}
              <Bar dataKey="positiveFraction" isAnimationActive={false} onClick={(entry: unknown) => {
                const next = (entry as { payload?: { group?: number } } | undefined)?.payload?.group;
                if (next) set("highlightGroup", next);
              }} cursor="pointer">
                {body.groups.map((row) => (
                  <Cell key={row.group} fill={row.group === highlight ? OKABE.purple : OKABE.orange} />
                ))}
                <LabelList dataKey="positiveFraction" position="top" formatter={(value: unknown) => (typeof value === "number" ? value.toFixed(2) : "")} style={{ fill: "#a3a3a3", fontSize: 9 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.orange }}>■ group</span> · <span style={{ color: OKABE.purple }}>■ group g = {highlight}</span> (stepped or clicked) · ┅ prevalence
          </p>
        </div>
      </div>

      <Finding>
        {hasRoc && top
          ? `In the most confident ${fmtPercent(1 / Math.max(1, body.groups.length), 0)} of scores, ${fmtPercent(top.positiveFraction, 1)} of windows are truly ${body.pattern}, against ${fmtPercent(prevalence, 2)} overall. At score ≥ ${fmt(atThreshold?.threshold, 4)} the network flags ${fmtInt(truePositives + falsePositives)} windows: ${fmtInt(truePositives)} TA-Lib agrees with, ${fmtInt(falsePositives)} it does not, and it misses ${fmtInt(falseNegatives)}.`
          : `TA-Lib never fires ${body.pattern} here; every window the network flags is a false positive (${fmtInt(falsePositives)} at score ≥ ${fmt(atThreshold?.threshold, 4)}).`}
      </Finding>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-200">Confusion counts at score ≥ {fmt(atThreshold?.threshold, 4)}</h4>
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-0.5 text-left font-normal" />
                <th className="py-0.5 text-right font-normal">network says yes</th>
                <th className="py-0.5 text-right font-normal">network says no</th>
              </tr>
            </thead>
            <tbody className="text-neutral-200">
              <tr>
                <td className="py-0.5 text-neutral-400">TA-Lib says yes</td>
                <td className="text-right">▲ TP {fmtInt(truePositives)}</td>
                <td className="text-right">▽ FN {fmtInt(falseNegatives)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-neutral-400">TA-Lib says no</td>
                <td className="text-right">△ FP {fmtInt(falsePositives)}</td>
                <td className="text-right">▼ TN {fmtInt(trueNegatives)}</td>
              </tr>
            </tbody>
          </table>
          <div className="grid gap-2 grid-cols-3">
            <Stat label="True positive rate" value={fmt(truePositiveRate, 4)} />
            <Stat label="False positive rate" value={fmt(falsePositiveRate, 5)} />
            <Stat label="Precision" value={fmt(precision, 4)} />
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Score distribution by TA-Lib verdict</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histogram} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="middle" type="number" domain={[0, 1]} {...AXIS} tickFormatter={(value: number) => fmt(value, 1)} />
              <YAxis {...AXIS} width={48} scale="sqrt" />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const bin = payload?.[0]?.payload as (typeof histogram)[number] | undefined;
                  if (!bin) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="px-2 py-1 font-mono text-[11px]">
                      <div>score {fmt(bin.lower, 3)} to {fmt(bin.upper, 3)}</div>
                      <div>▲ TA-Lib yes {fmtInt(bin.positives)}</div>
                      <div>▼ TA-Lib no {fmtInt(bin.negatives)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="negatives" name="TA-Lib no" fill={OKABE.blue} isAnimationActive={false} />
              <Bar dataKey="positives" name="TA-Lib yes" fill={OKABE.orange} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.orange }}>▲ TA-Lib yes</span> · <span style={{ color: OKABE.blue }}>▼ TA-Lib no</span> · square-root count axis
          </p>
          <SummaryTable
            columns={[
              { name: "score, TA-Lib yes", summary: body.positiveScores, decimals: 4 },
              { name: "score, TA-Lib no", summary: body.negativeScores, decimals: 4 },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <FormulaCard
          tex={"\\mathrm{AUC}=\\sum_{i}\\big(\\mathrm{FPR}_i-\\mathrm{FPR}_{i-1}\\big)\\,\\frac{\\mathrm{TPR}_i+\\mathrm{TPR}_{i-1}}{2},\\quad \\mathrm{TPR}=\\frac{TP}{P},\\ \\mathrm{FPR}=\\frac{FP}{N}"}
          caption="Area under the ROC: walk the thresholds from the highest score down and add up the trapezoids."
          symbols={[
            { tex: "i", name: "index over distinct scores, highest first", value: `${fmtInt(body.roc.length)} corners drawn` },
            { tex: "TP", name: "windows flagged that TA-Lib calls the pattern (at the slider)", value: fmtInt(truePositives) },
            { tex: "FP", name: "windows flagged that TA-Lib does not call the pattern", value: fmtInt(falsePositives) },
            { tex: "P", name: "windows TA-Lib calls the pattern", value: fmtInt(positives) },
            { tex: "N", name: "windows TA-Lib does not", value: fmtInt(negatives) },
            { tex: "\\mathrm{TPR}", name: "true positive rate at the slider", value: fmt(truePositiveRate, 4) },
            { tex: "\\mathrm{FPR}", name: "false positive rate at the slider", value: fmt(falsePositiveRate, 5) },
            { tex: "\\mathrm{AUC}", name: "area under the curve (0.5 = coin flip)", value: fmt(body.areaUnderCurve, 4) },
          ]}
        />
        <FormulaCard
          tex={"\\mathrm{AP}=\\sum_{n}\\big(R_n-R_{n-1}\\big)\\,\\mathrm{Precision}_n,\\quad R=\\frac{TP}{P},\\ \\mathrm{Precision}=\\frac{TP}{TP+FP}"}
          caption="Average precision: precision averaged over the recall gained at each threshold. A random score gets the prevalence."
          symbols={[
            { tex: "n", name: "index over distinct scores, highest first", value: "every corner" },
            { tex: "R_n", name: "recall at threshold n (= TPR)", value: fmt(truePositiveRate, 4) },
            { tex: "\\mathrm{Precision}_n", name: "share of flagged windows TA-Lib agrees with", value: fmt(precision, 4) },
            { tex: "\\mathrm{AP}", name: "average precision", value: fmt(body.averagePrecision, 4) },
            { tex: "\\pi", name: "prevalence P / (P + N): the random baseline", value: fmt(prevalence, 6) },
          ]}
        />
        <FormulaCard
          tex={"\\bar{y}_g=\\frac{1}{|G_g|}\\sum_{i\\in G_g} y_i"}
          caption="Sort the windows by score, cut them into equal-count groups, and take each group's share of TA-Lib positives."
          symbols={[
            { tex: "g", name: "score group being stepped", value: String(highlight) },
            { tex: "G_g", name: "the windows in group g", value: `scores ${fmt(group?.lowestScore, 4)} to ${fmt(group?.highestScore, 4)}` },
            { tex: "|G_g|", name: "how many windows the group holds", value: fmtInt(group?.windowCount) },
            { tex: "y_i", name: "1 when TA-Lib calls window i the pattern, else 0", value: "0 or 1" },
            { tex: "\\bar{y}_g", name: "fraction truly the pattern in group g", value: fmt(group?.positiveFraction, 4) },
          ]}
        />
      </div>
    </div>
  );
}
