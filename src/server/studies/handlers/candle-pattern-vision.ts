/**
 * Candle pattern vision: the record of every run of the candle_vision+talib_pattern_recognition
 * runner (src/ml/candle_vision/main.py), landed as derived_candle_pattern_vision_<table> with
 * recipe = run. The page picks a run (default: the newest) and a class; everything but the
 * exemplar images goes whole, the images only for the selected class.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, text } from "../sql";
import type { StudyHandler } from "../types";
import {
  visionView,
  type ClassMetric, type ConfusionCell, type EpochRow, type Exemplar, type SampleCount, type SplitSpan, type VisionBody, type VisionRun,
} from "../../../shared/studies/candle-pattern-vision";

const query = z.object({
  run: z.string().regex(/^[A-Za-z0-9_.-]{0,160}$/).default(""),
  className: z.string().regex(/^[a-z0-9]{1,40}:(bullish|bearish|neutral)$/).default("engulfing:bearish"),
});

const EMPTY: VisionBody = { runs: [], run: null, classMetrics: [], epochs: [], samples: [], confusion: [], splits: [], exemplars: [] };

const handler: StudyHandler<typeof query, VisionBody> = {
  slug: "candle-pattern-vision",
  datasets: [visionView("runs"), visionView("class_metrics"), visionView("epochs"), visionView("samples"), visionView("pattern_confusion"), visionView("exemplars"), visionView("splits")],
  query,
  cacheSeconds: 120,
  async run(q, context) {
    if ((await missingViews(context, [visionView("runs")])).length > 0) {
      context.notes.push("No run landed yet: start one from ML Studio / Training with the runner candle_vision+talib_pattern_recognition.");
      return EMPTY;
    }
    const runs = await context.lake.query<VisionRun>(`SELECT * FROM ${ident(visionView("runs"))} ORDER BY recipe DESC`);
    const run = runs.find((row) => row.recipe === q.run) ?? runs[0] ?? null;
    if (!run) return { ...EMPTY, runs };
    const where = `WHERE recipe = ${text(run.recipe)}`;
    const read = <T>(table: Parameters<typeof visionView>[0], order: string, columns = "* EXCLUDE (recipe)") =>
      context.lake.query<T>(`SELECT ${columns} FROM ${ident(visionView(table))} ${where} ORDER BY ${order}`);
    const [classMetrics, epochs, samples, confusion, splits, exemplars] = await Promise.all([
      read<ClassMetric>("class_metrics", "class_name, split, source"),
      read<EpochRow>("epochs", "epoch"),
      read<SampleCount>("samples", "class_name, split, source"),
      read<ConfusionCell>("pattern_confusion", "true_pattern, called_pattern"),
      read<SplitSpan>("splits", "first_bar"),
      context.lake.query<Exemplar>(
        `SELECT * EXCLUDE (recipe, window_unit_ohlc_json) FROM ${ident(visionView("exemplars"))} ${where} AND class_name = ${text(q.className)} ORDER BY kind, score DESC`),
    ]);
    return { runs, run, classMetrics, epochs, samples, confusion, splits, exemplars };
  },
};

export default handler;
