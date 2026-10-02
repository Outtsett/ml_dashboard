/**
 * overlayDispatch — the model-agnostic chart-overlay registry.
 *
 * Covers the contract the whole feature rests on: a model declares a
 * `chartOverlay` string, emits the same string as `overlayType`, and the client
 * routes on it without a per-model branch. The regime path is pinned because it
 * is the only overlay painting anything today and must not regress.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { OverlayPayload } from '@shared/trainingTypes';
import {
  dispatchOverlayEvent,
  reportOverlayDispatchResult,
  resetOverlayDispatchReporting,
  OVERLAY_HANDLER_REGISTRY,
  DECLARED_OVERLAY_TYPES,
} from '@/training/lib/overlayDispatch';
import { buildSSECallbacks } from '@/training/sse_handlers';
import type { TrainingStateSetters } from '@/training/sse_handlers';

beforeEach(() => {
  resetOverlayDispatchReporting();
});

describe('registry coverage', () => {
  it('has an entry for every chartOverlay value the configs declare', () => {
    // Measured from packages/config/runners.json, models.json and tasks.json.
    const declaredInConfig = [
      'prediction_markers',
      'prediction_line',
      'prediction_heatband',
      'reward_curve',
      'regime_bands',
      'credible_bands',
    ];
    for (const overlayType of declaredInConfig) {
      expect(OVERLAY_HANDLER_REGISTRY[overlayType], overlayType).toBeTypeOf('function');
    }
  });

  it('also handles regime_zones, the wire value the regime emitter sends', () => {
    expect(DECLARED_OVERLAY_TYPES).toContain('regime_zones');
  });
});

describe('regime_zones — unchanged behaviour', () => {
  it('returns the timestamps and assignments the candle painter expects', () => {
    const event: OverlayPayload = {
      overlayType: 'regime_zones',
      timestamps: [1726790400, 1726876800, 1726963200],
      assignments: [0, 1, 1],
      payload: { colors: ['#E69F00', '#0072B2'], labels: ['trending up', 'trending down'] },
    };
    const result = dispatchOverlayEvent(event);
    expect(result.outcome).toBe('regime_zones');
    if (result.outcome !== 'regime_zones') throw new Error('unreachable');
    expect(result.timestampsSeconds).toEqual([1726790400, 1726876800, 1726963200]);
    expect(result.regimeAssignments).toEqual([0, 1, 1]);
  });

  it('coerces string timestamps to numbers, as the previous hardcoded branch did', () => {
    const event = {
      overlayType: 'regime_zones',
      timestamps: ['1726790400', '1726876800'],
      assignments: [1, 0],
    } as unknown as OverlayPayload;
    const result = dispatchOverlayEvent(event);
    if (result.outcome !== 'regime_zones') throw new Error('expected regime_zones');
    expect(result.timestampsSeconds).toEqual([1726790400, 1726876800]);
  });

  it('reports a missing assignments array instead of painting nothing silently', () => {
    const event = { overlayType: 'regime_zones', timestamps: [1, 2] } as OverlayPayload;
    const result = dispatchOverlayEvent(event);
    expect(result.outcome).toBe('malformed_payload');
  });
});

describe('prediction_markers', () => {
  it('normalises the three parallel arrays into one marker per bar', () => {
    const event: OverlayPayload = {
      overlayType: 'prediction_markers',
      timestamps: [1726790400, 1726876800, 1726963200],
      assignments: [1, -1, 0],
      payload: { confidences: [0.82, 0.61, null], bar_count: 3 },
    };
    const result = dispatchOverlayEvent(event);
    if (result.outcome !== 'prediction_markers') throw new Error('expected prediction_markers');
    expect(result.predictionMarkers).toEqual([
      { timestampSeconds: 1726790400, direction: 1, confidence: 0.82 },
      { timestampSeconds: 1726876800, direction: -1, confidence: 0.61 },
      { timestampSeconds: 1726963200, direction: 0, confidence: null },
    ]);
  });

  it('works without a confidences array at all', () => {
    const result = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1726790400],
      assignments: [1],
      payload: { bar_count: 1 },
    });
    if (result.outcome !== 'prediction_markers') throw new Error('expected prediction_markers');
    expect(result.predictionMarkers).toEqual([
      { timestampSeconds: 1726790400, direction: 1, confidence: null },
    ]);
  });

  it('clamps any direction to up / flat / down', () => {
    const result = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1, 2, 3, 4],
      assignments: [5, -5, 0, Number.NaN],
    });
    if (result.outcome !== 'prediction_markers') throw new Error('expected prediction_markers');
    expect(result.predictionMarkers.map(m => m.direction)).toEqual([1, -1, 0, 0]);
  });

  it('converts a millisecond timestamp to seconds', () => {
    const result = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1726790400000],
      assignments: [1],
    });
    if (result.outcome !== 'prediction_markers') throw new Error('expected prediction_markers');
    expect(result.predictionMarkers[0].timestampSeconds).toBe(1726790400);
  });

  it('refuses arrays of mismatched length rather than mis-pairing every later bar', () => {
    const result = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1, 2, 3],
      assignments: [1, -1],
    });
    expect(result.outcome).toBe('malformed_payload');
    if (result.outcome !== 'malformed_payload') throw new Error('unreachable');
    expect(result.explanation).toContain('3 timestamps');
    expect(result.explanation).toContain('2 directions');
  });

  it('refuses a confidences array of the wrong length', () => {
    const result = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1, 2],
      assignments: [1, -1],
      payload: { confidences: [0.5] },
    });
    expect(result.outcome).toBe('malformed_payload');
  });
});

describe('declared but not yet rendered', () => {
  it.each(['prediction_line', 'prediction_heatband', 'regime_bands', 'reward_curve', 'credible_bands'])(
    '%s resolves to a named, visible outcome rather than being ignored',
    (overlayType) => {
      const result = dispatchOverlayEvent({ overlayType, timestamps: [1], assignments: [1] });
      expect(result.outcome).toBe('declared_but_not_yet_rendered');
      expect(result.overlayType).toBe(overlayType);
      if (result.outcome !== 'declared_but_not_yet_rendered') throw new Error('unreachable');
      expect(result.explanation).toContain(overlayType);
    },
  );
});

describe('unknown overlay types', () => {
  it('names the type and lists what is known', () => {
    const result = dispatchOverlayEvent({ overlayType: 'volatility_cone' });
    expect(result.outcome).toBe('unknown_overlay_type');
    if (result.outcome !== 'unknown_overlay_type') throw new Error('unreachable');
    expect(result.explanation).toContain('volatility_cone');
    expect(result.explanation).toContain('prediction_markers');
  });

  it('handles an event with no overlayType at all', () => {
    const result = dispatchOverlayEvent({} as OverlayPayload);
    expect(result.outcome).toBe('unknown_overlay_type');
  });
});

describe('reporting', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs an unknown type once, naming it', () => {
    const result = dispatchOverlayEvent({ overlayType: 'volatility_cone' });
    expect(reportOverlayDispatchResult(result)).toBe(true);
    expect(reportOverlayDispatchResult(result)).toBe(false);
    expect(reportOverlayDispatchResult(result)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('volatility_cone');
  });

  it('logs each distinct type separately', () => {
    reportOverlayDispatchResult(dispatchOverlayEvent({ overlayType: 'volatility_cone' }));
    reportOverlayDispatchResult(dispatchOverlayEvent({ overlayType: 'reward_curve' }));
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('stays silent for overlays that actually render', () => {
    const rendered = dispatchOverlayEvent({
      overlayType: 'prediction_markers',
      timestamps: [1],
      assignments: [1],
    });
    expect(reportOverlayDispatchResult(rendered)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns again after a reset, so a new training run is not swallowed', () => {
    const result = dispatchOverlayEvent({ overlayType: 'volatility_cone' });
    reportOverlayDispatchResult(result);
    resetOverlayDispatchReporting();
    expect(reportOverlayDispatchResult(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

// ── The SSE handler that consumes the registry ─────────────────────────────

describe('buildSSECallbacks.onOverlay routes through the registry', () => {
  function makeSetters() {
    const calls = {
      overlayType: [] as (string | null)[],
      overlayData: [] as unknown[],
      regimeTimestamps: [] as number[][],
      regimeAssignments: [] as number[][],
    };
    const noop = () => {};
    const setters = {
      setDataRange: noop, setTotalBars: noop, setModelType: noop, setPhase: noop,
      setProgress: noop, setLogs: noop, setMetrics: noop, setIterationHistory: noop,
      setOverlayType: (v: string | null) => calls.overlayType.push(v),
      setOverlayData: (v: unknown) => calls.overlayData.push(v),
      setLiveRegimeTimestamps: (v: number[]) => calls.regimeTimestamps.push(v),
      setLiveRegimeAssignments: (v: number[]) => calls.regimeAssignments.push(v),
      setCompletedModelId: noop, setDiagnostics: noop, setElapsedSec: noop,
      setModelState: noop, setModelStateHistory: noop, setMetricDeclarations: noop,
      setError: noop, setIsTraining: noop, clearElapsedTimer: noop,
      setTrainingContext: noop, invalidateModels: noop,
    } as unknown as TrainingStateSetters;
    return { setters, calls };
  }

  it('still feeds the regime painter exactly as before', () => {
    const { setters, calls } = makeSetters();
    buildSSECallbacks(setters).onOverlay!({
      overlayType: 'regime_zones',
      timestamps: [1726790400, 1726876800],
      assignments: [0, 1],
    });
    expect(calls.overlayType).toEqual(['regime_zones']);
    expect(calls.regimeTimestamps).toEqual([[1726790400, 1726876800]]);
    expect(calls.regimeAssignments).toEqual([[0, 1]]);
  });

  it('stores the raw event for a non-regime type without touching regime state', () => {
    const { setters, calls } = makeSetters();
    const event = {
      overlayType: 'prediction_markers',
      timestamps: [1726790400],
      assignments: [1],
      payload: { confidences: [0.9] },
    };
    buildSSECallbacks(setters).onOverlay!(event);
    expect(calls.overlayType).toEqual(['prediction_markers']);
    expect(calls.overlayData).toEqual([event]);
    expect(calls.regimeTimestamps).toEqual([]);
    expect(calls.regimeAssignments).toEqual([]);
  });

  it('warns once, by name, when a model declares an overlay nothing renders', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { setters } = makeSetters();
    const callbacks = buildSSECallbacks(setters);
    callbacks.onOverlay!({ overlayType: 'reward_curve', timestamps: [1], assignments: [1] });
    callbacks.onOverlay!({ overlayType: 'reward_curve', timestamps: [2], assignments: [1] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('reward_curve');
    warnSpy.mockRestore();
  });
});
