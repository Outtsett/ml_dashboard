/**
 * The candle vocabulary, and what it is worth. Replaced
 * Trading/quant/model/notebooks/candle_vocab.py.
 *
 * Reads four small tables landed by packages/ml-engine/src/studies/candle_vocabulary/build.py
 * from the stored results of two finished experiments (train_candle_seq.py and
 * train_candle_lm.py): 8 sequence rows, 192 archetype rows (24 codes x 4 bars x
 * 2 sets), 10 language-model rows and 6 direction rows. They are tiny, so every
 * row goes to the page and its controls filter in the browser.
 */

import { z } from "zod";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import type { CandleVocabularyBody } from "@shared/studies/candle-vocabulary";
import { EMPTY_BODY } from "@shared/studies/candle-vocabulary";

const SEQUENCE_VIEW = "derived_study_candle_vocabulary_sequence_results";
const ARCHETYPE_VIEW = "derived_study_candle_vocabulary_archetypes";
const LANGUAGE_MODEL_VIEW = "derived_study_candle_vocabulary_language_model_results";
const DIRECTION_VIEW = "derived_study_candle_vocabulary_language_model_direction";

const VIEWS = [SEQUENCE_VIEW, ARCHETYPE_VIEW, LANGUAGE_MODEL_VIEW, DIRECTION_VIEW] as const;

const handler: StudyHandler<z.ZodObject<Record<string, never>>, CandleVocabularyBody> = {
  slug: "candle-vocabulary",
  datasets: [...VIEWS],
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return EMPTY_BODY;
    const [sequenceResults, archetypes, languageModel, languageModelDirection] = await Promise.all([
      context.lake.query<CandleVocabularyBody["sequenceResults"][number]>(
        `SELECT * EXCLUDE (recipe) FROM "${SEQUENCE_VIEW}" ORDER BY run_name, stored_model_name`,
      ),
      context.lake.query<CandleVocabularyBody["archetypes"][number]>(
        `SELECT * EXCLUDE (recipe) FROM "${ARCHETYPE_VIEW}" ORDER BY run_name, code, bar_position`,
      ),
      context.lake.query<CandleVocabularyBody["languageModel"][number]>(
        `SELECT * EXCLUDE (recipe) FROM "${LANGUAGE_MODEL_VIEW}" ORDER BY symbol_stride_bars, stored_model_name`,
      ),
      context.lake.query<CandleVocabularyBody["languageModelDirection"][number]>(
        `SELECT * EXCLUDE (recipe) FROM "${DIRECTION_VIEW}" ORDER BY symbol_stride_bars, stored_model_name`,
      ),
    ]);
    if (sequenceResults.length === 0) context.notes.push("The sequence experiment's result files were not found when the tables were landed.");
    return { sequenceResults, archetypes, languageModel, languageModelDirection };
  },
};

export default handler;
