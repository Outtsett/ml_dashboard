/**
 * Output Parser Interface (OCP + DIP)
 *
 * Each model type implements this interface. New models extend
 * the system by adding a parser — no modification to PythonRunner needed.
 */

import type { TrainingSession } from '@shared/trainingTypes';

export interface ParserContext {
  modelsDir: string;
  modelId: string;
}

export interface IOutputParser {
  /** Parse a single line of stdout. Returns true if the line was handled. */
  parseLine(session: TrainingSession, line: string, context: ParserContext): boolean;
}
