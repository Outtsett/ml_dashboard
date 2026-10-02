/**
 * Chart CNN pattern recognition. Two requests: the overview (per-pattern
 * scores, window counts, the embedding projection; fixed, cached) and the
 * picked pattern (ROC, threshold counts, score groups, histogram, example
 * windows), recomputed in the lake's DuckDB whenever a pattern-side control
 * moves. The threshold, group stepping, sorting and colouring act in the
 * browser on what is already here.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, GRID, OKABE, Section, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  TOOLTIP, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  DEFAULT_PATTERN, PATTERN_NAMES, recognitionHeadline, shortPatternName,
  type CountRow, type OverviewBody, type PatternBody,
} from "@shared/studies/chart-cnn-pattern-recognition";
import { CandleGrid } from "./CandleThumb";
import { EmbeddingSection, type ColorBy } from "./EmbeddingSection";
import { PatternSection } from "./PatternSection";
import { RecognitionSection, type SortKey } from "./RecognitionSection";

const SLUG = "chart-cnn-pattern-recognition";

function CountBars({ title, rows, color }: { title: string; rows: readonly CountRow[]; color: string }) {
  const data = rows.map((row) => ({ ...row, label: shortPatternName(row.value) }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(90, 14 * data.length + 24)}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 8, left: 2, bottom: 2 }} barCategoryGap={1}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmtInt(value)} />
          <YAxis type="category" dataKey="label" width={112} {...AXIS} interval={0} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "windows"]} />
          <Bar dataKey="window_count" fill={color} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    sort: "auc",
    minimumPositives: 0,
    logScale: false,
    pattern: DEFAULT_PATTERN as string,
    thresholdIndex: 50,
    groups: 10,
    bins: 40,
    highlightGroup: 10,
    logFalsePositiveRate: false,
    examples: 8,
    showContext: false,
    colorBy: "target",
    targetCount: 12,
    pointSize: 2.5,
  });
  const pattern = (PATTERN_NAMES as readonly string[]).includes(controls.pattern) ? controls.pattern : DEFAULT_PATTERN;

  const overviewQuery = useStudyQuery<OverviewBody>(SLUG, { part: "overview" });
  const patternQuery = useStudyQuery<PatternBody>(SLUG, { part: "pattern", pattern, groups: controls.groups, bins: controls.bins, examples: controls.examples });
  const overview = overviewQuery.data?.data;
  const patternBody = patternQuery.data?.data;
  const rows = overview?.patterns ?? [];
  const headline = recognitionHeadline(rows);
  const neverFire = rows.filter((row) => row.positive_window_count === 0).map((row) => shortPatternName(row.pattern_name));
  const lowestAveragePrecision = [...rows].filter((row) => row.average_precision !== null).sort((a, b) => (a.average_precision as number) - (b.average_precision as number))[0];
  const projectionRows = overview?.projection
    ? overview.projection.windowId.map((windowId, index) => ({
        window_id: windowId,
        principal_component_1: overview.projection?.principalComponent1[index] ?? null,
        principal_component_2: overview.projection?.principalComponent2[index] ?? null,
        pattern_sign: overview.projection?.sign[index] ?? null,
        window_bar_count: overview.projection?.barCount[index] ?? null,
      }))
    : [];
  const windowSampleRows = (overview?.windowSample.rows ?? []).map((values) =>
    Object.fromEntries((overview?.windowSample.columns ?? []).map((column, index) => [column, values[index] ?? null])),
  );
  const pick = (next: string) => {
    set("pattern", next);
    set("highlightGroup", controls.groups);
  };

  return (
    <div className="space-y-3">
      <StudyState isLoading={overviewQuery.isLoading} error={overviewQuery.error}>
        <StudyNotes notes={overviewQuery.data?.notes ?? []} />
        {overview && rows.length > 0 && (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Real windows never seen in training" value={fmtInt(overview.windowCount)} hint={`${overview.firstWindowTime?.slice(0, 16)} to ${overview.lastWindowTime?.slice(0, 16)} New York`} />
              <Stat label="Mean AUC" value={fmt(headline.meanAreaUnderCurve, 4)} tone={OKABE.blue} hint="over the patterns TA-Lib fires at least once" />
              <Stat label="Median AUC" value={fmt(headline.medianAreaUnderCurve, 4)} tone={OKABE.blue} />
              <Stat label="Patterns above 0.95" value={`${headline.aboveCutCount} of ${headline.scoredCount}`} />
              <Stat label="Never fire on real windows" value={String(headline.unscoredCount)} hint={neverFire.join(", ")} />
            </div>
            <Finding>
              Trained only on synthetic candles TA-Lib verifies, the network recognises the patterns on {fmtInt(overview.windowCount)} real MNQ 5-minute windows
              ({overview.firstWindowTime?.slice(0, 10)} to {overview.lastWindowTime?.slice(0, 10)}) it never saw: mean AUC {fmt(headline.meanAreaUnderCurve, 4)},
              median {fmt(headline.medianAreaUnderCurve, 4)}, {headline.aboveCutCount} of {headline.scoredCount} scored patterns above 0.95. {headline.unscoredCount} patterns
              ({neverFire.join(", ")}) never fire on the real windows, so they have no score.
            </Finding>

            <Section title="A. Out-of-sample recognition per pattern" question="How well does the network's score rank the windows TA-Lib calls the pattern above the ones it does not?">
              <RecognitionSection
                rows={rows}
                sort={controls.sort as SortKey}
                onSort={(value) => set("sort", value)}
                minimumPositives={controls.minimumPositives}
                onMinimumPositives={(value) => set("minimumPositives", value)}
                logScale={controls.logScale}
                onLogScale={(value) => set("logScale", value)}
                selected={pattern}
                onPick={pick}
              />
              <Finding>
                AUC stays high even for rare patterns because it only asks for ranking; average precision is the harder test when positives are rare.
                {lowestAveragePrecision
                  ? ` The lowest is ${lowestAveragePrecision.pattern_name} at ${fmt(lowestAveragePrecision.average_precision, 3)}, with ${fmtInt(lowestAveragePrecision.positive_window_count)} positives in ${fmtInt(lowestAveragePrecision.visible_window_count)} windows, still far above its prevalence of ${fmt(lowestAveragePrecision.prevalence, 5)}.`
                  : ""}
              </Finding>
            </Section>
          </>
        )}
      </StudyState>

      <Section title={`B. One pattern up close: ${pattern}`} question="Its ROC, what a threshold flags, and how the true-positive fraction climbs with the score.">
        <ControlBar onReset={reset}>
          <SelectControl
            label="Pattern"
            value={pattern}
            options={PATTERN_NAMES.map((name) => ({ value: name, label: `${name}${rows.find((row) => row.pattern_name === name)?.positive_window_count === 0 ? " (never fires)" : ""}` }))}
            onChange={pick}
          />
        </ControlBar>
        <StudyState isLoading={patternQuery.isLoading} error={patternQuery.error}>
          <StudyNotes notes={patternQuery.data?.notes ?? []} />
          {patternBody && patternBody.visibleWindowCount > 0 && (
            <PatternSection
              body={patternBody}
              controls={controls}
              set={(key, value) => set(key, value as never)}
            />
          )}
        </StudyState>
      </Section>

      <Section title={`C. The windows behind the numbers: ${pattern}`} question="Drawn the way the network saw them: only the pattern's bars, scaled to their own range, rising bars hollow, falling bars filled.">
        <ControlBar>
          <SliderControl label="Windows per grid" value={controls.examples} min={1} max={24} onChange={(value) => set("examples", value)} />
          <SwitchControl label="Show the earlier bars the network did not see" checked={controls.showContext} onChange={(value) => set("showContext", value)} />
        </ControlBar>
        <p className="text-[11px] text-neutral-400">
          <span style={{ color: OKABE.orange }}>□ rising bar (hollow)</span> · <span style={{ color: OKABE.blue }}>■ falling bar (filled)</span> · p = the network&apos;s score · time in New York · hover a window for its prices
        </p>
        {patternBody && (
          <div className="space-y-3">
            <CandleGrid title="TA-Lib says yes, network most confident yes" windows={patternBody.truePositives} showContext={controls.showContext} empty="None: TA-Lib never fires this pattern here." />
            <CandleGrid title="TA-Lib says no, network most confident yes (false positives)" windows={patternBody.falsePositives} showContext={controls.showContext} empty="None." />
            <CandleGrid title="TA-Lib says yes, network least confident (misses)" windows={patternBody.misses} showContext={controls.showContext} empty="None: TA-Lib never fires this pattern here." />
          </div>
        )}
        <Finding>
          TA-Lib decides a pattern by fixed ratios of body and shadow lengths; the network only learned what TA-Lib-verified synthetic candles look like. Its score is a
          resemblance, so its false positives are the windows that look most like {pattern} without passing TA-Lib&apos;s rules, and its misses the ones TA-Lib
          accepts that look least like its training examples.
        </Finding>
      </Section>

      <Section title="D. Embedding space: the vectors that get tokenised" question="The network's 256-number embedding of 20,000 sampled windows, projected onto its two directions of greatest spread.">
        {overview?.projection ? (
          <EmbeddingSection
            projection={overview.projection}
            colorBy={controls.colorBy as ColorBy}
            onColorBy={(value) => set("colorBy", value)}
            targetCount={controls.targetCount}
            onTargetCount={(value) => set("targetCount", value)}
            pointSize={controls.pointSize}
            onPointSize={(value) => set("pointSize", value)}
          />
        ) : (
          <p className="text-[11px] text-neutral-500">The embedding projection is not in the lake yet.</p>
        )}
      </Section>

      <Section title="E. What this round concluded" question="From the synthesis of this phase (p1_synthesis).">
        <Finding>
          The network recognises the patterns (mean AUC {fmt(headline.meanAreaUnderCurve, 3)}), but the patterns carry no direction, so chart images are not built into
          the multimodal model unless an ablation shows lift. The direction question is answered in the candle pattern scorecard study.
        </Finding>
        <a href="/studies/candle-pattern-scorecard" className="text-[11px] text-[#56B4E9] underline">Candle patterns: read them, or trade them? →</a>
      </Section>

      {overview && rows.length > 0 && (
        <Section title="F. Every column" question="Each frame the study reads, one graphic per column, with its eight numbers.">
          <div className="space-y-4">
            <ColumnGrid rows={rows as unknown as Array<Record<string, unknown>>} title="Per-pattern scores (61 rows)" />
            <div className="grid gap-2 xl:grid-cols-3">
              <CountBars title="target_pattern: windows cut around each pattern" rows={overview.targetCounts} color={OKABE.sky} />
              <CountBars title="pattern_sign: -1 bearish, 0 none, +1 bullish" rows={overview.signCounts} color={OKABE.orange} />
              <CountBars title="window_bar_count: bars the network sees" rows={overview.barCountCounts} color={OKABE.blue} />
            </div>
            <ColumnGrid
              rows={windowSampleRows}
              exclude={["window_id"]}
              title={`Windows (${fmtInt(windowSampleRows.length)}-window sample; bar prices are absolute MNQ points)`}
            />
            <ColumnGrid rows={projectionRows} exclude={["window_id"]} title="Embedding projection (20,000 sampled windows)" />
          </div>
        </Section>
      )}
    </div>
  );
}
