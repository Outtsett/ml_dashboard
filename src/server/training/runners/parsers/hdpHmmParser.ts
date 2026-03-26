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
import * as trainingStorage from "../../../storage/trainingStorage";

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

      case 'metric': {
        emitSessionEvent(session, 'metric', {
          iteration: msg.iteration,
          totalIterations: msg.total,
          metrics: { [msg.name as string]: msg.value },
        });

        // Persist metric to SQLite for post-training convergence analysis (DIP)
        const dbSessionId = session.dbSessionId;
        if (dbSessionId != null) {
          trainingStorage.insertMetric({
            sessionId: dbSessionId,
            iteration: Number(msg.iteration ?? 0),
            metricName: String(msg.name),
            metricValue: Number(msg.value),
          });
        }
        break;
      }

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

      case 'model_state': {
        // Forward full snapshot to SSE clients
        emitSessionEvent(session, 'model_state', msg);

        // Persist to SQLite for post-training retrieval
        const msDbSessionId = session.dbSessionId;
        if (msDbSessionId != null) {
          trainingStorage.insertModelStateSnapshot({
            sessionId: msDbSessionId,
            iteration: Number(msg.iteration ?? 0),
            snapshot: JSON.stringify(msg.snapshot),
          });
        }
        break;
      }

      case 'sampler_diagnostics': {
        const diag = msg.diagnostics as Record<string, unknown> | undefined;
        if (!diag) break;

        const sdIteration = Number(msg.iteration ?? 0);
        const sdTotal = Number(msg.total ?? 0);
        const stepTiming = diag.step_timing as Record<string, number> | undefined;

        // Forward individual scalar metrics to SSE as regular metric events
        const metricsMap: Record<string, number> = {
          ess: Number(diag.ess ?? 0),
          autocorrelation_lag1: Number(diag.autocorrelation_lag1 ?? 0),
        };
        if (stepTiming) {
          metricsMap['step_timing_ffbs_ms'] = Number(stepTiming.ffbs_ms ?? 0);
          metricsMap['step_timing_emission_ms'] = Number(stepTiming.emission_ms ?? 0);
          metricsMap['step_timing_transition_ms'] = Number(stepTiming.transition_ms ?? 0);
        }

        // Emit each metric as a separate SSE metric event
        for (const [name, value] of Object.entries(metricsMap)) {
          emitSessionEvent(session, 'metric', {
            iteration: sdIteration,
            totalIterations: sdTotal,
            metrics: { [name]: value },
          });
        }

        // Persist each metric to the existing trainingMetrics table
        const sdDbSessionId = session.dbSessionId;
        if (sdDbSessionId != null) {
          for (const [name, value] of Object.entries(metricsMap)) {
            trainingStorage.insertMetric({
              sessionId: sdDbSessionId,
              iteration: sdIteration,
              metricName: name,
              metricValue: value,
            });
          }
        }
        break;
      }

      default:
        // Unknown type — emit as log
        emitSessionEvent(session, 'log', { message: trimmed, level: 'debug' });
    }

    return true;
  }
}
