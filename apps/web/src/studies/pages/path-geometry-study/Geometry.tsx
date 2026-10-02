/**
 * Sections 1 to 3: what the efficiency ratio measures, why the raw ratio needs
 * the random-walk correction, and the distribution of the corrected ratio.
 * Everything here is read live from mnq_ohlcv_1m for the bars in view.
 */

import { useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, Stat, SummaryTable, SwitchControl, TOOLTIP,
  fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  HISTOGRAM_BINS, HISTOGRAM_LIMIT, SELECTABLE_WINDOWS, densityFromCounts, mergeBins, randomWalkExpectations, windowGeometry,
  type ExtremeWindow, type PathGeometryBody,
} from "@shared/studies/path-geometry-study";
import type { Controls, Setter } from "./controls";

const WINDOW_COLOURS = [OKABE.blue, OKABE.orange, OKABE.sky, OKABE.vermillion, OKABE.purple, OKABE.green];
const WINDOW_DASHES = ["0", "6 3", "2 3", "8 3 2 3", "1 4", "10 4"];
const WINDOW_SHAPES = ["circle", "square", "triangle", "diamond", "cross", "star"] as const;

function sampleDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function WalkChart({ extreme, colour, dash, step, title }: { extreme: ExtremeWindow | null; colour: string; dash: string; step: number; title: string }) {
  if (!extreme || extreme.closes.length < 2) return <p className="text-xs text-neutral-500">No {title} window (not enough bars).</p>;
  const last = extreme.closes.length - 1;
  const shown = Math.min(step, last);
  const data = extreme.closes.map((close, k) => ({
    k,
    close,
    walked: k <= shown ? close : null,
    ahead: k >= shown ? close : null,
    chord: k === 0 || k === shown ? close : null,
  }));
  const geometry = windowGeometry(extreme.closes.slice(0, shown + 1));
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] text-neutral-300">
        <span style={{ color: colour }}>{title}</span> {last}-bar window ending {fmtTime(extreme.timestampMs)}: er {fmt(extreme.efficiency, 4)}
        {geometry && shown < last && <span className="text-neutral-500"> · walked {shown} of {last} steps: net {fmt(geometry.net, 5)}, path {fmt(geometry.path, 5)}, er {fmt(geometry.efficiency, 4)}</span>}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 2 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="k" domain={[0, last]} {...AXIS} />
          <YAxis domain={["auto", "auto"]} {...AXIS} width={52} tickFormatter={(value: number) => fmt(value, 0)} />
          <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 2)} labelFormatter={(label) => `bar ${label} of the window · ${fmtTime(extreme.timestamps[Number(label)])}`} />
          <Line dataKey="ahead" name="not yet walked" stroke={colour} strokeOpacity={0.3} strokeDasharray={dash} dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="walked" name="walked so far" stroke={colour} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="chord" name="net displacement" stroke="#d4d4d4" strokeDasharray="5 3" dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Geometry({ body, controls, set }: { body: PathGeometryBody; controls: Controls; set: Setter }) {
  const [stepPicked, setStepPicked] = useState(100000);
  const [inspect, setInspect] = useState<"straightest" | "choppiest">("straightest");
  const [formulaWindowPicked, setFormulaWindowPicked] = useState(60);
  const [yFixed, setYFixed] = useState(true);
  const [mergeFactor, setMergeFactor] = useState(1);
  const [logDensity, setLogDensity] = useState(false);

  const { extremes, statistics, histograms } = body;
  const windowLength = extremes.window;
  const step = Math.max(1, Math.min(stepPicked, windowLength));
  const inspected = inspect === "straightest" ? extremes.straightest : extremes.choppiest;
  const inspectedGeometry = inspected ? windowGeometry(inspected.closes.slice(0, Math.min(step, inspected.closes.length - 1) + 1)) : null;
  const inspectedFirst = inspected?.closes[0];
  const inspectedLast = inspected ? inspected.closes[Math.min(step, inspected.closes.length - 1)] : undefined;

  const formulaWindow = body.windows.includes(formulaWindowPicked) ? formulaWindowPicked : (body.windows[0] ?? 60);
  const formulaStatistics = statistics.find((entry) => entry.window === formulaWindow);
  const sigma = sampleDeviation(body.frame.rows.map((row) => row.close_to_close_log_return).filter((value): value is number => typeof value === "number"));
  const expectations = sigma === null ? null : randomWalkExpectations(formulaWindow, sigma);

  const termData = statistics.map((entry) => ({
    window: entry.window,
    null: entry.nullRatio,
    median: entry.efficiency.median,
    normalizedMedian: entry.normalized.median,
    normalizedLow: entry.normalized.percentile25,
    normalizedHigh: entry.normalized.percentile75,
  }));
  const medians = statistics.map((entry) => ({ window: entry.window, median: entry.normalized.median }));
  const firstAtOne = medians.find((entry) => (entry.median ?? 0) >= 1);
  const binWidth = (HISTOGRAM_LIMIT / HISTOGRAM_BINS) * mergeFactor;
  const histogramRows = Array.from({ length: HISTOGRAM_BINS / mergeFactor }, (_, index) => {
    const row: Record<string, number> = { x: (index + 0.5) * binWidth };
    for (const series of histograms) {
      const density = densityFromCounts(mergeBins(series.counts, mergeFactor), binWidth)[index] ?? 0;
      row[`w${series.window}`] = logDensity ? Math.max(density, 1e-4) : density;
    }
    return row;
  });
  const firstNormalized = statistics[0]?.normalized;
  const lastNormalized = statistics[statistics.length - 1]?.normalized;
  const tailGrows = firstNormalized && lastNormalized && statistics.length > 1 ? (lastNormalized.percentile95 ?? 0) > (firstNormalized.percentile95 ?? 0) : null;
  const summaryColumns = statistics.map((entry) => ({ name: `W=${entry.window}`, summary: entry.normalized, decimals: 4 }));

  return (
    <>
      <Section title="1 · What the efficiency ratio measures" question="Net displacement over path length across a trailing window: 1 for a straight walk, toward 0 for a stagger.">
        <ControlBar>
          <SegmentControl label="Window W (bars)" value={controls.extremeWindow} options={[15, 30, 60, 120, 240, 480, 1440].map((value) => ({ value, label: String(value) }))} onChange={(value) => set("extremeWindow", value)} hint="The window length whose straightest and choppiest instance is drawn" />
          <SegmentControl label="Inspect" value={inspect} options={[{ value: "straightest", label: "straightest" }, { value: "choppiest", label: "choppiest" }]} onChange={setInspect} />
          <label className="flex w-56 flex-col gap-1" title="Walk the window one step at a time and watch the sum grow">
            <span className="flex justify-between text-[10px] uppercase tracking-wider text-neutral-500"><span>Step i</span><span className="font-mono normal-case text-neutral-200">{step} of {windowLength}</span></span>
            <input type="range" min={1} max={windowLength} value={step} onChange={(event) => setStepPicked(Number(event.target.value))} className="h-4 w-full accent-[#56B4E9]" />
          </label>
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <WalkChart extreme={extremes.straightest} colour={OKABE.orange} dash="0" step={step} title="straightest" />
          <WalkChart extreme={extremes.choppiest} colour={OKABE.blue} dash="6 3" step={step} title="choppiest" />
        </div>
        <Finding>
          Same instrument, same window length, opposite geometry: the straightest {windowLength}-bar window on record has er {fmt(extremes.straightest?.efficiency, 4)}{" "}
          and the choppiest {fmt(extremes.choppiest?.efficiency, 6)}. That separation is what the feature is built to detect.
        </Finding>
        <div className="mt-2">
          <FormulaCard
            tex={"\\mathrm{er}=\\frac{\\left|\\ln p_t-\\ln p_{t-W}\\right|}{\\sum_{i=t-W+1}^{t}\\left|\\ln p_i-\\ln p_{i-1}\\right|}"}
            caption={`The ${inspect} window, walked ${step} of ${windowLength} steps. Walk straight and net equals path (er = 1); stagger and er falls toward 0.`}
            symbols={[
              { tex: "\\mathrm{er}", name: "efficiency ratio so far", value: fmt(inspectedGeometry?.efficiency, 4) },
              { tex: "W", name: "steps walked (window length when i reaches W)", value: `${step} of ${windowLength}` },
              { tex: "p_t", name: "close at the end of the walk so far", value: fmt(inspectedLast, 2) },
              { tex: "p_{t-W}", name: "close at the start of the window", value: fmt(inspectedFirst, 2) },
              { tex: "\\left|\\ln p_t-\\ln p_{t-W}\\right|", name: "net displacement: how far price got (log points)", value: fmt(inspectedGeometry?.net, 6) },
              { tex: "\\sum\\left|\\ln p_i-\\ln p_{i-1}\\right|", name: "path length: how far price travelled (log points)", value: fmt(inspectedGeometry?.path, 6) },
              { tex: "\\mathrm{er}\\sqrt{W}", name: "corrected ratio (section 2): 1 is a coin flip", value: fmt(inspectedGeometry?.normalized, 4) },
            ]}
          />
        </div>
      </Section>

      <Section title="2 · Why the raw ratio needs a random-walk correction" question="Staggering compounds, so the raw ratio shrinks with window length for arithmetic reasons. Multiplying by the square root of W puts every window on one scale, centred on 1.0 for a coin flip.">
        <ControlBar>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Windows compared</span>
            <div className="flex flex-wrap gap-1">
              {SELECTABLE_WINDOWS.map((value) => {
                const active = body.windows.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = active ? body.windows.filter((entry) => entry !== value) : [...body.windows, value].sort((a, b) => a - b);
                      if (next.length > 0) set("windows", next.join(","));
                    }}
                    className={`rounded border px-2 py-1 font-mono text-[11px] ${active ? "border-[#56B4E9] bg-neutral-700 text-neutral-50" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                  >
                    {active ? "✓ " : ""}{value}
                  </button>
                );
              })}
            </div>
          </div>
          <SwitchControl label="Fix right panel to 0.6 to 1.15" checked={yFixed} onChange={setYFixed} hint="The notebook's axis; switch off to see every value" />
        </ControlBar>
        <div className="mt-2 grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Bars read" value={fmtInt(body.bars.loaded)} hint={`of ${fmtInt(body.bars.available)} that pass the loader's filters (volume > 0, every price > 0)`} />
          <Stat label="First bar (as stamped)" value={fmtTime(body.bars.firstMs)} />
          <Stat label="Last bar (as stamped)" value={fmtTime(body.bars.lastMs)} />
          <Stat label="Median er × √W at the longest window" value={fmt(medians[medians.length - 1]?.median, 4)} hint={`W = ${medians[medians.length - 1]?.window}`} />
        </div>
        <div className="mt-2">
          <SegmentControl label="Formula at W" value={formulaWindow} options={body.windows.map((value) => ({ value, label: String(value) }))} onChange={setFormulaWindowPicked} />
        </div>
        <div className="mt-2">
          <FormulaCard
            tex={"\\mathbb{E}\\lvert\\text{net}\\rvert=\\sigma\\sqrt{\\tfrac{2W}{\\pi}},\\quad \\mathbb{E}[\\text{path}]=W\\sigma\\sqrt{\\tfrac{2}{\\pi}},\\quad \\frac{\\mathbb{E}\\lvert\\text{net}\\rvert}{\\mathbb{E}[\\text{path}]}=\\frac{1}{\\sqrt{W}}"}
            caption="For a driftless random walk the step size σ cancels, so er × √W centres on 1.0 and the same number means the same thing at every window."
            symbols={[
              { tex: "\\sigma", name: "standard deviation of one one-minute log step (estimated from the sampled bars)", value: fmt(sigma, 6) },
              { tex: "W", name: "window length in bars", value: String(formulaWindow) },
              { tex: "\\mathbb{E}\\lvert\\text{net}\\rvert", name: "expected net displacement of the walk (log points)", value: fmt(expectations?.net, 6) },
              { tex: "\\mathbb{E}[\\text{path}]", name: "expected path length of the walk (log points)", value: fmt(expectations?.path, 6) },
              { tex: "1/\\sqrt{W}", name: "the random-walk efficiency ratio", value: fmt(1 / Math.sqrt(formulaWindow), 5) },
              { tex: "\\text{median er}", name: "measured median raw efficiency ratio at this W", value: fmt(formulaStatistics?.efficiency.median, 5) },
              { tex: "\\text{median er}\\sqrt{W}", name: "measured median corrected ratio at this W", value: fmt(formulaStatistics?.normalized.median, 4) },
            ]}
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                {["W", "null 1/√W", "median er", "median er × √W", "p95 er × √W", "bars"].map((heading) => (
                  <th key={heading} className="py-0.5 pr-3 text-right font-normal first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statistics.map((entry) => (
                <tr key={entry.window} className="border-t border-neutral-900">
                  <td className="py-0.5 pr-3 text-left text-neutral-200">{entry.window}</td>
                  <td className="py-0.5 pr-3 text-right">{fmt(entry.nullRatio, 4)}</td>
                  <td className="py-0.5 pr-3 text-right">{fmt(entry.efficiency.median, 4)}</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-100">{fmt(entry.normalized.median, 4)}</td>
                  <td className="py-0.5 pr-3 text-right">{fmt(entry.normalized.percentile95, 4)}</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-400">{fmtInt(entry.normalized.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">Raw er tracks the random-walk null: the fall with W is pure arithmetic.</p>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={termData} margin={{ top: 6, right: 12, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="window" scale="log" domain={["dataMin", "dataMax"]} ticks={termData.map((row) => row.window)} {...AXIS} label={{ value: "window W (bars)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis scale="log" domain={["auto", "auto"]} {...AXIS} width={48} tickFormatter={(value: number) => fmt(value, 3)} />
                <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} labelFormatter={(label) => `W = ${label}`} />
                <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="median" name="median er (raw)" stroke={OKABE.blue} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="null" name="random-walk null 1/√W" stroke="#d4d4d4" strokeDasharray="6 3" dot={{ r: 3, strokeWidth: 1 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">After the correction: comparable across windows, and below 1 intraday. Dotted lines are the 25th and 75th percentiles.</p>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={termData} margin={{ top: 6, right: 12, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="window" scale="log" domain={["dataMin", "dataMax"]} ticks={termData.map((row) => row.window)} {...AXIS} label={{ value: "window W (bars)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis domain={yFixed ? [0.6, 1.15] : ["auto", "auto"]} allowDataOverflow={yFixed} {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 2)} />
                <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} labelFormatter={(label) => `W = ${label}`} />
                <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={1} stroke="#d4d4d4" strokeDasharray="6 3" label={{ value: "coin flip", fill: "#d4d4d4", fontSize: 10, position: "insideTopRight" }} />
                <Line dataKey="normalizedHigh" name="75th percentile" stroke={OKABE.sky} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                <Line dataKey="normalizedLow" name="25th percentile" stroke={OKABE.sky} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                <Line dataKey="normalizedMedian" name="median er × √W" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <Finding>
          Median er × √W by window: {medians.map((entry) => `${fmt(entry.median, 3)} at ${entry.window}`).join(", ")}.
          {firstAtOne
            ? ` The median first reaches the random-walk line at W = ${firstAtOne.window}; below it the tape staggers more than a coin flip.`
            : " The median stays below the random-walk line at every window shown: the tape staggers more than a coin flip at every scale here."}
          {(medians[0]?.median ?? 1) < 1 && " Below 1 at the short windows and decaying toward 1 with scale is the signature of the bid-ask bounce (microstructure mean reversion), consistent with the negative lag-1 autocorrelation already recorded for this instrument; er × √W is worth keeping as a descriptive regime feature."}
        </Finding>
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-neutral-300">The eight numbers of er × √W, per window</p>
          <div className="overflow-x-auto"><SummaryTable columns={summaryColumns} /></div>
        </div>
      </Section>

      <Section title="3 · Distribution of the corrected ratio" question="One step histogram per window of er × √W over 0 to 4, each normalised to a density so the windows overlay.">
        <ControlBar>
          <SegmentControl label="Bins" value={mergeFactor} options={[1, 2, 3, 4, 6].map((value) => ({ value, label: String(HISTOGRAM_BINS / value) }))} onChange={setMergeFactor} hint="Bins across 0 to 4" />
          <SwitchControl label="Log density" checked={logDensity} onChange={setLogDensity} />
        </ControlBar>
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={histogramRows} margin={{ top: 6, right: 12, left: 0, bottom: 14 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="x" domain={[0, HISTOGRAM_LIMIT]} ticks={[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]} {...AXIS} label={{ value: "er × √W", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis scale={logDensity ? "log" : "auto"} domain={logDensity ? [1e-4, "auto"] : [0, "auto"]} allowDataOverflow {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, logDensity ? 4 : 2)} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} labelFormatter={(label) => `er × √W ≈ ${fmt(Number(label), 3)}`} />
              <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine x={1} stroke="#d4d4d4" strokeDasharray="6 3" label={{ value: "coin flip", fill: "#d4d4d4", fontSize: 10, position: "top" }} />
              {histograms.map((series, index) => (
                <Line
                  key={series.window}
                  type="stepAfter"
                  dataKey={`w${series.window}`}
                  name={`W=${series.window} (${WINDOW_SHAPES[index % WINDOW_SHAPES.length]})`}
                  stroke={WINDOW_COLOURS[index % WINDOW_COLOURS.length]}
                  strokeDasharray={WINDOW_DASHES[index % WINDOW_DASHES.length]}
                  strokeWidth={1.8}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Finding>
          {histograms.map((series) => `W=${series.window}: ${fmtInt(series.inRangeCount)} of ${fmtInt(statistics.find((entry) => entry.window === series.window)?.normalized.count)} values fall in 0 to ${HISTOGRAM_LIMIT}`).join("; ")}.
          {tailGrows !== null && (tailGrows ? ` The 95th percentile rises with the window (${fmt(firstNormalized?.percentile95, 2)} at W=${firstNormalized ? statistics[0]?.window : ""} to ${fmt(lastNormalized?.percentile95, 2)} at W=${statistics[statistics.length - 1]?.window}): a long window can contain a real trend that a short one cannot.` : " The 95th percentile does not rise with the window.")}
        </Finding>
      </Section>
    </>
  );
}
