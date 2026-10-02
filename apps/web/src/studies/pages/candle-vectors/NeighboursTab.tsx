/**
 * Section 4: the nearest past windows of one firing and where price went after
 * each. Section 6: whether the neighbourhood's vote knows the direction.
 * Section 7: the vector database behind it.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, StudyNotes, StudyState, TOOLTIP,
  fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import { meanPath, type EvaluationBody, type NeighboursBody, type VectorStoreBody } from "@shared/studies/candle-vectors";
import { CandleChart, CandleKey, DataTable, IntervalPlot, Legend, PATTERN_STYLE, type IntervalItem, type SeriesStyle } from "./charts";
import type { TabProps } from "./controls";

const POPULATIONS = ["random 2025 bars", "hammer", "shooting_star", "bullish_engulfing", "bearish_engulfing", "bullish_harami", "bearish_harami", "doji"];
const VERDICT: Record<string, SeriesStyle> = {
  clears: { color: OKABE.orange, glyph: "diamond", label: "clears the null (q < 0.10)" },
  not: { color: OKABE.grey, glyph: "circle", label: "indistinguishable from the null" },
};
const QUERY_LINE = "#f5f5f5";
const finiteValues = (values: Array<number | null | undefined>): number[] => values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

function NeighbourSection({ controls, set }: TabProps) {
  const query = useStudyQuery<NeighboursBody>("candle-vectors", {
    section: "neighbours", timeframe: controls.timeframe, pattern: controls.pattern, vector: controls.neighbourVector,
    neighbours: controls.neighbourCount, occurrence: controls.neighbourOccurrence,
  });
  const body = query.data?.data;
  const members = body?.members ?? [];
  const firing = members.find((member) => member.rank === -1);
  const neighbours = members.filter((member) => member.rank >= 0);
  const pathBars = body?.pathBars ?? 24;
  const mean = meanPath(neighbours.map((member) => member.path), pathBars);
  const fan = Array.from({ length: pathBars + 1 }, (_, step) => {
    const row: Record<string, number | null> = { step, mean: mean[step] ?? null, firing: step === 0 ? 0 : (firing?.path[step - 1] ?? null) };
    neighbours.forEach((member) => { row[`n${member.rank}`] = step === 0 ? 0 : (member.path[step - 1] ?? null); });
    return row;
  });
  const maximum = Math.max(2, body?.firingCount ?? 0);
  const nearest = neighbours[0]?.squared_distance ?? null;
  const farthest = neighbours[neighbours.length - 1]?.squared_distance ?? null;

  return (
    <Section title="4 · Compare it to something: the nearest past windows" question="For every 2025 firing, the 50 closest 2021-2024 windows. Adjacent windows share 15 of 16 candles, so neighbours within 16 bars of a closer one are skipped: 50 neighbours are 50 distinct moments. The market vector swaps the candle shape for the state around it (trend, ADX, RSI, volatility, volume, time of day).">
      <ControlBar>
        <SegmentControl label="Compare by" value={controls.neighbourVector} options={[{ value: "shape", label: "candle shape (64 numbers)" }, { value: "market", label: "market state (11 numbers)" }]} onChange={(v) => set("neighbourVector", v)} />
        <SliderControl label="Neighbours drawn" value={controls.neighbourCount} min={1} max={50} onChange={(v) => set("neighbourCount", v)} />
        <SliderControl label={`2025 ${PATTERN_STYLE[controls.pattern]?.label} (of ${fmtInt(body?.firingCount ?? 0)})`} value={Math.min(controls.neighbourOccurrence, maximum)} min={1} max={maximum} onChange={(v) => set("neighbourOccurrence", v)} />
      </ControlBar>
      <FormulaCard
        tex={"d(a,b)=\\sum_{j=1}^{64}\\left(\\tilde a_j-\\tilde b_j\\right)^2"}
        caption="The market vector runs the same sum over its 11 numbers."
        symbols={[
          { tex: "d(a,b)", name: "squared distance between two windows (0 = identical)", value: `nearest ${fmt(nearest, 3)} · farthest drawn ${fmt(farthest, 3)}` },
          { tex: "\\sum_{j=1}^{64}", name: "sum over every number of the vector", value: controls.neighbourVector === "shape" ? "64 terms" : "11 terms" },
          { tex: "\\tilde a_j", name: "number j of this firing, standardised by the 2021-2024 mean and standard deviation", value: "unitless" },
          { tex: "\\tilde b_j", name: "number j of a past window, standardised the same way", value: "unitless" },
        ]}
      />
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body?.landed ? <Empty>The neighbour lists are not in the lake.</Empty> : members.length === 0 ? <Empty>No 2025 firing of this pattern here.</Empty> : (
          <>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {members.map((member) => (
                <div key={member.rank} className="min-w-0 rounded border border-neutral-800 p-1">
                  <div className="truncate text-[10px] text-neutral-300">{member.rank === -1 ? "this firing" : `neighbour ${member.rank + 1}`} · {member.time_label}</div>
                  <CandleChart height={100} xDomain={[-15.5, 0.5]} format={(v) => fmt(v, 1)}
                    candles={member.shape.map(([open, high, low, close], index) => ({
                      x: index - 15, open: open ?? Number.NaN, high: high ?? Number.NaN, low: low ?? Number.NaN, close: close ?? Number.NaN,
                      tip: [`${15 - index} bars back`, `open ${fmt(open, 2)} · high ${fmt(high, 2)} · low ${fmt(low, 2)} · close ${fmt(close, 2)}`],
                    }))} />
                </div>
              ))}
            </div>
            <CandleKey extra={" · each window in average ranges from its own last close"} />
            <div className="grid min-w-0 gap-3 xl:grid-cols-[3fr_2fr]">
              <div className="min-w-0">
                <div className="text-[11px] text-neutral-300">Grey = each neighbour's path, dashed sky = their average, thick white = what this firing did</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={fan} margin={{ top: 6, right: 8, left: 4, bottom: 16 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="step" type="number" domain={[0, pathBars]} {...AXIS} label={{ value: `${controls.timeframe} bars after the last candle`, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                    <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 1)} label={{ value: "close minus last close (average ranges)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                    <ReferenceLine y={0} stroke="#737373" strokeDasharray="2 2" />
                    <Tooltip {...TOOLTIP} content={({ payload, label }) => {
                      // 50 grey lines would make a 50-row card: show the firing, the average and the spread of the neighbours at this step.
                      const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
                      if (!row) return null;
                      const spread = finiteValues(neighbours.map((member) => row[`n${member.rank}`]));
                      return (
                        <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                          <div>{label} {controls.timeframe} bars after the last candle</div>
                          <div>this firing {fmt(row.firing, 3)}</div>
                          <div>neighbour average {fmt(row.mean, 3)}</div>
                          {spread.length > 0 && <div>{spread.length} neighbours from {fmt(Math.min(...spread), 3)} to {fmt(Math.max(...spread), 3)}</div>}
                        </div>
                      );
                    }} />
                    {neighbours.map((member) => (
                      <Line key={member.rank} dataKey={`n${member.rank}`} name={`neighbour ${member.rank + 1}`} stroke={OKABE.grey} strokeOpacity={0.5} dot={false} strokeWidth={1} isAnimationActive={false} connectNulls={false} legendType="none" />
                    ))}
                    <Line dataKey="mean" name="neighbour average (dashed)" stroke={OKABE.sky} strokeWidth={3} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
                    <Line dataKey="firing" name="this firing (solid)" stroke={QUERY_LINE} strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <DataTable rows={neighbours.map((member) => ({ rank: member.rank + 1, time_label: member.time_label, squared_distance: member.squared_distance }))} />
            </div>
          </>
        )}
      </StudyState>
    </Section>
  );
}

function EvaluationSection({ controls, set }: TabProps) {
  const query = useStudyQuery<EvaluationBody>("candle-vectors", { section: "evaluation", vector: controls.evaluationVector, nearest: controls.nearest, horizon: controls.horizon });
  const rows = query.data?.data.rows ?? [];
  const tableColumns = ["timeframe", "population", "usable_count", "actual_up_rate", "mean_neighbour_vote_up", "area_under_roc_curve",
    "area_under_roc_curve_null_95th_percentile", "area_under_roc_curve_permutation_p_value", "benjamini_hochberg_q_value",
    "area_under_roc_curve_interval_width", "last_bar_reversal_area_under_roc_curve", "last_bar_reversal_day_block_lower_95",
    "last_bar_reversal_day_block_upper_95", "brier_score_neighbour_vote", "brier_score_corpus_base_rate", "hit_rate_in_claimed_direction",
    "neighbour_predicted_claimed_direction"].map((key) => ({ key }));
  return (
    <Section title="6 · Does the neighbourhood know which way price goes next?" question="Each 2025 firing's vote is the share of its k nearest 2021-2024 windows whose close h bars later was higher; the score is the area under the ROC curve of that vote against what happened. A result counts only where it clears the null after correcting for testing everything at once.">
      <ControlBar>
        <SegmentControl label="Neighbours by" value={controls.evaluationVector} options={[{ value: "shape", label: "candle shape" }, { value: "market", label: "market state" }]} onChange={(v) => set("evaluationVector", v)} />
        <SegmentControl label="k nearest" value={controls.nearest} options={[5, 20, 50].map((k) => ({ value: k, label: String(k) }))} onChange={(v) => set("nearest", v)} />
        <span className="self-center text-[11px] text-neutral-400">horizon {controls.horizon} bars (the picker at the top)</span>
      </ControlBar>
      <Legend items={[{ key: "clears", ...VERDICT.clears! }, { key: "not", ...VERDICT.not! }, { key: "reversal", color: OKABE.blue, glyph: "x", label: "\"the last bar reverses\" as the forecast" }]} />
      <p className="text-[11px] text-neutral-400">line = the vote's 95% trading-day interval · white tick = the null's 95th percentile · dashed = 0.5, a coin flip</p>
      <StudyState isLoading={query.isLoading} error={query.error}>
        {rows.length === 0 ? <Empty>No neighbour tests landed for these settings.</Empty> : (
          <>
            <div className="grid min-w-0 gap-3 xl:grid-cols-3">
              {["1m", "1h", "4h"].map((timeframe) => (
                <div key={timeframe} className="min-w-0">
                  <div className="text-[11px] font-medium text-neutral-300">{timeframe}</div>
                  <IntervalPlot
                    rows={POPULATIONS} series={["vote"]} domain={[0.3, 0.75]} xLabel="area under the ROC curve" labelWidth={104}
                    reference={{ value: 0.5, color: "#737373" }}
                    items={rows.filter((row) => row.timeframe === timeframe).map((row): IntervalItem => {
                      const clears = typeof row.benjamini_hochberg_q_value === "number" && row.benjamini_hochberg_q_value < 0.1;
                      return {
                        row: row.population, series: "vote", value: row.area_under_roc_curve, low: row.area_under_roc_curve_day_block_lower_95,
                        high: row.area_under_roc_curve_day_block_upper_95, style: clears ? VERDICT.clears! : VERDICT.not!,
                        extras: [{ value: row.area_under_roc_curve_null_95th_percentile, kind: "tick", color: "#e5e5e5" },
                          { value: row.last_bar_reversal_area_under_roc_curve, kind: "x", color: OKABE.blue }],
                        tip: [`${row.timeframe} · ${row.population}`, `usable ${fmtInt(row.usable_count)}`, `area under the ROC curve ${fmt(row.area_under_roc_curve, 4)}`,
                          `null 95th percentile ${fmt(row.area_under_roc_curve_null_95th_percentile, 4)}`, `permutation p-value ${fmt(row.area_under_roc_curve_permutation_p_value, 4)}`,
                          `Benjamini-Hochberg q-value ${fmt(row.benjamini_hochberg_q_value, 3)}`, `last bar reversed ${fmt(row.last_bar_reversal_area_under_roc_curve, 4)}`,
                          `Brier score of the vote ${fmt(row.brier_score_neighbour_vote, 5)} · of the base rate ${fmt(row.brier_score_corpus_base_rate, 5)}`],
                      };
                    })}
                  />
                </div>
              ))}
            </div>
            <Finding>
              At one minute the intervals are narrow (about ±0.008) and the votes sit at 0.50: the neighbours know nothing about the next bars.
              Yet the cheapest forecast, "the last bar reverses", scores 0.514–0.517 one bar ahead: that edge sits inside the vector as one of its
              64 numbers, and averaging 50 neighbours washes it out. At one and four hours the intervals span 0.13–0.25, so these tests could
              only have caught a large effect: "nothing detected" there means too few firings, not proof of 0.50.
              {" "}Here {rows.filter((row) => typeof row.benjamini_hochberg_q_value === "number" && row.benjamini_hochberg_q_value < 0.1).length} of {rows.length} tests clear the null.
            </Finding>
            <DataTable rows={rows} columns={tableColumns} />
            <ColumnGrid rows={rows} title="Every column of these neighbour tests" />
          </>
        )}
      </StudyState>
    </Section>
  );
}

function VectorStoreSection() {
  const query = useStudyQuery<VectorStoreBody>("candle-vectors", { section: "vectorStore" });
  const body = query.data?.data;
  return (
    <Section title="7 · The vector database" question="The 2021-2024 vectors lived in DuckDB tables with an HNSW index (the vss extension), one per timeframe and vector. HNSW is approximate, so its answers were checked against the exact scan used in section 6.">
      <StudyState isLoading={query.isLoading} error={query.error}>
        {!body?.landed ? <Empty>The vector store checks are not in the lake.</Empty> : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <div className="text-[11px] text-neutral-300">Recall of the index against an exact scan</div>
              <DataTable rows={body.recall} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="text-[11px] text-neutral-300">What each corpus holds</div>
              <DataTable rows={body.corpora} />
            </div>
          </div>
        )}
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-300">{`INSTALL vss; LOAD vss;
-- the query vector is standardised with the corpus mean and standard deviation stored in \`corpora\`
SELECT ts, bar_number, array_distance(vec, ?::FLOAT[64]) AS distance
FROM states_shape_1h
ORDER BY distance
LIMIT 50;`}</pre>
        <Finding>
          The index is built only from windows whose outcome had closed before 2025, because a WHERE filter on an HNSW search is applied after
          the index returns its k: measured, <code>WHERE bar_number &lt; 100 … LIMIT 50</code> on the 1-hour table returned no rows at all, although
          75 rows match. Filter by building the table, never at query time. The dashboard reads the precomputed neighbour lists instead.
        </Finding>
      </StudyState>
    </Section>
  );
}

export function NeighboursTab(props: TabProps) {
  return (
    <>
      <NeighbourSection {...props} />
      <EvaluationSection {...props} />
      <VectorStoreSection />
    </>
  );
}
