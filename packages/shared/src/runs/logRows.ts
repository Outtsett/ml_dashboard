/**
 * The terminal's grammar, read into columns. The Model Cycle engine writes one
 * line per event in a fixed shape (`[fold 1/3][tune trial 7/20] complete
 * sharpe_ratio=1.25 best=1.25 (trial 1)`); this module turns each line into
 * a row the page can lay out as columns — when, which fold, which stage, what
 * happened in plain words, and the numbers as named values — so the log reads
 * as a table instead of a wall of text. The raw line is kept on every row.
 */

export type LogStage = "data" | "device" | "features" | "plan" | "tune" | "train" | "validate" | "replay" | "test" | "trade" | "save" | "other";

/** What each stage is, in one sentence a reader can act on. */
export const STAGE_MEANING: Record<LogStage, { label: string; meaning: string }> = {
  data: { label: "Data", meaning: "Reading the bars from the lake and back-adjusting them at contract rolls, so a roll is not a price move." },
  device: { label: "Device", meaning: "Which processor the run fits on: the GPU when the model can use it, otherwise the CPU." },
  features: { label: "Features", meaning: "The causal columns computed from the bars (rolling, z-scored, clipped) that the model reads; a dropped feature needs data the lake does not carry for this symbol." },
  plan: { label: "Plan", meaning: "How the bars are cut into walk-forward folds (train, validation, test, in time order), the label, the trading rule and the search budget." },
  tune: { label: "Search", meaning: "Trying candidate settings on the fold's own training bars (Optuna); each trial fits, scores on inner validation blocks, and the best score's settings are kept for the fold." },
  train: { label: "Fit", meaning: "Fitting the model with the chosen settings on the fold's training bars; the price model is a second fit that predicts the size of the move." },
  validate: { label: "Validate", meaning: "Scoring the fit on the fold's validation bars (bars it did not train on) to pick the kept step; still in-sample for the search." },
  replay: { label: "Replay", meaning: "Walking the validation bars one at a time with the fitted model — a look at what it does, never a test result." },
  test: { label: "Test", meaning: "Walking the fold's test bars one at a time, out of sample: every prediction, trade and score here is the real result." },
  trade: { label: "Trade", meaning: "A position opened or closed by the trading rule during the test walk, with its fill, bars held and net after costs." },
  save: { label: "Record", meaning: "Landing the run's tables in the lake and its artifacts beside the model, at every fold and at the end." },
  other: { label: "Note", meaning: "A line outside the stage grammar: shown as written, with no fold or stage." },
};

export interface LogNumber {
  /** The quantity in full words (`validation loss`, `P(up)`), never the engine's key. */
  name: string;
  /** The value as the engine printed it (`0.6927`, `+$502.22`, `25,128.75`). */
  value: string;
}

export interface LogRow {
  seq: number | null;
  level: "debug" | "info" | "warn" | "error";
  receivedAt: number;
  /** 1-based fold number and the fold count, when the line belongs to a fold. */
  fold: number | null;
  foldCount: number | null;
  stage: LogStage;
  /** 1-based trial number and count, when the line belongs to a search trial. */
  trial: number | null;
  trialCount: number | null;
  /** The trade number for `[trade #n]` lines. */
  trade: number | null;
  /** What happened, in plain words, without the bracket prefixes or the numbers. */
  event: string;
  numbers: LogNumber[];
  /** The bar the line is stamped with (`2025-12-02 02:20`), when it names one. */
  barStamp: string | null;
  /** The line as the engine wrote it. */
  raw: string;
}

const PREFIX = /^(?:\[fold (\d+)\/(\d+)\])?\s*(?:\[(tune trial (\d+)\/(\d+)|tune|train|validate|replay|test|data|device|features|plan|save|trade #(\d+))\])?\s*(?:\[(train|validate)\])?\s*/;

/** Engine keys → full words. A key not listed is shown with its underscores as spaces. */
const KEY_WORDS: Record<string, string> = {
  loss: "training loss",
  val_loss: "validation loss",
  val_accuracy: "validation accuracy",
  val_f1: "validation F1",
  val_mae: "validation mean absolute error",
  val_sign_accuracy: "validation sign accuracy",
  best: "best so far",
  "samples/s": "samples per second",
  block: "bars seen",
  p_up: "P(up)",
  signal: "signal",
  position: "position",
  equity: "equity",
  forecast: "price forecast",
  close: "close",
  bars: "bars held",
  reason: "exit reason",
  gross: "gross",
  cost: "cost",
  net: "net",
  sharpe_ratio: "Sharpe ratio",
  net_profit_usd: "net profit",
  accuracy: "accuracy",
  fit: "fit",
  step: "step",
  bar: "bar",
};

// a key is a word (`val_loss`) or the one slashed key the engine writes (`samples/s`); never a path segment
const KEY_VALUE = /(?<![\w$/])([a-z_]\w*(?:\/s)?)=([^\s,;]+)/g;

const SENTENCE_NUMBERS: Array<[RegExp, (m: RegExpExecArray) => LogNumber[]]> = [
  [/fold done: net ([-+$\d.,]+), Sharpe ([-\d.]+), ([\d,]+) trades?, accuracy ([\d.]+) on ([\d,]+) scored bars \(([\d,]+) walked in ([\d.]+ s)\)/,
    (m) => [n("net profit", m[1]!), n("Sharpe ratio", m[2]!), n("trades", m[3]!), n("accuracy", m[4]!), n("scored bars", m[5]!), n("bars walked", m[6]!), n("walk time", m[7]!)]],
  [/([\d,]+) validation bars walked, ([\d,]+) trades?, net ([-+$\d.,]+), accuracy ([\d.]+)/,
    (m) => [n("validation bars", m[1]!), n("trades", m[2]!), n("net", m[3]!), n("accuracy", m[4]!)]],
  [/mean absolute error ([\d.]+) points against ([\d.]+) for the no-change forecast \(skill ([-\d.]+)\), direction accuracy ([\d.]+) on ([\d,]+) resolved forecasts/,
    (m) => [n("forecast mean absolute error", `${m[1]} pts`), n("no-change forecast error", `${m[2]} pts`), n("forecast skill", m[3]!), n("direction accuracy", m[4]!), n("resolved forecasts", m[5]!)]],
  [/best trial (\d+) of (\d+): (\w+)=([-\d.]+)/, (m) => [n("best trial", `${m[1]} of ${m[2]}`), n(word(m[3]!), m[4]!)]],
  [/block (\d+)\/(\d+) scored .*? (\w+)=([-\d.]+)/, (m) => [n("inner block", `${m[1]} of ${m[2]}`), n(word(m[3]!), m[4]!)]],
  [/fitted in ([\d.]+ s)/, (m) => [n("fit time", m[1]!)]],
  [/([\d,.]+) bars\/s over ([\d,]+) bars/, (m) => [n("bars per second", m[1]!), n("bars", m[2]!)]],
  [/Loaded ([\d,]+) rows/, (m) => [n("rows", m[1]!)]],
  [/^([\d,]+) bars, strictly increasing/, (m) => [n("bars", m[1]!)]],
  [/splice step ([-+\d.]+) points/, (m) => [n("splice step", `${m[1]} pts`)]],
  [/(\d+) causal features, rolling z-score window (\d+) clipped to ([-\d.]+)\.\.([-\d.]+) \(([\d.]+ s)\)/,
    (m) => [n("features", m[1]!), n("z-score window", `${m[2]} bars`), n("clip", `${m[3]}..${m[4]}`), n("time", m[5]!)]],
  [/coverage on ([\d.]+%) of bars/, (m) => [n("news coverage", m[1]!)]],
  [/fitting .*? on ([\d,]+) bars .*?, validating on ([\d,]+) bars/, (m) => [n("training bars", m[1]!), n("validation bars", m[2]!)]],
  [/walking ([\d,]+) bars one at a time/, (m) => [n("bars to walk", m[1]!)]],
  [/landed (\w+): ([\d,]+) rows/, (m) => [n("table", m[1]!), n("rows", m[2]!)]],
  [/stay probabilities ([\d., ]+) \(expected bars per visit ([\d., ]+)\)/, (m) => [n("stay probability per state", m[1]!.trim()), n("expected bars per visit", m[2]!.trim())]],
  [/readout up-rate per state ([\d., ]+) \(prior ([\d.]+)\)/, (m) => [n("up-rate per state", m[1]!.trim()), n("prior up-rate", m[2]!)]],
  [/readout mean scaled move per state ([-\d., ]+) \(prior ([-\d.]+)\)/, (m) => [n("mean scaled move per state", m[1]!.trim()), n("prior", m[2]!)]],
  [/(\d+) fold\(s\) cut (\d+)% train \/ (\d+)% validation \/ (\d+)% test/, (m) => [n("folds", m[1]!), n("train", `${m[2]}%`), n("validation", `${m[3]}%`), n("test", `${m[4]}%`)]],
  [/train (\S+ \S+)\.\.(\S+ \S+) \((\d+) bars\) validate (\S+ \S+)\.\.(\S+ \S+) \((\d+)\) test (\S+ \S+)\.\.(\S+ \S+) \((\d+)\)/,
    (m) => [n("train", `${m[1]} → ${m[2]} (${m[3]} bars)`), n("validation", `${m[4]} → ${m[5]} (${m[6]} bars)`), n("test", `${m[7]} → ${m[8]} (${m[9]} bars)`)]],
  [/(\d+) trials per fold, objective (\w+)/, (m) => [n("trials per fold", m[1]!), n("objective", word(m[2]!))]],
  [/— (\d+) of ([\d,]+) bars$/, (m) => [n("bars without a label", `${m[1]} of ${m[2]}`)]],
];

function n(name: string, value: string): LogNumber {
  return { name, value };
}

function word(key: string): string {
  return KEY_WORDS[key] ?? key.replace(/_/g, " ");
}

const BAR_STAMP = /\b(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\b/;
const SETTINGS_JSON = /\{[^{}]*\}/;

/** `[fold 1/3][tune trial 7/20] start {"state_count": 3, ...}` → the settings as numbers. */
function settingsOf(text: string): LogNumber[] {
  const match = SETTINGS_JSON.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return Object.entries(parsed).map(([key, value]) => n(word(key), typeof value === "number" ? trim(value) : String(value)));
  } catch {
    return [];
  }
}

function trim(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** The event in plain words: the line without its prefixes, numbers and JSON. */
function eventOf(body: string, stage: LogStage, trial: number | null): string {
  let text = body;
  if (trial !== null && /^start \{/.test(text)) return "trial started with these settings";
  if (trial !== null && /^complete /.test(text)) return "trial scored";
  if (/^best trial/.test(text)) return "search finished; the fold uses the best trial's settings";
  if (/bar \d+\/\d+ close=/.test(text)) return stage === "replay" ? "replay step" : "test step";
  if (/^ENTER (LONG|SHORT)/.test(text)) return `entered ${/LONG/.test(text) ? "long" : "short"}`;
  if (/^EXIT (LONG|SHORT)/.test(text)) return `exited ${/LONG/.test(text) ? "long" : "short"}`;
  if (/^fold done:/.test(text)) return "fold finished out of sample";
  if (/^price forecast: mean absolute error/.test(text)) return "price forecast scored against copying the last close";
  if (/validation bars walked/.test(text)) return "replay finished (in-sample look, never a test)";
  if (/^fit \d+\/\d+ step/.test(text)) return "fit step";
  if (/^fit \d+\/\d+ val_/.test(text)) return "validation score";
  if (/^price model fit \d+\/\d+ step/.test(text)) return "price model fit step";
  if (/^price model fit \d+\/\d+ val_/.test(text)) return "price model validation score";
  if (/^fitted in/.test(text)) return "fit finished";
  if (/^price model fitted in/.test(text)) return "price model fit finished";
  if (/^fitting /.test(text)) return "fitting the model on the training bars";
  if (/^price model: fitting/.test(text)) return "fitting the price model on the training bars";
  if (/^walking /.test(text)) return stage === "replay" ? "walking the validation bars" : "walking the test bars";
  if (/bars\/s over/.test(text)) return "walk speed";
  if (/^landed /.test(text)) return "table landed in the lake";
  if (/^\d+ trials, objective/.test(text)) return "search started on this fold's training bars";
  text = text.replace(SETTINGS_JSON, "").replace(KEY_VALUE, "").replace(/\s{2,}/g, " ").replace(/[,;]\s*$/, "").trim();
  return text;
}

export function parseLogLine(line: { seq: number | null; level: LogRow["level"]; message: string; receivedAt: number }): LogRow {
  const message = line.message;
  const prefix = PREFIX.exec(message);
  const fold = prefix?.[1] ? Number(prefix[1]) : null;
  const foldCount = prefix?.[2] ? Number(prefix[2]) : null;
  const bracket = prefix?.[3] ?? null;
  const trial = prefix?.[4] ? Number(prefix[4]) : null;
  const trialCount = prefix?.[5] ? Number(prefix[5]) : null;
  const trade = prefix?.[6] ? Number(prefix[6]) : null;
  const inner = prefix?.[7] ?? null;
  let stage: LogStage = "other";
  if (bracket) {
    if (bracket.startsWith("tune")) stage = "tune";
    else if (bracket.startsWith("trade")) stage = "trade";
    else stage = bracket as LogStage;
  }
  // a trial's own fit / validation lines are search steps: `[tune trial 7/20][train]`
  if (stage === "tune" && inner) stage = "tune";
  const body = message.slice(prefix?.[0].length ?? 0);
  const numbers: LogNumber[] = [];
  const seen = new Set<string>();
  const push = (entry: LogNumber) => {
    if (seen.has(entry.name)) return;
    seen.add(entry.name);
    numbers.push(entry);
  };
  for (const [pattern, extract] of SENTENCE_NUMBERS) {
    const match = pattern.exec(body);
    if (match) {
      extract(match).forEach(push);
      break;
    }
  }
  for (const match of body.matchAll(KEY_VALUE)) {
    const key = match[1]!;
    // object paths carry `recipe=` and `table=` segments: not quantities
    if (key === "run" || key === "recipe" || key === "table" || key === "part") continue;
    push(n(word(key), match[2]!));
  }
  for (const counter of ["fit", "step", "bar"] as const) {
    const match = new RegExp(`\\b${counter} (\\d+)\\/(\\d+)`).exec(body);
    if (match) push(n(counter, `${match[1]} of ${match[2]}`));
  }
  settingsOf(body).forEach(push);
  const stamp = BAR_STAMP.exec(body);
  return {
    seq: line.seq,
    level: line.level,
    receivedAt: line.receivedAt,
    fold,
    foldCount,
    stage,
    trial,
    trialCount,
    trade,
    event: eventOf(body, stage, trial),
    numbers,
    barStamp: stamp ? stamp[1]! : null,
    raw: message,
  };
}

/** The rows of one search trial, folded into one: its settings, its score, and how many steps it took. */
export interface TrialSummary {
  fold: number | null;
  trial: number;
  trialCount: number | null;
  settings: LogNumber[];
  score: LogNumber | null;
  bestSoFar: LogNumber | null;
  stepCount: number;
  /** Index into the row list of the trial's first row. */
  firstIndex: number;
  lastIndex: number;
}

/** Group consecutive rows of the same trial, so the terminal can show one line per trial by default. */
export function summariseTrials(rows: LogRow[]): Map<number, TrialSummary> {
  const byFirst = new Map<number, TrialSummary>();
  let open: TrialSummary | null = null;
  rows.forEach((row, index) => {
    if (row.trial === null) {
      open = null;
      return;
    }
    if (!open || open.fold !== row.fold || open.trial !== row.trial) {
      open = { fold: row.fold, trial: row.trial, trialCount: row.trialCount, settings: [], score: null, bestSoFar: null, stepCount: 0, firstIndex: index, lastIndex: index };
      byFirst.set(index, open);
    }
    open.lastIndex = index;
    open.stepCount += 1;
    if (row.event === "trial started with these settings") open.settings = row.numbers;
    if (row.event === "trial scored") {
      open.score = row.numbers.find((entry) => entry.name !== "best so far") ?? null;
      open.bestSoFar = row.numbers.find((entry) => entry.name === "best so far") ?? null;
    }
  });
  return byFirst;
}
