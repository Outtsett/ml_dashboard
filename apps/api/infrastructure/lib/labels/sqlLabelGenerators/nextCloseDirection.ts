/**
 * Next-Close Direction — binary up/down on the next bar close.
 *
 * Thin wrapper around `direction` with horizon defaulting to 1, threshold=0,
 * numClasses=2. Cheapest possible label target — high autocorrelation, watch
 * for leakage when paired with engineered momentum features.
 *
 * Output: { timestamp, symbol, close, label, resolution_bars, future_return_fraction } where
 * label ∈ {-1 (down or flat), 1 (up)}.
 */

import type { LabelGeneratorConfig } from './helpers';
import { generateDirectionLabelsSQL } from './direction';

export interface NextCloseDirectionParams {
  horizonBars?: number;
}

export function generateNextCloseDirectionLabelsSQL(
  params: NextCloseDirectionParams,
  config: LabelGeneratorConfig,
): string {
  const horizon = Math.max(1, Math.floor(Number(params.horizonBars ?? 1)));
  return generateDirectionLabelsSQL(
    { horizonBars: horizon, thresholdPercent: 0, classCount: 2 },
    config,
  );
}
