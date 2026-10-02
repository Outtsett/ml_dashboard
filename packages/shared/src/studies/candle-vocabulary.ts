/**
 * The body of GET /api/studies/candle-vocabulary, and the pure arithmetic the
 * page and the handler's test share.
 *
 * The four tables are the stored results of two experiments on a Conv1d VQ-VAE
 * codebook of K multi-bar candle archetypes (packages/ml-engine/src/studies/candle_vocabulary/
 * build.py lands them as derived_study_candle_vocabulary_<table>).
 */

export interface SequenceResultRow {
  run_name: string;
  symbol: string;
  timeframe: string;
  code_count: number;
  width_bars: number;
  horizon_bars: number;
  history_months: number;
  with_magnitude_channels: boolean;
  channel_count: number;
  /** full-word representation name, e.g. "continuous_latent_without_quantisation" */
  representation: string;
  /** the name the trainer wrote: har, code_rand, code_book, latent_z */
  stored_model_name: string;
  out_of_sample_r_squared: number | null;
  har_plus_r_squared: number | null;
  added_to_har_r_squared: number | null;
  codebook_perplexity: number | null;
  codes_used_count: number;
  windows_assigned_count: number;
  bar_count: number;
  train_sequence_count: number;
  test_sequence_count: number;
  random_seed: number;
  test_fraction: number;
  elapsed_seconds: number | null;
  source_file: string;
}

export interface ArchetypeRow {
  run_name: string;
  symbol: string;
  timeframe: string;
  code_count: number;
  width_bars: number;
  with_magnitude_channels: boolean;
  code: number;
  bar_position: number;
  windows_assigned_count: number;
  share_of_windows_fraction: number | null;
  rank_by_window_count: number;
  open_position_fraction: number | null;
  close_position_fraction: number | null;
  body_fraction: number | null;
  upper_wick_fraction: number | null;
  lower_wick_fraction: number | null;
  log_range_zscore: number | null;
  log_volume_zscore: number | null;
  source_file: string;
}

export interface LanguageModelRow {
  run_name: string;
  symbol: string;
  timeframe: string;
  code_count: number;
  width_bars: number;
  symbol_stride_bars: number;
  history_months: number;
  model: string;
  stored_model_name: string;
  accuracy_next_symbol: number | null;
  negative_log_likelihood_next_symbol_nats: number | null;
  accuracy_two_symbols_ahead: number | null;
  negative_log_likelihood_two_symbols_ahead_nats: number | null;
  nats_better_than_unigram: number | null;
  train_window_count: number;
  test_window_count: number;
  train_sequence_count: number;
  test_sequence_count: number;
  train_codebook_perplexity: number | null;
  test_codebook_perplexity: number | null;
  masked_model_final_loss: number | null;
  elapsed_seconds: number | null;
  source_file: string;
}

export interface LanguageModelDirectionRow {
  run_name: string;
  symbol: string;
  timeframe: string;
  code_count: number;
  width_bars: number;
  symbol_stride_bars: number;
  model: string;
  stored_model_name: string;
  direction_accuracy: number | null;
  test_count: number;
  majority_direction_accuracy: number | null;
  accuracy_minus_majority: number | null;
  source_file: string;
}

export interface CandleVocabularyBody {
  sequenceResults: SequenceResultRow[];
  archetypes: ArchetypeRow[];
  languageModel: LanguageModelRow[];
  languageModelDirection: LanguageModelDirectionRow[];
}

export const EMPTY_BODY: CandleVocabularyBody = { sequenceResults: [], archetypes: [], languageModel: [], languageModelDirection: [] };

/** The representation names in the order the notebook's chart lists them, with plain-words labels. */
export const REPRESENTATION_LABELS: Record<string, { short: string; long: string }> = {
  har_rv_baseline: { short: "HAR-RV", long: "HAR-RV baseline: three lagged realized-volatility averages, no candle code" },
  code_with_random_embedding: { short: "code, random embedding", long: "the K-symbol code, each symbol embedded at random" },
  code_with_codebook_embedding: { short: "code, codebook embedding", long: "the K-symbol code, each symbol embedded from its fitted codebook vector" },
  continuous_latent_without_quantisation: { short: "continuous latent", long: "the encoder's continuous latent, no rounding to K symbols" },
};

export const LANGUAGE_MODEL_LABELS: Record<string, string> = {
  unigram: "unigram (commonest symbol)",
  bigram: "bigram (previous symbol)",
  trigram: "trigram (previous two)",
  causal_transformer_only: "causal transformer only",
  masked_and_causal_transformer: "masked + causal transformer",
};

/** Bits of a full-precision window that survive rounding to one of K symbols: log2(K). */
export function bitsKept(codeCount: number): number {
  return codeCount > 0 ? Math.log2(codeCount) : Number.NaN;
}

/** The representation rows of a run (the HAR baseline excluded), in a fixed order. */
export function nonBaselineRows(rows: readonly SequenceResultRow[]): SequenceResultRow[] {
  const order = Object.keys(REPRESENTATION_LABELS);
  return rows
    .filter((row) => row.representation !== "har_rv_baseline")
    .sort((a, b) => order.indexOf(a.representation) - order.indexOf(b.representation) || Number(a.with_magnitude_channels) - Number(b.with_magnitude_channels));
}

/**
 * added_to_har recomputed the way the notebook meant it: a representation's
 * HAR-plus R-squared minus the R-squared of the HAR row of the SAME run,
 * matched by name (the notebook took "the first row", which is the HAR row
 * only while the trainer writes it first).
 */
export function addedToHar(rows: readonly SequenceResultRow[]): Array<{ row: SequenceResultRow; added: number | null }> {
  const harByRun = new Map<string, number | null>();
  for (const row of rows) if (row.representation === "har_rv_baseline") harByRun.set(row.run_name, row.out_of_sample_r_squared);
  return rows.map((row) => {
    const har = harByRun.get(row.run_name);
    const plus = row.har_plus_r_squared;
    return { row, added: har === undefined || har === null || plus === null ? null : plus - har };
  });
}

/** The representation that adds the most on top of HAR-RV, over every run. */
export function bestAddition(rows: readonly SequenceResultRow[]): SequenceResultRow | null {
  let best: SequenceResultRow | null = null;
  for (const row of nonBaselineRows(rows)) {
    if (row.added_to_har_r_squared === null) continue;
    if (best === null || row.added_to_har_r_squared > (best.added_to_har_r_squared as number)) best = row;
  }
  return best;
}

/** The HAR-RV baseline's own out-of-sample R-squared for a run (null when the run has no HAR row). */
export function harBaseline(rows: readonly SequenceResultRow[], runName: string): number | null {
  return rows.find((row) => row.run_name === runName && row.representation === "har_rv_baseline")?.out_of_sample_r_squared ?? null;
}

/** Fraction of a symbol's bars that the next symbol shares when symbols start `stride` bars apart: max(W - s, 0) / W. */
export function sharedBarFraction(width: number, stride: number): number {
  if (width <= 0) return Number.NaN;
  return Math.max(width - stride, 0) / width;
}

// ---------------------------------------------------------------------------
// Archetypes

export interface ArchetypeSet {
  runName: string;
  codeCount: number;
  width: number;
  withMagnitude: boolean;
  codes: ArchetypeCode[];
}

export interface ArchetypeCode {
  code: number;
  count: number;
  share: number;
  rank: number;
  /** bars in time order, each holding every channel the set has */
  bars: ArchetypeBar[];
}

export interface ArchetypeBar {
  position: number;
  open: number | null;
  close: number | null;
  body: number | null;
  upperWick: number | null;
  lowerWick: number | null;
  logRangeZscore: number | null;
  logVolumeZscore: number | null;
}

/** Groups the flat archetype table into sets, each with its codes and their bars in order. */
export function groupArchetypes(rows: readonly ArchetypeRow[]): ArchetypeSet[] {
  const sets = new Map<string, ArchetypeSet>();
  const codes = new Map<string, ArchetypeCode>();
  for (const row of rows) {
    let set = sets.get(row.run_name);
    if (!set) {
      set = { runName: row.run_name, codeCount: row.code_count, width: row.width_bars, withMagnitude: row.with_magnitude_channels, codes: [] };
      sets.set(row.run_name, set);
    }
    const key = `${row.run_name}|${row.code}`;
    let code = codes.get(key);
    if (!code) {
      code = { code: row.code, count: row.windows_assigned_count, share: row.share_of_windows_fraction ?? 0, rank: row.rank_by_window_count, bars: [] };
      codes.set(key, code);
      set.codes.push(code);
    }
    code.bars.push({
      position: row.bar_position,
      open: row.open_position_fraction,
      close: row.close_position_fraction,
      body: row.body_fraction,
      upperWick: row.upper_wick_fraction,
      lowerWick: row.lower_wick_fraction,
      logRangeZscore: row.log_range_zscore,
      logVolumeZscore: row.log_volume_zscore,
    });
  }
  for (const set of sets.values()) {
    for (const code of set.codes) code.bars.sort((a, b) => a.position - b.position);
    set.codes.sort((a, b) => a.code - b.code);
  }
  return [...sets.values()].sort((a, b) => a.runName.localeCompare(b.runName));
}

export type ArchetypeOrder = "count" | "code" | "rare";

export function orderCodes(codes: readonly ArchetypeCode[], order: ArchetypeOrder): ArchetypeCode[] {
  const copy = [...codes];
  if (order === "code") return copy.sort((a, b) => a.code - b.code);
  if (order === "rare") return copy.sort((a, b) => a.count - b.count || a.code - b.code);
  return copy.sort((a, b) => b.count - a.count || a.code - b.code);
}

export interface GlyphBar {
  position: number;
  /** wick, from the lower wick's end to the upper wick's end, as fractions of the bar's own range */
  wickLow: number;
  wickHigh: number;
  bodyBottom: number;
  /** at least MINIMUM_BODY so a doji still shows */
  bodyHeight: number;
  rising: boolean;
}

export const MINIMUM_BODY = 0.015;

/**
 * One archetype drawn as candles: per bar the body runs between the mean open
 * and close position, and the wicks extend by the mean wick fractions. This is
 * the notebook's drawing exactly: geometry from the stored MEAN of the real
 * windows assigned to the code, not from the decoder's reconstruction.
 * A bar with a missing channel (a code no window was assigned to) is skipped.
 */
export function glyphBars(bars: readonly ArchetypeBar[]): GlyphBar[] {
  const out: GlyphBar[] = [];
  for (const bar of bars) {
    if (bar.open === null || bar.close === null || bar.upperWick === null || bar.lowerWick === null) continue;
    const top = Math.max(bar.open, bar.close);
    const bottom = Math.min(bar.open, bar.close);
    out.push({
      position: bar.position,
      wickLow: bottom - bar.lowerWick,
      wickHigh: top + bar.upperWick,
      bodyBottom: bottom,
      bodyHeight: Math.max(top - bottom, MINIMUM_BODY),
      rising: bar.close >= bar.open,
    });
  }
  return out;
}

/** Perplexity exp(-sum p ln p) of a code-usage distribution: the effective number of codes in use. */
export function perplexity(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return Number.NaN;
  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return Math.exp(entropy);
}

/** The terms -p ln p of the perplexity's sum, in the order given, each with its running total. */
export function entropyTerms(counts: readonly number[]): Array<{ index: number; probability: number; term: number; running: number }> {
  const total = counts.reduce((a, b) => a + b, 0);
  let running = 0;
  return counts.map((count, index) => {
    const probability = total > 0 ? count / total : 0;
    const term = probability > 0 ? -probability * Math.log(probability) : 0;
    running += term;
    return { index: index + 1, probability, term, running };
  });
}
