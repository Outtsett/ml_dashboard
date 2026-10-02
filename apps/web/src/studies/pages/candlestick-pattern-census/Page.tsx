/**
 * Candlestick pattern census. The server sends the 305 census rows once; every
 * control (timeframe, holdout split, candle counts, threshold, bins) re-selects
 * and re-counts here in the browser, exactly as the notebook's reactive cells did.
 */

import {
  ControlBar, Finding, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl, OKABE,
  fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  CANDLE_COUNTS, TIMEFRAME_ORDER, acrossTimeframes, barReadings, effectiveThreshold, lengthBreakdown, neverFires, selectView,
  singleSided, summationTerms, viewCounts, type CensusBody, type TimeframeChoice,
} from "@shared/studies/candlestick-pattern-census";
import { FiringChart, LengthCharts, RegistryChart, SideChart } from "./charts";
import { CensusColumns } from "./Columns";
import { MultiToggle, PresenceLegend } from "./parts";
import { Summation } from "./Summation";
import { CensusTable, NamedPatternsTable, ProvenanceTable } from "./Tables";

const TIMEFRAME_OPTIONS = [{ value: "all", label: "all pooled" }, ...TIMEFRAME_ORDER.map((timeframe) => ({ value: timeframe as string, label: timeframe }))];
const MEASURABLE_FIRINGS = 60;
/** The four shapes traders call one-candle patterns that TA-Lib forms from two candles. */
const TWO_CANDLE_SHAPES = ["CDLHAMMER", "CDLHANGINGMAN", "CDLINVERTEDHAMMER", "CDLSHOOTINGSTAR"];

function parseSizes(text: string): number[] {
  const sizes = text.split(",").map(Number).filter((value) => (CANDLE_COUNTS as readonly number[]).includes(value));
  return sizes.length > 0 ? sizes : [...CANDLE_COUNTS];
}

function asTimeframe(text: string): TimeframeChoice {
  return text === "all" || (TIMEFRAME_ORDER as readonly string[]).includes(text) ? (text as TimeframeChoice) : "all";
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    timeframe: "all",
    holdout: false,
    minimum: 60,
    sizes: "1,2,3,4,5",
    step: 1,
    bins: 20,
    logScale: true,
    dropNever: false,
    estimator: "notebook",
  });
  const query = useStudyQuery<CensusBody>("candlestick-pattern-census");
  const body = query.data?.data;
  const rows = body?.rows ?? [];
  const hasData = rows.length > 0;

  // Population-level facts, which no control changes.
  const totals = acrossTimeframes(rows);
  const patternCount = totals.length;
  const dead = neverFires(totals);
  const fireCount = totals.filter((entry) => entry.firingCountAllTimeframes > 0).length;
  const singleCandle = totals.filter((entry) => entry.candle_count === 1);
  const allFirings = totals.reduce((sum, entry) => sum + entry.firingCountAllTimeframes, 0);
  const oneCandleFirings = singleCandle.reduce((sum, entry) => sum + entry.firingCountAllTimeframes, 0);
  const measurableAtOneMinute = rows.filter((row) => row.timeframe === "1m" && row.firing_count_holdout_2025 >= MEASURABLE_FIRINGS).length;
  const pooledMeasurable = totals.filter((entry) => entry.firingCountAllTimeframes >= MEASURABLE_FIRINGS).length;
  const bars = barReadings(rows);
  const lengths = lengthBreakdown(totals);
  const talibProvenance = body?.provenance.find((row) => row.source_name.startsWith("datalake interpreter"));
  const talibVersion = talibProvenance?.talib_version ?? "0.7.1";
  const talibFunctionCount = talibProvenance?.library_function_count ?? null;

  // What the controls select.
  const sizes = parseSizes(controls.sizes);
  const timeframe = asTimeframe(controls.timeframe);
  const view = selectView(rows, { timeframe, holdoutOnly: controls.holdout, candleCounts: sizes });
  const counts = viewCounts(view.patterns, controls.minimum);
  const threshold = effectiveThreshold(controls.minimum);
  const terms = summationTerms(view.patterns, controls.minimum);
  const stepped = Math.min(Math.max(1, controls.step), Math.max(1, terms.length));
  const atSixty = view.patterns.filter((entry) => entry.firingCountSelected >= MEASURABLE_FIRINGS).length;
  const thin = counts.thin;
  const singleSidedPatterns = singleSided(view.patterns);
  const split = controls.holdout ? "2025 holdout only" : "2021–2025, every bar";
  const sizeLabel = view.candleSizes.map((size) => `${size}-candle`).join(", ");
  const twoCandle = TWO_CANDLE_SHAPES.map((name) => totals.find((entry) => entry.talib_function === name)).filter((entry) => entry !== undefined);

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!hasData ? (
          <p className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-4 text-xs text-neutral-300">
            The census has not been landed in the lake, so there is nothing to count. It is built by datalake
            <span className="font-mono"> scripts/build_candlestick_pattern_census.py</span> into
            <span className="font-mono"> derived/mnq_candlestick_pattern_census</span>.
          </p>
        ) : (
          <>
            <Finding>
              Three numbers get called <em>the</em> number of candlestick patterns, and they answer different questions. <strong>What a library defines:</strong> TA-Lib {talibVersion} ships{" "}
              <strong>{patternCount}</strong> candlestick functions{talibFunctionCount !== null && `, out of ${fmtInt(talibFunctionCount)} in the library`}; that is fixed by its C source, not by any data.{" "}
              <strong>What the market produced:</strong> all {patternCount} are computed over MNQ 2021–2025 on five timeframes ({fmtInt(bars)} bar readings), and <strong>{fireCount}</strong> fire at least once;{" "}
              {dead.length} never fire anywhere. <strong>What can be measured:</strong> the scorecard wants {MEASURABLE_FIRINGS} firings on the 2025 holdout before it measures a pattern side, and{" "}
              <strong>{measurableAtOneMinute}</strong> patterns clear that at 1-minute; {patternCount - measurableAtOneMinute} do not.
            </Finding>

            <div className="grid gap-2 grid-cols-2 xl:grid-cols-6">
              <Stat label="TA-Lib defines" value={fmtInt(patternCount)} hint="Fixed by the library's C source" />
              <Stat label="One-candle patterns" value={fmtInt(singleCandle.length)} hint="Of the patterns TA-Lib defines, how many read one bar" />
              <Stat label="Fire at least once" value={fmtInt(fireCount)} tone={OKABE.orange} hint="Summed over MNQ 2021-2025 and five timeframes" />
              <Stat label="Never fire" value={fmtInt(dead.length)} tone={OKABE.blue} hint={dead.join(", ")} />
              <Stat label={`Measurable at 1m (≥${MEASURABLE_FIRINGS} holdout)`} value={fmtInt(measurableAtOneMinute)} hint="Patterns with at least 60 firings on the 2025 holdout at 1-minute" />
              <Stat label="Bar readings scanned" value={fmtInt(bars)} hint="One pattern's scanned bars, summed over the five timeframes" />
            </div>

            <ControlBar onReset={reset}>
              <SegmentControl label="Timeframe" value={controls.timeframe} options={TIMEFRAME_OPTIONS} onChange={(value) => set("timeframe", value)} />
              <SwitchControl label="Count only the 2025 holdout split" checked={controls.holdout} onChange={(value) => set("holdout", value)} />
              <MultiToggle
                label="Candles the pattern is made of"
                values={CANDLE_COUNTS}
                selected={sizes}
                onChange={(next) => set("sizes", next.join(","))}
                hint="Set it to 1 alone and every panel below is about one-candle shapes"
              />
              <SliderControl
                label="Minimum firings before a pattern counts as present"
                value={controls.minimum}
                min={0}
                max={2000}
                step={10}
                onChange={(value) => set("minimum", value)}
                hint="A value of 0 still needs one firing"
              />
            </ControlBar>

            <Section title="In view" question={`Candlestick patterns counted on ${timeframe === "all" ? "all timeframes pooled" : timeframe}, ${split}, for the ${sizeLabel} lengths selected.`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <tbody>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Candlestick patterns TA-Lib {talibVersion} defines, every length</td><td className="py-1 text-right font-mono tnum">{fmtInt(patternCount)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">…of those, {sizeLabel}</td><td className="py-1 text-right font-mono tnum">{fmtInt(counts.inView)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Bar readings scanned ({timeframe === "all" ? "all timeframes pooled" : timeframe}, {split})</td><td className="py-1 text-right font-mono tnum">{fmtInt(view.barsInView)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Of the {counts.inView} in view, fire at least once</td><td className="py-1 text-right font-mono tnum" style={{ color: OKABE.orange }}>● {fmtInt(counts.fireAtLeastOnce)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">…fire at least {fmtInt(threshold)} times</td><td className="py-1 text-right font-mono tnum" style={{ color: OKABE.orange }}>● {fmtInt(counts.present)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">…below that bar</td><td className="py-1 text-right font-mono tnum" style={{ color: OKABE.blue }}>◐ {fmtInt(counts.below)}</td></tr>
                  </tbody>
                </table>
              </div>
              <Finding>
                Set the candle counts to 1 to get the individual patterns: “{patternCount} patterns” is a mixed bag, with one-candle shapes in the same list as two-, three-, four- and five-candle
                formations, and only {singleCandle.length} of the {patternCount} are a single candle. Drag the firing threshold from 1 to {MEASURABLE_FIRINGS} and the count falls from {counts.fireAtLeastOnce} to {atSixty} without a
                line of code changing; only the {patternCount} on the top row is a property of TA-Lib.
              </Finding>
            </Section>

            <Section title="The count, written out" question="Step the index p through the sum and watch each term light up in the running total.">
              <Summation
                terms={terms}
                threshold={controls.minimum}
                timeframe={timeframe}
                holdoutOnly={controls.holdout}
                candleSizes={view.candleSizes}
                step={stepped}
                onStep={(value) => set("step", value)}
              />
            </Section>

            <Section title="How many candles is a “pattern”?" question="TA-Lib mixes five lengths in one list; the count of individual patterns, shapes read off a single bar, is much smaller.">
              <Finding>
                Four shapes traders name as one-candle patterns are multi-candle rules in TA-Lib, because the C implementation compares the bar against its predecessor:{" "}
                {twoCandle.length > 0
                  ? twoCandle.map((entry) => `${entry.talib_function} (${entry.candle_count}-candle)`).join(", ")
                  : TWO_CANDLE_SHAPES.join(", ")}
                . They are counted under their TA-Lib length below, not under 1.
              </Finding>
              <LengthCharts rows={lengths} />
              <Finding>
                Build the feature set from the {singleCandle.length} one-candle rules and treat the other {patternCount - singleCandle.length} as compositions of them. The {singleCandle.length} individual patterns carry{" "}
                {fmtPercent(oneCandleFirings / Math.max(1, allFirings))} of all pattern firings in MNQ 2021–2025, {singleCandle.every((entry) => entry.firingCountAllTimeframes > 0) ? "every one of them fires" : "not all of them fire"},
                and each is a function of a single bar&apos;s open, high, low and close, so it needs no lookback and has no roll-gap hazard.
              </Finding>
              <h4 className="pt-1 text-[11px] font-semibold text-neutral-300">The {view.patterns.length} patterns of length {view.candleSizes.join(", ")}, named</h4>
              <NamedPatternsTable patterns={view.patterns} />
            </Section>

            <Section title="Every pattern, by how often it fired" question={`Firing count on the selected view (${timeframe === "all" ? "all timeframes pooled" : timeframe}, ${split}), against the threshold of ${fmtInt(threshold)}.`}>
              <PresenceLegend />
              <FiringChart patterns={view.patterns} threshold={controls.minimum} />
              <Finding>
                Delete the {counts.dead.length} never-firing columns from <span className="font-mono">build_mnq_next_candles.py</span>&apos;s output rather than carrying them as zeros. On this view {counts.dead.length} pattern columns hold nothing but zeros
                ({counts.dead.length > 0 ? counts.dead.join(", ") : "none"}), and {thin} more fire too rarely to be measured. The axis is symmetric-log because the range runs from 0 to hundreds of thousands: on a linear axis
                every pattern below the first few is a line of invisible pixels.
              </Finding>
            </Section>

            <Section title="Which side each pattern fires on" question="TA-Lib emits a signed integer: positive for the bullish reading, negative for the bearish one. Some patterns are single-sided by construction.">
              <SideChart patterns={view.patterns} />
              <Finding>
                Treat a pattern and its side as one unit when counting hypotheses. {singleSidedPatterns.length} of the patterns in view fired on one side only, so “{patternCount} patterns” is not “{patternCount * 2} tests”
                {body?.scorecard
                  ? `: the scorecard's own family is ${fmtInt(body.scorecard.patternSideCount)} distinct (pattern, side) pairs, which is the number a multiple-testing correction has to pay for, not ${patternCount} and not ${patternCount * 2}.`
                  : "."}
              </Finding>
            </Section>

            <Section title="Every column in the census, one panel each" question="One row per (pattern, timeframe). Every numeric column is a distribution and every categorical column a count, labelled with its full name.">
              <CensusColumns
                rows={rows}
                bins={controls.bins}
                logScale={controls.logScale}
                dropNever={controls.dropNever}
                estimator={controls.estimator === "dashboard" ? "dashboard" : "notebook"}
                onBins={(value) => set("bins", value)}
                onLogScale={(value) => set("logScale", value)}
                onDropNever={(value) => set("dropNever", value)}
                onEstimator={(value) => set("estimator", value)}
              />
              <Finding>
                Read <span className="font-mono">firing_count_total</span> through its median, not its mean. Its skewness sits far above zero because a dozen patterns fire hundreds of thousands of times and the rest fire in the
                hundreds; any sizing rule built off the mean firing rate is sized for patterns that do not exist.
              </Finding>
            </Section>

            <Section title="“How many patterns” also depends on which registry you ask" question="Seven pattern vocabularies live on this machine. They are not the same list and must never be pooled into one count: the bars are definition counts, each counted from its source.">
              {body && body.registries.length > 0 ? <RegistryChart registries={body.registries} /> : <p className="text-xs text-neutral-500">The registry counts are not landed yet (see the note above).</p>}
              {body && body.provenance.length > 0 && (
                <div className="space-y-1 pt-2">
                  <h4 className="text-[11px] font-semibold text-neutral-300">Which TA-Lib</h4>
                  <ProvenanceTable rows={body.provenance} />
                  <Finding>
                    The census was computed with TA-Lib {talibVersion}; the chart&apos;s pattern drawings are verified against a newer library. Both define the same {patternCount} candlestick functions, and this page does not claim
                    the two agree on every bar: nothing reconciles the {body.registries.find((row) => row.registry_name.startsWith("ml_dashboard chart-overlay"))?.definition_count ?? "hand-written"} TypeScript detectors the chart draws with the
                    {" "}{patternCount} TA-Lib rules the scorecard measures.
                  </Finding>
                </div>
              )}
              <Finding>
                Point every new pattern consumer at TA-Lib&apos;s {patternCount}, and treat the chart&apos;s <span className="font-mono">registry.ts</span> as a rendering layer only. The TypeScript detectors are hand-written and share names but not
                rules with TA-Lib, so a chart overlay drawn from them and a scorecard row measured from TA-Lib can disagree about whether the same bar is a hammer.
              </Finding>
            </Section>

            <Section title="The census table itself" question="One row per (pattern, timeframe).">
              <CensusTable rows={rows} />
            </Section>

            <Section title="The answer, in one line each" question="Fixed facts of the data: none of the controls above change these.">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="py-1 font-normal">question</th>
                      <th className="py-1 text-right font-normal">answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Candlestick patterns TA-Lib {talibVersion} defines</td><td className="py-1 text-right font-mono tnum">{fmtInt(patternCount)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">TA-Lib functions in total (all groups)</td><td className="py-1 text-right font-mono tnum">{fmtInt(talibFunctionCount)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Patterns that fire at least once in MNQ 2021–2025</td><td className="py-1 text-right font-mono tnum">{fmtInt(fireCount)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Patterns that never fire anywhere</td><td className="py-1 text-right font-mono tnum">{fmtInt(dead.length)} — {dead.join(", ") || "none"}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Patterns firing ≥ {MEASURABLE_FIRINGS} times pooled over the five timeframes</td><td className="py-1 text-right font-mono tnum">{fmtInt(pooledMeasurable)}</td></tr>
                    <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Patterns with ≥ {MEASURABLE_FIRINGS} firings on the 2025 holdout at 1-minute, i.e. measurable</td><td className="py-1 text-right font-mono tnum">{fmtInt(measurableAtOneMinute)}</td></tr>
                    {body?.scorecard && (
                      <>
                        <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Distinct (pattern, side) pairs the scorecard measured <span className="text-neutral-600">(from the scorecard dataset)</span></td><td className="py-1 text-right font-mono tnum">{fmtInt(body.scorecard.patternSideCount)}</td></tr>
                        <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Rows in the scorecard: pattern × side × timeframe × horizon</td><td className="py-1 text-right font-mono tnum">{fmtInt(body.scorecard.testCount)}</td></tr>
                        <tr className="border-t border-neutral-900"><td className="py-1 text-neutral-400">Of those tests, survivors after Benjamini-Yekutieli</td><td className="py-1 text-right font-mono tnum" style={{ color: body.scorecard.survivorCount > 0 ? OKABE.orange : OKABE.blue }}>{fmtInt(body.scorecard.survivorCount)}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <Finding>
                Stop adding pattern definitions and start pruning them. The vocabulary is already {patternCount} rules deep
                {body?.scorecard && `, ${fmtInt(body.scorecard.testCount)} tests were run across it, and ${body.scorecard.survivorCount === 0 ? "none" : fmtInt(body.scorecard.survivorCount)} survived a multiple-testing correction`}
                ; the next useful move is cutting the {dead.length} dead columns and the rules that fire too rarely to be measured, not enumerating another pattern.
              </Finding>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
