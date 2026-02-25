/**
 * HDP-HMM Output Parser
 *
 * Parses stdout from the HDP-HMM Python training script.
 * Handles Gibbs iteration metrics, step progress, regime snapshots,
 * walk-forward windows, and binary sidecar files.
 */

import path from 'path';
import fs from 'fs';
import type { TrainingSession } from '@shared/trainingTypes';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';

export class HdpHmmParser implements IOutputParser {
  parseLine(session: TrainingSession, trimmed: string, ctx: ParserContext): boolean {
    if (trimmed.startsWith('__JSON_OUTPUT__')) return true;

    // Binary sidecar files for live regime snapshots
    if (trimmed.startsWith('__REGIME_META__')) {
      try {
        const meta = JSON.parse(trimmed.slice('__REGIME_META__'.length));
        const tsFile = path.join(ctx.modelsDir, ctx.modelId, 'live_timestamps.bin');
        if (fs.existsSync(tsFile)) {
          const buf = fs.readFileSync(tsFile);
          const int64View = new BigInt64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
          const timestamps = Array.from(int64View, (v) => Number(v));
          emitSessionEvent(session, 'overlay', {
            overlayType: 'regime_timestamps',
            timestamps,
            count: meta.count,
          });
        }
      } catch { /* skip malformed */ }
      return true;
    }
    if (trimmed.startsWith('__REGIME_SNAP__')) {
      try {
        const snap = JSON.parse(trimmed.slice('__REGIME_SNAP__'.length));
        const snapFile = path.join(ctx.modelsDir, ctx.modelId, 'live_snapshot.bin');
        if (fs.existsSync(snapFile)) {
          const buf = fs.readFileSync(snapFile);
          const assignments = Array.from(new Uint8Array(buf));
          emitSessionEvent(session, 'overlay', {
            overlayType: 'regime_colors',
            assignments,
            iteration: snap.iter,
          });
        }
      } catch { /* skip malformed */ }
      return true;
    }

    // Skip raw JSON objects/arrays but NOT step markers like [1/9]
    if (trimmed.startsWith('{')) return true;
    if (trimmed.startsWith('[') && !/^\[\d+\/\d+\]/.test(trimmed)) return true;
    if (/^=+$/.test(trimmed) || trimmed === '') return true;

    // Step progress: [1/9] Loading data...
    const stepMatch = trimmed.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
    // Gibbs iteration: iter 50/100: Regimes=5 Fit=-3.45/bar LL=-12345 ...
    const gibbsMatch = trimmed.match(
      /iter\s+(\d+)\/(\d+):\s+Regimes=(\d+)\s+Fit=([-\d.]+)\/bar\s+LL=\s*([-\d,. ]+)\s+D=\s*([-\d,.]+)\s+Entropy=([\d.]+)\s+Switch=([\d.]+)\s+SelfTr=([\d.]+)\s+MaxReg=([\d.]+)%\s+Dwell=([\d.]+)/
    );
    const gibbsMatchOld = !gibbsMatch ? trimmed.match(/iter\s+(\d+)\/(\d+):\s+LL=\s*([-\d,. ]+)\s+active_states=(\d+)\s+delta=([\d.]+)/) : null;
    const discoveredMatch = trimmed.match(/Discovered\s+(\d+)\s+regimes/i) || trimmed.match(/Regimes Discovered:\s+(\d+)/);
    const stabMatch = trimmed.match(/Walk-Forward Stability:\s+([\d.]+)/);
    const simMatch = trimmed.match(/Distribution Similarity:\s+([\d.]+)/);
    const corrMatch = trimmed.match(/Profile Correlation:\s+([\d.]+)/);
    const qualMatch = trimmed.match(/Quality Score:\s+([\d.]+)/);
    const featureMatrixMatch = trimmed.match(/Feature matrix:\s+([\d,]+)\s+bars/);
    const windowMatch = trimmed.match(/Window\s+(\d+)\/(\d+):\s+k=(\d+)\s+train_ll=([-\d.]+)\/bar\s+oos_ll=([-\d.]+)\/bar/);

    if (gibbsMatch) {
      emitSessionEvent(session, 'metric', {
        iteration: parseInt(gibbsMatch[1]!),
        totalIterations: parseInt(gibbsMatch[2]!),
        metrics: {
          activeStates: parseInt(gibbsMatch[3]!),
          fitPerBar: parseFloat(gibbsMatch[4]!),
          logLikelihood: parseFloat(gibbsMatch[5]!.replace(/[, ]/g, '')),
          delta: parseFloat(gibbsMatch[6]!.replace(/[, ]/g, '')),
          entropy: parseFloat(gibbsMatch[7]!),
          switchRate: parseFloat(gibbsMatch[8]!),
          selfTransition: parseFloat(gibbsMatch[9]!),
          maxRegimePct: parseFloat(gibbsMatch[10]!),
          avgDwell: parseFloat(gibbsMatch[11]!),
        },
        message: trimmed,
      });
      return true;
    } else if (gibbsMatchOld) {
      emitSessionEvent(session, 'metric', {
        iteration: parseInt(gibbsMatchOld[1]!),
        totalIterations: parseInt(gibbsMatchOld[2]!),
        metrics: {
          logLikelihood: parseFloat(gibbsMatchOld[3]!.replace(/[, ]/g, '')),
          activeStates: parseInt(gibbsMatchOld[4]!),
          delta: parseFloat(gibbsMatchOld[5]!),
        },
        message: trimmed,
      });
      return true;
    } else if (stepMatch) {
      const step = parseInt(stepMatch[1]!);
      const total = parseInt(stepMatch[2]!);
      const msg = stepMatch[3]!;
      emitSessionEvent(session, 'progress', {
        step,
        totalSteps: total,
        phase: msg.toLowerCase().includes('load') ? 'loading'
          : msg.toLowerCase().includes('feature') ? 'features'
          : msg.toLowerCase().includes('split') ? 'splitting'
          : msg.toLowerCase().includes('standard') ? 'scaling'
          : msg.toLowerCase().includes('gibbs') || msg.toLowerCase().includes('hdp') ? 'gibbs_sampling'
          : msg.toLowerCase().includes('walk') ? 'walk_forward'
          : msg.toLowerCase().includes('out-of-sample') ? 'oos_evaluation'
          : msg.toLowerCase().includes('analyz') ? 'analyzing'
          : msg.toLowerCase().includes('shap') ? 'shap_analysis'
          : 'saving',
        message: trimmed,
        pct: Math.round((step / total) * 100),
      });
      return true;
    } else if (discoveredMatch) {
      emitSessionEvent(session, 'metric', { type: 'regimes_discovered', value: parseInt(discoveredMatch[1]!) });
      return true;
    } else if (stabMatch) {
      emitSessionEvent(session, 'metric', { type: 'stability', value: parseFloat(stabMatch[1]!) });
      return true;
    } else if (simMatch) {
      emitSessionEvent(session, 'metric', { type: 'oos_similarity', value: parseFloat(simMatch[1]!) });
      return true;
    } else if (corrMatch) {
      emitSessionEvent(session, 'metric', { type: 'oos_correlation', value: parseFloat(corrMatch[1]!) });
      return true;
    } else if (qualMatch) {
      emitSessionEvent(session, 'metric', { type: 'quality_score', value: parseFloat(qualMatch[1]!) });
      return true;
    } else if (windowMatch) {
      emitSessionEvent(session, 'metric', {
        type: 'walk_forward_window',
        window: parseInt(windowMatch[1]!),
        totalWindows: parseInt(windowMatch[2]!),
        regimes: parseInt(windowMatch[3]!),
        trainLlBar: parseFloat(windowMatch[4]!),
        oosLlBar: parseFloat(windowMatch[5]!),
      });
      return true;
    } else if (featureMatrixMatch) {
      emitSessionEvent(session, 'metric', { type: 'data_size', value: parseInt(featureMatrixMatch[1]!.replace(/,/g, '')) });
      return true;
    } else if (trimmed.includes('Training complete')) {
      emitSessionEvent(session, 'progress', { phase: 'complete', message: trimmed, pct: 100 });
      return true;
    }

    return false; // not handled — let default parser emit as log
  }
}
