/**
 * The terminal grammar read into columns, on lines the engine really wrote
 * (run MNQ_5m_hidden_markov_regimes, 2026-10-07).
 */
import { describe, expect, it } from "vitest";

import { parseLogLine, STAGE_MEANING, summariseTrials, type LogRow } from "@shared/runs/logRows";

const at = 1_760_000_000_000;
const line = (message: string, level: LogRow["level"] = "info") => parseLogLine({ seq: 1, level, message, receivedAt: at });

describe("parseLogLine", () => {
  it("reads a test step into bar, close, P(up), signal, position, equity and forecast columns", () => {
    const row = line("[fold 1/3][test] 2025-12-02 02:20 bar 1/1352 close=25695.75 p_up=0.522 signal=LONG position=LONG equity=+$0.00 forecast=25695.50@02:50");
    expect(row.fold).toBe(1);
    expect(row.foldCount).toBe(3);
    expect(row.stage).toBe("test");
    expect(row.event).toBe("test step");
    expect(row.barStamp).toBe("2025-12-02 02:20");
    const by = Object.fromEntries(row.numbers.map((n) => [n.name, n.value]));
    expect(by).toMatchObject({ bar: "1 of 1352", close: "25695.75", "P(up)": "0.522", signal: "LONG", position: "LONG", equity: "+$0.00", "price forecast": "25695.50@02:50" });
  });

  it("reads a trial's start, fit, validation and score; every column name is in full words", () => {
    const start = line('[fold 1/3][tune trial 1/20] start {"state_count": 3, "readout_prior_strength": 82.46413065237456}');
    expect(start.stage).toBe("tune");
    expect(start.trial).toBe(1);
    expect(start.trialCount).toBe(20);
    expect(start.event).toBe("trial started with these settings");
    expect(start.numbers).toEqual([{ name: "state count", value: "3" }, { name: "readout prior strength", value: "82.4641" }]);
    const fit = line("[fold 1/3][tune trial 1/20][train] fit 1/1 step 1/1 loss=0.6893 samples/s=543 block=2025-09-30 00:00..2025-10-15 19:00 (every round sees the whole training window)", "debug");
    expect(fit.stage).toBe("tune");
    expect(fit.event).toBe("fit step");
    expect(fit.numbers.map((n) => n.name)).toEqual(["training loss", "samples per second", "bars seen", "fit", "step"]);
    const validate = line("[fold 1/3][tune trial 1/20][validate] fit 1/1 val_loss=0.7041 val_accuracy=0.460 val_f1=0.630 best=0.7041@1", "debug");
    expect(validate.numbers.map((n) => n.name)).toEqual(["validation loss", "validation accuracy", "validation F1", "best so far", "fit"]);
    const score = line("[fold 1/3][tune trial 1/20] complete sharpe_ratio=1.2493 best=1.2493 (trial 1)");
    expect(score.event).toBe("trial scored");
    expect(score.numbers).toEqual([{ name: "Sharpe ratio", value: "1.2493" }, { name: "best so far", value: "1.2493" }]);
    for (const row of [start, fit, validate, score]) for (const n of row.numbers) expect(n.name).not.toMatch(/_|\/s$/);
  });

  it("reads the fold's out-of-sample summary into named numbers", () => {
    const row = line("[fold 1/3][test] fold done: net +$502.22, Sharpe 3.65, 1 trades, accuracy 0.548 on 1304 scored bars (1352 walked in 0.7 s)");
    expect(row.event).toBe("fold finished out of sample");
    expect(Object.fromEntries(row.numbers.map((n) => [n.name, n.value]))).toEqual({
      "net profit": "+$502.22", "Sharpe ratio": "3.65", trades: "1", accuracy: "0.548", "scored bars": "1304", "bars walked": "1352", "walk time": "0.7 s",
    });
  });

  it("reads trades, the price-forecast score, the plan and the data lines", () => {
    const exit = line("[trade #1] EXIT LONG @ 25948.75 2025-12-08 23:55 bars=1351 reason=fold_end gross=+$505.00 cost=$2.78 net=+$502.22");
    expect(exit.stage).toBe("trade");
    expect(exit.trade).toBe(1);
    expect(exit.event).toBe("exited long");
    expect(Object.fromEntries(exit.numbers.map((n) => [n.name, n.value]))).toMatchObject({ "bars held": "1351", "exit reason": "fold_end", gross: "+$505.00", cost: "$2.78", net: "+$502.22" });
    const forecast = line("[fold 1/3][test] price forecast: mean absolute error 20.28 points against 20.20 for the no-change forecast (skill -0.004), direction accuracy 0.451 on 1316 resolved forecasts");
    expect(forecast.numbers.map((n) => n.name)).toEqual(["forecast mean absolute error", "no-change forecast error", "forecast skill", "direction accuracy", "resolved forecasts"]);
    const plan = line("[plan] fold 1/3: train 2025-09-30 00:00..2025-11-24 08:05 (10581 bars) validate 2025-11-24 08:40..2025-12-02 01:45 (1305) test 2025-12-02 02:20..2025-12-08 23:55 (1352)");
    expect(plan.stage).toBe("plan");
    expect(plan.numbers[0]).toEqual({ name: "train", value: "2025-09-30 00:00 → 2025-11-24 08:05 (10581 bars)" });
    const roll = line("[data] roll MNQU5 -> MNQZ5 at 2025-09-15 00:00: splice step +241.75 points (both contracts' closes on the same bar)");
    expect(roll.stage).toBe("data");
    expect(roll.numbers).toEqual([{ name: "splice step", value: "+241.75 pts" }]);
    const landed = line("[save] landed bars: 25,122 rows -> s3://derived/model_cycle_runs/recipe=x/table=bars/part-0.parquet (manifest written)", "debug");
    expect(landed.event).toBe("table landed in the lake");
    expect(landed.numbers).toEqual([{ name: "table", value: "bars" }, { name: "rows", value: "25,122" }]);
  });

  it("folds a trial's rows into one summary with its settings, score and step count", () => {
    const rows = [
      line('[fold 2/3][tune trial 4/20] start {"state_count": 2}'),
      line("[fold 2/3][tune trial 4/20][train] fit 1/1 step 1/1 loss=0.69 samples/s=500 block=a..b", "debug"),
      line("[fold 2/3][tune trial 4/20][validate] fit 1/1 val_loss=0.70 val_accuracy=0.5 val_f1=0.6 best=0.70@1", "debug"),
      line("[fold 2/3][tune trial 4/20] complete sharpe_ratio=-0.5 best=1.1 (trial 2)"),
      line("[fold 2/3][train] fitted in 1.1 s"),
    ];
    const trials = summariseTrials(rows);
    expect(trials.size).toBe(1);
    const summary = trials.get(0)!;
    expect(summary).toMatchObject({ fold: 2, trial: 4, trialCount: 20, stepCount: 4, firstIndex: 0, lastIndex: 3 });
    expect(summary.settings).toEqual([{ name: "state count", value: "2" }]);
    expect(summary.score).toEqual({ name: "Sharpe ratio", value: "-0.5" });
    expect(summary.bestSoFar).toEqual({ name: "best so far", value: "1.1" });
  });

  it("gives every stage a plain-words meaning", () => {
    for (const entry of Object.values(STAGE_MEANING)) expect(entry.meaning.length).toBeGreaterThan(40);
  });
});
