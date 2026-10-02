// Runs the Market chart's own support/resistance on bars read from stdin, for the Python parity test
// (tests/test_zones.py). Input: {"bars": [{time, open, high, low, close}], "lookback": 5, "maxLevels": 10}.
import { readFileSync } from "node:fs";

import { computeSupportResistance } from "../../apps/web/src/market/lib/chart_overlays";

const input = JSON.parse(readFileSync(0, "utf8")) as {
  bars: { time: number; open: number; high: number; low: number; close: number }[];
  lookback: number;
  maxLevels: number;
};
process.stdout.write(JSON.stringify(computeSupportResistance(input.bars, input.lookback, input.maxLevels)));
