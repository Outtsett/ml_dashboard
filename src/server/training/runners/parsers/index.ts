/**
 * Output Parser Registry (OCP)
 *
 * Maps model types to their stdout parsers.
 * To add a new model: create a parser file, add one line here.
 */

import type { IOutputParser } from './types';
import { DefaultParser } from './defaultParser';

export type { IOutputParser, ParserContext } from './types';

const defaultParser = new DefaultParser();

const PARSERS: Record<string, IOutputParser> = {
};

/** Get the parser for a model type, falling back to the default log-emitter. */
export function getParser(modelType: string): IOutputParser {
  return PARSERS[modelType] ?? defaultParser;
}
