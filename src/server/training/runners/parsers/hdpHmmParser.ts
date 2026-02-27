/**
 * HDP-HMM Output Parser
 *
 * Parses structured JSON events from the HDP-HMM Python script.
 * Each stdout line is a JSON object with a "type" field matching
 * the universal training protocol (progress, metric, overlay, log, done, error).
 */

import type { TrainingSession } from '@shared/trainingTypes';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';

export class HdpHmmParser implements IOutputParser {
  parseLine(session: TrainingSession, line: string, ctx: ParserContext): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;

    // Try JSON parse — all HDP-HMM output is structured JSON
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Not JSON — emit as raw log
      emitSessionEvent(session, 'log', { message: trimmed, level: 'info' });
      return true;
    }

    const type = msg.type as string;
    if (!type) {
      emitSessionEvent(session, 'log', { message: trimmed, level: 'info' });
      return true;
    }

    switch (type) {
      case 'progress':
        emitSessionEvent(session, 'progress', {
          phase: msg.phase ?? 'gibbs_sampling',
          step: msg.iteration,
          totalSteps: msg.total,
          pct: msg.total ? ((msg.iteration as number) / (msg.total as number)) * 100 : 0,
          message: msg.message ?? `Iteration ${msg.iteration}/${msg.total}`,
        });
        break;

      case 'metric':
        emitSessionEvent(session, 'metric', {
          iteration: msg.iteration,
          totalIterations: msg.total,
          metrics: { [msg.name as string]: msg.value },
        });
        break;

      case 'overlay':
        emitSessionEvent(session, 'overlay', {
          overlayType: msg.overlayType ?? 'regime_zones',
          timestamps: msg.timestamps,
          assignments: msg.assignments,
          payload: msg.data ?? msg.payload,
        });
        break;

      case 'log':
        emitSessionEvent(session, 'log', {
          message: msg.message,
          level: msg.level ?? 'info',
        });
        break;

      case 'done':
        emitSessionEvent(session, 'done', {
          modelId: ctx.modelId,
          modelPath: msg.modelPath,
          elapsedSec: msg.elapsedSec,
          diagnostics: msg.diagnostics,
        });
        break;

      case 'error':
        emitSessionEvent(session, 'error', {
          message: msg.message,
          details: msg.details,
        });
        break;

      default:
        // Unknown type — emit as log
        emitSessionEvent(session, 'log', { message: trimmed, level: 'debug' });
    }

    return true;
  }
}
