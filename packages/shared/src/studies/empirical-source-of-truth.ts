/**
 * Empirical source of truth: every finding of every study in one ledger, plus the systematic
 * "after a bar like this, what next" table it rests on.
 *
 *   derived_study_insights_ledger             one row per finding: the condition, the number, its
 *                                             baseline, sample, interval, verdict, what it means and
 *                                             how a trading model should use it, with its source and
 *                                             whether an independent check reproduced it
 *                                             (packages/ml-engine/src/studies/insights_ledger/build.py)
 *   derived_study_conditional_edges_<table>   MNQ 1m / 5m / 15m conditions tested on 2021-2023 and
 *                                             confirmed on 2024 - 2025-06, against costs
 *                                             (packages/ml-engine/src/studies/conditional_edges/build.py)
 */

export const LEDGER_VIEWS = {
  insights: "derived_study_insights_ledger",
  edges: "derived_study_conditional_edges_edges",
  baselines: "derived_study_conditional_edges_baselines",
  definitions: "derived_study_conditional_edges_definitions",
} as const;

export const VERDICTS = ["edge", "weak edge", "no edge", "negative edge", "fact", "defect found", "inconclusive"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const MODEL_USES = [
  "use as feature", "use as filter", "use as veto", "target or label design", "evaluation rule", "cost rule", "reject",
  "needs more data", "infrastructure fact",
] as const;
export type ModelUse = (typeof MODEL_USES)[number];

export const EDGE_VERDICTS = ["edge after costs", "real but smaller than costs", "not confirmed out of sample", "no edge", "too few events"] as const;
export type EdgeVerdict = (typeof EDGE_VERDICTS)[number];

export const EDGE_TIMEFRAMES = ["1m", "5m", "15m"] as const;
export const EDGE_HORIZONS = [1, 3, 10] as const;
export const EDGE_FAMILIES = [
  "relative volume", "relative range", "shape", "direction", "session",
  "relative volume x shape x direction", "relative range x shape x direction", "relative volume x direction x session",
] as const;

export interface InsightRow {
  insight_id: string;
  study_slug: string;
  study_link: string | null;
  category: string;
  analytics_tier: "descriptive" | "diagnostic" | "predictive" | "prescriptive";
  instrument: string | null;
  timeframe: string | null;
  sample_window: string | null;
  condition: string;
  measured_quantity: string;
  value: number | null;
  value_text: string;
  value_unit: string | null;
  baseline_value: number | null;
  baseline_description: string | null;
  sample_count: number | null;
  confidence_interval_text: string | null;
  verdict: Verdict;
  interpretation: string;
  model_use: ModelUse;
  model_rule: string;
  evidence_source: string;
  evidence_kind: string;
  verification_status: "confirmed" | "corrected" | "unverifiable" | "computed here";
  verification_note: string | null;
}

export interface EdgeRow {
  timeframe: string;
  horizon_bars: number;
  family: string;
  condition: string;
  relative_volume: string;
  relative_range: string;
  shape: string;
  direction: string;
  session: string;
  full_event_count: number;
  full_up_share_percent: number | null;
  full_base_up_share_percent: number;
  full_mean_move_ticks: number | null;
  full_mean_absolute_move_ticks: number | null;
  discovery_moved_count: number | null;
  discovery_up_share_percent: number | null;
  discovery_lift_percentage_points: number | null;
  discovery_q_value: number | null;
  confirmation_moved_count: number | null;
  confirmation_up_share_percent: number | null;
  confirmation_up_share_low_percent: number | null;
  confirmation_up_share_high_percent: number | null;
  confirmation_base_up_share_percent: number | null;
  confirmation_lift_percentage_points: number | null;
  confirmation_p_value_one_sided: number | null;
  confirmation_gross_ticks_per_trade: number | null;
  confirmation_net_ticks_per_trade: number | null;
  favoured_direction: "up" | "down" | "none";
  round_trip_cost_ticks: number;
  verdict: EdgeVerdict;
}

export interface BaselineRow {
  timeframe: string;
  horizon_bars: number;
  split: string;
  base_up_share_percent: number;
  base_mean_move_ticks: number;
  moved_count: number;
  event_count: number;
}

export interface EdgeVerdictCount {
  timeframe: string;
  horizon_bars: number;
  verdict: EdgeVerdict;
  cell_count: number;
}

export interface LedgerBody {
  insights: InsightRow[];
  edges: EdgeRow[];
  baselines: BaselineRow[];
  edgeVerdicts: EdgeVerdictCount[];
  definitions: Array<{ name: string; value: string }>;
}
