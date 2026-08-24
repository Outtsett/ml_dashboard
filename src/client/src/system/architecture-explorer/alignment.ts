/**
 * Chart ↔ network alignment check.
 *
 * The candle chart and the neuron network sit on the same screen, which invites
 * the assumption that the bars ARE the model's input. They are related, but not
 * identically — this module states exactly which axes line up and which do not,
 * so the pairing can be trusted rather than assumed.
 *
 * The derived input carries three axes — batch, window length, feature width —
 * but their ORDER is architecture-specific and is never assumed here. The TFT is
 * sequence-first ("B × 32 × 20" = B × W × F); Conv1d is channels-first, (N, C_in,
 * L), so the CNN derives "B × 20 × 136" where the LAST axis is the window. Axes
 * are therefore identified by MEANING (which one equals window_size), not by
 * position — reading dims[last] as "features" mislabels the window as features on
 * every channels-first model.
 *
 *   batch   — symbolic in the schematic. The chart shows ONE window, so the
 *             chart's batch is 1. Stated, never silently assumed.
 *   window  — length in bars. The axis that genuinely aligns: the chart is asked
 *             for exactly `window_size` bars, so it should equal the bars
 *             ACTUALLY returned. If the feed comes up short (thin symbol, market
 *             gap), they diverge and the check MUST say so.
 *   features— width. Does NOT align with the chart's columns. It counts
 *             ENGINEERED features (derive.ts DEFAULT_NEURAL_FEATURES = 20;
 *             xgboost 29, sourced 'price_action / volatility / volume /
 *             momentum'), computed from the bars upstream. The chart draws OHLC.
 *             Presenting it as the chart's fields would be a lie, so it is
 *             reported as derived-from, not equal-to.
 *
 * No trained model is involved. This verifies SHAPE agreement between what the
 * chart fetched and what the architecture declares it consumes — nothing about
 * predictions.
 */

import { parseShape } from './graph/flow';
import type { ArchGraph } from './graph/types';

export type AlignState = 'aligned' | 'mismatch' | 'unlinked' | 'pending';

export interface AlignAxis {
  label: string;
  /** What the chart actually has. */
  chart: string;
  /** What the architecture declares. */
  model: string;
  state: AlignState;
  /** Plain-language meaning — shown, not inferred from colour. */
  note: string;
}

export interface AlignmentReport {
  overall: AlignState;
  axes: AlignAxis[];
  /** The input node's derived shape, e.g. "B × 32 × 20". */
  inputShape: string | null;
}

/** The graph's first column is the input terminal — the node the bars feed. */
function inputNode(graph: ArchGraph) {
  let best = graph.nodes[0];
  for (const n of graph.nodes) {
    if (best == null || n.column < best.column) best = n;
  }
  return best ?? null;
}

/**
 * Compare the bars the chart actually holds against the architecture's declared
 * input shape.
 *
 * @param barsReturned  bars the chart really received (NOT the requested limit —
 *                      a short feed must surface as a mismatch, not be hidden).
 * @param windowSize    the model's window_size HP, or null when it exposes none.
 */
export function checkAlignment(
  graph: ArchGraph,
  barsReturned: number | null,
  windowSize: number | null,
): AlignmentReport {
  const node = inputNode(graph);
  const shape = node?.outShape ?? node?.inShape ?? null;
  const dims = parseShape(shape ?? undefined);

  if (windowSize == null) {
    return {
      overall: 'unlinked',
      inputShape: shape,
      axes: [
        {
          label: 'window',
          chart: barsReturned == null ? '—' : `${barsReturned} bars`,
          model: 'no window_size',
          state: 'unlinked',
          note: 'This architecture exposes no window_size, so the bar count is a fixed default and is not tied to the model.',
        },
      ],
    };
  }

  if (barsReturned == null) {
    return {
      overall: 'pending',
      inputShape: shape,
      axes: [
        {
          label: 'window',
          chart: 'loading',
          model: `${windowSize} bars`,
          state: 'pending',
          note: 'Waiting on the feed before the window can be compared.',
        },
      ],
    };
  }

  const axes: AlignAxis[] = [];

  // ── batch ─────────────────────────────────────────────────────────────────
  // B is symbolic in the schematic; the chart is one window, hence one sample.
  const batchAxis = dims?.[0];
  axes.push({
    label: 'batch',
    chart: '1 window',
    model: typeof batchAxis === 'string' ? batchAxis : String(batchAxis ?? 'B'),
    state: 'aligned',
    note: 'The batch axis is symbolic in the schematic. The chart shows a single window, so it corresponds to one sample.',
  });

  // ── window — the axis that genuinely aligns ───────────────────────────────
  const windowMatches = barsReturned === windowSize;
  axes.push({
    label: 'window',
    chart: `${barsReturned} bars`,
    model: `${windowSize} bars`,
    state: windowMatches ? 'aligned' : 'mismatch',
    note: windowMatches
      ? 'The chart holds exactly the bars this architecture consumes per sample.'
      : `The feed returned ${barsReturned} of the ${windowSize} bars the model needs — short by ${windowSize - barsReturned}. A window this size cannot be filled from the visible data.`,
  });

  // ── features — the axis that does NOT align ───────────────────────────────
  //
  // Axis ORDER is architecture-specific and must not be assumed. The TFT is
  // sequence-first (B × W × F: "B × 32 × 20"), but Conv1d is channels-first —
  // (N, C_in, L) — so the CNN derives "B × 20 × 136" where the LAST axis is the
  // window and the MIDDLE one is the feature count. Taking dims[last] as
  // "features" mislabels the window as features on every channels-first model.
  //
  // Identify by meaning instead: the axis equal to window_size IS the window;
  // the remaining non-batch numeric axis is the feature width.
  if (dims && dims.length >= 3) {
    const nonBatch = dims.slice(1);
    const windowIdx = nonBatch.findIndex((d) => d === windowSize);
    const featureAxis =
      windowIdx >= 0
        ? nonBatch.find((d, i) => i !== windowIdx && typeof d === 'number')
        : undefined;

    if (typeof featureAxis === 'number') {
      axes.push({
        label: 'features',
        chart: 'OHLC per bar',
        model: `${featureAxis} features`,
        state: 'unlinked',
        note: `Not the chart's columns. The model consumes ${featureAxis} engineered features computed from these bars upstream, not the raw OHLC fields drawn here.`,
      });
    }
  }

  const overall = axes.some((a) => a.state === 'mismatch') ? 'mismatch' : 'aligned';
  return { overall, axes, inputShape: shape };
}
