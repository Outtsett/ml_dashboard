/**
 * Candlestick pattern census: how many candlestick patterns there are, and how
 * many of them are in the data. Replaced
 * datalake/notebooks/candlestick_pattern_census.py.
 *
 * Reads four views, all small:
 *   derived_mnq_candlestick_pattern_census               305 rows = 61 TA-Lib patterns x 5 timeframes
 *   derived_study_candlestick_pattern_census_registries  7 pattern registries, counted from source
 *   derived_study_candlestick_pattern_census_talib_provenance  the TA-Lib versions in play
 *   derived_mnq_candle_pattern_scorecard                 tests, (pattern, side) pairs, survivors
 * The last three are optional: a missing one becomes a note and an empty part
 * of the body. Every control (timeframe, holdout, candle counts, threshold) is
 * applied in the browser over the census rows.
 */

import { z } from "zod";
import { ident } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import type {
  CensusBody, CensusRow, ProvenanceRow, RegistryRow, ScorecardCrossTabulation,
} from "@shared/studies/candlestick-pattern-census";

export const CENSUS_VIEW = "derived_mnq_candlestick_pattern_census";
export const REGISTRIES_VIEW = "derived_study_candlestick_pattern_census_registries";
export const PROVENANCE_VIEW = "derived_study_candlestick_pattern_census_talib_provenance";
export const SCORECARD_VIEW = "derived_mnq_candle_pattern_scorecard";

const EMPTY: CensusBody = { rows: [], registries: [], provenance: [], scorecard: null };

const handler: StudyHandler<z.ZodObject<Record<string, never>>, CensusBody> = {
  slug: "candlestick-pattern-census",
  datasets: [CENSUS_VIEW, REGISTRIES_VIEW, PROVENANCE_VIEW, SCORECARD_VIEW],
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, [CENSUS_VIEW])).length > 0) return EMPTY;
    const { lake } = context;

    // The hive `timeframe` column can be typed as anything a value like "1m" infers to: make it text.
    const rows = await lake.query<CensusRow>(
      `SELECT * EXCLUDE (recipe) REPLACE (CAST(timeframe AS VARCHAR) AS timeframe) FROM ${ident(CENSUS_VIEW)} ORDER BY talib_pattern_number, timeframe`,
    );

    const [registriesMissing, provenanceMissing, scorecardMissing] = await Promise.all([
      missingViews(context, [REGISTRIES_VIEW]),
      missingViews(context, [PROVENANCE_VIEW]),
      missingViews(context, [SCORECARD_VIEW]),
    ]);

    const registries =
      registriesMissing.length > 0
        ? []
        : await lake.query<RegistryRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(REGISTRIES_VIEW)} ORDER BY definition_count DESC, registry_name`);
    const provenance =
      provenanceMissing.length > 0
        ? []
        : await lake.query<ProvenanceRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(PROVENANCE_VIEW)} ORDER BY source_name`);

    let scorecard: ScorecardCrossTabulation | null = null;
    if (scorecardMissing.length === 0) {
      const counted = await lake.query<{ test_count: number; pattern_side_count: number; survivor_count: number }>(
        `SELECT
           (SELECT count(*) FROM ${ident(SCORECARD_VIEW)}) AS test_count,
           (SELECT count(*) FROM (SELECT DISTINCT pattern_name, pattern_side FROM ${ident(SCORECARD_VIEW)})) AS pattern_side_count,
           (SELECT count(*) FROM ${ident(SCORECARD_VIEW)} WHERE survives_multiple_testing_correction) AS survivor_count`,
      );
      const first = counted[0];
      if (first) {
        scorecard = { testCount: first.test_count, patternSideCount: first.pattern_side_count, survivorCount: first.survivor_count };
      }
    }

    return { rows, registries, provenance, scorecard };
  },
};

export default handler;
