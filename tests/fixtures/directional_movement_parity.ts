// Runs the Market chart's own ADX (calcDirectionalMovement, the calculator behind the ADX indicator) on
// bars read from stdin, for the Python parity test of the structural regime model's ADX feature
// (packages/ml-engine/tests/test_cycle_regime_hmm.py). Input: {"high": [], "low": [], "close": [], "period": 14}.
import { readFileSync } from "node:fs";

import { calcDirectionalMovement } from "../../apps/web/src/market/lib/calculators/subchart/trend";

const input = JSON.parse(readFileSync(0, "utf8")) as { high: number[]; low: number[]; close: number[]; period: number };
process.stdout.write(JSON.stringify(calcDirectionalMovement(input.high, input.low, input.close, input.period).adx));
