/**
 * Next-Close Direction — binary up/down on the next bar close.
 *
 * Thin wrapper around `direction` with horizon defaulting to 1, threshold=0,
 * numClasses=2. Cheapest possible label target — high autocorrelation, watch
 * for leakage when paired with engineered momentum features.
 *
 * Output: { timestamp, symbol, close, future_return, label } where
 * label ∈ {-1 (down or flat), 1 (up)}.
 */

import type { LabelGeneratorConfig } from './helpers';
import { generateDirectionLabelsSQL } from './direction';

export interface NextCloseDirectionParams {
  horizon?: number;
}

export function generateNextCloseDirectionLabelsSQL(
  params: NextCloseDirectionParams,
  config: LabelGeneratorConfig,
): string {
  const horizon = Math.max(1, params.horizon ?? 1);
  return generateDirectionLabelsSQL(
    { horizon, threshold: 0, numClasses: 2 },
    config,
  );
}
