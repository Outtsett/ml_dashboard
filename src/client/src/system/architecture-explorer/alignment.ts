/**
 * Chart ↔ network alignment check.
 *
 * The candle chart and the neuron network sit on the same screen, which invites
 * the assumption that the bars ARE the model's input. They are related, but not
 * identically — this module states exactly which axes line up and which do not,
 * so the pairing can be trusted rather than assumed.
 *
 * The derived input shape is `B × W × F`:
 *   B — batch. Symbolic in the schematic. The chart shows ONE window, so the
 *       chart's batch is 1. This is stated, never silently assumed.
 *   W — window length in bars. This is the axis that genuinely aligns: the chart
 *       is asked for exactly `window_size` bars, so W should equal the bars
 *       actually returned. If the feed comes up short (thin symbol, market gap),
 *       they diverge and the check MUST say so.
 *   F — feature width. This does NOT align with the chart's columns. F counts
 *       ENGINEERED features (derive.ts DEFAULT_NEURAL_FEATURES = 20; xgboost 29,
 *       sourced 'price_action / volatility / volume / momentum'), computed from
 *       the bars upstream. The chart draws OHLC. Presenting F as if it were the
 *       chart's fields would be a lie, so it is reported as derived-from, not
 *       equal-to.
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
  const featureAxis = dims?.[dims.length - 1];
  if (typeof featureAxis === 'number' && dims && dims.length >= 2) {
    axes.push({
      label: 'features',
      chart: 'OHLC per bar',
      model: `${featureAxis} features`,
      state: 'unlinked',
      note: `Not the chart's columns. The model consumes ${featureAxis} engineered features computed from these bars upstream, not the raw OHLC fields drawn here.`,
    });
  }

  const overall = axes.some((a) => a.state === 'mismatch') ? 'mismatch' : 'aligned';
  return { overall, axes, inputShape: shape };
}
