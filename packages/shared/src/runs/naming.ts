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
export function runPurpose(input: PurposeInput): string {
  const parts: string[] = [input.modelLabel];
  if (input.directionMode === "from_price") {
    parts.push("price model, direction taken from the forecast");
  } else if (input.hasPriceModel) {
    parts.push("direction classifier + price model");
  } else if (input.directionMode === "classifier") {
    parts.push("direction classifier");
  }
  if (input.symbol) parts.push(`${input.symbol}${input.timeframe ? ` ${input.timeframe}` : ""}`);
  if (input.labelHorizonBars) parts.push(`calls the move ${input.labelHorizonBars} bars ahead`);
  if (input.tuningTrialCount && input.tuningTrialCount > 0) {
    const objective = input.tuningObjective ? OBJECTIVE_WORDS[input.tuningObjective] ?? input.tuningObjective : "its objective";
    parts.push(`settings searched on ${objective}, ${input.tuningTrialCount} trials per fold`);
  } else if (input.tuningTrialCount === 0) {
    parts.push("reviewed default settings");
  }
  return parts.join(" · ");
}
