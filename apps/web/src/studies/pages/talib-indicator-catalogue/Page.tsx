/**
 * Every TA-Lib indicator on front-month MNQ bars. Replaced
 * datalake/notebooks/mnq_talib_1m.py and is generic over the three bar sets the
 * lake holds (1-minute, 1-hour, 4-hour).
 *
 * One endpoint in three parts: the catalogue (statistics, histogram and trend
 * of every column, fetched once per timeframe), a window of the wide table and
 * the thinned line series. The last two are fetched only while their tab is
 * open, so a control on one part never refetches another.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  ControlBar, Empty, Finding, OKABE, SegmentControl, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyControls,
} from "@/studies/kit";
import { TIMEFRAMES, type BarSetSummary } from "@shared/studies/talib-indicator-catalogue";
import { Catalogue } from "./Catalogue";
import { Lines } from "./Lines";
import { Patterns } from "./Patterns";
import { WideTable } from "./WideTable";
import { DEFAULTS, TIMEFRAME_LABELS, asTimeframe, useCatalogue } from "./shared";

const TABS = [
  { value: "catalogue", label: "Catalogue" },
  { value: "patterns", label: "Candlestick patterns" },
  { value: "table", label: "Wide table" },
  { value: "lines", label: "Lines" },
] as const;

const CONTRACT_COLORS = [OKABE.blue, OKABE.sky, OKABE.purple, OKABE.yellow];

/** The bar set split by contract: one segment per front-month run, its width the share of bars. */
function ContractRuns({ summary }: { summary: BarSetSummary }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] text-neutral-300">
        Front-month contracts across the {fmtInt(summary.barCount)} bars, in time order (segment width = share of bars; the boundary is the roll)
      </div>
      <div className="flex h-6 overflow-hidden rounded">
        {summary.contracts.map((run, index) => (
          <div
            key={run.contractSymbol}
            className="flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-neutral-950 font-mono text-[10px] text-neutral-950"
            style={{ width: `${(100 * run.barCount) / Math.max(1, summary.barCount)}%`, background: CONTRACT_COLORS[index % CONTRACT_COLORS.length] }}
            title={`${run.contractSymbol}: ${fmtInt(run.barCount)} bars from bar ${fmtInt(run.firstBarIndex)}, ${fmtTime(run.firstTimestamp)} to ${fmtTime(run.lastTimestamp)} (stamped clock)`}
          >
            {run.contractSymbol}
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-[10px] text-neutral-400">
        {summary.contracts.map((run) => (
          <span key={run.contractSymbol}>
            {run.contractSymbol}: {fmtInt(run.barCount)} bars ({fmt((100 * run.barCount) / Math.max(1, summary.barCount), 1)}%), {fmtTime(run.firstTimestamp)} to {fmtTime(run.lastTimestamp)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const timeframe = asTimeframe(controls.timeframe);
  const query = useCatalogue(timeframe);
  const body = query.data?.data;
  const columns = body?.columns ?? [];
  const summary = body?.summary ?? null;

  const groups = [...new Set(columns.map((column) => column.talib_group))].sort();
  const functionOutputs = new Map<string, number>();
  for (const column of columns) functionOutputs.set(column.talib_function, (functionOutputs.get(column.talib_function) ?? 0) + 1);
  const multipleOutput = [...functionOutputs.values()].filter((count) => count > 1).length;
  const empty = columns.filter((column) => column.finite_count === 0);
  const tab = TABS.some((entry) => entry.value === controls.tab) ? controls.tab : "catalogue";

  return (
    <div className="space-y-3">
      <ControlBar onReset={reset}>
        <SegmentControl
          label="Bar set"
          value={timeframe}
          options={TIMEFRAMES.map((value) => ({ value, label: TIMEFRAME_LABELS[value] }))}
          onChange={(value) => { set("timeframe", value); set("windowStart", 0); set("zoomStart", 0); set("zoomEnd", 0); set("tablePage", 1); set("patternMinimum", 0); }}
          hint="The lake holds the same 180 TA-Lib columns on 1-minute, 1-hour and 4-hour front-month MNQ bars"
        />
      </ControlBar>

      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body || !summary || columns.length === 0 ? (
          <Empty>
            The TA-Lib catalogue tables are not in the lake for this bar set. Land them with{" "}
            <code>packages/ml-engine/src/studies/talib_indicator_catalogue/build.py</code>, then refresh the derived views.
          </Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="TA-Lib functions" value={fmtInt(functionOutputs.size)} hint={`in ${groups.length} groups: ${groups.join(", ")}`} />
              <Stat label="Output columns" value={fmtInt(columns.length)} hint={`${fmtInt(multipleOutput)} functions have more than one output (MACD has three, Bollinger Bands three)`} />
              <Stat label={`Front-month bars (${TIMEFRAME_LABELS[body.timeframe]})`} value={fmtInt(summary.barCount)} hint={summary.contracts.map((run) => `${run.contractSymbol} ${fmtInt(run.barCount)}`).join(" then ")} />
              <Stat label="Columns with no value at all" value={fmtInt(empty.length)} tone={empty.length > 0 ? OKABE.orange : undefined} hint={empty.map((column) => column.column_name).join(", ") || "every column has at least one finite value"} />
              <Stat label="TA-Lib version" value={summary.talibVersion} hint={`window ${fmtTime(summary.windowStart)} to ${fmtTime(summary.windowEnd)} (stamped clock)`} />
            </div>
            <ContractRuns summary={summary} />
            <Finding>
              Every TA-Lib function was run at its default parameters on the unadjusted front-month MNQ series and each output became one column: {fmtInt(functionOutputs.size)} functions,{" "}
              {fmtInt(columns.length)} columns, {fmtInt(summary.barCount)} {TIMEFRAME_LABELS[body.timeframe]} bars from {fmtTime(summary.windowStart)} to {fmtTime(summary.windowEnd)}. This page is the
              inventory of that dataset: which columns are filled, what each one looks like, how often each candlestick pattern fires, and the bars themselves. It answers "is this column usable and
              what scale is it on" before the column is used anywhere else.
            </Finding>

            <Tabs value={tab} onValueChange={(value) => set("tab", value)}>
              <TabsList className="flex-wrap">
                {TABS.map((entry) => (
                  <TabsTrigger key={entry.value} value={entry.value} className="text-xs">
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="catalogue" className="mt-3">
                <Catalogue body={body} controls={controls} set={set} groups={groups} />
              </TabsContent>
              <TabsContent value="patterns" className="mt-3">
                <Patterns body={body} controls={controls} set={set} />
              </TabsContent>
              <TabsContent value="table" className="mt-3">
                <WideTable catalogue={body} timeframe={timeframe} controls={controls} set={set} />
              </TabsContent>
              <TabsContent value="lines" className="mt-3">
                <Lines catalogue={body} timeframe={timeframe} controls={controls} set={set} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </StudyState>
    </div>
  );
}
