/**
 * How do you know what to encode? The feature ladder, its shuffled control,
 * the four targets, the close-to-next-open gap against the spread, and
 * whether the ladder's order decides the answer. The ladder tables (28 rows
 * per ordering) go to the page whole and every control below filters them in
 * the browser; only the gap section's bins and clip reach the server.
 */

import {
  ColumnGrid, ControlBar, Empty, Finding, OKABE, Section, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  BLOCK_ORDER,
  TARGETS,
  blockLabel,
  isEarned,
  metricLabel,
  rungsOf,
  signed,
  targetLabel,
  type FeatureLadderBody,
  type LadderRow,
} from "@shared/studies/feature-ladder-what-to-encode";
import { CategoryGrid } from "./CategoryGrid";
import { CitedFigures, DataPanel, MonteCarloPanel } from "./Cited";
import { DecisionTable } from "./DecisionTable";
import { GapSection, type GapAxis } from "./GapSection";
import { IncrementMatrix } from "./IncrementMatrix";
import { LadderChart, earnedList, scoreRange } from "./LadderChart";
import { MutualInformation } from "./MutualInformation";
import { RobustnessSection } from "./RobustnessSection";

const SLUG = "feature-ladder-what-to-encode";
const DEAD_TARGETS = ["next_bar_direction", "next_open_gap"] as const;

function incrementOn(rows: readonly LadderRow[], target: string, block: string): LadderRow | undefined {
  return rowsFor(rows, target).find((row) => row.block_added === block);
}

function rowsFor(rows: readonly LadderRow[], target: string): LadderRow[] {
  return rungsOf(rows, "derivatives_first", target);
}

function ProposalTable({ rows, minimumIncrement }: { rows: readonly LadderRow[]; minimumIncrement: number }) {
  const proposals: Array<{ block: string; verdict: string }> = [
    { block: "volatility_rate_of_change", verdict: "keep: volatility clustering is the most reliable effect here, and its derivative carries what the level does not" },
    { block: "momentum_rate_of_change", verdict: "drop: acceleration of price is not informative here" },
    { block: "volume_conditioned_body", verdict: "keep, but as an execution-cost estimate rather than a direction signal (price impact, Kyle's lambda in its simplest form)" },
  ];
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-neutral-500">
          <th className="py-0.5 text-left font-normal">proposal</th>
          <th className="py-0.5 text-right font-normal">on range</th>
          <th className="py-0.5 text-right font-normal">on gap magnitude</th>
          <th className="py-0.5 text-right font-normal">earns on</th>
          <th className="py-0.5 pl-3 text-left font-normal">the notebook's verdict</th>
        </tr>
      </thead>
      <tbody>
        {proposals.map(({ block, verdict }) => {
          const range = incrementOn(rows, "next_bar_range", block);
          const magnitude = incrementOn(rows, "next_open_gap_magnitude", block);
          const earnedCount = TARGETS.filter((target) => {
            const row = incrementOn(rows, target.key, block);
            return row ? isEarned(row, minimumIncrement) : false;
          }).length;
          return (
            <tr key={block} className="border-t border-neutral-900 align-top">
              <td className="py-1 font-mono text-neutral-200">{blockLabel(block)}</td>
              <td className="py-1 text-right font-mono tnum text-neutral-200">
                {signed(range?.score_increment_over_previous_rung)} {range && isEarned(range, minimumIncrement) ? "✓" : "○"}
              </td>
              <td className="py-1 text-right font-mono tnum text-neutral-200">
                {signed(magnitude?.score_increment_over_previous_rung)} {magnitude && isEarned(magnitude, minimumIncrement) ? "✓" : "○"}
              </td>
              <td className="py-1 text-right font-mono tnum text-neutral-200">{earnedCount} of {TARGETS.length}</td>
              <td className="max-w-[26ch] py-1 pl-3 text-neutral-400">{verdict}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    target: "next_bar_range",
    showShuffle: true,
    rung: 5,
    minimumIncrement: 0,
    bins: 60,
    clip: 0.2,
    gapAxis: "meanRange",
  });
  const query = useStudyQuery<FeatureLadderBody>(SLUG, { bins: controls.bins, clip: controls.clip });
  const body = query.data?.data;
  const ladder = body?.ladder ?? [];
  const ladderFrame: Array<Record<string, unknown>> = ladder.map((row) => ({ ...row }));
  const rungs = rowsFor(ladder, controls.target);
  const top = rungs[rungs.length - 1];
  const range = scoreRange(ladder, controls.target);
  const earned = earnedList(ladder, controls.target, controls.minimumIncrement);
  const metric = metricLabel(rungs[0]?.metric ?? "");

  const passingOnDeadTargets = DEAD_TARGETS.flatMap((target) =>
    rowsFor(ladder, target)
      .filter((row) => isEarned(row, controls.minimumIncrement))
      .map((row) => ({ target, block: row.block_added, increment: row.score_increment_over_previous_rung as number })),
  );
  const largestOnDeadTargets = passingOnDeadTargets.reduce((top, entry) => Math.max(top, entry.increment), 0);
  const gapMagnitudeTop = incrementOn(ladder, "next_open_gap_magnitude", "volume_conditioned_body");
  const largestIncrement = ladder
    .filter((row) => row.ordering === "derivatives_first" && row.score_increment_over_previous_rung !== null)
    .reduce<LadderRow | null>((best, row) => (best === null || (row.score_increment_over_previous_rung as number) > (best.score_increment_over_previous_rung as number) ? row : best), null);

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <ControlBar onReset={reset}>
          <SelectControl
            label="Target"
            value={controls.target}
            options={TARGETS.map((target) => ({ value: target.key, label: target.label }))}
            onChange={(value) => set("target", value)}
            hint="The target decides the answer: the same blocks are decisive on one and worthless on another"
          />
          <SliderControl
            label="Materiality floor δ"
            value={controls.minimumIncrement}
            min={0}
            max={0.01}
            step={0.0005}
            onChange={(value) => set("minimumIncrement", value)}
            format={(value) => value.toFixed(4)}
            hint="0 is the notebook's rule (any positive increment that beats its shuffle). Raise it to ask for a gain of a stated size."
          />
        </ControlBar>

        {ladder.length === 0 ? (
          <Empty>The feature-ladder views are not landed yet, so there is nothing to draw. See the note above.</Empty>
        ) : (
          <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
            <Stat label="MNQ 5-minute bars" value={fmtInt(body?.totalBarCount)} hint="fitted 2021-2023, scored once on 2025" />
            <Stat label="Holdout rows scored" value={fmtInt(top?.test_row_count)} hint="the top rung's test rows for this target" />
            <Stat label="Blocks that earn their place" value={`${earned.length} of ${BLOCK_ORDER.length}`} hint={`on ${targetLabel(controls.target)}`} tone={earned.length > 0 ? OKABE.orange : OKABE.blue} />
            <Stat label={`Top-rung ${metric}`} value={signed(top?.score_holdout, 4)} hint={`${fmtInt(top?.feature_count)} features`} />
          </div>
        )}

        <Section title="The trap: a marginal number answers a question nobody asked" question="Volume carries 0.0616 nats about the signed body compares knowing volume against knowing nothing. No model knows nothing, and volume and range correlate +0.803, so most of it is already in a column the model has.">
          <Finding>
            The test that decides whether a feature ships is conditional, and a feature can carry real information and still be worth nothing because something already in the model says the same thing. So the honest test is a ladder, not a ranking: each rung is the rung below plus one named block, scored out of sample. Step the ladder below and watch X, Z and the increment change.
          </Finding>
          <MutualInformation rows={ladder} target={controls.target} rung={controls.rung} onRung={(value) => set("rung", value)} minimumIncrement={controls.minimumIncrement} />
        </Section>

        <Section title="A. The ladder, and the control that keeps it honest" question="Every rung also gets a shuffled control: the same rung with its newest block's rows permuted, refitted and scored five times. A block earns its place only if its increment is positive AND its score beats the best of five shuffles.">
          <ControlBar>
            <SwitchControl label="Draw the shuffled control" checked={controls.showShuffle} onChange={(value) => set("showShuffle", value)} />
          </ControlBar>
          <p className="my-1 text-[11px] text-neutral-400">
            <span style={{ color: OKABE.orange }}>● filled orange circle</span> earns its place · <span style={{ color: OKABE.orange }}>○ hollow circle</span> does not · <span style={{ color: OKABE.purple }}>▼ purple triangle, dashed</span> best of five shuffles
          </p>
          <Finding>
            {targetLabel(controls.target)}: {metric} runs from {signed(range.first, 4)} at the intercept to {signed(range.best, 4)} at its best rung.{" "}
            {earned.length > 0 ? (
              <>
                Blocks that earn their place: {earned.map((entry) => `${blockLabel(entry.block)} (${signed(entry.increment)})`).join(", ")}.
              </>
            ) : (
              <>No block earns its place on this target.</>
            )}
          </Finding>
          <LadderChart rows={ladder} target={controls.target} showShuffle={controls.showShuffle} minimumIncrement={controls.minimumIncrement} highlightRung={controls.rung} />
        </Section>

        <Section title="B. The same features, four targets, four different answers" question={`"What should I encode" has no answer until you name the target. A ✓ means the block both improved the score and beat its own shuffled control${controls.minimumIncrement > 0 ? `, by more than ${controls.minimumIncrement.toFixed(4)}` : ""}.`}>
          <IncrementMatrix rows={ladder} minimumIncrement={controls.minimumIncrement} />
          <Finding>
            Read the rows, not the columns. The notebook reads direction and the signed gap as dead and the two magnitude targets as alive.
            {passingOnDeadTargets.length > 0
              ? ` By its own two-part rule ${passingOnDeadTargets.length} block${passingOnDeadTargets.length === 1 ? "" : "s"} still pass on those two dead targets (${passingOnDeadTargets.map((entry) => `${blockLabel(entry.block)} on ${targetLabel(entry.target)}, ${signed(entry.increment)}`).join("; ")}), each by at most ${largestOnDeadTargets.toFixed(4)}, so that verdict rests on the size of the gain: set the materiality floor to ${(Math.ceil(largestOnDeadTargets * 2000) / 2000).toFixed(4)} and they all drop out.`
              : " By the two-part rule no block passes on either dead target at this floor."}
            {gapMagnitudeTop &&
              ` On the gap magnitude the volume-conditioned body adds ${signed(gapMagnitudeTop.score_increment_over_previous_rung)} against a best shuffled score of ${signed(gapMagnitudeTop.shuffled_block_score_best_of_five)} (its own score is ${signed(gapMagnitudeTop.score_holdout)}).`}
            {largestIncrement && ` The largest single increment anywhere is ${signed(largestIncrement.score_increment_over_previous_rung)}: ${blockLabel(largestIncrement.block_added)} on ${targetLabel(largestIncrement.target)}.`}
          </Finding>
          <Finding>
            A caution on scale: every target is already divided by the ten-bar average range, which removes the easy, autocorrelated part of the variance before scoring starts. That makes these R squared values much harsher than the 0.6677 that analytics/volrange/forecast.py reports for next-bar log range; the two are not comparable, and the ladder's job is the increments, not the levels.
          </Finding>
        </Section>

        <Section title="C. What your proposal actually found" question="Three proposals, three separate verdicts from the ladder.">
          <ProposalTable rows={ladder} minimumIncrement={controls.minimumIncrement} />
        </Section>

        <Section title="D. The gap you asked to forecast, against the bid-ask spread" question="Close to next open on the 2025 holdout, in ticks. The quoted spread is the notebook's figure and is not recomputed here.">
          <GapSection
            gap={body?.gap ?? null}
            bins={controls.bins}
            clip={controls.clip}
            axis={controls.gapAxis as GapAxis}
            onBins={(value) => set("bins", value)}
            onClip={(value) => set("clip", value)}
            onAxis={(value) => set("gapAxis", value)}
          />
          <Finding>
            Why it matters: body_per_unit_volume (price moved per unit of volume filled) is a price-impact estimate, and price impact is what sets the spread, so a feature built to predict direction predicts execution cost instead. That is the number for sizing an order and timing an entry, not a directional signal: the signed version of the same target stays flat at zero across every rung.
          </Finding>
        </Section>

        <Section title="E. The Monte Carlo idea, answered bluntly" question="Simulating many futures to find where the next open lands.">
          <MonteCarloPanel />
        </Section>

        <Section title="F. Does the ladder's order decide the answer?" question="A ladder gives shared information to whichever block arrives first, so the ladder was re-run with volume moved ahead of both derivatives, forcing each derivative to earn its place with volume already in the model.">
          <RobustnessSection rows={ladder} />
        </Section>

        <Section title="G. The data for what you actually asked for is on disk, unusable" question="A model that sees volume and price move at the same time, live, and updates to hold or flip.">
          <DataPanel />
        </Section>

        <Section title="The decision rule" question="Name the target first. Rank by increment, never by marginal correlation or mutual information. Every block faces a shuffled copy of itself. Score once on held-out time, never a random split. For a distribution, use a proper scoring rule.">
          <DecisionTable rows={ladder} minimumIncrement={controls.minimumIncrement} />
          <p className="mt-1 text-[10px] text-neutral-500">Dots in the order direction, range, signed gap, gap magnitude: ● earned, ○ not. The last column is the same count with volume ahead of both derivatives.</p>
        </Section>

        <Section title="Figures quoted, not recomputed" question="The notebook's other numbers, and where each came from.">
          <CitedFigures />
        </Section>

        <Section title="Every column of the ladder frames" question="Both orderings together (56 rows): each numeric column as its own histogram with its eight numbers, each other column as counts.">
          <div className="space-y-4">
            <ColumnGrid rows={ladderFrame} title="Numeric columns" />
            <CategoryGrid rows={ladderFrame} columns={["ordering", "target", "block_added", "metric", "beats_its_shuffled_control", "timeframe", "recipe"]} title="Other columns" />
          </div>
        </Section>
      </StudyState>
    </div>
  );
}
