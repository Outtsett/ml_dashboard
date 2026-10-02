/**
 * The candle vocabulary, and what it is worth. Four small tables (8 sequence,
 * 192 archetype, 10 language-model and 6 direction rows) come from one request;
 * every control filters them in the browser.
 */

import { Link } from "wouter";
import { Empty, Finding, Section, StudyNotes, StudyState, ColumnGrid, useStudyQuery } from "@/studies/kit";
import type { CandleVocabularyBody } from "@shared/studies/candle-vocabulary";
import { ArchetypeSection } from "./ArchetypeSection";
import { LanguageModelSection } from "./LanguageModelSection";
import { SequenceSection } from "./SequenceSection";

const RELATED_VIEWS = [
  "derived_mnq_candle_shape_embedding_1m",
  "derived_mnq_candle_shape_embedding_1h",
  "derived_mnq_candle_shape_embedding_4h",
  "derived_mnq_candle_windows_1m",
  "derived_mnq_frozen_encoder_probe",
  "derived_mnq_single_candle_recognizer_study",
];

export default function Page() {
  const query = useStudyQuery<CandleVocabularyBody>("candle-vocabulary");
  const body = query.data?.data;
  const empty = !body || body.sequenceResults.length === 0;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {empty ? (
          <Empty>The stored results of train_candle_seq.py and train_candle_lm.py have not been landed in the lake yet.</Empty>
        ) : (
          <>
            <Section title="What this is" question="A Conv1d VQ-VAE fitted on candle geometry; its codebook is a dictionary of K archetypes: multi-bar shapes that recur often enough to earn a symbol.">
              <div className="space-y-2">
                <Finding>
                  Every bar is assigned to exactly one archetype. Two experiments use the dictionary. <strong>train_candle_seq.py</strong> uses the symbols as an <em>input</em> to predict the log of forward realized
                  volatility against HAR-RV: it works, but only once the geometry carries magnitude. <strong>train_candle_lm.py</strong> asks a masked transformer to predict the <em>next symbol</em>: it fails, because once
                  symbols describe disjoint bars nothing beats guessing the commonest one; the apparent structure in an earlier run was window overlap.
                </Finding>
                <Finding>
                  <strong>The one thing to take away.</strong> The candle geometry divides every channel by the bar&apos;s own range. That is what makes an archetype comparable across price levels, and it also deletes size
                  entirely, so a pure-shape dictionary cannot express a magnitude target no matter how it is embedded.
                </Finding>
              </div>
            </Section>

            <SequenceSection rows={body.sequenceResults} />
            <ArchetypeSection rows={body.archetypes} />
            <LanguageModelSection rows={body.languageModel} direction={body.languageModelDirection} />

            <Section title="D. Every column of every table" question="Each numeric column of the four landed tables, as its own histogram with its eight numbers.">
              <div className="space-y-4">
                <ColumnGrid title="Sequence results (8 rows)" rows={body.sequenceResults} exclude={["random_seed"]} />
                <ColumnGrid title="Archetype channels (one row per archetype and bar)" rows={body.archetypes} />
                <ColumnGrid title="Language-model results (10 rows)" rows={body.languageModel} />
                <ColumnGrid title="Language-model direction (6 rows)" rows={body.languageModelDirection} />
              </div>
            </Section>

            <Section title="Where the numbers come from" question="Stored results, not refit here.">
              <div className="space-y-2">
                <Finding>
                  Landed by packages/ml-engine/src/studies/candle_vocabulary/build.py from {[...new Set(body.sequenceResults.map((row) => row.source_file))].length} sequence files,{" "}
                  {[...new Set(body.archetypes.map((row) => row.source_file))].length} archetype files and {[...new Set(body.languageModel.map((row) => row.source_file))].length} language-model files as
                  derived_study_candle_vocabulary_&lt;table&gt;. The notebook this replaces pointed at a folder that does not exist and showed &quot;No results yet&quot;.
                </Finding>
                <p className="text-[11px] text-neutral-400">
                  A different study, already served: {RELATED_VIEWS.map((view) => (
                    <span key={view} className="mr-2 font-mono text-neutral-300">{view}</span>
                  ))}
                  (the frozen-encoder probe and the single-candle recognizer). See the{" "}
                  <Link href="/studies/candle-vectors" className="text-[#56B4E9] hover:underline">candle vectors study</Link> and the{" "}
                  <Link href="/studies/single-candle-recognizer" className="text-[#56B4E9] hover:underline">single-candle recognizer</Link>.
                </p>
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
