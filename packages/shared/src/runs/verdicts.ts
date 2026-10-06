/**
 * The run's verdicts: every rule reads measured numbers off the run and says,
 * in one sentence, what is wrong and what to change. Pure, so the server (for
 * `GET /api/runs/:id`) and the tests run the same rules.
 *
 * Thresholds are rules of thumb, named here once so a reader can find and
 * change them: they flag a run for a closer look, they do not prove anything.
 */
import type { CycleRunStatus, CycleTrial } from "../cycle/schema";
import type { RunEpochPoint, RunFoldRow, RunVerdict } from "./types";

/** Log loss of always answering 50%: ln 2. A direction model above this is worse than saying nothing. */
export const COIN_FLIP_LOG_LOSS = Math.LN2;
/** Brier score of always answering 50%. */
export const COIN_FLIP_BRIER_SCORE = 0.25;
/** Below this many closed trades no trading statistic is stable enough to read. */
export const MINIMUM_TRADE_COUNT = 30;
/** Accuracy has to beat the majority-class share by more than this to count as skill. */
export const MINIMUM_ACCURACY_EDGE = 0.01;
/** ROC AUC has to clear this to count as ranking skill. */
export const MINIMUM_ROC_AUC = 0.52;
/** Validation loss this far above its own minimum, relative, while training loss kept falling. */
export const OVERFIT_VALIDATION_RISE = 0.02;
/** A Sharpe ratio this high on few trades is more often a leak than an edge. */
export const SUSPICIOUS_SHARPE_RATIO = 3;

export interface VerdictInput {
  status: CycleRunStatus;
  error: string | null;
  /** The final scoreboard's metrics, or the running one's while the run is live. */
  metrics: Record<string, number | null>;
  epochs: readonly RunEpochPoint[];
  trials: readonly CycleTrial[];
  folds: readonly RunFoldRow[];
}

const SEVERITY_ORDER: Record<RunVerdict["severity"], number> = { critical: 0, warning: 1, pass: 2 };

function known(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function usd(value: number): string {
  const rounded = Math.round(Math.abs(value)).toLocaleString("en-US");
  return `${value < 0 ? "-" : ""}$${rounded}`;
}

function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

// ─── learning ───────────────────────────────────────────────────────────────

interface FoldCurve {
  foldIndex: number;
  bestStep: number;
  bestValidationLoss: number;
  lastStep: number;
  lastValidationLoss: number;
  firstTrainLoss: number;
  lastTrainLoss: number;
}

/** One curve per fold for a model role: where validation loss bottomed and where it ended. */
export function foldCurves(epochs: readonly RunEpochPoint[], modelRole: "direction" | "price"): FoldCurve[] {
  const byFold = new Map<number, RunEpochPoint[]>();
  for (const point of epochs) {
    if (point.modelRole !== modelRole) continue;
    if (!known(point.validationLoss) || !known(point.trainLoss)) continue;
    const list = byFold.get(point.foldIndex) ?? [];
    list.push(point);
    byFold.set(point.foldIndex, list);
  }
  const curves: FoldCurve[] = [];
  for (const [foldIndex, points] of byFold) {
    if (points.length < 2) continue;
    points.sort((a, b) => a.step - b.step);
    let best = points[0]!;
    for (const point of points) if (point.validationLoss! < best.validationLoss!) best = point;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    curves.push({
      foldIndex,
      bestStep: best.step,
      bestValidationLoss: best.validationLoss!,
      lastStep: last.step,
      lastValidationLoss: last.validationLoss!,
      firstTrainLoss: first.trainLoss!,
      lastTrainLoss: last.trainLoss!,
    });
  }
  return curves.sort((a, b) => a.foldIndex - b.foldIndex);
}

function learningVerdicts(input: VerdictInput): RunVerdict[] {
  const out: RunVerdict[] = [];
  const curves = foldCurves(input.epochs, "direction");
  if (curves.length === 0) return out;

  const overfit = curves.filter(
    (curve) =>
      curve.lastTrainLoss < curve.firstTrainLoss &&
      curve.lastValidationLoss > curve.bestValidationLoss * (1 + OVERFIT_VALIDATION_RISE),
  );
  if (overfit.length > 0) {
    const worst = overfit.reduce((a, b) =>
      b.lastValidationLoss / b.bestValidationLoss > a.lastValidationLoss / a.bestValidationLoss ? b : a,
    );
    out.push({
      rule: "overfitting",
      severity: "warning",
      category: "learning",
      title: `Overfitting in ${overfit.length} of ${curves.length} folds: validation loss turned up while training loss kept falling.`,
      evidence:
        `Fold ${worst.foldIndex + 1}: validation loss bottomed at ${fixed(worst.bestValidationLoss)} on step ${worst.bestStep}, ` +
        `ended at ${fixed(worst.lastValidationLoss)} on step ${worst.lastStep}; training loss went ${fixed(worst.firstTrainLoss)} to ${fixed(worst.lastTrainLoss)}.`,
      action: "Stop earlier (fewer rounds or epochs), make the model smaller (lower depth or width), or regularise harder.",
    });
  }

  const neverBeatCoin = curves.filter((curve) => curve.bestValidationLoss >= COIN_FLIP_LOG_LOSS);
  if (neverBeatCoin.length > 0) {
    const best = curves.reduce((a, b) => (b.bestValidationLoss < a.bestValidationLoss ? b : a));
    out.push({
      rule: "validation_never_beat_coin_flip",
      severity: "critical",
      category: "learning",
      title: `Validation loss never got under a coin flip in ${neverBeatCoin.length} of ${curves.length} folds.`,
      evidence: `Best validation log loss was ${fixed(best.bestValidationLoss)} (fold ${best.foldIndex + 1}); always answering 50% scores ${fixed(COIN_FLIP_LOG_LOSS)}.`,
      action: "The features carry no signal for this label at this horizon. Change the label or the features before tuning the model.",
    });
  } else if (overfit.length === 0) {
    const best = curves.reduce((a, b) => (b.bestValidationLoss < a.bestValidationLoss ? b : a));
    out.push({
      rule: "learning_ok",
      severity: "pass",
      category: "learning",
      title: "Validation loss fell below a coin flip in every fold and did not turn back up.",
      evidence: `Best validation log loss ${fixed(best.bestValidationLoss)} against ${fixed(COIN_FLIP_LOG_LOSS)} for always answering 50%.`,
      action: "",
    });
  }
  return out;
}

// ─── prediction ─────────────────────────────────────────────────────────────

function predictionVerdicts(metrics: Record<string, number | null>): RunVerdict[] {
  const out: RunVerdict[] = [];
  const accuracy = metrics.accuracy;
  const majority = metrics.majority_class_accuracy;
  const balanced = metrics.balanced_accuracy;
  const recall = metrics.recall;
  const rocAuc = metrics.roc_auc;
  const logLoss = metrics.log_loss;
  const brier = metrics.brier_score;

  const oneDirection =
    (known(recall) && (recall >= 0.98 || recall <= 0.02)) ||
    (known(balanced) && Math.abs(balanced - 0.5) < 0.005 && known(accuracy) && known(majority) && Math.abs(accuracy - majority) < 0.005);
  if (oneDirection) {
    const side = known(recall) && recall <= 0.02 ? "down" : "up";
    out.push({
      rule: "one_direction",
      severity: "critical",
      category: "prediction",
      title: `The model calls "${side}" on almost every bar. It is not predicting, it is repeating the common direction.`,
      evidence:
        `Recall ${known(recall) ? percent(recall) : "n/a"}, balanced accuracy ${known(balanced) ? percent(balanced) : "n/a"} (50.0% is no skill), ` +
        `accuracy ${known(accuracy) ? percent(accuracy) : "n/a"} against ${known(majority) ? percent(majority) : "n/a"} for always calling the majority.`,
      action: "Raise the label threshold above 0 ticks so tiny moves are not labels, check class balance, and judge by balanced accuracy.",
    });
  } else if (known(accuracy) && known(majority)) {
    const edge = accuracy - majority;
    if (edge <= MINIMUM_ACCURACY_EDGE) {
      out.push({
        rule: "no_accuracy_edge",
        severity: "critical",
        category: "prediction",
        title: "Accuracy does not beat always guessing the common direction.",
        evidence: `Accuracy ${percent(accuracy)} against ${percent(majority)} for the majority class: an edge of ${(edge * 100).toFixed(2)} points.`,
        action: "There is no directional skill to trade. Change the label horizon or the feature set.",
      });
    } else {
      out.push({
        rule: "accuracy_edge",
        severity: "pass",
        category: "prediction",
        title: "Accuracy beats always guessing the common direction.",
        evidence: `Accuracy ${percent(accuracy)} against ${percent(majority)} for the majority class: an edge of ${(edge * 100).toFixed(2)} points.`,
        action: "",
      });
    }
  }

  if (known(rocAuc)) {
    if (rocAuc < MINIMUM_ROC_AUC) {
      out.push({
        rule: "no_ranking_skill",
        severity: "critical",
        category: "prediction",
        title: "The model's confidence does not rank bars: a high probability is no more likely to be right than a low one.",
        evidence: `ROC AUC ${fixed(rocAuc)}; 0.500 is random ordering and ${fixed(MINIMUM_ROC_AUC, 2)} is the bar set here.`,
        action: "Do not size or filter trades by this model's probability. Its scores are noise.",
      });
    } else {
      out.push({
        rule: "ranking_skill",
        severity: "pass",
        category: "prediction",
        title: "Higher probabilities are right more often than lower ones.",
        evidence: `ROC AUC ${fixed(rocAuc)} against 0.500 for random ordering.`,
        action: "",
      });
    }
  }

  if (known(logLoss) && logLoss >= COIN_FLIP_LOG_LOSS) {
    out.push({
      rule: "probabilities_worse_than_coin_flip",
      severity: "warning",
      category: "prediction",
      title: "Its probabilities are worse than answering 50% every time.",
      evidence:
        `Out-of-sample log loss ${fixed(logLoss, 4)} against ${fixed(COIN_FLIP_LOG_LOSS, 4)} for a coin flip` +
        (known(brier) ? `; Brier score ${fixed(brier, 4)} against ${fixed(COIN_FLIP_BRIER_SCORE, 2)}.` : "."),
      action: "The model is over-confident. Calibrate it on validation data, or regularise harder.",
    });
  }

  const priceSkill = metrics.price_forecast_skill;
  if (known(priceSkill)) {
    const forecastError = metrics.price_forecast_mean_absolute_error_points;
    const persistenceError = metrics.persistence_mean_absolute_error_points;
    const errors =
      known(forecastError) && known(persistenceError)
        ? ` Mean absolute error ${fixed(forecastError, 2)} points against ${fixed(persistenceError, 2)} for the last close.`
        : "";
    if (priceSkill <= 0) {
      out.push({
        rule: "price_forecast_loses_to_last_close",
        severity: "warning",
        category: "prediction",
        title: "The price forecast is no better than copying the last close.",
        evidence: `Forecast skill ${percent(priceSkill, 2)} against the persistence baseline (above 0 is better than the last close).${errors}`,
        action: "Ignore the forecast line on the chart for this run. A level target is persistent, so copying it is hard to beat.",
      });
    } else {
      out.push({
        rule: "price_forecast_beats_last_close",
        severity: "pass",
        category: "prediction",
        title: "The price forecast beats copying the last close.",
        evidence: `Forecast skill ${percent(priceSkill, 2)} against the persistence baseline.${errors}`,
        action: "",
      });
    }
  }
  return out;
}

// ─── trading ────────────────────────────────────────────────────────────────

function tradingVerdicts(metrics: Record<string, number | null>): RunVerdict[] {
  const out: RunVerdict[] = [];
  const trades = metrics.trade_count;
  const netProfit = metrics.net_profit_usd;
  const buyAndHold = metrics.buy_and_hold_net_profit_usd;
  const sharpe = metrics.sharpe_ratio;
  const exposure = metrics.exposure_fraction;
  const cost = metrics.total_cost_usd;
  const grossProfit = metrics.gross_profit_usd;
  const drawdown = metrics.maximum_drawdown_usd;

  const fewTrades = known(trades) && trades < MINIMUM_TRADE_COUNT;
  if (fewTrades) {
    out.push({
      rule: "too_few_trades",
      severity: "critical",
      category: "trading",
      title: `${trades} closed trades. Sharpe, win rate and profit factor mean nothing on a sample this small.`,
      evidence: `${trades} trades against a floor of ${MINIMUM_TRADE_COUNT}` + (known(exposure) ? `; in the market ${percent(exposure)} of bars.` : "."),
      action: "Shorten the holding period, set a stop and a target, or widen the test window until there are enough trades to judge.",
    });
  }

  if (known(exposure) && exposure > 0.98 && known(trades)) {
    out.push({
      rule: "always_in_market",
      severity: "warning",
      category: "trading",
      title: "It is in the market on nearly every bar: the result is the market's move, not the model's timing.",
      evidence:
        `Exposure ${percent(exposure)} across ${trades} trades` +
        (known(netProfit) && known(buyAndHold) ? `; net ${usd(netProfit)} against ${usd(buyAndHold)} for buy and hold.` : "."),
      action: "Make it stand aside when it is unsure: trade only above a probability threshold, or raise the label threshold.",
    });
  }

  if (known(netProfit) && known(buyAndHold)) {
    if (netProfit < 0) {
      out.push({
        rule: "lost_money",
        severity: "critical",
        category: "trading",
        title: "It lost money after costs.",
        evidence:
          `Net ${usd(netProfit)}` +
          (known(sharpe) ? `, Sharpe ${fixed(sharpe, 2)}` : "") +
          (known(drawdown) ? `, worst drawdown ${usd(drawdown)}` : "") +
          `; buy and hold returned ${usd(buyAndHold)} over the same bars.`,
        action: "Do not trade this. Fix the prediction findings first; a trading rule cannot rescue calls with no skill.",
      });
    } else if (netProfit <= buyAndHold) {
      out.push({
        rule: "lost_to_buy_and_hold",
        severity: "warning",
        category: "trading",
        title: "It made money, but less than buying and holding.",
        evidence: `Net ${usd(netProfit)} against ${usd(buyAndHold)} for buy and hold.`,
        action: "The model added nothing over the market's drift in this window. Test it on a window where the market fell.",
      });
    } else if (!fewTrades) {
      out.push({
        rule: "beat_buy_and_hold",
        severity: "pass",
        category: "trading",
        title: "It made money after costs and beat buy and hold.",
        evidence: `Net ${usd(netProfit)} against ${usd(buyAndHold)} for buy and hold` + (known(sharpe) ? `, Sharpe ${fixed(sharpe, 2)}.` : "."),
        action: "",
      });
    }
  }

  if (known(sharpe) && sharpe > SUSPICIOUS_SHARPE_RATIO) {
    out.push({
      rule: "too_good",
      severity: "warning",
      category: "trading",
      title: "The Sharpe ratio is higher than a real edge usually is. Check for a leak before believing it.",
      evidence: `Sharpe ${fixed(sharpe, 2)} on ${known(trades) ? trades : "an unknown number of"} trades; above ${SUSPICIOUS_SHARPE_RATIO} is the flag.`,
      action: "Check that no feature sees the future, that purge covers the label horizon, and rerun on another symbol or period.",
    });
  }

  if (known(cost) && known(grossProfit) && grossProfit > 0 && cost / grossProfit > 0.5) {
    out.push({
      rule: "costs_eat_the_edge",
      severity: "warning",
      category: "trading",
      title: "Costs take more than half of the gross profit.",
      evidence: `Costs ${usd(cost)} against gross profit ${usd(grossProfit)}: ${percent(cost / grossProfit, 0)}.`,
      action: "Trade less often: lengthen the holding period or require a bigger predicted move before entering.",
    });
  }
  return out;
}

// ─── tuning ─────────────────────────────────────────────────────────────────

function tuningVerdicts(trials: readonly CycleTrial[]): RunVerdict[] {
  const complete = trials.filter((trial) => trial.state === "complete" && known(trial.objectiveValue));
  if (complete.length < 2) return [];
  const objective = complete[0]!.objectiveName;
  const lowerIsBetter = objective === "log_loss";
  const byFold = new Map<number, CycleTrial[]>();
  for (const trial of complete) {
    const fold = trial.foldIndex ?? 0;
    const list = byFold.get(fold) ?? [];
    list.push(trial);
    byFold.set(fold, list);
  }
  const bestPerFold: number[] = [];
  for (const list of byFold.values()) {
    const values = list.map((trial) => trial.objectiveValue as number);
    bestPerFold.push(lowerIsBetter ? Math.min(...values) : Math.max(...values));
  }
  const out: RunVerdict[] = [];
  if (objective === "sharpe_ratio") {
    const losing = bestPerFold.filter((value) => value <= 0).length;
    if (losing > 0) {
      out.push({
        rule: "search_found_nothing_profitable",
        severity: "critical",
        category: "tuning",
        title: `In ${losing} of ${bestPerFold.length} folds no setting the search tried made money on the fold's own training window.`,
        evidence: `Best Sharpe per fold: ${bestPerFold.map((value) => fixed(value, 2)).join(", ")} across ${complete.length} completed trials.`,
        action: "More trials will not help. The model family or the features are wrong for this label; change those.",
      });
    } else {
      out.push({
        rule: "search_found_profitable_settings",
        severity: "pass",
        category: "tuning",
        title: "The search found settings with a positive Sharpe ratio in every fold's training window.",
        evidence: `Best Sharpe per fold: ${bestPerFold.map((value) => fixed(value, 2)).join(", ")} across ${complete.length} completed trials.`,
        action: "",
      });
    }
  }
  return out;
}

// ─── folds ──────────────────────────────────────────────────────────────────

function foldVerdicts(folds: readonly RunFoldRow[]): RunVerdict[] {
  const profits = folds.map((fold) => fold.metrics.net_profit_usd).filter(known);
  if (profits.length < 2) return [];
  const winning = profits.filter((value) => value > 0).length;
  const listed = profits.map((value) => usd(value)).join(", ");
  if (winning === profits.length) {
    return [
      {
        rule: "every_fold_profitable",
        severity: "pass",
        category: "folds",
        title: `Profitable in all ${profits.length} test windows.`,
        evidence: `Net profit per fold: ${listed}.`,
        action: "",
      },
    ];
  }
  if (winning === 0) {
    return [
      {
        rule: "every_fold_lost",
        severity: "critical",
        category: "folds",
        title: `It lost money in all ${profits.length} test windows.`,
        evidence: `Net profit per fold: ${listed}.`,
        action: "The loss is consistent, not bad luck in one window.",
      },
    ];
  }
  return [
    {
      rule: "unstable_across_folds",
      severity: "warning",
      category: "folds",
      title: `Profitable in ${winning} of ${profits.length} test windows: the result depends on which window you look at.`,
      evidence: `Net profit per fold: ${listed}.`,
      action: "Run more folds before trusting the total. One good window is carrying it.",
    },
  ];
}

// ─── the run ────────────────────────────────────────────────────────────────

/** Every verdict on a run, the worst first. */
export function judgeRun(input: VerdictInput): RunVerdict[] {
  const out: RunVerdict[] = [];
  if (input.status === "failed") {
    out.push({
      rule: "run_failed",
      severity: "critical",
      category: "learning",
      title: "The run failed before it finished.",
      evidence: input.error ?? "No error message was recorded.",
      action: "Read the last lines of the terminal for the traceback.",
    });
  }
  out.push(...learningVerdicts(input));
  out.push(...predictionVerdicts(input.metrics));
  out.push(...tradingVerdicts(input.metrics));
  out.push(...tuningVerdicts(input.trials));
  out.push(...foldVerdicts(input.folds));
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface RunHeadline {
  tone: "critical" | "warning" | "pass" | "pending";
  text: string;
}

/** The one line above the verdicts. */
export function headlineOf(status: CycleRunStatus, verdicts: readonly RunVerdict[]): RunHeadline {
  const critical = verdicts.filter((verdict) => verdict.severity === "critical").length;
  const warning = verdicts.filter((verdict) => verdict.severity === "warning").length;
  const live = status === "running" ? " so far" : "";
  if (verdicts.length === 0) {
    return { tone: "pending", text: status === "running" ? "Running. Verdicts appear as numbers arrive." : "No scored bars in this run." };
  }
  if (critical > 0) {
    return { tone: "critical", text: `Do not trade this${live}: ${critical} critical finding${critical === 1 ? "" : "s"}, ${warning} warning${warning === 1 ? "" : "s"}.` };
  }
  if (warning > 0) {
    return { tone: "warning", text: `Not ready${live}: ${warning} warning${warning === 1 ? "" : "s"} to clear.` };
  }
  return { tone: "pass", text: `Every check passed${live}. Confirm it on another period before trusting it.` };
}
