/**
 * XGBoost Classifier output parser.
 *
 * Parses JSON-line stdout events emitted by packages/ml-engine/src/xgb_classifier/main.py and
 * dispatches them to the SSE stream as the standard TrainingEventType variants.
 *
 * Recognized JSON event types:
 *   - log                    (level, message)
 *   - progress               (iteration, total, phase)
 *   - metric                 (name, value, iteration, total)
 *   - metric_declarations    (declarations: { name -> {renderer, group, mission, context} })
 *   - epoch_metric           (iteration, total, train_logloss, val_logloss, train_auc, val_auc, ...)
 *   - done                   (modelPath, diagnostics)
 *   - error                  (message, details)
 *
 * Anything that doesn't parse as JSON falls back to a log event so the verbose
 * panel still shows it.
 */

import type { TrainingSession } from '@shared/trainingTypes';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';

const HANDLED_TYPES = new Set([
  'log',
  'progress',
  'metric',
  'metric_declarations',
  'epoch_metric',
  'done',
  'error',
  'overlay',
  'model_state',
  'sampler_diagnostics',
]);

export class XgbClassifierParser implements IOutputParser {
  parseLine(session: TrainingSession, line: string, _ctx: ParserContext): boolean {
    if (!line) return true;
    if (!line.startsWith('{')) {
      emitSessionEvent(session, 'log', { message: line });
      return true;
    }

    let parsed: { type?: string; [k: string]: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      emitSessionEvent(session, 'log', { message: line });
      return true;
    }

    const type = parsed.type;
    if (!type || !HANDLED_TYPES.has(type)) {
      emitSessionEvent(session, 'log', { message: line });
      return true;
    }

    // For 'done', signal the runner that we already emitted the done event
    // so it doesn't double-emit on child close.
    if (type === 'done') {
      const { type: _t, ...payload } = parsed;
      emitSessionEvent(session, 'done', payload);
      (session as TrainingSession & { parserHandledDone?: boolean }).parserHandledDone = true;
      return true;
    }

    if (type === 'error') {
      const { type: _t, ...payload } = parsed;
      emitSessionEvent(session, 'error', payload);
      return true;
    }

    // All other types pass through with the same name.
    const { type: _t, ...payload } = parsed;
    emitSessionEvent(session, type as Parameters<typeof emitSessionEvent>[1], payload);
    return true;
  }
}
