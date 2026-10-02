/**
 * Output Parser Registry (OCP)
 *
 * Maps model types to their stdout parsers.
 *
 * Two layers of resolution:
 *   1. Exact-match `PARSERS[modelType]` for hand-wired runners that have
 *      a bespoke parser (e.g. xgb_classifier).
 *   2. Generic `GeneratedParser` for anything emitted by a `_base.py.j2`-derived
 *      Python runner — registered for the `generated_*` modelType prefix
 *      that the workshop save-flow uses (W1.e), and as the fall-through
 *      default for unknown modelTypes since the base protocol is now the
 *      project-wide convention.
 *
 * To add a new model: create a parser file, add one line here.
 */

import type { IOutputParser } from './types';
import { DefaultParser } from './defaultParser';
import { XgbClassifierParser } from './xgb_classifier';
import { GeneratedParser } from './generated';

export type { IOutputParser, ParserContext } from './types';

const defaultParser = new DefaultParser();
const xgbClassifierParser = new XgbClassifierParser();
const generatedParser = new GeneratedParser();

const PARSERS: Record<string, IOutputParser> = {
  xgb_classifier: xgbClassifierParser,
  xgb_classifier_wf: xgbClassifierParser,
  xgb_classifier_nest: xgbClassifierParser,
};

/** Prefix-routed parsers — first match wins. */
const PREFIX_PARSERS: Array<{ prefix: string; parser: IOutputParser }> = [
  { prefix: 'generated_', parser: generatedParser },
];

/**
 * Get the parser for a model type.
 *
 * Resolution order:
 *   1. Exact match in `PARSERS`.
 *   2. Prefix match in `PREFIX_PARSERS` (e.g. `generated_*`).
 *   3. Fall back to `GeneratedParser` — the base-template protocol is the
 *      project-wide convention, so unrecognized model types should benefit
 *      from typed event handling rather than the bare log-only default.
 *      `DefaultParser` remains exported for explicit opt-in.
 */
export function getParser(modelType: string): IOutputParser {
  const exact = PARSERS[modelType];
  if (exact) return exact;
  for (const { prefix, parser } of PREFIX_PARSERS) {
    if (modelType.startsWith(prefix)) return parser;
  }
  return generatedParser;
}

/** Exported for tests / explicit opt-in (pre-protocol scripts). */
export { defaultParser, generatedParser };
