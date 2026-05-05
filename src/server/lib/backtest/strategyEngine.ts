/**
 * Strategy Engine — evaluates strategy definitions to generate signals.
 *
 * Dispatches to model inference, indicator computation, or hybrid approaches
 * based on the strategy type. Applies optional session and confirmation filters.
 */

import type { Signal, OHLCVBar } from './tradeSimulator';
import {
  generateModelSignals,
  generateMomentumSignals,
  generateIndicatorSignals,
} from './modelInference';
import {
  FOREX_SESSIONS,
  type StrategyDefinition,
} from '@shared/strategyTypes';

// ─── Strategy Execution ─────────────────────────────────────────────────────

/**
 * Execute a strategy definition against OHLCV bars and return filtered signals.
 *
 * Dispatches by strategy.type:
 *  - ml_prediction → model inference
 *  - momentum      → momentum lookback
 *  - indicator     → technical indicator preset
 *  - hybrid        → model + indicator, then merge
 *
 * Post-processing:
 *  1. Session filter (forex hours)
 *  2. Confirmation filter (consecutive bar agreement)
 */
export async function executeStrategy(
  bars: OHLCVBar[],
  strategy: StrategyDefinition,
): Promise<Signal[]> {
  let signals: Signal[];

  switch (strategy.type) {
    case 'ml_prediction': {
      if (!strategy.modelId) {
        throw new Error('[StrategyEngine] ml_prediction strategy requires modelId');
      }
      signals = await generateModelSignals(
        bars,
        strategy.modelId,
        strategy.minConfidence,
      );
      break;
    }

    case 'momentum': {
      signals = generateMomentumSignals(bars);
      break;
    }

    case 'indicator': {
      if (!strategy.indicatorPreset) {
        throw new Error('[StrategyEngine] indicator strategy requires indicatorPreset');
      }
      signals = generateIndicatorSignals(bars, {
        preset: strategy.indicatorPreset,
        params: strategy.indicatorParams,
      });
      break;
    }

    case 'hybrid': {
      // Hybrid: combine model signals with indicator signals.
      // Model provides direction, indicator provides timing confirmation.
      const modelSignals = strategy.modelId
        ? await generateModelSignals(bars, strategy.modelId, strategy.minConfidence)
        : generateMomentumSignals(bars);

      const indicatorSignals = strategy.indicatorPreset
        ? generateIndicatorSignals(bars, {
            preset: strategy.indicatorPreset,
            params: strategy.indicatorParams,
          })
        : [];

      if (indicatorSignals.length === 0) {
        signals = modelSignals;
      } else {
        // Build a lookup of indicator signal timestamps → prediction
        const indicatorMap = new Map<number, Signal>();
        for (const sig of indicatorSignals) {
          indicatorMap.set(sig.timestamp, sig);
        }

        // Keep model signals that agree with indicator direction, or have no
        // indicator conflict. Boost confidence when both agree.
        signals = [];
        for (const ms of modelSignals) {
          const is = indicatorMap.get(ms.timestamp);
          if (!is) {
            // No indicator signal at this bar — pass through at reduced confidence
            signals.push({ ...ms, confidence: ms.confidence * 0.8 });
          } else if (is.prediction === ms.prediction) {
            // Agreement — boost confidence
            signals.push({
              ...ms,
              confidence: Math.min(ms.confidence * 1.2, 0.99),
            });
          }
          // Disagreement → drop the signal
        }
      }
      break;
    }

    default:
      throw new Error(`[StrategyEngine] Unknown strategy type: ${(strategy as any).type}`);
  }

  // Apply session filter
  if (strategy.sessionFilter?.sessions?.length) {
    signals = applySessionFilter(signals, bars, strategy.sessionFilter.sessions);
  }

  // Apply confirmation filter
  if (strategy.confirmationBars && strategy.confirmationBars > 1) {
    signals = applyConfirmationFilter(signals, strategy.confirmationBars);
  }

  // Apply minimum confidence filter (belt-and-suspenders for non-model paths)
  if (strategy.minConfidence && strategy.minConfidence > 0) {
    signals = signals.filter(s => s.confidence >= strategy.minConfidence!);
  }

  console.log(
    `[StrategyEngine] ${strategy.type}/${strategy.indicatorPreset ?? 'default'}: ` +
    `${signals.length} signals after filters`,
  );
  return signals;
}

// ─── Session Filter ─────────────────────────────────────────────────────────

/**
 * Filter signals to only those that fall within active forex trading sessions.
 *
 * Sessions can wrap midnight (e.g. Sydney 21:00–06:00).
 * When multiple sessions are provided, a signal passes if it falls within ANY of them.
 */
export function applySessionFilter(
  signals: Signal[],
  _bars: OHLCVBar[],
  sessionKeys: string[],
): Signal[] {
  const sessions = sessionKeys
    .map(key => FOREX_SESSIONS[key])
    .filter((s): s is NonNullable<typeof s> => !!s);

  if (sessions.length === 0) return signals;

  return signals.filter(signal => {
    const hour = new Date(signal.timestamp).getUTCHours();
    return sessions.some(session => {
      if (session.startHourUTC < session.endHourUTC) {
        // Normal range (e.g. London 8–16)
        return hour >= session.startHourUTC && hour < session.endHourUTC;
      }
      // Wraps midnight (e.g. Sydney 21–6)
      return hour >= session.startHourUTC || hour < session.endHourUTC;
    });
  });
}

// ─── Confirmation Filter ────────────────────────────────────────────────────

/**
 * Require N consecutive signals with the same direction before emitting.
 *
 * Only emits the Nth signal in a consecutive run. Neutral signals (prediction=1)
 * reset the counter.
 */
export function applyConfirmationFilter(
  signals: Signal[],
  confirmationBars: number,
): Signal[] {
  if (confirmationBars <= 1) return signals;

  const filtered: Signal[] = [];
  let streak = 0;
  let lastDirection = -1;

  for (const signal of signals) {
    if (signal.prediction === 1) {
      // Neutral resets
      streak = 0;
      lastDirection = -1;
      continue;
    }

    if (signal.prediction === lastDirection) {
      streak++;
    } else {
      lastDirection = signal.prediction;
      streak = 1;
    }

    if (streak >= confirmationBars) {
      filtered.push(signal);
    }
  }

  return filtered;
}
