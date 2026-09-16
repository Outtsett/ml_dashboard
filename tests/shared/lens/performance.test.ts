/**
 * The largest record the lens has to serve is MNQ_1m_cnn_transformer:
 * 468,929 out-of-sample rows at a 20-row forward horizon. A control on the
 * dashboard has to feel immediate, so a full evaluateLens over that record has
 * to finish in well under a second and a half in Node.
 *
 * The series here is synthetic but the same SHAPE: the same row count, the same
 * horizon, a label and a realised return on every row, and a full set of seven
 * conformal quantiles, so nothing that scales with n is skipped.
 */

import { describe, expect, it } from "vitest";
import { buildBarWindow, clampLensParams, evaluateLens, createRandom } from "@shared/lens/index";
import { makeManifest, makeSeries } from "./fixtures";

const ROW_COUNT = 468_929;
const HORIZON_BARS = 20;
const BUDGET_MILLISECONDS = 1500;

function buildLargeSeries() {
  const random = createRandom(20260915);
  const close: number[] = new Array(ROW_COUNT);
  const probabilityUp: number[] = new Array(ROW_COUNT);
  const label: Array<0 | 1> = new Array(ROW_COUNT);
  const realized: number[] = new Array(ROW_COUNT);
  const quantiles: Array<Array<number | null>> = Array.from({ length: 7 }, () => new Array(ROW_COUNT));
  const offsets = [-90, -70, -35, 0, 35, 70, 90];

  let price = 19_000;
  for (let index = 0; index < ROW_COUNT; index += 1) {
    price += (random() - 0.5) * 2;
    close[index] = Math.round(price * 4) / 4;
    probabilityUp[index] = 0.5 + (random() - 0.5) * 0.6;
    label[index] = random() > 0.5 ? 1 : 0;
    realized[index] = (random() - 0.5) * 120;
    const width = 0.5 + random();
    for (let q = 0; q < 7; q += 1) (quantiles[q] as Array<number | null>)[index] = (offsets[q] as number) * width;
  }

  const series = makeSeries({
    close,
    probabilityUp,
    label,
    realizedReturnBasisPoints: realized,
    quantilesBasisPoints: quantiles,
    horizonBars: HORIZON_BARS,
    roundTripPoints: 1.4,
    pointValueUsd: 2,
  });
  const manifest = makeManifest(series, { defaultThreshold: 0.55 });
  return { series, manifest };
}

describe("evaluateLens performance", () => {
  it(
    `evaluates a ${ROW_COUNT.toLocaleString()}-row record in under ${BUDGET_MILLISECONDS} ms`,
    { timeout: 600_000 },
    () => {
      const { series, manifest } = buildLargeSeries();
      const params = clampLensParams({}, manifest);

      // One warm pass so the measurement is not dominated by first-call JIT.
      evaluateLens(series, null, manifest, params);

      const started = performance.now();
      const evaluation = evaluateLens(series, null, manifest, params);
      const elapsed = performance.now() - started;

      const windowStarted = performance.now();
      const window = buildBarWindow(
        series,
        null,
        manifest,
        params,
        { startRowIndex: 400_000, endRowIndex: 404_999 },
        5000,
      );
      const windowElapsed = performance.now() - windowStarted;

       
      console.log(
        `evaluateLens over ${ROW_COUNT.toLocaleString()} rows: ${elapsed.toFixed(1)} ms ` +
          `(${evaluation.headline.tradeCount.toLocaleString()} trades, ` +
          `${evaluation.equity.length} equity points, ${evaluation.rolling.points.length} rolling points); ` +
          `buildBarWindow over 5,000 bars: ${windowElapsed.toFixed(1)} ms`,
      );

      expect(evaluation.headline.barCount).toBe(ROW_COUNT);
      expect(evaluation.headline.tradeCount).toBeGreaterThan(1000);
      expect(evaluation.equity.length).toBeLessThanOrEqual(3000);
      expect(evaluation.rolling.points.length).toBeLessThanOrEqual(2000);
      expect(evaluation.scatter.points.length).toBeLessThanOrEqual(4000);
      expect(window.bars).toHaveLength(5000);
      expect(elapsed).toBeLessThan(BUDGET_MILLISECONDS);
    },
  );
});
