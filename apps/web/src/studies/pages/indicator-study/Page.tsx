/**
 * Indicator study: every TA-Lib indicator on MNQ's 2025-Q4 candles, and what
 * each says about direction. Replaced datalake/notebooks/mnq_indicator_study.py;
 * each notebook section is a tab, each widget a control kept in the URL, and
 * every number is read from the lake by GET /api/studies/indicator-study.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ControlBar, Finding, SegmentControl, Stat, StudyNotes, StudyState, fmtInt, useStudyQuery } from "@/studies/kit";
import { INDICATOR_STUDY_HORIZONS, INDICATOR_STUDY_TIMEFRAMES, type OverviewBody } from "@shared/studies/indicator-study";
import { TIMEFRAME_LABEL, timeframeOf, useIndicatorControls, type IndicatorControls, type SetIndicatorControl } from "./controls";
import { ChartTab } from "./ChartTab";
import { InspectorTab } from "./InspectorTab";
import { CorrelationTab } from "./CorrelationTab";
import { DirectionTab, PredictabilityTab } from "./PredictabilityTab";
import { CallsTab, WalkForwardTab } from "./ModelsTab";
import { CatalogueTab, DistributionsTab } from "./DistributionsTab";
import { ConditionsTab } from "./ConditionsTab";

const TABS = [
  ["chart", "1 · Candles"],
  ["inspector", "2 · Pattern inspector"],
  ["correlation", "3 · Correlation"],
  ["direction", "4 · Direction label"],
  ["predictability", "5 · Predictability"],
  ["calls", "6 · Patterns as calls"],
  ["walkForward", "7 · Walk-forward"],
  ["distributions", "8 · Distributions"],
  ["catalogue", "9 · Catalogue"],
  ["conditions", "10 · Pattern conditions"],
] as const;

export interface TabProps {
  controls: IndicatorControls;
  set: SetIndicatorControl;
  overview: OverviewBody | null;
}

function isOverview(data: unknown): data is OverviewBody {
  return typeof data === "object" && data !== null && "catalogue" in data;
}

function Tiles({ overview, controls }: { overview: OverviewBody; controls: IndicatorControls }) {
  const timeframe = timeframeOf(controls);
  const run = overview.runInformation.find((row) => row.timeframe === timeframe);
  const checks = overview.independentCheck.filter((row) => row.timeframe === timeframe);
  const agreeing = checks.reduce((total, row) => total + row.agreeing_bar_count, 0);
  const compared = checks.reduce((total, row) => total + row.compared_bar_count, 0);
  const significant = overview.familywiseThresholds
    .filter((row) => row.timeframe === timeframe && row.variant === "transformed" && row.statistic === "information_coefficient")
    .sort((a, b) => a.horizon_bars - b.horizon_bars)
    .map((row) => row.familywise_significant_count);
  return (
    <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
      <Stat
        label={`${timeframe} bars`}
        value={fmtInt(overview.barCount)}
        hint={overview.contracts.map((row) => `${row.contract_symbol} ${fmtInt(row.bar_count)}`).join(", ")}
      />
      <Stat
        label="indicators scored"
        value={run ? `${run.scored_indicator_count} of ${run.indicator_column_count}` : "—"}
        hint={run ? `${run.duplicate_indicator_count} duplicates of another column; the rest null, infinite or constant here` : undefined}
      />
      <Stat
        label="pattern agreement"
        value={compared ? `${((agreeing / compared) * 100).toFixed(2)}%` : "—"}
        hint="TA-Lib against an independent re-implementation of 6 patterns, every bar"
      />
      <Stat
        label="family-wise significant indicators"
        value={significant.length ? significant.join(", ") : "—"}
        hint="transformed values, information coefficient, at h = 1, 4, 12"
      />
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useIndicatorControls();
  const timeframe = timeframeOf(controls);
  const overviewQuery = useStudyQuery<unknown>("indicator-study", { part: "overview", timeframe });
  const overview = isOverview(overviewQuery.data?.data) ? overviewQuery.data.data : null;

  const changeTimeframe = (next: string) => {
    set("timeframe", next);
    set("windowEnd", -1);
    set("occurrence", 1);
    set("firing", 0);
    set("firingsPage", 1);
    set("pairA", "");
    set("pairB", "");
  };

  return (
    <div className="min-w-0 space-y-3">
      <ControlBar onReset={reset}>
        <SegmentControl
          label="Timeframe"
          value={timeframe}
          options={INDICATOR_STUDY_TIMEFRAMES.map((value) => ({ value, label: TIMEFRAME_LABEL[value] }))}
          onChange={changeTimeframe}
          hint="The 1-hour and 4-hour sets are the 1-minute bars resampled into UTC buckets with every TA-Lib function recomputed on them, not sampled"
        />
        <SegmentControl
          label="Direction horizon"
          value={controls.horizon}
          options={INDICATOR_STUDY_HORIZONS.map((value) => ({ value, label: `${value} bar${value > 1 ? "s" : ""} ahead` }))}
          onChange={(value) => set("horizon", value)}
        />
      </ControlBar>
      <Finding>
        Front-month MNQ, 2025-10-01 to 2025-12-31, unadjusted, one roll (MNQZ5 to MNQH6 at 2025-12-16 00:00 UTC). The 1-minute set is{" "}
        <span className="font-mono">derived_mnq_talib_1m</span>; the 1-hour and 4-hour sets are the same bars resampled into UTC buckets with every TA-Lib
        function recomputed on them: a 1-minute RSI read at the top of the hour is the RSI of fourteen minutes, so neither is sampled. The study tables were built
        once by the datalake repository&apos;s <span className="font-mono">scripts/build_mnq_indicator_study.py</span> and are served as{" "}
        <span className="font-mono">derived_study_indicator_study_*</span>.
      </Finding>
      <StudyState isLoading={overviewQuery.isLoading} error={overviewQuery.error}>
        <StudyNotes notes={overviewQuery.data?.notes ?? []} />
        {overview && <Tiles overview={overview} controls={controls} />}
      </StudyState>
      <Tabs value={controls.tab} onValueChange={(value) => set("tab", value)} className="min-w-0">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-neutral-900/60">
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="text-[11px]">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="chart"><ChartTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="inspector"><InspectorTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="correlation"><CorrelationTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="direction"><DirectionTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="predictability"><PredictabilityTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="calls"><CallsTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="walkForward"><WalkForwardTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="distributions"><DistributionsTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="catalogue"><CatalogueTab controls={controls} set={set} overview={overview} /></TabsContent>
        <TabsContent value="conditions"><ConditionsTab controls={controls} set={set} overview={overview} /></TabsContent>
      </Tabs>
    </div>
  );
}
