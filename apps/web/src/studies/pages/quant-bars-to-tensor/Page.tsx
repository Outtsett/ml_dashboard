/**
 * From bars to a tensor. The six controls the notebook had (root, start, end,
 * normalization window, sequence length, window index) live in the URL; the
 * lake scan runs once per (root, dates, normalization window) on the server
 * and everything after it, the sequence length and the window slider, reads
 * that cached series.
 */

import {
  Empty, Finding, Section, SelectControl, Stat, StudyNotes, StudyState, ControlBar, fmt, fmtInt, fmtPercent,
  useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  FEATURE_NAMES, ROOTS, type BarsBody, type ColumnPanel, type FeatureName, type SummaryBody, type WindowBody, type WindowUnavailable,
} from "@shared/studies/quant-bars-to-tensor";
import { BarsTable } from "./BarsTable";
import { BaselineChart, SplitBar, TimelineChart } from "./charts";
import { Formulas } from "./Formulas";
import { sig, stampDay } from "./format";
import { CommitSlider, DateControl } from "./inputs";
import { StageGrid } from "./StageGrid";
import { WindowViewer } from "./WindowViewer";

const SLUG = "quant-bars-to-tensor";
const BAR_PAGE_SIZE = 25;

const EIGHT_NUMBER_COLUMNS: Array<[keyof ColumnPanel["summary"], string]> = [
  ["count", "count"], ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"], ["skewness", "skewness"],
  ["kurtosis", "excess kurtosis"], ["percentile25", "25th percentile"], ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
];

/** The notebook's distribution table: one row per z-scored feature, all eight numbers and the count. */
function EightNumberTable({ panels }: { panels: readonly ColumnPanel[] }) {
  return (
    <div className="overflow-x-auto rounded border border-neutral-800">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="px-2 py-1 text-left font-normal">feature</th>
            {EIGHT_NUMBER_COLUMNS.map(([, label]) => (
              <th key={label} className="px-2 py-1 text-right font-normal">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {panels.map((panel) => (
            <tr key={panel.name} className="border-t border-neutral-900">
              <td className="px-2 py-0.5 text-neutral-300">{panel.name}</td>
              {EIGHT_NUMBER_COLUMNS.map(([key, label]) => (
                <td key={label} className="px-2 py-0.5 text-right text-neutral-200">
                  {key === "count" ? fmtInt(panel.summary.count) : sig(panel.summary[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function baselineSentence(baseline: NonNullable<SummaryBody["baseline"]>): string {
  const zero = baseline.zeroPredictionMeanSquaredError;
  const copy = baseline.persistenceMeanSquaredError;
  const ratio = copy / zero;
  const harder = copy > zero ? "Predicting zero is the harder bar to beat" : "Copying the last return is the harder bar to beat";
  const gain = (zero - baseline.bestScaledCopyMeanSquaredError) / zero;
  const correlation = baseline.lastReturnCorrelation;
  return (
    `Predicting zero scores ${sig(zero)}; copying the last return (scaled by the target's own standard deviation, as the notebook does) scores ${sig(copy)}, ${fmt(ratio, 2)} times as much. ${harder}. ` +
    `Across the validation windows the z-scored last return and the next return have correlation ${fmt(correlation, 4)}, so even the best possible multiple of it only removes ${fmtPercent(gain, 3)} of the zero-forecast error: ` +
    `a copy scaled to the target's full spread adds its own noise on top of the target's.`
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    root: "MNQ",
    startDate: "2024-06-01",
    endDate: "2024-09-01",
    normalizationWindow: 256,
    sequenceLength: 32,
    windowIndex: -1,
    barOffset: 0,
    formulaFeature: "log_return_close",
    windowView: "heatmap",
    clip: 3,
  });
  const scan = { root: controls.root, startDate: controls.startDate, endDate: controls.endDate, normalizationWindow: controls.normalizationWindow, sequenceLength: controls.sequenceLength };

  const summaryQuery = useStudyQuery<SummaryBody>(SLUG, { part: "summary", ...scan });
  const summary = summaryQuery.data?.data;
  const landed = summary?.landed === true;
  const hasTensor = landed && summary?.tensor !== null;

  const windowQuery = useStudyQuery<WindowBody | WindowUnavailable>(SLUG, { part: "window", ...scan, windowIndex: controls.windowIndex }, { enabled: hasTensor });
  const windowData = windowQuery.data?.data;
  const windowBody = windowData && windowData.landed ? windowData : null;

  const barsQuery = useStudyQuery<BarsBody>(SLUG, { part: "bars", ...scan, barOffset: controls.barOffset, barRows: BAR_PAGE_SIZE }, { enabled: landed });
  const barsPage = barsQuery.data?.data;

  const notes = [...(summaryQuery.data?.notes ?? [])];
  const zscorePanels = summary?.stages.filter((stage) => stage.stage === "z-scored features") ?? [];
  const normalization = summary?.normalization ?? null;
  const tensor = summary?.tensor ?? null;
  const split = summary?.split ?? null;
  const baseline = summary?.baseline ?? null;
  const bars = summary?.bars ?? null;
  const windowIndex = windowBody?.windowIndex ?? tensor?.defaultWindowIndex ?? 0;

  return (
    <div className="space-y-3">
      <ControlBar onReset={reset}>
        <SelectControl label="Symbol root" value={controls.root} options={ROOTS.map((root) => ({ value: root, label: root }))} onChange={(value) => set("root", value)} hint="The futures root; the lake holds every contract month and the page keeps one per UTC day" />
        <DateControl label="Start date" value={controls.startDate} onChange={(value) => set("startDate", value)} hint="First day, inclusive" />
        <DateControl label="End date" value={controls.endDate} onChange={(value) => set("endDate", value)} hint="Last day, exclusive" />
        <CommitSlider label="Normalization window (bars)" value={controls.normalizationWindow} min={32} max={1024} step={32} onCommit={(value) => set("normalizationWindow", value)} hint="Trailing window of the z-score; released to re-scan" />
        <CommitSlider label="Sequence length (bars)" value={controls.sequenceLength} min={8} max={128} step={8} onCommit={(value) => set("sequenceLength", value)} hint="Bars in one model input window" />
      </ControlBar>

      <StudyState isLoading={summaryQuery.isLoading} error={summaryQuery.error}>
        <StudyNotes notes={notes} />
        {!landed || !bars ? (
          <Empty>No bars to show for this root and range. The lake reads 1-minute futures bars from the Iceberg table market.bars.</Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Stat label="Bars after the roll" value={fmtInt(bars.count)} hint={`${fmtInt(bars.rawBarCountBeforeRoll)} raw rows across every contract`} />
              <Stat label="Range" value={`${stampDay(bars.firstTimestampMs ?? 0)} to ${stampDay(bars.lastTimestampMs ?? 0)}`} hint="First and last bar as stamped in the lake" />
              <Stat label="Contracts" value={String(bars.contracts.length)} hint={bars.contracts.map((c) => `${c.contractSymbol}: ${fmtInt(c.barCount)} bars`).join(", ")} />
              <Stat label="Rows dropped" value={normalization ? fmtInt(normalization.droppedRowCount) : "—"} hint="Rows with any of the six z-scores unknown" />
              <Stat label="Windows" value={tensor ? `${fmtInt(tensor.windowCount)} × (${tensor.sequenceLength}, ${tensor.featureCount})` : "—"} hint="Windows of sequence length by six features" />
              <Stat label="Train · purge · validation" value={split ? `${fmtInt(split.trainWindowCount)} · ${fmtInt(split.purgeWindowCount)} · ${fmtInt(split.validationWindowCount)}` : "—"} hint="Windows in each span of the purged 70/30 split" />
            </div>

            <Section title="1. Raw bars" question="Continuous front-month 1-minute bars: one contract per UTC day, the one with the most volume that day.">
              <Finding>
                {fmtInt(bars.rawBarCountBeforeRoll)} raw rows across every contract month become {fmtInt(bars.count)} bars from {bars.contracts.length} contract{bars.contracts.length === 1 ? "" : "s"}
                ({bars.contracts.map((contract) => `${contract.contractSymbol} ${fmtInt(contract.barCount)}`).join(", ")}). The roll splices each contract's own prices, it does not back-adjust them, so the return on the first bar after a roll carries the
                calendar spread, and {fmtInt(bars.zeroRangeBarCount)} bar{bars.zeroRangeBarCount === 1 ? "" : "s"} have no range at all (high equals low). Timestamps are as stamped in the lake, where futures carry Pacific wall-clock.
              </Finding>
              {barsPage && barsPage.landed && <BarsTable page={barsPage} offset={controls.barOffset} onOffset={(value) => set("barOffset", value)} pageSize={BAR_PAGE_SIZE} />}
              <TimelineChart points={summary.timeline} contracts={bars.contracts} split={split} />
            </Section>

            <Section title="2. Six features, then a trailing z-score" question="Each bar becomes six scale-free numbers; each is standardised against its own trailing window.">
              {normalization && (
                <Finding>
                  Warmup drops the first {fmtInt(normalization.warmupRowCount)} rows, because <span className="font-mono">min_periods == window</span>: an unknown stays unknown instead of becoming a zero.
                  {normalization.unknownInsideWindowCount > 0 && (
                    <>
                      {" "}A further {fmtInt(normalization.unknownInsideWindowCount)} rows drop after warmup: a bar with no range leaves its three fraction features unknown, and every trailing window that contains it stays unknown for the next {fmtInt(summary.normalizationWindow)} bars.
                    </>
                  )}{" "}
                  {fmtInt(normalization.usableRowCount)} of {fmtInt(bars.count)} rows ({fmtPercent(normalization.usableRowCount / bars.count, 2)}) reach a window.
                </Finding>
              )}
              <h4 className="text-xs font-semibold text-neutral-200">The notebook's table: eight numbers per z-scored feature</h4>
              <Finding>Each feature is summarised over its own finite z-scores, so the counts differ. Standard deviation divides by n − 1 and skewness and kurtosis use that same deviation, exactly as quantlab's <span className="font-mono">data.distribution</span> does.</Finding>
              <EightNumberTable panels={zscorePanels} />
              <h4 className="pt-2 text-xs font-semibold text-neutral-200">Every column the pipeline builds</h4>
              <StageGrid panels={summary.stages} />
            </Section>

            <Section title="3. Windows, the purged split and two baselines" question="Window i is rows i to i + S − 1; its target is the log return on the row after. The first 70% train, a purge gap follows, the rest validate.">
              {tensor && split && baseline ? (
                <>
                  <Finding>
                    {fmtInt(tensor.windowCount)} windows of shape ({tensor.sequenceLength}, {tensor.featureCount}): train {fmtInt(split.trainWindowCount)}, purge {fmtInt(split.purgeWindowCount)}, validation {fmtInt(split.validationWindowCount)}.
                    The purge is sequence length + normalization window = {fmtInt(split.purgeWindowCount)} windows: adjacent windows share S − 1 rows, and each z-score looked back W bars.
                    {split.notebookPurgeWindowCount !== split.purgeWindowCount &&
                      ` The notebook called split_walk_forward without the normalization window, so it always purged ${fmtInt(split.notebookPurgeWindowCount)} whatever its slider said; this page uses the slider.`}
                  </Finding>
                  <SplitBar split={split} windowCount={tensor.windowCount} />
                  {tensor.windowsSpanningDroppedRows > 0 && (
                    <Finding>
                      {fmtInt(tensor.windowsSpanningDroppedRows)} of {fmtInt(tensor.windowCount)} windows ({fmtPercent(tensor.windowsSpanningDroppedRows / tensor.windowCount, 2)}) straddle a dropped bar: windows are cut from the usable rows, so their rows are consecutive usable rows,
                      not always consecutive minutes.
                    </Finding>
                  )}
                  <h4 className="pt-1 text-xs font-semibold text-neutral-200">Baselines on the {fmtInt(baseline.validationWindowCount)} validation windows</h4>
                  <Finding>{baselineSentence(baseline)}</Finding>
                  <BaselineChart baseline={baseline} />
                </>
              ) : (
                <Empty>Too few usable rows for one window of {summary.sequenceLength} bars plus its target. Widen the date range or shorten the window.</Empty>
              )}
            </Section>

            {tensor && windowBody && (
              <Section title="4. One window, and the formulas behind it" question="The exact matrix the model is fed: position in the window by the six z-scored features.">
                <WindowViewer
                  window={windowBody}
                  windowCount={tensor.windowCount}
                  index={windowIndex}
                  onIndex={(index) => set("windowIndex", index)}
                  split={split}
                  view={controls.windowView}
                  onView={(view) => set("windowView", view)}
                  clip={controls.clip}
                  onClip={(clip) => set("clip", clip)}
                />
                <Formulas
                  window={windowBody}
                  feature={(FEATURE_NAMES as readonly string[]).includes(controls.formulaFeature) ? (controls.formulaFeature as FeatureName) : "log_return_close"}
                  onFeature={(feature) => set("formulaFeature", feature)}
                  sequenceLength={summary.sequenceLength}
                  normalizationWindow={summary.normalizationWindow}
                  windowCount={tensor.windowCount}
                  split={split}
                  baseline={baseline}
                />
              </Section>
            )}
          </>
        )}
      </StudyState>
    </div>
  );
}
