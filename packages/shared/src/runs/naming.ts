/**
 * How a run is named, so two runs of the same model read as two things.
 *
 * - `runName(id)`: a memorable `adjective-noun-NN`, derived from the run id's
 *   hash, so every run (live, recorded, old) has the same name every time it is
 *   read and nothing has to be stored.
 * - `runVersions(runs)`: the ordinal of each run among the runs of the same
 *   model, symbol and timeframe, oldest first: `xgboost v7` is the seventh
 *   XGBoost run on that series.
 * - `runPurpose(...)`: one line saying what the model is and does, from the
 *   run's own plan.
 */

const ADJECTIVES = [
  "amber", "brisk", "calm", "clear", "cool", "crisp", "dusky", "eager", "early", "fair",
  "fast", "firm", "fresh", "glad", "gold", "grand", "hardy", "hazy", "keen", "late",
  "light", "lively", "lone", "lucky", "merry", "mild", "misty", "noble", "pale", "plain",
  "proud", "quick", "quiet", "rapid", "rare", "ready", "royal", "rusty", "sharp", "silent",
  "sleek", "smart", "snowy", "soft", "solid", "spare", "steady", "still", "stout", "sunny",
  "swift", "tidy", "tough", "true", "vivid", "warm", "wild", "wise", "witty", "young",
] as const;

const NOUNS = [
  "aspen", "badger", "beacon", "birch", "bison", "canyon", "cedar", "comet", "coral", "crane",
  "delta", "dune", "eagle", "ember", "falcon", "fjord", "forest", "glacier", "harbor", "heron",
  "island", "jaguar", "juniper", "kestrel", "lagoon", "lark", "lynx", "maple", "marsh", "meadow",
  "mesa", "moose", "oak", "orca", "osprey", "otter", "pebble", "pine", "plover", "prairie",
  "quartz", "raven", "reef", "ridge", "river", "robin", "saddle", "sierra", "sparrow", "spruce",
  "summit", "tundra", "valley", "walnut", "willow", "wren", "yarrow", "zenith", "basalt", "cobalt",
] as const;

/** FNV-1a, 32-bit: stable across runtimes, good enough to spread ids over the word lists. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** `brisk-heron-41`: the same for the same run id, every time. */
export function runName(runId: string): string {
  const h = hash(runId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length]!;
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]!;
  const number = Math.floor(h / (ADJECTIVES.length * NOUNS.length)) % 100;
  return `${adjective}-${noun}-${number}`;
}

export interface VersionedRun {
  id: string;
  modelType: string;
  symbol: string | null;
  timeframe: string | null;
  startedAt: number;
}

/** Each run's version among the runs of the same model on the same series, oldest = 1. */
export function runVersions(runs: readonly VersionedRun[]): Map<string, number> {
  const groups = new Map<string, VersionedRun[]>();
  for (const run of runs) {
    const key = `${run.modelType}|${run.symbol ?? ""}|${run.timeframe ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  const versions = new Map<string, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    list.forEach((run, index) => versions.set(run.id, index + 1));
  }
  return versions;
}

export interface PurposeInput {
  modelLabel: string;
  symbol: string | null;
  timeframe: string | null;
  directionMode?: "classifier" | "from_price" | null;
  hasPriceModel?: boolean | null;
  labelHorizonBars?: number | null;
  /** "direction" (the default) or "reversal": what the direction model predicts. */
  labelKind?: "direction" | "reversal" | null;
  tuningObjective?: string | null;
  tuningTrialCount?: number | null;
}

const OBJECTIVE_WORDS: Record<string, string> = {
  sharpe_ratio: "Sharpe ratio",
  log_loss: "log loss",
  f1_score: "F1 score",
};

/**
 * What the run is for, in one line: the model, what it predicts, on what, how
 * far ahead, and how its settings were chosen. Built from the plan the engine
 * announced, so it is true of the run rather than of the model in general.
 */
/** `5m` → `5-minute`, `1h` → `1-hour`; null when the timeframe is not of that shape. */
function timeframeWords(timeframe: string | null | undefined): string | null {
  const match = /^(\d+)(m|h|d)$/.exec(timeframe ?? "");
  if (!match) return null;
  const unit = { m: "minute", h: "hour", d: "day" }[match[2] as "m" | "h" | "d"];
  return `${Number(match[1])}-${unit}`;
}

/** The horizon as a clock span: `6 bars (30 minutes)` for 6 bars of 5 minutes; bars alone when the timeframe is unknown. */
function horizonWords(bars: number, timeframe: string | null | undefined): string {
  const match = /^(\d+)(m|h|d)$/.exec(timeframe ?? "");
  if (!match) return `${bars} bar${bars === 1 ? "" : "s"}`;
  const minutes = Number(match[1]) * { m: 1, h: 60, d: 1440 }[match[2] as "m" | "h" | "d"] * bars;
  const span = minutes % 1440 === 0 && minutes >= 1440 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;
  return `${bars} bar${bars === 1 ? "" : "s"} (${span})`;
}

/**
 * What the run is and does, in complete sentences a reader can check against the
 * data: the instrument and bar size, exactly what is predicted and over what
 * horizon, and how the settings were chosen. Never shorthand.
 */
export function runPurpose(input: PurposeInput): string {
  const series = input.symbol ? `${input.symbol}${timeframeWords(input.timeframe) ? ` on ${timeframeWords(input.timeframe)} bars` : input.timeframe ? ` ${input.timeframe}` : ""}` : "the series";
  const horizon = input.labelHorizonBars ? horizonWords(input.labelHorizonBars, input.timeframe) : null;
  const close = horizon ? `the close ${horizon} after each bar` : "a later close";
  const sentences: string[] = [];
  if (input.directionMode === "from_price") {
    sentences.push(`${input.modelLabel} forecasts ${series}: for every bar it predicts where ${close} will be, in points, and the direction it trades is the sign of that forecast.`);
  } else if (input.hasPriceModel) {
    if (input.labelKind === "reversal") {
      sentences.push(`${input.modelLabel} on ${series}: for every bar it predicts whether the move over the next ${horizon} will turn against the move over the previous ${horizon} (a reversal classifier, giving a probability of a turn; the walk trades against the previous move when that probability is at or above 0.5 and with it below), and a second model predicts how far the price will move, in points.`);
    } else {
      sentences.push(`${input.modelLabel} on ${series}: for every bar it predicts whether ${close} will be above or below that bar's close (a direction classifier, giving a probability of up), and a second model predicts how far it will move, in points.`);
    }
  } else if (input.directionMode === "classifier") {
    if (input.labelKind === "reversal") {
      sentences.push(`${input.modelLabel} on ${series}: for every bar it predicts whether the move over the next ${horizon} will turn against the move over the previous ${horizon} (a reversal classifier, giving a probability of a turn; the walk trades against the previous move when that probability is at or above 0.5 and with it below).`);
    } else {
      sentences.push(`${input.modelLabel} on ${series}: for every bar it predicts whether ${close} will be above or below that bar's close (a direction classifier, giving a probability of up).`);
    }
  } else {
    sentences.push(`${input.modelLabel} on ${series}, predicting ${close}.`);
  }
  if (input.tuningTrialCount && input.tuningTrialCount > 0) {
    const objective = input.tuningObjective ? OBJECTIVE_WORDS[input.tuningObjective] ?? input.tuningObjective : "its objective";
    sentences.push(`Inside every fold, ${input.tuningTrialCount} candidate setting${input.tuningTrialCount === 1 ? "" : "s"} were tried on that fold's own training bars and the one with the best ${objective} was kept.`);
  } else if (input.tuningTrialCount === 0) {
    sentences.push("Settings are the registry's reviewed defaults; nothing was searched.");
  }
  return sentences.join(" ");
}
