/**
 * Market series explorer. The instrument, the span and the drawing controls
 * live in the URL; the handler slices a series it holds in memory, so moving
 * the span is fast after the first load of an instrument.
 */

import {
  ColumnGrid, ControlBar, Empty, Finding, OKABE, Section, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  EMPTY_BODY, SERIES_COLUMNS, VIEW_TIMEFRAME, paneCandidates, type ExplorerBody, type StatisticsConvention,
} from "@shared/studies/market-series-explorer";
import { AlignedPanes } from "./AlignedPanes";
import { MomentsCard, RollStepper, ShapeCard, ZscoreStepper } from "./Formulas";
import { Overview } from "./Overview";
import { RollTable } from "./RollTable";
import { RowTable } from "./RowTable";
import { StatisticsSection } from "./Statistics";
import { DEFAULTS, serverControls, splitList, toggleInList, type SetControl } from "./controls";
import { clock } from "./layout";

function PaneChips({ candidates, selected, onToggle }: { candidates: readonly string[]; selected: readonly string[]; onToggle: (column: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Panes">
      {candidates.map((column) => {
        const spec = SERIES_COLUMNS.find((item) => item.name === column);
        const on = selected.includes(column);
        return (
          <button
            key={column}
            type="button"
            aria-pressed={on}
            title={spec?.definition}
            onClick={() => onToggle(column)}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] ${on ? "border-[#E69F00] bg-[#E69F00]/15 text-neutral-50" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
          >
            {on ? "✓ " : ""}
            {column}
          </button>
        );
      })}
    </div>
  );
}

export default function Page() {
  const [controls, setControl, reset] = useStudyControls(DEFAULTS);
  const set = setControl as SetControl;
  const query = useStudyQuery<ExplorerBody>("market-series-explorer", serverControls(controls));
  const body = query.data?.data ?? EMPTY_BODY;
  const summary = body.summary;
  const span = body.span;
  const landed = body.instruments.length > 0 && summary !== null;

  const candidates = paneCandidates(body.columns);
  const panes = splitList(controls.panes).filter((column) => candidates.includes(column));
  const overlays = splitList(controls.overlays);
  const rollsInSpan = span ? body.rolls.filter((roll) => roll.timestamp >= span.startTimestamp && roll.timestamp <= span.endTimestamp) : [];
  const last = body.rows[body.rows.length - 1];
  const drawnZscore: Record<string, number | null> = {};
  for (const name of ["return_zscore", "range_zscore", "volume_zscore"]) {
    const value = last?.[name];
    drawnZscore[name] = typeof value === "number" ? value : null;
  }
  const instrumentLabel = summary ? summary.key.replace(":", " · ") : controls.instrument;
  const chosenStatistics = body.statistics.find((row) => row.column === controls.statisticsColumn);

  const title = span
    ? `${instrumentLabel} — ${fmtInt(span.barsDrawn)} candles${span.stride > 1 ? `, every ${span.stride}th bar of ${fmtInt(span.barsInSpan)}` : ""}`
    : instrumentLabel;

  const sigmaChange = summary && summary.returnStandardDeviationAdjusted && summary.returnStandardDeviationUnadjusted
    ? summary.returnStandardDeviationUnadjusted / summary.returnStandardDeviationAdjusted - 1
    : null;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!landed ? (
          <Empty>
            The lake view <span className="font-mono">bars</span> holds no {VIEW_TIMEFRAME === "1h" ? "1-minute" : ""} futures or forex bars to build the series from.
          </Empty>
        ) : (
          <>
            <ControlBar
              onReset={() => {
                reset();
              }}
            >
              <SelectControl
                label="Instrument"
                value={controls.instrument}
                options={body.instruments.map((option) => ({ value: option.key, label: `${option.root} (${option.assetClass})` }))}
                onChange={(next) => {
                  set("instrument", next);
                  set("spanStart", -1);
                  set("spanEnd", -1);
                }}
                hint="Only instruments that have 1-minute bars in the lake"
              />
              <SliderControl label="Candles drawn (about)" value={controls.targetBars} min={20} max={1000} step={10} onChange={(next) => set("targetBars", next)} hint="Thinned by taking every nth bar, never re-aggregated, so the panes keep describing the candles drawn" />
              <SwitchControl label="Log price axis" checked={controls.logPrice} onChange={(next) => set("logPrice", next)} />
              <p className="pb-1 text-[11px] text-neutral-400">
                <span className="font-mono text-neutral-200">{instrumentLabel}</span>: {fmtInt(summary.barCount)} {VIEW_TIMEFRAME} bars, {clock(summary.firstTimestamp, false)} to {clock(summary.lastTimestamp, false)},{" "}
                {summary.fromMemory ? "held in memory" : `read in ${fmt(summary.loadSeconds, 1)} s`}.
              </p>
            </ControlBar>

            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Rows per minute, raw" value={summary.interleaveRatio === null ? "unknown" : fmt(summary.interleaveRatio, 2)} hint="Minute rows per distinct minute in the lake: 1 means one contract per bar, above 1 means contracts are interleaved under one root" tone={OKABE.orange} />
              <Stat label="Contracts chained" value={fmtInt(summary.contractCount)} hint="Distinct contracts the hourly bars come from, one per day chosen by volume" />
              <Stat label="Rolls adjusted" value={fmtInt(summary.rollCount)} hint="Days the front contract changed" />
              <Stat label="Level error unadjusted" value={`${fmt((summary.cumulativeAdjustmentFactor - 1) * 100, 2)} percent`} hint="The oldest bar's adjustment factor minus 1" tone={OKABE.blue} />
            </div>
            <Finding>
              Three things hold for everything below. <strong>One contract per bar:</strong> the raw minute slice carries {summary.interleaveRatio === null ? "several" : fmt(summary.interleaveRatio, 2)} rows per
              distinct minute, so each day keeps only its most-traded contract. <strong>Roll-adjusted:</strong> left unadjusted, {fmtInt(summary.rollCount)} rolls put the oldest bar
              {" "}{fmt((summary.cumulativeAdjustmentFactor - 1) * 100, 2)} percent off the level
              {sigmaChange === null ? "." : ` while the hourly return standard deviation moves only ${fmtPercent(sigmaChange, 2)} (${fmt(summary.returnStandardDeviationAdjusted, 6)} adjusted, ${fmt(summary.returnStandardDeviationUnadjusted, 6)} not), so a volatility check never catches it.`}{" "}
              <strong>Causal:</strong> every rolling statistic needs its full 100-bar window, so the first {fmtInt(summary.warmupBarCount)} bars of the return z-score are unknown, never zero.
            </Finding>

            <Section title="History and span" question="Daily mean range z-score shows where the volatile stretches are; the shaded span is what the rest of the page describes.">
              {span ? (
                <Overview
                  key={controls.instrument}
                  overview={body.overview}
                  startIndex={span.startIndex}
                  endIndex={span.endIndex}
                  onCommit={(start, end) => {
                    set("spanStart", start);
                    set("spanEnd", end);
                  }}
                />
              ) : (
                <Empty>No days with a known range z-score.</Empty>
              )}
            </Section>

            <Section title="Candles with aligned panes" question="Every column you tick is drawn under the bar that produced it, on one shared x axis.">
              <div className="space-y-3">
                <PaneChips candidates={candidates} selected={panes} onToggle={(column) => set("panes", toggleInList(panes.join(","), column))} />
                <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                  <SwitchControl label="Mark contract rolls" checked={overlays.includes("rolls")} onChange={() => set("overlays", toggleInList(controls.overlays, "rolls"))} />
                  <SwitchControl label="Shade session hours" checked={overlays.includes("session")} onChange={() => set("overlays", toggleInList(controls.overlays, "session"))} />
                  {overlays.includes("session") && (
                    <>
                      <SliderControl label="Session from hour" value={controls.sessionStart} min={0} max={23} onChange={(next) => set("sessionStart", next)} hint="Hour of the stored clock. Futures are stamped in Pacific wall clock as if it were UTC, forex is true UTC." />
                      <SliderControl label="Session until hour" value={controls.sessionEnd} min={1} max={24} onChange={(next) => set("sessionEnd", next)} />
                    </>
                  )}
                </div>
                <AlignedPanes
                  rows={body.rows}
                  panes={panes}
                  title={`${title}${span ? ` — ${clock(span.startTimestamp, false)} to ${clock(span.endTimestamp, false)}` : ""}`}
                  logPrice={controls.logPrice}
                  rollTimestamps={rollsInSpan.map((roll) => roll.timestamp)}
                  showRolls={overlays.includes("rolls")}
                  showSession={overlays.includes("session")}
                  sessionStart={controls.sessionStart}
                  sessionEnd={controls.sessionEnd}
                />
                <Finding>
                  Prices are roll-adjusted (a label, not a level to compare across instruments); times are the lake's stored clock, which for futures is Pacific wall clock stamped as UTC. A pane
                  that shows <span className="text-[#E6E600]">N null</span> has N bars whose value is unknown, not zero.
                </Finding>
              </div>
            </Section>

            <Section title="The brushed span against the rest of history" question="Does the span you picked look like the rest of the series, in the middle of the distribution and in its tails?">
              <StatisticsSection
                statistics={body.statistics}
                histogram={body.histogram}
                column={controls.statisticsColumn}
                convention={controls.convention as StatisticsConvention}
                bins={controls.bins}
                onColumn={(next) => set("statisticsColumn", next)}
                onConvention={(next) => set("convention", next)}
                onBins={(next) => set("bins", next)}
              />
              <div className="mt-3">
                <MomentsCard convention={controls.convention as StatisticsConvention} brushed={chosenStatistics?.brushed} column={controls.statisticsColumn} />
              </div>
            </Section>

            <Section title="How the series is built" question="Step through the two sums the series depends on: the roll adjustment and the causal z-score window.">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <h4 className="text-xs font-semibold text-neutral-200">Ratio roll adjustment</h4>
                  <RollStepper key={`rolls-${controls.instrument}`} rolls={body.rolls} cumulativeAdjustmentFactor={summary.cumulativeAdjustmentFactor} />
                  <h4 className="pt-2 text-xs font-semibold text-neutral-200">Rolls inside the span</h4>
                  <RollTable rolls={rollsInSpan} />
                </div>
                <div className="min-w-0 space-y-2">
                  <h4 className="text-xs font-semibold text-neutral-200">Causal z-score</h4>
                  <ZscoreStepper
                    key={`z-${controls.instrument}-${span?.endIndex ?? 0}`}
                    examples={body.zscoreExamples}
                    column={controls.zscoreColumn}
                    onColumn={(next) => set("zscoreColumn", next)}
                    drawnZscore={drawnZscore}
                  />
                </div>
              </div>
              <div className="mt-4">
                <ShapeCard row={last} />
              </div>
            </Section>

            <Section title="Every column, for the bars drawn" question="Each numeric column as its own histogram with its eight numbers, then the rows behind them.">
              <div className="space-y-3">
                <ColumnGrid rows={body.rows} exclude={["timestamp"]} title="Every column of the drawn bars" />
                <RowTable rows={body.rows} columns={body.columns} />
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
