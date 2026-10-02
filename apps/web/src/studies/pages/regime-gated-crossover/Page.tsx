/**
 * Regime-gated crossover. The record (verdicts, gate, leak control, folds,
 * transition matrices) is the notebook's own run, landed by
 * packages/ml-engine/src/studies/regime_gated_crossover/build.py. The live half re-tags the 5m
 * bars with the 1m regime at the chosen label offset and reruns the notebook's
 * dependent bootstrap on the server with the chosen assumptions.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, Stat, StudyNotes, StudyState,
  SummaryTable, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type {
  FeaturePoint, GateStatus, LiveRegime, RegimeGatedCrossoverBody, Verdict, VerdictRecord,
} from "@shared/studies/regime-gated-crossover";
import {
  BASIS_POINTS, CommitSlider, FoldStrip, IntervalPlot, RegimeKey, RegimeToggles, TransitionGrid, bp, regimeName, regimeStyle,
  type IntervalRow,
} from "./parts";

const SLUG = "regime-gated-crossover";

const VERDICT_TEXT: Record<Verdict, string> = { trade: "▲ trade", sit_out: "▽ sit out", insufficient_sample: "· too few bars" };
const STATUS_TEXT: Record<GateStatus, string> = { ship: "ship the gate", do_not_ship: "do not ship", no_op: "no-op (nothing gated out)" };

function toneOfVerdict(verdict: Verdict | undefined): string {
  if (verdict === "trade") return OKABE.orange;
  if (verdict === "sit_out") return OKABE.blue;
  return OKABE.grey;
}

function toneOfStatus(status: GateStatus | undefined): string {
  if (status === "ship") return OKABE.orange;
  if (status === "do_not_ship") return OKABE.blue;
  return OKABE.grey;
}

function scaled(summary: LiveRegime["summary"]) {
  const s = (value: number | null) => (value === null ? null : value * BASIS_POINTS);
  return {
    ...summary, mean: s(summary.mean), median: s(summary.median), standardDeviation: s(summary.standardDeviation),
    percentile25: s(summary.percentile25), percentile75: s(summary.percentile75), minimum: s(summary.minimum), maximum: s(summary.maximum),
  };
}

function RegimeHistogram({ regime, record, regimeCount }: { regime: LiveRegime; record: VerdictRecord | undefined; regimeCount: number }) {
  const data = regime.histogram.map((bin) => ({
    middle: ((bin.lower + bin.upper) / 2) * BASIS_POINTS, lower: bin.lower * BASIS_POINTS, upper: bin.upper * BASIS_POINTS, count: bin.count,
  }));
  const first = data[0];
  const last = data[data.length - 1];
  const style = regimeStyle(regime.regime);
  const fill = regime.meanNetReturn >= 0 ? OKABE.orange : OKABE.blue;
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span style={{ color: style.color }}>{style.glyph} {regimeName(regime.regime, regimeCount)}</span>
        <span style={{ color: toneOfVerdict(regime.verdict) }}>{VERDICT_TEXT[regime.verdict]}</span>
      </div>
      <div className="font-mono text-[10px] text-neutral-500">
        n {fmtInt(regime.barCount)} · mean {bp(regime.meanNetReturn)} · {regime.meanNetReturn >= 0 ? "▲ orange: mean ≥ 0" : "▼ blue: mean < 0"}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap={0}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="middle" type="number" domain={[first?.lower ?? 0, last?.upper ?? 1]} tickFormatter={(v: number) => fmt(v, 0)} {...AXIS} />
          <YAxis {...AXIS} width={36} />
          <Tooltip
            {...TOOLTIP}
            formatter={(value) => [fmtInt(Number(value)), "5m bars"]}
            labelFormatter={(_label, payload) => {
              const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return row ? `${fmt(row.lower, 2)} to ${fmt(row.upper, 2)} bp` : "";
            }}
          />
          <Bar dataKey="count" fill={fill} isAnimationActive={false} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          {regime.interval && <ReferenceLine x={regime.interval.bcaLow * BASIS_POINTS} stroke="#f5f5f5" strokeDasharray="4 3" />}
          {regime.interval && <ReferenceLine x={regime.interval.bcaHigh * BASIS_POINTS} stroke="#f5f5f5" strokeDasharray="4 3" />}
          {record?.bca_low !== null && record?.bca_low !== undefined && <ReferenceLine x={record.bca_low * BASIS_POINTS} stroke={OKABE.purple} strokeDasharray="1 2" />}
          {record?.bca_high !== null && record?.bca_high !== undefined && <ReferenceLine x={record.bca_high * BASIS_POINTS} stroke={OKABE.purple} strokeDasharray="1 2" />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RegimeScatter({ features, centers, regimeCount }: { features: FeaturePoint[]; centers: Array<{ regime: number; size_center: number; flow_center: number; training_share: number }>; regimeCount: number }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="size" name="size" domain={[-3, 3]} allowDataOverflow {...AXIS} label={{ value: "size: log range minus its trailing 64-bar mean", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
        <YAxis type="number" dataKey="flow" name="flow" domain={[-4, 4]} allowDataOverflow {...AXIS} width={36} label={{ value: "flow", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
        <ZAxis range={[10, 10]} />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const point = payload?.[0]?.payload as (FeaturePoint & { center?: boolean; training_share?: number }) | undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                <div style={{ color: regimeStyle(point.regime).color }}>{regimeStyle(point.regime).glyph} {regimeName(point.regime, regimeCount)}{point.center ? " · centre" : ""}</div>
                <div>size {fmt(point.size, 3)} · flow {fmt(point.flow, 3)}</div>
                {point.center ? <div>share of training bars {fmtPercent(point.training_share)}</div> : <div>{fmtTime(point.timestamp)}</div>}
              </div>
            );
          }}
        />
        {Array.from({ length: regimeCount }, (_, regime) => (
          <Scatter
            key={regime}
            name={`${regimeStyle(regime).glyph} regime ${regime}`}
            data={features.filter((point) => point.regime === regime)}
            fill={regimeStyle(regime).color}
            fillOpacity={0.55}
            shape={regimeStyle(regime).shape}
            isAnimationActive={false}
          />
        ))}
        <Scatter
          name="✚ fold centre"
          data={centers.map((center) => ({ size: center.size_center, flow: center.flow_center, regime: center.regime, center: true, training_share: center.training_share }))}
          isAnimationActive={false}
          shape={(props: unknown) => {
            const { cx, cy, payload } = props as { cx: number; cy: number; payload: { regime: number } };
            const color = regimeStyle(payload.regime).color;
            return (
              <g>
                <circle cx={cx} cy={cy} r={9} fill="#0a0a0a" stroke="#f5f5f5" strokeWidth={1.5} />
                <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fill={color} fontWeight={700}>{payload.regime}</text>
              </g>
            );
          }}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    regimeCount: 4,
    labelOffset: 0,
    leakOffset: 25,
    replicates: 2000,
    blockFloor: 390,
    minimumBars: 500,
    seed: 0,
    bins: 40,
    gate: "verdicts",
    scope: "same",
    splitFold: 3,
    fold: 5,
    regime: 1,
  });
  const { fold: selectedFold, regime: selectedRegimeControl, ...serverControls } = controls;
  const query = useStudyQuery<RegimeGatedCrossoverBody>(SLUG, serverControls);
  const body = query.data?.data;
  const run = body?.run ?? null;
  const regimeCount = body?.regimeCount ?? controls.regimeCount;
  const folds = body?.folds ?? [];
  const record = body?.record ?? { verdicts: [], gate: null, leak: [] };
  const live = body?.live ?? null;
  const gate = live?.gate ?? null;
  const origin = run ? Date.parse(`${run.window_start}T00:00:00Z`) : 0;

  const fold = Math.min(Math.max(0, selectedFold), Math.max(0, folds.length - 1));
  const foldRow = folds.find((row) => row.fold === fold);
  const foldTransitions = (body?.transitions ?? []).filter((row) => row.fold === fold);
  const foldCenters = (body?.centers ?? []).filter((row) => row.fold === fold);
  const selectedRegime = Math.min(Math.max(0, selectedRegimeControl), regimeCount - 1);
  const liveRegime = live?.regimes.find((row) => row.regime === selectedRegime);
  const recordRegime = record.verdicts.find((row) => row.regime === selectedRegime);
  const selectedCenter = foldCenters.find((row) => row.regime === selectedRegime);
  const chosenGate = controls.gate === "verdicts" ? null : controls.gate === "none" ? [] : controls.gate.split(",").map(Number).filter((r) => r < regimeCount);
  const barsPerYear = run?.annualisation_bars_per_year ?? null;

  const sharpeByFold = folds.map((row) => {
    const liveFold = gate?.folds.find((entry) => entry.fold === row.fold);
    return { fold: `fold ${row.fold}`, record: row.out_of_sample_sharpe, baseline: liveFold?.baselineSharpe ?? null, gated: liveFold?.gatedSharpe ?? null, bars: row.out_of_sample_bar_count };
  });
  const stickiness = folds.map((row) => ({ fold: row.fold, diagonal: row.transition_diagonal_mean, rows: row.training_one_minute_rows }));
  const chance = 1 / regimeCount;

  const verdictRows: IntervalRow[] = [];
  for (let regime = 0; regime < regimeCount; regime += 1) {
    const recorded = record.verdicts.find((row) => row.regime === regime);
    const computed = live?.regimes.find((row) => row.regime === regime);
    if (recorded) {
      verdictRows.push({
        label: <span><span style={{ color: regimeStyle(regime).color }}>{regimeStyle(regime).glyph}</span> {regime} record</span>,
        point: recorded.mean_net_return, low: recorded.bca_low, high: recorded.bca_high, color: OKABE.purple, glyph: "◆",
        detail: `record (notebook): ${recorded.verdict}, block ${recorded.block_length ?? "—"}`,
      });
    }
    if (computed) {
      verdictRows.push({
        label: <span><span style={{ color: regimeStyle(regime).color }}>{regimeStyle(regime).glyph}</span> {regime} live</span>,
        point: computed.meanNetReturn, low: computed.interval?.bcaLow ?? null, high: computed.interval?.bcaHigh ?? null,
        color: regimeStyle(regime).color, glyph: "●", detail: `live: ${computed.verdict}, block ${computed.interval?.blockLength ?? "—"}`,
      });
    }
  }

  const gateRows: IntervalRow[] = [];
  if (record.gate) {
    gateRows.push({
      label: `record: trade {${record.gate.trade_regimes || "none"}}`, point: record.gate.mean_per_bar_effect, low: record.gate.bca_low, high: record.gate.bca_high,
      color: OKABE.purple, glyph: "◆", detail: `notebook: ${STATUS_TEXT[record.gate.status]}`,
    });
  }
  if (gate) {
    gateRows.push({
      label: `live: trade {${gate.tradeRegimes.join(",") || "none"}}`, point: gate.meanPerBarEffect, low: gate.interval?.bcaLow ?? null, high: gate.interval?.bcaHigh ?? null,
      color: toneOfStatus(gate.status), glyph: "●", detail: `live: ${STATUS_TEXT[gate.status]}`,
    });
  }

  const leakData = (live?.leak ?? []).map((row) => ({
    regime: `${regimeStyle(row.regime).glyph} ${row.regime}`,
    labelled: row.labelledMean === null ? null : row.labelledMean * BASIS_POINTS,
    shifted: row.shiftedMean === null ? null : row.shiftedMean * BASIS_POINTS,
    difference: row.absoluteDifference,
  }));
  const leakMaximum = Math.max(0, ...(live?.leak ?? []).map((row) => row.absoluteDifference ?? 0));

  const equity = (live?.equity ?? []).map((point) => ({ timestamp: point.timestamp, baseline: point.baseline * BASIS_POINTS, gated: point.gated * BASIS_POINTS }));
  const trade = record.gate?.trade_regimes || "none";
  const worstFold = [...folds].sort((a, b) => a.out_of_sample_sharpe - b.out_of_sample_sharpe)[0];
  const recordMeans = record.verdicts.map((row) => row.mean_net_return);
  const positiveMeans = recordMeans.filter((value) => value > 0).length;
  const smallestMean = recordMeans.length ? Math.min(...recordMeans) : null;
  const largestMean = recordMeans.length ? Math.max(...recordMeans) : null;
  const flipped = record.leak.filter((row) => Math.sign(row.causal_mean_net_return) !== Math.sign(row.leaky_mean_net_return)).map((row) => row.regime);
  const bestOf = (key: "causal_mean_net_return" | "leaky_mean_net_return") => [...record.leak].sort((a, b) => b[key] - a[key])[0]?.regime;
  const bestCausal = bestOf("causal_mean_net_return");
  const bestLeaky = bestOf("leaky_mean_net_return");

  let solution = "";
  if (gate) {
    if (gate.status === "ship") solution = `Ship the gate in crossovers/crossover.py: with these settings the per-bar effect's 95% BCa interval [${bp(gate.interval?.bcaLow)}, ${bp(gate.interval?.bcaHigh)}] is above zero.`;
    else if (gate.status === "do_not_ship") solution = `Do not ship the regime gate: the per-bar effect's 95% BCa interval [${bp(gate.interval?.bcaLow)}, ${bp(gate.interval?.bcaHigh)}] ${gate.interval && gate.interval.bcaHigh < 0 ? "is below zero: gating costs return" : "straddles zero"}; the Sharpe move ${fmt(gate.baselineSharpe, 3)} → ${fmt(gate.gatedSharpe, 3)} is not distinguishable from noise.`;
    else solution = "Keep the ungated crossover: no regime is gated out, so the gate changes nothing.";
  }

  return (
    <div className="min-w-0 space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!run ? (
          <Section title="Not landed" question="The study's tables are not in the lake yet.">
            <Finding>
              Run <code>Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/regime_gated_crossover/build.py</code> to land
              derived_study_regime_gated_crossover_*, then refresh the derived views. Nothing on this page is computed without them.
            </Finding>
          </Section>
        ) : (
          <>
            <Finding>
              A finished negative result, kept as a record. MNQ 5m, {run.window_start} to {run.window_end}; the {run.fast_kind.toUpperCase()}{run.fast_period} /
              {" "}{run.slow_kind.toUpperCase()}{run.slow_period} crossover, always long or short, charged {fmt(run.cost_points_per_side, 4)} points per side.
              Each 5m bar carries the latest 1m volatility regime (k-means on size and flow, refitted inside each walk-forward fold). A regime
              is traded only when the 95% BCa interval of its mean net return is above zero.
            </Finding>

            <ControlBar onReset={reset}>
              <SegmentControl
                label="Regimes (k)"
                value={controls.regimeCount}
                options={(body?.regimeCounts ?? [controls.regimeCount]).map((k) => ({ value: k, label: k === 4 ? "4 (notebook)" : String(k) }))}
                onChange={(k) => set("regimeCount", k)}
                hint="Every k was run through the notebook's code by build.py; 4 is the notebook's own run"
              />
            </ControlBar>

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              <Stat label="Walk-forward Sharpe, mean of 6 folds" value={fmt(run.mean_walk_forward_sharpe, 3)} hint="published single 70/30 split: 1.32" tone={OKABE.orange} />
              <Stat label="Baseline Sharpe (all tagged bars)" value={fmt(record.gate?.baseline_sharpe, 3)} />
              <Stat label={`Gated Sharpe (trade {${trade}})`} value={fmt(record.gate?.gated_sharpe, 3)} />
              <Stat label="Gate effect per bar, 95% BCa" value={`${bp(record.gate?.mean_per_bar_effect)} [${bp(record.gate?.bca_low)}, ${bp(record.gate?.bca_high)}]`} />
              <Stat label="Record's decision" value={record.gate ? STATUS_TEXT[record.gate.status] : "—"} tone={toneOfStatus(record.gate?.status)} />
              <Stat label="Regime persistence (diagonal)" value={`${fmt(run.mean_transition_diagonal, 3)} vs ${fmt(run.chance_transition_diagonal, 3)} chance`} tone={run.stickiness_check_passes ? OKABE.orange : OKABE.blue} hint="mean of P(same regime next minute) over folds; the notebook asks for more than 1.3 × chance" />
            </div>

            <Section title="A. The crossover, walk-forward" question="Six expanding folds on the 5m bars, a 100-bar embargo before each test window. How does the ungated crossover do out of sample?">
              <FoldStrip folds={folds} origin={origin} selected={fold} split={live?.settings.splitTimestamp ?? null} />
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={sharpeByFold} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="fold" {...AXIS} />
                      <YAxis {...AXIS} width={36} />
                      <Tooltip {...TOOLTIP} formatter={(value) => [fmt(Number(value), 3), "out-of-sample Sharpe"]} />
                      <ReferenceLine y={0} stroke={OKABE.grey} />
                      <ReferenceLine y={run.mean_walk_forward_sharpe} stroke={OKABE.orange} strokeDasharray="4 3" label={{ value: `mean ${fmt(run.mean_walk_forward_sharpe, 2)}`, fill: OKABE.orange, fontSize: 10, position: "right" }} />
                      <Bar dataKey="record" isAnimationActive={false}>
                        {sharpeByFold.map((row) => <Cell key={row.fold} fill={row.record >= 0 ? OKABE.orange : OKABE.blue} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-500"><span style={{ color: OKABE.orange }}>▲ orange</span> positive · <span style={{ color: OKABE.blue }}>▼ blue</span> negative</p>
                </div>
                <FormulaCard
                  tex={"S = \\frac{\\bar r}{s_r}\\,\\sqrt{A}, \\qquad A = \\frac{N}{\\text{span in days} / 365.25}"}
                  caption="The crossover module's Sharpe ratio: per-bar net return, annualised by the bars per year the series actually has."
                  symbols={[
                    { tex: "S", name: "annualised Sharpe ratio of the baseline net return, bars the gate is scored on", value: fmt(gate?.baselineSharpe, 3) },
                    { tex: "r", name: "a 5m bar's net return: position held × price change − cost on a position change", value: "fraction" },
                    { tex: "\\bar r", name: "mean net return per bar", value: bp(gate?.baselineMeanNetReturn) },
                    { tex: "s_r", name: "sample standard deviation of r (ddof 1)", value: bp(gate?.baselineStandardDeviation) },
                    { tex: "A", name: "bars per year, from the realised timestamp span", value: fmt(barsPerYear, 1) },
                    { tex: "N", name: "net-return bars", value: fmtInt(run.net_return_bars) },
                  ]}
                />
              </div>
              <Finding>
                {worstFold && worstFold.out_of_sample_sharpe < 0
                  ? `Fold ${worstFold.fold} (${fmtTime(worstFold.test_start_timestamp).slice(0, 10)} to ${fmtTime(worstFold.test_end_timestamp).slice(0, 10)}) loses: Sharpe ${fmt(worstFold.out_of_sample_sharpe, 2)}. `
                  : ""}
                The mean over the {folds.length} folds, {fmt(run.mean_walk_forward_sharpe, 3)}, {run.walk_forward_sharpe_check_passes ? "clears" : "misses"} the notebook's 0.3 sanity bar
                (published single split: 1.32). The crossover is what gets gated; its edge before gating is not the question here.
              </Finding>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="text-left font-normal">fold</th><th className="text-right font-normal">train bars</th><th className="text-right font-normal">train ends</th>
                      <th className="text-right font-normal">test from</th><th className="text-right font-normal">test to</th><th className="text-right font-normal">test bars</th>
                      <th className="text-right font-normal">1m training rows</th><th className="text-right font-normal">diagonal</th><th className="text-right font-normal">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folds.map((row) => (
                      <tr key={row.fold} className="border-t border-neutral-900">
                        <td>{row.fold}</td><td className="text-right">{fmtInt(row.train_bar_count)}</td><td className="text-right">{fmtTime(row.train_end_timestamp)}</td>
                        <td className="text-right">{fmtTime(row.test_start_timestamp)}</td><td className="text-right">{fmtTime(row.test_end_timestamp)}</td>
                        <td className="text-right">{fmtInt(row.test_bar_count)}</td><td className="text-right">{fmtInt(row.training_one_minute_rows)}</td>
                        <td className="text-right">{fmt(row.transition_diagonal_mean, 3)}</td>
                        <td className="text-right" style={{ color: row.out_of_sample_sharpe >= 0 ? OKABE.orange : OKABE.blue }}>{fmt(row.out_of_sample_sharpe, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="B. What the regimes are" question="Each 1m bar is a point (size, flow); k-means, refitted on each fold's training minutes, splits them into regimes ordered calm to stressed.">
              <ControlBar>
                <CommitSlider label="Fold" value={fold} min={0} max={Math.max(0, folds.length - 1)} onCommit={(v) => set("fold", v)} hint="Which fold's fitted centres and transition matrix to show" />
                <SegmentControl label="Regime for the formulas" value={selectedRegime} options={Array.from({ length: regimeCount }, (_, r) => ({ value: r, label: `${regimeStyle(r).glyph} ${r}` }))} onChange={(r) => set("regime", r)} />
              </ControlBar>
              <RegimeKey regimeCount={regimeCount} />
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <RegimeScatter features={body?.features ?? []} centers={foldCenters} regimeCount={regimeCount} />
                  <p className="text-[10px] text-neutral-500">
                    {fmtInt(body?.features.length)} of {fmtInt(run.feature_rows)} minutes (a fixed hash sample), coloured by their final label; circled numbers are fold {fold}'s centres.
                  </p>
                </div>
                <div className="min-w-0 space-y-2">
                  <TransitionGrid rows={foldTransitions} regimeCount={regimeCount} />
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={stickiness} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="fold" {...AXIS} />
                      <YAxis domain={[0, Math.max(0.6, chance * 1.5)]} {...AXIS} width={36} />
                      <Tooltip {...TOOLTIP} formatter={(value) => [fmt(Number(value), 4), "mean diagonal"]} labelFormatter={(label) => `fold ${label}`} />
                      <ReferenceLine y={chance} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "chance", fill: "#a3a3a3", fontSize: 9, position: "right" }} />
                      <ReferenceLine y={chance * 1.3} stroke={OKABE.blue} strokeDasharray="2 2" label={{ value: "1.3 × chance", fill: OKABE.blue, fontSize: 9, position: "right" }} />
                      <Line dataKey="diagonal" stroke={OKABE.orange} dot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <FormulaCard
                  tex={"\\text{size}_t = \\ln(H_t - L_t) - \\frac{1}{w}\\sum_{j=1}^{w} \\ln(H_{t-j} - L_{t-j}), \\qquad \\text{flow}_t = \\ln V_t - \\frac{1}{w}\\sum_{j=1}^{w} \\ln V_{t-j}"}
                  caption="Both are the minute's log magnitude against its own trailing expectation, which excludes the minute itself. Zero-range and zero-volume minutes are dropped."
                  symbols={[
                    { tex: "H_t,\\ L_t", name: "high and low of 1m bar t (points)", value: "per bar" },
                    { tex: "V_t", name: "volume of 1m bar t (contracts)", value: "per bar" },
                    { tex: "w", name: "trailing window, bars", value: fmtInt(run.feature_window_bars) },
                    { tex: "\\sum_{j=1}^{w}", name: "sum over the w bars before t", value: `${fmtInt(run.feature_window_bars)} terms` },
                    { tex: "\\text{size}", name: `centre of ${regimeName(selectedRegime, regimeCount)}, fold ${fold}`, value: fmt(selectedCenter?.size_center, 3) },
                    { tex: "\\text{flow}", name: `centre of ${regimeName(selectedRegime, regimeCount)}, fold ${fold}`, value: fmt(selectedCenter?.flow_center, 3) },
                  ]}
                />
                <FormulaCard
                  tex={"\\bar p = \\frac{1}{k}\\sum_{i=0}^{k-1} P(r_{t+1} = i \\mid r_t = i) \\;>\\; 1.3 \\times \\frac{1}{k}"}
                  caption="Stickiness: how often the next minute stays in the same regime, averaged over regimes, on the fold's training minutes."
                  symbols={[
                    { tex: "\\bar p", name: `mean diagonal, fold ${fold}`, value: fmt(foldRow?.transition_diagonal_mean, 4) },
                    { tex: "k", name: "number of regimes", value: String(regimeCount) },
                    { tex: "P(r_{t+1}=i \\mid r_t=i)", name: `stay probability of ${regimeName(selectedRegime, regimeCount)}`, value: fmt(foldTransitions.find((row) => row.from_regime === selectedRegime && row.to_regime === selectedRegime)?.probability, 4) },
                    { tex: "1/k", name: "chance: a label drawn at random", value: fmt(chance, 3) },
                    { tex: "1.3/k", name: "the notebook's bar", value: fmt(chance * 1.3, 3) },
                  ]}
                />
              </div>
              <Finding>
                Regimes persist: the mean diagonal is {fmt(run.mean_transition_diagonal, 3)} against a chance level of {fmt(chance, 3)} (published single-window figure 0.452),
                {run.stickiness_check_passes ? " above the notebook's 1.3 × chance bar in every refit." : " which does not clear the notebook's 1.3 × chance bar at this k."} Fold {fold} puts{" "}
                {foldCenters.map((row) => `${fmtPercent(row.training_share, 0)} in ${row.regime}`).join(", ")} of its training minutes.
              </Finding>
            </Section>

            <Section title="C. Where the edge sits: per-regime returns and verdicts" question="The 5m net return split by the regime known at the bar, each with its 95% BCa interval on the mean. Trade a regime only if the interval's low end is above zero.">
              <ControlBar>
                <CommitSlider label="Label offset (1m rows)" value={controls.labelOffset} min={-10} max={60} onCommit={(v) => set("labelOffset", v)} format={(v) => (v === 0 ? "0 (notebook)" : v < 0 ? `${v} (older)` : `+${v} (peek)`)} hint="Shift the 1m label series before tagging: -1 uses the last minute that has closed when the 5m bar starts; positive values peek ahead" />
                <CommitSlider label="Bins" value={controls.bins} min={10} max={120} onCommit={(v) => set("bins", v)} />
                <CommitSlider label="Bootstrap replicates" value={controls.replicates} min={200} max={5000} step={100} onCommit={(v) => set("replicates", v)} format={fmtInt} />
                <CommitSlider label="Block floor (bars)" value={controls.blockFloor} min={1} max={2000} onCommit={(v) => set("blockFloor", v)} hint="The notebook floors the Politis-White block length at 390 bars" />
                <CommitSlider label="Minimum bars" value={controls.minimumBars} min={100} max={20000} step={100} onCommit={(v) => set("minimumBars", v)} format={fmtInt} hint="Below this a regime is flagged 'too few bars' instead of bootstrapped" />
                <CommitSlider label="Seed" value={controls.seed} min={0} max={50} onCommit={(v) => set("seed", v)} />
              </ControlBar>
              <p className="text-[11px] text-neutral-400">
                Lines: <span className="text-neutral-100">╌ white dashed</span> live interval (these settings) · <span style={{ color: OKABE.purple }}>┈ purple dotted</span> the notebook's recorded interval ·
                grey solid zero. Bins span the pooled 0.5th to 99.5th percentile, so the edge bins hold the tails.
              </p>
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                {(live?.regimes ?? []).map((row) => (
                  <RegimeHistogram key={row.regime} regime={row} record={record.verdicts.find((entry) => entry.regime === row.regime)} regimeCount={regimeCount} />
                ))}
              </div>
              <IntervalPlot rows={verdictRows} axisLabel="mean net return per 5m bar, bp" />
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="text-left font-normal">regime</th><th className="text-right font-normal">bars</th><th className="text-right font-normal">mean</th>
                      <th className="text-right font-normal">record 95% BCa</th><th className="text-right font-normal">record</th>
                      <th className="text-right font-normal">live 95% BCa</th><th className="text-right font-normal">block (PW)</th><th className="text-right font-normal">live</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: regimeCount }, (_, regime) => {
                      const recorded = record.verdicts.find((row) => row.regime === regime);
                      const computed = live?.regimes.find((row) => row.regime === regime);
                      return (
                        <tr key={regime} className="border-t border-neutral-900">
                          <td style={{ color: regimeStyle(regime).color }}>{regimeStyle(regime).glyph} {regime}</td>
                          <td className="text-right">{fmtInt(computed?.barCount ?? recorded?.bar_count)}</td>
                          <td className="text-right">{bp(computed?.meanNetReturn ?? recorded?.mean_net_return)}</td>
                          <td className="text-right">[{bp(recorded?.bca_low)}, {bp(recorded?.bca_high)}]</td>
                          <td className="text-right" style={{ color: toneOfVerdict(recorded?.verdict) }}>{recorded ? VERDICT_TEXT[recorded.verdict] : "—"}</td>
                          <td className="text-right">[{bp(computed?.interval?.bcaLow)}, {bp(computed?.interval?.bcaHigh)}]</td>
                          <td className="text-right">{computed?.interval ? `${computed.interval.blockLength} (${computed.interval.politisWhiteBlockLength})` : "—"}</td>
                          <td className="text-right" style={{ color: toneOfVerdict(computed?.verdict) }}>{computed ? VERDICT_TEXT[computed.verdict] : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <SummaryTable columns={(live?.regimes ?? []).map((row) => ({ name: `${regimeStyle(row.regime).glyph} ${row.regime} (bp)`, summary: scaled(row.summary), decimals: 3 }))} />
              <div className="grid gap-3 xl:grid-cols-2">
                <FormulaCard
                  tex={"[\\,\\hat\\theta^*_{(\\alpha_1)},\\ \\hat\\theta^*_{(\\alpha_2)}\\,], \\quad \\alpha_{1,2} = \\Phi\\!\\left(\\hat z_0 + \\frac{\\hat z_0 + z_{\\alpha/2,\\,1-\\alpha/2}}{1 - \\hat a\\,(\\hat z_0 + z_{\\alpha/2,\\,1-\\alpha/2})}\\right)"}
                  caption={`Bias-corrected and accelerated interval for ${regimeName(selectedRegime, regimeCount)}, live settings.`}
                  symbols={[
                    { tex: "\\hat\\theta", name: "observed mean net return", value: bp(liveRegime?.meanNetReturn) },
                    { tex: "\\hat\\theta^*", name: "a circular-block bootstrap replicate of the mean", value: `${fmtInt(liveRegime?.interval?.replicates)} replicates` },
                    { tex: "\\hat z_0", name: "bias correction: Φ⁻¹ of the share of replicates below the observed mean", value: fmt(liveRegime?.interval?.biasCorrection, 4) },
                    { tex: "\\hat a", name: "acceleration, from the skew of the delete-one-block jackknife", value: fmt(liveRegime?.interval?.acceleration, 5) },
                    { tex: "z_{\\alpha/2}", name: "standard normal quantile at 2.5%", value: "-1.960" },
                    { tex: "\\Phi", name: "standard normal distribution function", value: "—" },
                    { tex: "\\alpha_1,\\ \\alpha_2", name: "replicate percentiles the interval is read at", value: `${fmtPercent(liveRegime?.interval?.bcaProbabilityLow, 2)}, ${fmtPercent(liveRegime?.interval?.bcaProbabilityHigh, 2)}` },
                    { tex: "[\\cdot,\\cdot]", name: "live interval (record in brackets)", value: `[${bp(liveRegime?.interval?.bcaLow)}, ${bp(liveRegime?.interval?.bcaHigh)}] ([${bp(recordRegime?.bca_low)}, ${bp(recordRegime?.bca_high)}])` },
                  ]}
                />
                <FormulaCard
                  tex={"b = \\min\\!\\Big(\\max\\big(b_{\\text{floor}},\\ \\lceil (2\\hat G^2 / \\hat D)^{1/3}\\, n^{1/3} \\rceil\\big),\\ \\lfloor n/3 \\rfloor\\Big)"}
                  caption="Block length: Politis & White's automatic rule from the series' own autocovariance, floored (the notebook uses 390 bars, about a trading day) and capped."
                  symbols={[
                    { tex: "b", name: "block length used, bars", value: fmtInt(liveRegime?.interval?.blockLength) },
                    { tex: "b_{\\text{floor}}", name: "floor", value: fmtInt(controls.blockFloor) },
                    { tex: "n", name: "bars in this regime", value: fmtInt(liveRegime?.barCount) },
                    { tex: "\\hat G", name: "flat-top-weighted Σ |k| R(k)", value: liveRegime?.interval ? liveRegime.interval.politisWhite.gHat.toExponential(3) : "—" },
                    { tex: "\\hat D", name: "(4/3) × (flat-top spectral density at 0)²", value: liveRegime?.interval ? liveRegime.interval.politisWhite.dCircularBlock.toExponential(3) : "—" },
                    { tex: "\\hat m", name: "lag where autocorrelation dies out", value: liveRegime?.interval ? `${liveRegime.interval.politisWhite.dependenceHorizon}${liveRegime.interval.politisWhite.horizonTruncated ? " (search window hit)" : ""}` : "—" },
                    { tex: "b_{PW}", name: "Politis-White length before floor and cap", value: fmtInt(liveRegime?.interval?.politisWhiteBlockLength) },
                  ]}
                />
              </div>
              <Finding>
                In the record {record.verdicts.filter((row) => row.verdict === "trade").map((row) => `regime ${row.regime}`).join(", ") || "no regime"} clears zero.{" "}
                {positiveMeans} of {record.verdicts.length} regimes have a positive mean net return; the intervals are what separate them, and they are wide against
                means of {bp(smallestMean, 3)} to {bp(largestMean, 3)} per bar.
                Record and live intervals differ only by the random generator (numpy, one stream shared across regimes, versus one seeded stream per regime here).
                Set the label offset to −1 to tag each bar with the last minute that has closed when the 5m bar starts.
              </Finding>
            </Section>

            <Section title="D. Negative control: does the label carry information?" question="Shift the 1m labels into the future before tagging. If per-regime means did not move, the label would be doing nothing, or the join would be broken.">
              <ControlBar>
                <CommitSlider label="Shift (1m rows)" value={controls.leakOffset} min={-30} max={240} onCommit={(v) => set("leakOffset", v)} format={(v) => (v === 25 ? "+25 (notebook)" : v > 0 ? `+${v}` : String(v))} />
              </ControlBar>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={leakData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="regime" {...AXIS} />
                      <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmt(v, 2)} />
                      <Tooltip {...TOOLTIP} formatter={(value, name) => [`${fmt(Number(value), 4)} bp`, String(name)]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke={OKABE.grey} />
                      <Bar dataKey="labelled" name={`as tagged (offset ${controls.labelOffset})`} fill={OKABE.sky} isAnimationActive={false} />
                      <Bar dataKey="shifted" name={`shifted ${controls.leakOffset > 0 ? "+" : ""}${controls.leakOffset} rows`} fill={OKABE.purple} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full text-[11px] font-mono tnum">
                    <thead>
                      <tr className="text-neutral-500"><th className="text-left font-normal">regime</th><th className="text-right font-normal">causal (record)</th><th className="text-right font-normal">+25 rows (record)</th><th className="text-right font-normal">|difference|</th></tr>
                    </thead>
                    <tbody>
                      {record.leak.map((row) => (
                        <tr key={row.regime} className="border-t border-neutral-900">
                          <td style={{ color: regimeStyle(row.regime).color }}>{regimeStyle(row.regime).glyph} {row.regime}</td>
                          <td className="text-right">{bp(row.causal_mean_net_return, 4)}</td>
                          <td className="text-right">{bp(row.leaky_mean_net_return, 4)}</td>
                          <td className="text-right">{bp(row.absolute_difference, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    The notebook requires the largest difference to exceed 1e-6 (0.01 bp): record {bp(run.leak_control_maximum_difference, 4)} ({run.leak_control_check_passes ? "passes" : "fails"});
                    live, at this shift, {bp(leakMaximum, 4)}.
                  </p>
                </div>
              </div>
              <Finding>
                With the labels read 25 rows ahead (the record), {flipped.length > 0 ? `the mean flips sign in regime ${flipped.join(", ")} and ` : ""}the best regime
                {bestCausal === bestLeaky ? ` stays ${bestCausal}` : ` moves from ${bestCausal} to ${bestLeaky}`}. The label moves the means, so the join works and the control can fail;
                it also shows how much of a regime's apparent return depends on exactly when its label is read.
              </Finding>
            </Section>

            <Section title="E. The gate: sit out the other regimes" question="Zero the net return (flat, no cost) outside the traded regimes. The question is the difference, per bar, with its interval, not two Sharpe bars side by side.">
              <ControlBar>
                <SegmentControl label="Gate" value={controls.gate === "verdicts" ? "verdicts" : "chosen"} options={[{ value: "verdicts", label: "from the verdicts" }, { value: "chosen", label: "choose" }]} onChange={(v) => set("gate", v === "verdicts" ? "verdicts" : (live?.regimes.filter((row) => row.verdict === "trade").map((row) => row.regime).join(",") || "none"))} />
                {chosenGate && <RegimeToggles regimeCount={regimeCount} chosen={chosenGate} onChange={(next) => set("gate", next.length ? next.join(",") : "none")} />}
                <SegmentControl label="Scored on" value={controls.scope} options={[{ value: "same", label: "same bars (notebook)" }, { value: "heldout", label: "held out" }]} onChange={(v) => set("scope", v)} hint="Held out: verdicts decided on bars before the split, gate scored only after it" />
                {controls.scope === "heldout" && (
                  <SegmentControl label="Split at fold" value={controls.splitFold} options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => set("splitFold", v)} />
                )}
              </ControlBar>
              {controls.scope === "heldout" && <FoldStrip folds={folds} origin={origin} split={live?.settings.splitTimestamp ?? null} />}
              <IntervalPlot rows={gateRows} axisLabel="mean per-bar effect of gating (gated − baseline), bp" />
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <Stat label="Baseline Sharpe (live)" value={fmt(gate?.baselineSharpe, 3)} />
                <Stat label="Gated Sharpe (live)" value={fmt(gate?.gatedSharpe, 3)} tone={gate && gate.gatedSharpe > gate.baselineSharpe ? OKABE.orange : OKABE.blue} />
                <Stat label="Bars sat out" value={gate ? `${fmtInt(gate.barsGatedOut)} of ${fmtInt(gate.scoredBarCount)}` : "—"} />
                <Stat label="Decision (live)" value={gate ? STATUS_TEXT[gate.status] : "—"} tone={toneOfStatus(gate?.status)} />
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={sharpeByFold.filter((row) => row.baseline !== null)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="fold" {...AXIS} />
                      <YAxis {...AXIS} width={36} />
                      <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 3), String(name)]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke={OKABE.grey} />
                      <Bar dataKey="baseline" name="baseline" fill={OKABE.sky} isAnimationActive={false} />
                      <Bar dataKey="gated" name="gated" fill={OKABE.orange} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-500">Sharpe inside each walk-forward test window, baseline against gated.</p>
                </div>
                <div className="min-w-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={equity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(v: number) => fmtTime(v).slice(0, 7)} {...AXIS} />
                      <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 0)} />
                      <Tooltip {...TOOLTIP} labelFormatter={(label) => fmtTime(Number(label))} formatter={(value, name) => [`${fmt(Number(value), 1)} bp`, String(name)]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line dataKey="baseline" name="baseline (solid)" stroke={OKABE.sky} dot={false} isAnimationActive={false} />
                      <Line dataKey="gated" name="gated (dashed)" stroke={OKABE.orange} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-500">Cumulative net return in bp over the bars the gate is scored on.</p>
                </div>
              </div>
              <FormulaCard
                tex={"g_t = r_t \\cdot \\mathbf{1}[\\,\\text{regime}_t \\in T\\,], \\qquad d_t = g_t - r_t, \\qquad \\bar d = \\frac{1}{n}\\sum_{t=1}^{n} d_t"}
                caption="The gate zeroes a bar's return (flat, no cost) when its regime is not in the traded set; the effect is the mean of the per-bar difference, with the same BCa interval."
                symbols={[
                  { tex: "r_t", name: "baseline net return of 5m bar t", value: `mean ${bp(gate?.baselineMeanNetReturn)}` },
                  { tex: "g_t", name: "gated net return", value: `mean ${bp(gate?.gatedMeanNetReturn)}` },
                  { tex: "T", name: "traded regimes", value: `{${gate?.tradeRegimes.join(", ") ?? ""}}` },
                  { tex: "\\mathbf{1}[\\cdot]", name: "1 when the bar's regime is traded, else 0", value: gate ? `0 on ${fmtInt(gate.barsGatedOut)} bars` : "—" },
                  { tex: "n", name: "bars scored", value: fmtInt(gate?.scoredBarCount) },
                  { tex: "\\bar d", name: "mean per-bar effect", value: bp(gate?.meanPerBarEffect) },
                  { tex: "95\\%\\ \\text{BCa}", name: "interval on the mean effect", value: `[${bp(gate?.interval?.bcaLow)}, ${bp(gate?.interval?.bcaHigh)}]` },
                ]}
              />
              <Finding>
                <strong>SOLUTION:</strong> {solution}
              </Finding>
              <Finding>
                Why the gated Sharpe rises while the effect is negative: sitting out zeroes {gate ? fmtPercent(gate.barsGatedOut / Math.max(1, gate.scoredBarCount), 0) : "—"} of the bars,
                which shrinks the standard deviation more than the mean. A higher Sharpe from holding less is not an edge; the per-bar return it gives up is what the interval measures.
                Switch "Scored on" to held out to let the rule decide on its own history before scoring it on bars it has not seen.
              </Finding>
            </Section>

            <Section title="F. What the notebook's code does, and which control undoes it" question="Kept as the notebook ran it, so the record reproduces; each is testable here.">
              <ul className="list-disc space-y-1 pl-5 text-[12px] text-neutral-300">
                <li>Verdicts and the gated Sharpe are computed on the same bars; only the labels are walk-forward. <em>Gate → Scored on: held out.</em></li>
                <li>A 5m bar stamped t is tagged with the 1m regime stamped t, whose range and volume happen inside the 5m bar's own return window (a peek of up to one minute). <em>Label offset −1.</em></li>
                <li>Fold i+1 relabels the last 100 5m bars of fold i's test window (the embargo overlap), and fold 0's training minutes are labelled in sample by the model fitted on them ({fmtInt(run.labelled_one_minute_rows)} labelled minutes in all).</li>
                <li>MNQ is the lake's naive bare-root splice: contract rolls are price jumps, not back-adjusted, and their returns are in the net return.</li>
                <li>One random generator seeded 0 serves every regime and then the gate, so each recorded interval depends on the regimes before it. The live half gives each regime its own seeded stream.</li>
              </ul>
            </Section>

            <Section title="G. Every column">
              <ColumnGrid rows={(body?.bars ?? []) as unknown as Record<string, unknown>[]} exclude={["timestamp"]} title={`5m bars (every 31st of ${fmtInt(run.tagged_bar_count)})`} />
              <ColumnGrid rows={(body?.features ?? []) as unknown as Record<string, unknown>[]} exclude={["timestamp"]} title={`1m regime features (${fmtInt(body?.features.length)} sampled minutes)`} />
              <ColumnGrid rows={folds as unknown as Record<string, unknown>[]} exclude={["regime_count"]} title="Walk-forward folds" />
              <ColumnGrid rows={record.verdicts as unknown as Record<string, unknown>[]} title="Recorded verdicts" />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
