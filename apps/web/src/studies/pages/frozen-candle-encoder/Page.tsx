/**
 * Why not to freeze the candle recogniser as an encoder. Controls filter or
 * re-slice what the handler returns; only the pattern, firing and window
 * length go back to the server (they choose the real window to draw).
 */

import {
  ColumnGrid, Finding, Section, Stat, StudyNotes, StudyState, OKABE, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { coordinateSummary, horizonVerdicts, type FrozenEncoderBody } from "@shared/studies/frozen-candle-encoder";
import { CoordinateSection } from "./CoordinateSection";
import { ProbeSection } from "./ProbeSection";
import { RecordedSection } from "./RecordedSection";
import { WindowSection } from "./WindowSection";

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    pattern: "hammer",
    index: 0,
    context: 5,
    bins: 30,
    coordinate: 0,
    horizon: 1,
    showNull: true,
  });
  const query = useStudyQuery<FrozenEncoderBody>("frozen-candle-encoder", {
    pattern: controls.pattern,
    index: controls.index,
    context: controls.context,
  });
  const body = query.data?.data;
  const direction = body?.direction ?? [];
  const coordinates = body?.coordinates ?? [];
  const verdicts = horizonVerdicts(direction);
  const summary = coordinateSummary(coordinates.map((row) => row.share_explained_by_the_61_labels));
  const clearCount = verdicts.filter((entry) => entry.encoderBeatsNull === true).length;
  const advantages = verdicts.map((entry) => entry.advantage).filter((v): v is number => v !== null);
  const bestAdvantage = advantages.length > 0 ? Math.max(...advantages) : null;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <Finding>
          The recommendation to freeze the recogniser as an encoder was wrong, and this page is the measurement that shows it rather than the argument that suggested it. <code>chart_cnn/synth/runs/seed0/cnn_patterns.pt</code> identifies TA-Lib candlestick patterns almost perfectly; the tempting next step is transfer learning: drop the classification head, keep the 256-number layer underneath, and hand that vector to a direction model. It works in vision. Here three reasons compound: the window is five candles (an argument), the target is a deterministic function of the input (an argument), and the encoder's scores on 2025 direction (a measurement, and the one that settles it).
        </Finding>

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Window the model saw" value="5 candles" hint="gen_synthetic.py slices every sample to its last five" />
          <Stat label="Mean share of the embedding the 61 labels explain" value={`${fmt((summary.mean ?? 0) * 100, 1)}%`} tone={OKABE.purple} hint="ridge R², 256 coordinates, fitted 2024, scored 2025" />
          <Stat label="Best encoder advantage over shuffled" value={bestAdvantage === null ? "—" : `${bestAdvantage >= 0 ? "▲ +" : "▼ "}${fmt(bestAdvantage, 4)}`} tone={OKABE.orange} hint="area under the curve, across horizons" />
          <Stat label="Horizons where the encoder clears its null" value={`${clearCount} of ${verdicts.length}`} tone={clearCount > 0 ? OKABE.orange : OKABE.blue} />
        </div>

        <Section title="Reason 1. The window is five candles, not forty-eight" question="Drag the sliders to see real MNQ windows at the width the model actually received.">
          <WindowSection
            view={body?.window ?? null}
            pattern={controls.pattern}
            index={controls.index}
            context={controls.context}
            onPattern={(value) => set("pattern", value)}
            onIndex={(value) => set("index", value)}
            onContext={(value) => set("context", value)}
          />
        </Section>

        <Section title="Reason 2. The target is a deterministic function of the input" question="How much of the 256-number embedding do the 61 labels already explain?">
          <CoordinateSection
            coordinates={coordinates}
            bins={controls.bins}
            coordinate={controls.coordinate}
            onBins={(value) => set("bins", value)}
            onCoordinate={(value) => set("coordinate", value)}
          />
        </Section>

        <Section title="Reason 3. The measurement that decides it" question="Fitted on 2024, scored once on 2025: can any feature block predict whether price is higher k candles from now?">
          <ProbeSection
            direction={direction}
            horizon={controls.horizon}
            showNull={controls.showNull}
            onHorizon={(value) => set("horizon", value)}
            onShowNull={(value) => set("showNull", value)}
          />
        </Section>

        <Section title="So what should happen to the checkpoint" question="Two uses survive; a learned candle encoder does not beat the raw numbers.">
          <RecordedSection />
        </Section>

        <Section title="Every column of the data behind this page" question={`Probe recipe ${body?.recipe ?? "not landed"}: direction rows, the 256 R² rows, and the window on screen. Times are Pacific wall clock stored as UTC.`}>
          <div className="space-y-4">
            <ColumnGrid title={`Direction probe, ${fmtInt(direction.length)} rows`} rows={direction} />
            <ColumnGrid title={`Ridge R² per coordinate, ${fmtInt(coordinates.length)} rows`} rows={coordinates} />
            <ColumnGrid title={`Window bars on screen, ${fmtInt(body?.window?.bars.length ?? 0)} rows`} rows={body?.window?.bars ?? []} exclude={["timestamp_milliseconds"]} />
          </div>
          <button type="button" onClick={reset} className="mt-2 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
            Reset every control
          </button>
        </Section>
      </StudyState>
    </div>
  );
}
