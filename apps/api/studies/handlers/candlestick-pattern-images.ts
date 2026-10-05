/**
 * Candlestick pattern images: the 88 pictures (61 patterns x the directions each fires in) landed by
 * packages/ml-engine/src/studies/candlestick_pattern_images/build.py — about 1 MB, sent whole; the page filters.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident } from "../sql";
import type { StudyHandler } from "../types";
import { PATTERN_IMAGES_VIEW, type PatternImage, type PatternImagesBody } from "@shared/studies/candlestick-pattern-images";

const query = z.object({});

const handler: StudyHandler<typeof query, PatternImagesBody> = {
  slug: "candlestick-pattern-images",
  datasets: [PATTERN_IMAGES_VIEW],
  query,
  cacheSeconds: 3600,
  async run(_query, context) {
    if ((await missingViews(context, [PATTERN_IMAGES_VIEW])).length > 0) return { images: [] };
    const view = ident(PATTERN_IMAGES_VIEW);
    // the newest landed recipe only, chosen here: DuckDB 1.x raised an internal error on a
    // max(recipe) subquery over this hive-partitioned view
    const rows = await context.lake.query<PatternImage & { recipe: string }>(`SELECT * FROM ${view}`);
    const newest = rows.reduce((best, row) => (row.recipe > best ? row.recipe : best), "");
    const images: PatternImage[] = rows
      .filter((row) => row.recipe === newest)
      .map(({ recipe: _recipe, ...row }) => row)
      .sort((a, b) => a.pattern.localeCompare(b.pattern) || a.direction.localeCompare(b.direction));
    const silent = [...new Set(images.filter((row) => !row.image_png_base64).map((row) => row.pattern))]
      .filter((pattern) => images.every((row) => row.pattern !== pattern || !row.image_png_base64));
    if (silent.length > 0) context.notes.push(`Never fired on MNQ 1-minute bars 2021-01 → 2025-06, so no picture: ${silent.join(", ")}.`);
    return { images };
  },
};

export default handler;
