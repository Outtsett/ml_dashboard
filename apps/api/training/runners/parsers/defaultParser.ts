/**
 * Default Output Parser
 *
 * Fallback parser that emits all unrecognized stdout lines as log events.
 * Used when no model-specific parser is registered.
 */

import type { TrainingSession } from '@shared/trainingTypes';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';

export class DefaultParser implements IOutputParser {
  parseLine(session: TrainingSession, line: string, _ctx: ParserContext): boolean {
    if (line) {
      emitSessionEvent(session, 'log', { message: line });
    }
    return true;
  }
}
