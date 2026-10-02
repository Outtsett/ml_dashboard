/**
 * The body of GET /api/studies/multimodal-model, shared by the handler and the
 * page, plus the pure arithmetic both use: gate counting, the trial label, the
 * trade-level equity / quarter / head roll-ups, the histogram, the win rate a
 * payoff needs, and the deflated Sharpe ratio. Nothing here reaches the lake.
 *
 * The plan of record is docs/plans/2026-09-29-multimodal/PLAN.md. A trial is one
 * walk-forward run of the runner multimodal_fusion+bracket_meta_label scored
 * after AMP costs on the canonical window 2021Q2..2025Q2. The locked holdout
 * (2025-07-01 .. 2025-12-31) and the forward period (2026) are in no table.
 */

export const GATE_KEYS = ["G1", "G2", "G3", "G4", "G5"] as const;
export type GateKey = (typeof GATE_KEYS)[number];

export const GATE_DEFINITIONS: Record<GateKey, { name: string; asks: string; threshold: string }> = {
  G1: { name: "Profitable after costs", asks: "net profit after AMP costs", threshold: "net profit > 0" },
  G2: { name: "Trades every day", asks: "every session has a closed trade", threshold: "sessions traded = 100%" },
  G3: { name: "Win rate", asks: "share of trades that win", threshold: "win rate ≥ 40%" },
  G4: { name: "2:1 profit ratio", asks: "both readings", threshold: "average win ≥ 2 × average loss AND profit factor ≥ 2" },
  G5: { name: "Not luck", asks: "bootstrap, quarters, one more tick of cost", threshold: "bootstrap 95% lower bound > 0, ≥ 75% of quarters positive, still profitable with +1 tick per side" },
};

/** The development window the trial table is scored on. */
export const CANONICAL_FIRST_QUARTER = "2021Q2";
/** Nothing after this quarter is ever read by the page: 2025Q3 onward is the locked holdout. */
export const DEVELOPMENT_LAST_QUARTER = "2025Q2";

export type QuarterWindow = "canonical" | "all";

export type GateFlags = Partial<Record<GateKey, boolean>>;

/** One development trial: the canonical-window scope of its summary, flattened. */
export interface TrialRow {
  recipe: string;
  /** Short label for an axis: "0929 18:14". */
  label: string;
  /** Which summary scope fed this row (canonical, else policy-tuned, which covers the same quarters). */
  scope: string;
  /** From docs/plans/.../trials.jsonl: gbdt, fusion or ensemble. Null when the ledger has no line for it. */
  family: string | null;
  blocks: string | null;
  trade_count: number | null;
  session_count: number | null;
  sessions_traded_share: number | null;
  trades_per_session: number | null;
  forced_trade_share: number | null;
  win_rate: number | null;
  average_win_points: number | null;
  average_loss_points: number | null;
  payoff_ratio: number | null;
  profit_factor: number | null;
  expectancy_points: number | null;
  net_profit_points: number | null;
  net_profit_usd: number | null;
  stressed_net_profit_usd: number | null;
  daily_sharpe_annualised: number | null;
  maximum_drawdown_usd: number | null;
  quarters_positive_share: number | null;
  bootstrap_total_points_lower_95: number | null;
  bootstrap_probability_profitable: number | null;
  gate: GateFlags;
  gate_passed_count: number;
  /** Net points per quarter, from the summary (empty when the summary has none). */
  quarter_net_points: Record<string, number>;
}

/** One closed trade of the selected trial. Points are after costs; USD = points × the MNQ point value. */
export interface TradeRow {
  session: number;
  quarter: string;
  head: string;
  forced: boolean;
  net_points: number;
  probability: number | null;
  expected_points: number | null;
  stop_points: number | null;
  target_points: number | null;
  minutes_held: number | null;
}

export interface CalibrationRow {
  head: string;
  decile: number;
  predicted_probability: number | null;
  realised_win_rate: number | null;
  mean_net_points: number | null;
  row_count: number;
}

/** One (quarter, head, modality) ablation: the test-quarter AUC with the block in and with it switched off. */
export interface AblationRow {
  fold: string;
  head: string;
  modality: string;
  auc_full: number | null;
  auc_without: number | null;
  auc_drop: number;
}

export interface GainRow {
  modality: string;
  head: string;
  gain_share: number | null;
}

export interface TopFeatureRow {
  feature: string;
  modality: string;
  mean_gain_share: number | null;
}

export interface FoldRow {
  fold: string;
  train_rows: number | null;
  validation_rows: number | null;
  test_rows: number | null;
  long_r2_auc: number | null;
  long_r2_base_rate: number | null;
  long_r2_mean_probability: number | null;
  short_r2_auc: number | null;
  short_r2_base_rate: number | null;
  short_r2_mean_probability: number | null;
  long_r3_auc: number | null;
  long_r3_base_rate: number | null;
  long_r3_mean_probability: number | null;
  short_r3_auc: number | null;
  short_r3_base_rate: number | null;
  short_r3_mean_probability: number | null;
  epochs_run: number | null;
  validation_loss: number | null;
  fusion_epochs_run: number | null;
  fusion_validation_loss: number | null;
  [column: string]: unknown;
}

export interface PolicyRow {
  quarter: string;
  policy_index: number | null;
  threshold_points: number | null;
  max_trades: number | null;
  forced_minute: number | null;
  heads: string | null;
  history_net_points: number | null;
}

export interface BaseRateRow {
  breakdown: string;
  recipe: string;
  side: number;
  reward_multiple: number;
  decision_hour: number | null;
  year: number | null;
  candidate_count: number | null;
  session_count: number | null;
  target_hit_rate: number | null;
  stop_rate: number | null;
  session_end_rate: number | null;
  win_rate: number | null;
  average_win_points: number | null;
  average_loss_points: number | null;
  payoff_ratio: number | null;
  profit_factor: number | null;
  expectancy_points: number | null;
  median_stop_points: number | null;
  median_target_points: number | null;
  median_minutes_held: number | null;
}

export interface AuditRow {
  path: string;
  relevant_to_training: boolean | null;
  topic: string | null;
  edge_evidence: string | null;
  lookahead_risk: string | null;
  costs_included: string | null;
  out_of_sample: string | null;
  edge_summary: string | null;
  recommendation: string | null;
}

export interface EdgeVerdictRow {
  path: string;
  claim: string | null;
  holds: string | null;
  reasons: string | null;
  corrected_numbers: string | null;
  usable_for_design: string | null;
}

export interface OverfittingSummary {
  sessions: number | null;
  best_trial: string | null;
  best_daily_sharpe: number | null;
  best_annualised_sharpe: number | null;
  trials: number | null;
  expected_maximum_daily_sharpe_of_null_trials: number | null;
  skewness: number | null;
  kurtosis: number | null;
  deflated_sharpe_probability: number | null;
  pbo: number | null;
  combinations: number | null;
  median_logit: number | null;
}

export interface OverfittingTrialRow {
  trial: string;
  daily_sharpe: number | null;
  annualised_sharpe: number | null;
  net_points: number | null;
}

/** A landed acceptance-gate record (recipe gate_*). Empty until the holdout's single look. */
export interface GateRecord {
  recipe: string;
  scope: string;
  summary: Record<string, unknown>;
}

export interface HoldoutStatus {
  looks: number | null;
  lookBudget: number | null;
  forwardLooks: number | null;
  forwardLookBudget: number | null;
  phase: string | null;
  step: string | null;
  lastCheckpoint: string | null;
  /** Non-blank lines in docs/plans/2026-09-29-multimodal/trials.jsonl. */
  ledgerLines: number | null;
}

export interface SelectedTrialDetail {
  recipe: string;
  window: QuarterWindow;
  trades: TradeRow[];
  calibration: CalibrationRow[];
  predictionRowCount: number;
  /** A reproducible thin sample of the prediction frame (for the per-column graphics). */
  predictionSample: Array<Record<string, number | null>>;
  ablationRows: AblationRow[];
  gain: GainRow[];
  topFeatures: TopFeatureRow[];
  gainShareSample: Array<{ gain_share: number }>;
  folds: FoldRow[];
  policies: PolicyRow[];
}

export interface MultimodalBody {
  /** USD per index point for MNQ, from packages/config/cost_model.json. */
  pointValueUsd: number;
  roundTripCostPoints: number;
  trials: TrialRow[];
  /** The recipe the detail tabs describe (the request's, else the highest profit factor). */
  selectedRecipe: string | null;
  window: QuarterWindow;
  detail: SelectedTrialDetail | null;
  baseRates: BaseRateRow[];
  audit: AuditRow[];
  edgeVerdicts: EdgeVerdictRow[];
  overfitting: { summary: OverfittingSummary | null; trials: OverfittingTrialRow[] };
  gates: GateRecord[];
  holdout: HoldoutStatus;
}

// ── trial rows ─────────────────────────────────────────────────────────────

/** "MNQ_5m_multimodal_fusion_bracket_meta_label_20260929T181434" → "0929 18:14". */
export function trialLabel(recipe: string): string {
  const match = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(recipe);
  if (!match) return recipe.length > 14 ? recipe.slice(-14) : recipe;
  return `${match[2]}${match[3]} ${match[4]}:${match[5]}`;
}

export function gatePassedCount(gate: GateFlags | null | undefined): number {
  if (!gate) return 0;
  return Object.values(gate).reduce<number>((total, value) => total + (value ? 1 : 0), 0);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The run's ledger line (family, blocks) keyed by recipe: the ledger's model_id swaps "_" for "+". */
export interface LedgerConfiguration {
  family: string | null;
  blocks: string | null;
}

/** One summary_json string of derived_multimodal_runs_summary, flattened to a trial row. */
export function flattenSummary(recipe: string, scope: string, summaryJson: string, configuration?: LedgerConfiguration): TrialRow | null {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(summaryJson);
    if (typeof value !== "object" || value === null) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const gateSource = typeof parsed.gate === "object" && parsed.gate !== null ? (parsed.gate as Record<string, unknown>) : {};
  const gate: GateFlags = {};
  for (const key of GATE_KEYS) if (key in gateSource) gate[key] = Boolean(gateSource[key]);
  const quarters: Record<string, number> = {};
  if (typeof parsed.quarter_net_points === "object" && parsed.quarter_net_points !== null) {
    for (const [quarter, value] of Object.entries(parsed.quarter_net_points as Record<string, unknown>)) {
      const points = finiteOrNull(value);
      if (points !== null) quarters[quarter] = points;
    }
  }
  const pick = (key: string) => finiteOrNull(parsed[key]);
  return {
    recipe,
    label: trialLabel(recipe),
    scope,
    family: configuration?.family ?? null,
    blocks: configuration?.blocks ?? null,
    trade_count: pick("trade_count"),
    session_count: pick("session_count"),
    sessions_traded_share: pick("sessions_traded_share"),
    trades_per_session: pick("trades_per_session"),
    forced_trade_share: pick("forced_trade_share"),
    win_rate: pick("win_rate"),
    average_win_points: pick("average_win_points"),
    average_loss_points: pick("average_loss_points"),
    payoff_ratio: pick("payoff_ratio"),
    profit_factor: pick("profit_factor"),
    expectancy_points: pick("expectancy_points"),
    net_profit_points: pick("net_profit_points"),
    net_profit_usd: pick("net_profit_usd"),
    stressed_net_profit_usd: pick("stressed_net_profit_usd"),
    daily_sharpe_annualised: pick("daily_sharpe_annualised"),
    maximum_drawdown_usd: pick("maximum_drawdown_usd"),
    quarters_positive_share: pick("quarters_positive_share"),
    bootstrap_total_points_lower_95: pick("bootstrap_total_points_lower_95"),
    bootstrap_probability_profitable: pick("bootstrap_probability_profitable"),
    gate,
    gate_passed_count: gatePassedCount(gate),
    quarter_net_points: quarters,
  };
}

/** The trial with the highest profit factor (the notebook's default pick); null profit factors sort last. */
export function bestTrialRecipe(trials: readonly TrialRow[]): string | null {
  let best: TrialRow | null = null;
  for (const trial of trials) {
    if (best === null) best = trial;
    else if ((trial.profit_factor ?? -Infinity) > (best.profit_factor ?? -Infinity)) best = trial;
  }
  return best?.recipe ?? null;
}

// ── trade roll-ups ─────────────────────────────────────────────────────────

const MILLISECONDS_PER_DAY = 86_400_000;

/** `session` counts epoch DAYS; this is its ISO calendar date. */
export function sessionDate(session: number): string {
  return new Date(session * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

export interface EquityPoint {
  session: number;
  date: string;
  netUsd: number;
  cumulativeNetUsd: number;
  tradeCount: number;
}

/** Sum of net USD per session, accumulated in session order. */
export function equityCurve(trades: readonly TradeRow[], pointValueUsd: number): EquityPoint[] {
  const bySession = new Map<number, { netUsd: number; tradeCount: number }>();
  for (const trade of trades) {
    const entry = bySession.get(trade.session) ?? { netUsd: 0, tradeCount: 0 };
    entry.netUsd += trade.net_points * pointValueUsd;
    entry.tradeCount += 1;
    bySession.set(trade.session, entry);
  }
  let running = 0;
  return [...bySession.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([session, entry]) => {
      running += entry.netUsd;
      return { session, date: sessionDate(session), netUsd: entry.netUsd, cumulativeNetUsd: running, tradeCount: entry.tradeCount };
    });
}

export interface QuarterNet {
  quarter: string;
  netUsd: number;
  netPoints: number;
  tradeCount: number;
}

export function quarterNet(trades: readonly TradeRow[], pointValueUsd: number): QuarterNet[] {
  const byQuarter = new Map<string, QuarterNet>();
  for (const trade of trades) {
    const entry = byQuarter.get(trade.quarter) ?? { quarter: trade.quarter, netUsd: 0, netPoints: 0, tradeCount: 0 };
    entry.netPoints += trade.net_points;
    entry.netUsd += trade.net_points * pointValueUsd;
    entry.tradeCount += 1;
    byQuarter.set(trade.quarter, entry);
  }
  return [...byQuarter.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
}

export interface HeadSummary {
  head: string;
  tradeCount: number;
  winRate: number;
  expectancyPoints: number;
  forcedShare: number;
}

export function headSummary(trades: readonly TradeRow[]): HeadSummary[] {
  const byHead = new Map<string, { count: number; wins: number; net: number; forced: number }>();
  for (const trade of trades) {
    const entry = byHead.get(trade.head) ?? { count: 0, wins: 0, net: 0, forced: 0 };
    entry.count += 1;
    if (trade.net_points > 0) entry.wins += 1;
    entry.net += trade.net_points;
    if (trade.forced) entry.forced += 1;
    byHead.set(trade.head, entry);
  }
  return [...byHead.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([head, entry]) => ({
      head,
      tradeCount: entry.count,
      winRate: entry.wins / entry.count,
      expectancyPoints: entry.net / entry.count,
      forcedShare: entry.forced / entry.count,
    }));
}

export interface OutcomeBin {
  lower: number;
  upper: number;
  middle: number;
  count: number;
}

/** Equal-width bins over the full range (no trimming): the picture shows the tails the trade log has. */
export function binValues(values: readonly number[], binCount: number): OutcomeBin[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0 || binCount < 1) return [];
  let low = Infinity;
  let high = -Infinity;
  for (const value of finite) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (!(high > low)) return [{ lower: low, upper: high, middle: low, count: finite.length }];
  const width = (high - low) / binCount;
  const bins: OutcomeBin[] = Array.from({ length: binCount }, (_, index) => ({
    lower: low + index * width,
    upper: low + (index + 1) * width,
    middle: low + (index + 0.5) * width,
    count: 0,
  }));
  for (const value of finite) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - low) / width)));
    (bins[index] as OutcomeBin).count += 1;
  }
  return bins;
}

export interface AblationMean {
  modality: string;
  head: string;
  meanAucDrop: number;
  foldCount: number;
}

/** Mean AUC drop per (modality, head), as the notebook grouped it; ordered by head then modality. */
export function ablationMeans(rows: readonly AblationRow[]): AblationMean[] {
  const groups = new Map<string, { modality: string; head: string; total: number; count: number; folds: Set<string> }>();
  for (const row of rows) {
    if (!Number.isFinite(row.auc_drop)) continue;
    const key = `${row.head}|${row.modality}`;
    const entry = groups.get(key) ?? { modality: row.modality, head: row.head, total: 0, count: 0, folds: new Set<string>() };
    entry.total += row.auc_drop;
    entry.count += 1;
    entry.folds.add(row.fold);
    groups.set(key, entry);
  }
  return [...groups.values()]
    .map((entry) => ({ modality: entry.modality, head: entry.head, meanAucDrop: entry.total / entry.count, foldCount: entry.folds.size }))
    .sort((a, b) => a.head.localeCompare(b.head) || a.modality.localeCompare(b.modality));
}

// ── the arithmetic behind gates G3 and G4 ──────────────────────────────────

/** Profit factor from win rate p and payoff ratio R (average win ÷ average loss): p·R ÷ (1 − p). */
export function profitFactorFrom(winRate: number, payoffRatio: number): number | null {
  if (!(winRate >= 0 && winRate < 1) || !(payoffRatio >= 0)) return null;
  return (winRate * payoffRatio) / (1 - winRate);
}

/** The win rate at which wins and losses cancel for a payoff ratio R: 1 ÷ (1 + R). */
export function breakevenWinRate(payoffRatio: number): number | null {
  return payoffRatio >= 0 ? 1 / (1 + payoffRatio) : null;
}

/** The win rate a payoff ratio R needs for a profit factor of `target`: target ÷ (R + target). */
export function winRateForProfitFactor(payoffRatio: number, target: number): number | null {
  return payoffRatio + target > 0 ? target / (payoffRatio + target) : null;
}

// ── deflated Sharpe ratio (Bailey and López de Prado 2014) ─────────────────

/** Standard normal CDF, Abramowitz and Stegun 7.1.26 through erf (absolute error below 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - polynomial * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * P(true Sharpe > 0 | the best of several trials was picked):
 *   Φ( (SR − SR₀) · √(T − 1) / √(1 − γ₃·SR + (γ₄ − 1)/4 · SR²) )
 * with SR the best trial's daily Sharpe, SR₀ the expected maximum of the null
 * trials' Sharpes, T the number of sessions, γ₃ the skewness and γ₄ the
 * (non-excess) kurtosis of the daily returns. Null when the variance term is not positive.
 */
export function deflatedSharpeProbability(
  dailySharpe: number,
  nullMaximumSharpe: number,
  sessions: number,
  skewness: number,
  kurtosis: number,
): number | null {
  if (![dailySharpe, nullMaximumSharpe, sessions, skewness, kurtosis].every(Number.isFinite) || sessions < 2) return null;
  const variance = 1 - skewness * dailySharpe + ((kurtosis - 1) / 4) * dailySharpe * dailySharpe;
  if (!(variance > 0)) return null;
  return normalCdf(((dailySharpe - nullMaximumSharpe) * Math.sqrt(sessions - 1)) / Math.sqrt(variance));
}
