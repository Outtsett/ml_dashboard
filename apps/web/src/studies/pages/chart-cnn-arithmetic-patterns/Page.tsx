/**
 * Chart CNN control round. Two requests: the overview (the per-pattern table
 * the notebook showed, the window span, the direction pairing; fixed, cached)
 * and the picked pattern (ROC, threshold counts, score groups, histogram),
 * recomputed in the lake's DuckDB whenever a pattern-side control moves. The
 * threshold, group stepping, sorting and scaling act in the browser on what is
 * already here.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, GRID, OKABE, Section, SelectControl, Stat, StudyNotes, StudyState, TOOLTIP,
  fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  DEFAULT_PATTERN, DEFAULT_TAG, PATTERN_NAMES, patternLabel, precisionLift, recognitionHeadline,
  type OverviewBody, type PatternBody,
} from "@shared/studies/chart-cnn-arithmetic-patterns";
import { ControlComparison } from "./ControlComparison";
import { PatternSection } from "./PatternSection";
import { RecognitionSection, type SortKey } from "./RecognitionSection";

const SLUG = "chart-cnn-arithmetic-patterns";

function CountBars({ title, rows, color, unit }: { title: string; rows: ReadonlyArray<{ label: string; value: number }>; color: string; unit: string }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(120, 14 * rows.length + 28)}>
        <BarChart data={[...rows]} layout="vertical" margin={{ top: 2, right: 8, left: 2, bottom: 2 }} barCategoryGap={1}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmtInt(value)} />
          <YAxis type="category" dataKey="label" width={108} {...AXIS} interval={0} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), unit]} />
          <Bar dataKey="value" fill={color} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthBars({ rows }: { rows: ReadonlyArray<{ month: string; window_count: number }> }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">window_time_new_york: test windows per month</div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={[...rows]} margin={{ top: 2, right: 8, left: 2, bottom: 2 }} barCategoryGap={1}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="month" {...AXIS} interval={5} />
          <YAxis {...AXIS} width={44} tickFormatter={(value: number) => fmtInt(value)} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "windows"]} />
          <Bar dataKey="window_count" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    tag: DEFAULT_TAG as string,
    sort: "auc",
    minimumPositives: 0,
    logScale: false,
    pattern: DEFAULT_PATTERN as string,
    thresholdIndex: 50,
    groups: 10,
    bins: 40,
    highlightGroup: 10,
    logFalsePositiveRate: false,
  });
  const pattern = (PATTERN_NAMES as readonly string[]).includes(controls.pattern) ? controls.pattern : DEFAULT_PATTERN;

  const overviewQuery = useStudyQuery<OverviewBody>(SLUG, { part: "overview", tag: controls.tag });
  const patternQuery = useStudyQuery<PatternBody>(SLUG, { part: "pattern", tag: controls.tag, pattern, groups: controls.groups, bins: controls.bins });
  const overview = overviewQuery.data?.data;
  const patternBody = patternQuery.data?.data;
  const rows = overview?.patterns ?? [];
  const headline = recognitionHeadline(rows);
  const weakest = [...rows].sort((a, b) => a.average_precision - b.average_precision)[0];
  const testLabel = overview ? `${fmtInt(overview.windowCount)} test windows, ${overview.firstWindowTime?.slice(0, 10)} to ${overview.lastWindowTime?.slice(0, 10)} (New York)` : "";
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
        <ControlBar onReset={reset}>
          <SelectControl
            label="Dataset tag"
            value={controls.tag}
            options={(overview?.tags.length ? overview.tags : [controls.tag]).map((tag) => ({ value: tag, label: tag }))}
            onChange={(value) => set("tag", value)}
            hint="The bar timeframe and instrument the round was built on; only mnq5m has been run"
          />
        </ControlBar>
        {overview && rows.length > 0 && (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Test windows, never trained on" value={fmtInt(overview.windowCount)} hint={`${overview.firstWindowTime?.slice(0, 16)} to ${overview.lastWindowTime?.slice(0, 16)} New York`} />
              <Stat label="Mean AUC" value={fmt(headline.meanAreaUnderCurve, 4)} tone={OKABE.blue} hint={`over ${headline.scoredCount} arithmetic patterns`} />
              <Stat label="Median AUC" value={fmt(headline.medianAreaUnderCurve, 4)} tone={OKABE.blue} hint={`lowest ${fmt(headline.minimumAreaUnderCurve, 4)}, highest ${fmt(headline.maximumAreaUnderCurve, 4)}`} />
              <Stat label="Patterns above 0.95" value={`${headline.aboveCutCount} of ${headline.scoredCount}`} />
              <Stat
                label="Direction AUC, same windows"
                value={overview.direction ? fmt(overview.direction.areaUnderCurve, 4) : "not landed"}
                tone={OKABE.vermillion}
                hint={overview.direction ? `95% interval ${fmt(overview.direction.intervalLow, 4)} to ${fmt(overview.direction.intervalHigh, 4)}` : undefined}
              />
            </div>
            <Finding>
              The network that cannot predict direction (AUC {overview.direction ? fmt(overview.direction.areaUnderCurve, 3) : "≈ 0.50"}) reads candle shape almost perfectly: on {fmtInt(overview.windowCount)} test
              windows it ranks the windows that satisfy each of {headline.scoredCount} arithmetic patterns with mean AUC {fmt(headline.meanAreaUnderCurve, 4)}, {headline.aboveCutCount} of {headline.scoredCount} above 0.95.
              {weakest ? ` The hardest by average precision is ${patternLabel(weakest.pattern_name)} (a ${weakest.pattern_bar_count}-bar rule) at ${fmt(weakest.average_precision, 3)}, against a prevalence of ${fmt(weakest.prevalence, 4)}, ${fmt(precisionLift(weakest), 1)} times a random score.` : ""}
            </Finding>

            <Section title="A. Out-of-sample recognition per pattern" question="How well does the network's score rank the windows that satisfy each arithmetic rule above the ones that do not?">
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
                testLabel={testLabel}
              />
              <Finding>
                AUC is near 1 everywhere because it only asks for ranking. Average precision is the harder test when positives are rare: the diamond is what a random score would get,
                and a bar far above it means the top-scored windows really are the pattern. Rare multi-bar patterns (the stars, the soldiers and crows) sit lowest.
              </Finding>
            </Section>
          </>
        )}
      </StudyState>

      <Section title={`B. One pattern up close: ${patternLabel(pattern)}`} question="Its ROC, what a threshold flags, and how the true-positive fraction climbs with the predicted score.">
        <ControlBar>
          <SelectControl
            label="Pattern"
            value={pattern}
            options={PATTERN_NAMES.map((name) => ({ value: name, label: patternLabel(name) }))}
            onChange={pick}
          />
        </ControlBar>
        <StudyState isLoading={patternQuery.isLoading} error={patternQuery.error}>
          <StudyNotes notes={patternQuery.data?.notes ?? []} />
          {patternBody && patternBody.windowCount > 0 && (
            <PatternSection body={patternBody} controls={controls} set={(key, value) => set(key, value as never)} />
          )}
        </StudyState>
      </Section>

      {overview && rows.length > 0 && (
        <Section title="C. The control: patterns versus direction" question="Same images, same network, same split. Only the label changed, from the barrier direction to a deterministic function of the last one to three bars.">
          <ControlComparison rows={rows} direction={overview.direction} selected={pattern} tag={overview.tag} />
          <div className="mt-3 space-y-1">
            <h4 className="text-xs font-semibold text-neutral-200">How to read this</h4>
            <Finding>
              The images and the network are identical to the direction experiment; only the label changed to a pattern that is a deterministic arithmetic function of the last one
              to three bars. AUC near 1 means the CNN sees candle shape perfectly well, so the direction result (AUC ≈ 0.50) is a statement about the market, not the model.
              Average precision is compared against prevalence (the diamond in section A): AP far above prevalence means the top-scored windows really are the pattern.
            </Finding>
          </div>
          <div className="mt-3 max-h-[360px] overflow-auto rounded border border-neutral-800">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-neutral-900">
                <tr className="text-neutral-500">
                  <th className="px-2 py-1 text-left font-normal">pattern</th>
                  <th className="px-2 py-1 text-right font-normal">bars read</th>
                  <th className="px-2 py-1 text-left font-normal">the rule, from patterns.py (evaluated at the last bar of each window)</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => PATTERN_NAMES.indexOf(a.pattern_name as never) - PATTERN_NAMES.indexOf(b.pattern_name as never)).map((row) => (
                  <tr key={row.pattern_name} onClick={() => pick(row.pattern_name)} className={`cursor-pointer border-t border-neutral-900 ${row.pattern_name === pattern ? "bg-[#0072B2]/20 text-neutral-50" : "text-neutral-300 hover:bg-neutral-900"}`}>
                    <td className="px-2 py-0.5 font-mono">{row.pattern_name}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{row.pattern_bar_count}</td>
                    <td className="px-2 py-0.5">{row.rule_in_words}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {overview && rows.length > 0 && (
        <Section title="D. Every column" question="Each frame the study reads, one graphic per column, with its eight numbers.">
          <div className="space-y-4">
            <ColumnGrid rows={rows as unknown as Array<Record<string, unknown>>} exclude={["pattern_bar_count", "window_count"]} title={`Per-pattern results (${rows.length} rows)`} />
            <div className="grid gap-2 xl:grid-cols-3">
              <CountBars
                title="pattern_name: windows that satisfy each rule (the label columns)"
                rows={[...rows].sort((a, b) => b.positive_window_count - a.positive_window_count).map((row) => ({ label: patternLabel(row.pattern_name), value: row.positive_window_count }))}
                color={OKABE.orange}
                unit="positive windows"
              />
              <CountBars
                title="pattern_bar_count: how many bars each rule reads"
                rows={[1, 2, 3].map((count) => ({ label: `${count}-bar rules`, value: rows.filter((row) => row.pattern_bar_count === count).length }))}
                color={OKABE.blue}
                unit="patterns"
              />
              <MonthBars rows={overview.monthlyWindowCounts} />
            </div>
            <ColumnGrid
              rows={windowSampleRows}
              exclude={["window_id"]}
              title={`Window scores (${fmtInt(windowSampleRows.length)}-window sample of ${fmtInt(overview.windowCount)}; the 0/1 label columns are the bars above)`}
            />
          </div>
        </Section>
      )}
    </div>
  );
}
