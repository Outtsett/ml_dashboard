/**
 * Vector-space explainer: what PC1, PC2 and HNSW are, on the Lens run's own
 * bars. Replaced Trading/quant/model/notebooks/vector_space_explained.py.
 *
 * Reads the six tables of derived_study_vector_space_explained_* (landed by
 * packages/ml-engine/src/studies/vector_space_explained/build.py from the Lens run
 * multimodal_MNQ_1h). The 4,000 x 32 z-scored feature matrix goes to the page
 * whole (about 1 MB), pivoted to one comma-joined series per feature so the
 * browser can move a slider and recompute the shadows, the eigen-decomposition
 * and the HNSW walk itself; the landed spectrum, loadings and recall go as they
 * are. Nothing the browser sends reaches SQL: the query has no parameters.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident } from "../sql";
import type { StudyHandler } from "../types";
import {
  EMPTY_BODY, blockRank, parseSeries,
  type LoadingRow, type RecallRow, type RunInformation, type SpectrumRow, type VectorSpaceBody,
} from "@shared/studies/vector-space-explained";

const PREFIX = "derived_study_vector_space_explained_";
const TABLES = ["standardized_features", "component_spectrum", "component_loadings", "neighbour_index_recall", "walk_node_layers", "run_information"] as const;
const VIEWS = TABLES.map((table) => `${PREFIX}${table}`);

interface SeriesRow {
  feature_name: string;
  block_name: string;
  series: string;
}

const handler: StudyHandler<z.ZodObject<Record<string, never>>, VectorSpaceBody> = {
  slug: "vector-space-explained",
  datasets: VIEWS,
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return EMPTY_BODY;
    const lake = context.lake;
    const view = (table: (typeof TABLES)[number]) => ident(`${PREFIX}${table}`);

    const [seriesRows, barRows, spectrum, loadings, recall, layers, information] = await Promise.all([
      lake.query<SeriesRow>(
        `SELECT feature_name, block_name, string_agg(CAST(ROUND(value, 5) AS VARCHAR), ',' ORDER BY bar_index) AS series
         FROM ${view("standardized_features")} GROUP BY feature_name, block_name`,
      ),
      lake.query<{ series: string }>(
        `SELECT string_agg(CAST(bar_index AS VARCHAR), ',' ORDER BY bar_index) AS series
         FROM (SELECT DISTINCT bar_index FROM ${view("standardized_features")})`,
      ),
      lake.query<SpectrumRow>(`SELECT * EXCLUDE (recipe) FROM ${view("component_spectrum")} ORDER BY basis, component_number`),
      lake.query<LoadingRow>(`SELECT * EXCLUDE (recipe) FROM ${view("component_loadings")} ORDER BY basis, component_number, feature_name`),
      lake.query<RecallRow>(`SELECT * EXCLUDE (recipe) FROM ${view("neighbour_index_recall")} ORDER BY basis, ef_search`),
      lake.query<{ node_index: number; layer: number }>(`SELECT node_index, layer FROM ${view("walk_node_layers")} ORDER BY node_index`),
      lake.query<RunInformation>(`SELECT * EXCLUDE (recipe) FROM ${view("run_information")} LIMIT 1`),
    ]);

    const barIndex = parseSeries(barRows[0]?.series) ?? [];
    const features: Array<{ name: string; block: string; values: number[] }> = [];
    for (const row of seriesRows) {
      const values = parseSeries(row.series);
      if (values === null || values.length !== barIndex.length) {
        context.notes.push(`Feature ${row.feature_name} has ${values === null ? "an unreadable series" : `${values.length} values for ${barIndex.length} bars`} and was left out.`);
        continue;
      }
      features.push({ name: row.feature_name, block: row.block_name, values });
    }
    features.sort((a, b) => blockRank(a.block) - blockRank(b.block) || a.name.localeCompare(b.name));

    return {
      run: information[0] ?? null,
      featureNames: features.map((feature) => feature.name),
      featureBlocks: features.map((feature) => feature.block),
      barIndex,
      values: features.map((feature) => feature.values),
      spectrum,
      loadings,
      recall,
      nodeLayers: layers.map((row) => Number(row.layer)),
    };
  },
};

export default handler;
