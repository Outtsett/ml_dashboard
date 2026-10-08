/**
 * The plain-language explainer of one catalog model: how it works step by
 * step with no formulas, what to use it for, and one worked example from
 * input to output.
 *
 * One file per catalog specification:
 * `packages/config/model_explainers/<specificationId>.json`. The server
 * validates every file against this schema before serving it
 * (`GET /api/model-catalog/:id/explainer`); the catalog's "How it works"
 * panel renders it.
 *
 * Numbers are whole numbers or whole percentages, never decimal fractions:
 * the reader takes in "58 percent" at a glance and "0.58" slowly.
 *
 * The worked example is an ILLUSTRATION written to show the shape of the
 * model's input and output. It is never a measured run; measured results
 * live in the model's Runs panel.
 */

import { z } from "zod";

/** A formula marker: the explainer is words only. */
const FORMULA_PATTERN = /\$[^$]*\$|\\(?:frac|sum|prod|int|sigma|theta|alpha|beta|lambda|mathbb|mathcal|nabla|partial)\b|[∑∏∫∂∇]/;

/** A decimal fraction such as 0.58, 1.8 or 18,452.25. */
const DECIMAL_PATTERN = /\d\.\d/;

const DECIMAL_MESSAGE =
  "no decimal numbers: write a whole percentage (58 percent, not 0.58), a percentage above or below (80 percent above average, not 1.8 times), or a whole number (18,452 not 18,452.25; a quarter point, not 0.25)";

const plainText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((text) => !FORMULA_PATTERN.test(text), { message: "plain words only: no formulas or mathematical notation" })
    .refine((text) => !DECIMAL_PATTERN.test(text), { message: DECIMAL_MESSAGE });

/** One named value of the worked example. */
export const explainerFieldSchema = z.object({
  /** The full-word name of the value, with its unit when it has one. */
  name: plainText(2, 80),
  /** The value as it would be read on screen. */
  value: z.string().min(1).max(160).refine((text) => !DECIMAL_PATTERN.test(text), { message: DECIMAL_MESSAGE }),
  /** What the value is, in one sentence. */
  meaning: plainText(15, 300),
});

export const explainerStepSchema = z.object({
  title: plainText(3, 80),
  /** What the model does at this step, in plain words. */
  description: plainText(40, 600),
  /** What this step does to the worked example. */
  inExample: plainText(20, 400),
});

export const explainerUseSchema = z.object({
  /** The job the model is suited to. */
  task: plainText(3, 120),
  /** A concrete case of that job. */
  example: plainText(30, 400),
});

export const modelExplainerSchema = z.object({
  /** The catalog specification this explains; equals the file name. */
  specificationId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  /** "Think of it as ...": the model as something familiar. */
  analogy: plainText(40, 400),
  /** How the model works, in order. */
  steps: z.array(explainerStepSchema).min(4).max(8),
  /** What to use the model for, each with a concrete case. */
  useFor: z.array(explainerUseSchema).min(3).max(5),
  /** When another model is the better choice. */
  avoidWhen: z.array(plainText(20, 300)).min(1).max(3),
  /** One worked example, from the information that goes in to what comes out. */
  example: z.object({
    scenario: plainText(40, 500),
    input: z.object({ summary: plainText(20, 300), fields: z.array(explainerFieldSchema).min(3).max(10) }),
    output: z.object({ summary: plainText(20, 300), fields: z.array(explainerFieldSchema).min(2).max(8) }),
    /** How to read the output and what to do with it. */
    reading: plainText(40, 500),
  }),
});

export type ExplainerField = z.infer<typeof explainerFieldSchema>;
export type ExplainerStep = z.infer<typeof explainerStepSchema>;
export type ExplainerUse = z.infer<typeof explainerUseSchema>;
export type ModelExplainer = z.infer<typeof modelExplainerSchema>;
