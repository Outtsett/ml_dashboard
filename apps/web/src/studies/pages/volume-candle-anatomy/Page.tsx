/**
 * Volume and the parts of a candle. Panels B to F and the answer read the
 * landed study (800 whole-population rows, sent once); the per-decile rows
 * and Panel A's bars are fetched as their controls move.
 */

import {
  ColumnGrid, ControlBar, Finding, OKABE, Section, SegmentControl, SelectControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { POPULATIONS, TIMEFRAMES, type VolumeCandleAnatomyBody } from "@shared/studies/volume-candle-anatomy";
import { AnswerPanel } from "./AnswerPanel";
import { ControlPanel } from "./ControlPanel";
import { DEFAULTS } from "./controls";
import { DecilePanel } from "./DecilePanel";
import { InformationPanel } from "./InformationPanel";
import { NatsPanel } from "./NatsPanel";
import { ReadingsPanel } from "./ReadingsPanel";
import { WindowPanel } from "./WindowPanel";

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const query = useStudyQuery<VolumeCandleAnatomyBody>("volume-candle-anatomy", { part: "board" });
  const board = query.data?.data.board ?? null;

  return (
    <div className="space-y-3">
      <Finding>
        <strong>What was already known.</strong> Volume against total range was measured exhaustively on 647,416 MNQ 1-minute candles: Pearson +0.803 on causal z-scores, mutual information only 1.28 times its Gaussian equivalent (so that link is linear, not a hidden regime), and volume moves the range distribution 11.0 times across deciles. That question is closed.{" "}
        <strong>What nobody had asked.</strong> Total range sums the three parts, so it cannot tell one big directional push from violent two-sided rejection. A body is price that was accepted; a wick is price that was rejected, traded and given back inside the bar. This page measures volume against those separately. Everything is causal: each trailing statistic is shifted one bar and needs a full window, so warmup rows are null, not a three-sample mean posing as a 120-sample one.
      </Finding>

      <StudyNotes notes={query.data?.notes ?? []} />
      <WindowPanel controls={controls} set={set} />

      <StudyState isLoading={query.isLoading} error={query.error}>
        {board ? (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Landed rows" value={fmtInt(board.rowCount)} hint={`recipe ${board.recipe}: timeframes x populations x readings x candle parts x deciles`} />
              <Stat label="Timeframes" value={board.timeframes.join(" ")} />
              <Stat label="Best reading (mean |Spearman|)" value={board.byEncoding[0]?.volume_encoding.replace("volume_", "") ?? "—"} tone={OKABE.orange} hint="bars closing inside their range, honest pairings" />
              <Stat label="Mean |Spearman|, best reading" value={fmt(board.byEncoding[0]?.mean_absolute_spearman, 4)} />
            </div>

            <ControlBar onReset={reset}>
              <SegmentControl label="Timeframe (B to E)" value={controls.timeframe} options={TIMEFRAMES.map((value) => ({ value, label: value }))} onChange={(value) => set("timeframe", value)} />
              <SelectControl label="Population (B to D)" value={controls.population} options={POPULATIONS.map((entry) => ({ value: entry.value, label: entry.label }))} onChange={(value) => set("population", value)} hint="The bid-ask-bounce control is the one that matters" />
              <SwitchControl label="Hide pairings that share a construction term" checked={controls.hideTautology} onChange={(value) => set("hideTautology", value)} hint="Hides the signed-volume pairings with the signed body and the wick asymmetry: they share the candle's sign by construction" />
            </ControlBar>

            <ReadingsPanel rows={board.overall} controls={controls} />
            <InformationPanel rows={board.overall} controls={controls} />
            <NatsPanel rows={board.overall} controls={controls} set={set} />
            <DecilePanel controls={controls} set={set} />
            <ControlPanel rows={board.overall} />
            <AnswerPanel board={board} />

            <Section title="Every column of the landed study" question="Each numeric column of the 800 whole-population rows as its own histogram with its eight numbers.">
              <ColumnGrid rows={board.overall} />
            </Section>
          </>
        ) : (
          !query.isLoading && (
            <p className="rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-400">
              The landed study derived_mnq_volume_candle_anatomy is not in the lake. Rebuild it with datalake scripts/build_volume_candle_anatomy.py, then refresh the derived views.
            </p>
          )
        )}
      </StudyState>
    </div>
  );
}
