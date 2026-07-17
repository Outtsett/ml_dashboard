/**
 * deriveArchGraph — faithful, source-derived architecture schematics.
 *
 * Every derivation here mirrors real model source read from this repo — no
 * invented layers, no fabricated parameter counts. The parameter formulas are
 * the exact PyTorch weight-tensor sizes for each nn.Module:
 *
 *   src/ml/blocks/tft.py          → temporal_fusion_transformer
 *   src/ml/blocks/encoder.py      → transformer_2s / transformer_tiny (TwoStreamPriceVolumeEncoder)
 *   src/ml/blocks/{encoder,head,attention}.py + templates → pytorch_* / transformer_seq
 *   src/ml/xgb_classifier/main.py → xgboost (feature-load → triple-barrier → hist boosting → sigmoid)
 *
 * Layout is a column (x, data-flow left→right) × lane (y, parallel branches)
 * grid; pixel geometry lives in NetworkDiagram. Repeated transformer encoder
 * layers unroll into nodes when n_layers <= UNROLL_CAP, else collapse to one
 * "× N" node whose params scale with N (deterministic rule, tested).
 */

import type { ArchGraph, ArchNode, ArchEdge, TunableHp } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Parameter formulas — exact PyTorch trainable-weight counts (bias included
// unless stated). These reproduce the real .numel() sum of each module.
// ────────────────────────────────────────────────────────────────────────────

/** nn.Linear(inD, outD) = weight (inD·outD) + bias (outD). */
const linearP = (inD: number, outD: number, bias = true): number =>
  inD * outD + (bias ? outD : 0);

/** nn.LayerNorm(d) = weight (d) + bias (d). */
const layerNormP = (d: number): number => 2 * d;

/** nn.Conv1d(inCh, outCh, k) = inCh·outCh·k + outCh. */
const conv1dP = (inCh: number, outCh: number, k: number): number =>
  inCh * outCh * k + outCh;

/** nn.MultiheadAttention(embed_dim=d): in_proj 3d² + 3d, out_proj d² + d = 4d² + 4d. */
const mhaP = (d: number): number => 4 * d * d + 4 * d;

/**
 * nn.LSTM(input, hidden, num_layers): per layer 4·hidden·in_l + 4·hidden·hidden
 * + 8·hidden (bias_ih + bias_hh). Layer 0 uses `input`, later layers `hidden`.
 */
const lstmP = (input: number, hidden: number, layers: number): number => {
  let total = 0;
  for (let l = 0; l < layers; l += 1) {
    const inl = l === 0 ? input : hidden;
    total += 4 * hidden * inl + 4 * hidden * hidden + 8 * hidden;
  }
  return total;
};

/**
 * nn.TransformerEncoderLayer(d_model=d, nhead, dim_feedforward=ff): self-attn
 * (4d²+4d) + linear1 (d·ff+ff) + linear2 (ff·d+d) + 2 LayerNorm (norm1/norm2).
 */
const transformerLayerP = (d: number, ff: number): number =>
  mhaP(d) + linearP(d, ff) + linearP(ff, d) + 2 * layerNormP(d);

/** GatedLinearUnit(inD, outD): fc_value + fc_gate = 2·Linear(inD, outD). */
const gluP = (inD: number, outD: number): number => 2 * linearP(inD, outD);

/**
 * GatedResidualNetwork(inD, hidden, outD, context): fc1 + optional fc_context
 * (no bias) + fc2 + GLU(outD,outD) + LayerNorm(outD) + skip-Linear when inD≠outD.
 */
const grnP = (inD: number, hidden: number, outD: number, context: number | null = null): number => {
  let p = linearP(inD, hidden);
  if (context != null) p += linearP(context, hidden, false);
  p += linearP(hidden, outD);
  p += gluP(outD, outD);
  p += layerNormP(outD);
  if (inD !== outD) p += linearP(inD, outD);
  return p;
};

/**
 * VariableSelectionNetwork(numInputs=F, inputDim, hidden=H, context): one
 * selection GRN (F·inputDim → F) + F per-variable GRNs (inputDim → H).
 */
const vsnP = (F: number, inputDim: number, H: number, context: number | null = null): number => {
  const selection = grnP(F * inputDim, H, F, context);
  const perVar = grnP(inputDim, H, H, null);
  return selection + F * perVar;
};

/**
 * InterpretableMultiHeadAttention(d_model=H, n_heads=h): per-head q/k proj
 * (H→H), SHARED value proj (H→d_head), out proj (d_head→H). d_head = H/h.
 */
const interpretableMhaP = (H: number, h: number): number => {
  const dHead = Math.floor(H / h);
  return linearP(H, H) + linearP(H, H) + linearP(H, dHead) + linearP(dHead, H);
};

// ────────────────────────────────────────────────────────────────────────────
// Hyperparameter reading — the contract passes number|string|boolean values.
// List-shaped HPs (hidden_dims, channels) arrive as a "a,b,c" string or absent.
// ────────────────────────────────────────────────────────────────────────────

type Hp = Record<string, number | string | boolean>;

function numHp(hp: Hp, keys: string[], dflt: number): number {
  for (const k of keys) {
    const v = hp[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return dflt;
}

function intHp(hp: Hp, keys: string[], dflt: number): number {
  return Math.max(1, Math.round(numHp(hp, keys, dflt)));
}

function listHp(hp: Hp, keys: string[], dflt: number[]): number[] {
  for (const k of keys) {
    const v = hp[k];
    if (typeof v === 'string' && v.trim() !== '') {
      const parts = v
        .replace(/[[\]()]/g, '')
        .split(/[,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.round(n));
      if (parts.length) return parts;
    }
  }
  return dflt;
}

const D = '×'; // ×
const shape = (...parts: (string | number)[]): string => parts.join(` ${D} `);

// ────────────────────────────────────────────────────────────────────────────
// GraphBuilder — accumulates nodes/edges, derives totals/columns/lanes.
// ────────────────────────────────────────────────────────────────────────────

class GraphBuilder {
  private nodes: ArchNode[] = [];
  private edges: ArchEdge[] = [];

  add(node: ArchNode): string {
    this.nodes.push(node);
    return node.id;
  }

  edge(from: string, to: string, kind: ArchEdge['kind'] = 'flow', label?: string): void {
    this.edges.push({ from, to, kind, label });
  }

  finalize(title: string, subtitle?: string): ArchGraph {
    const totalParams = this.nodes.reduce((s, n) => s + (n.params ?? 0), 0);
    const columns = this.nodes.reduce((m, n) => Math.max(m, n.column), 0) + 1;
    const lanes = this.nodes.reduce((m, n) => Math.max(m, n.lane), 0) + 1;
    return { title, subtitle, nodes: this.nodes, edges: this.edges, totalParams, columns, lanes };
  }
}

/** How many transformer encoder layers to unroll before collapsing to "× N". */
const UNROLL_CAP = 4;
/** How many individual boosting trees to draw before summarizing. */
const TREE_DISPLAY_CAP = 4;

const DEFAULT_NEURAL_FEATURES = 20;
const DEFAULT_XGB_FEATURES = 29;

// ────────────────────────────────────────────────────────────────────────────
// Shared: an unrolled/stacked transformer encoder over an existing input node.
// Decomposes each unrolled layer into self-attention + feed-forward sub-nodes
// with an explicit residual skip edge, per the TransformerEncoderLayer source.
// Returns the id of the node that carries the encoder output.
// ────────────────────────────────────────────────────────────────────────────

function addTransformerEncoder(
  g: GraphBuilder,
  opts: {
    inputId: string;
    startColumn: number;
    lane: number;
    d: number;
    nHeads: number;
    dFF: number;
    W: number | string;
    nLayers: number;
    dropout: number;
  },
): { lastId: string; nextColumn: number } {
  const { inputId, startColumn, lane, d, nHeads, dFF, W, nLayers, dropout } = opts;
  const seqShape = shape('B', W, d);

  if (nLayers > UNROLL_CAP) {
    // Collapse to one stacked node; params scale with layer count.
    const perLayer = transformerLayerP(d, dFF);
    const id = g.add({
      id: 'enc_stack',
      kind: 'attention',
      label: 'Transformer Encoder',
      sublabel: `${D} ${nLayers} layers · ${nHeads} heads · d_ff ${dFF}`,
      inShape: seqShape,
      outShape: seqShape,
      params: nLayers * perLayer,
      column: startColumn,
      lane,
      detail: {
        n_layers: nLayers,
        n_heads: nHeads,
        d_model: d,
        d_ff: dFF,
        dropout,
        'params / layer': perLayer,
        norm: 'pre-norm (norm_first)',
        residual: 'attn + FFN skip inside each layer',
      },
      analogy:
        'A tall stack of bar-comparison rounds; each round every bar re-weighs which other bars matter, then refines its own read.',
    });
    return { lastId: id, nextColumn: startColumn + 1 };
  }

  // Unroll: two sub-nodes per layer (self-attn + FFN), each with a residual skip.
  let prev = inputId;
  let col = startColumn;
  for (let i = 0; i < nLayers; i += 1) {
    const layerInput = prev;
    const saId = g.add({
      id: `enc${i}_sa`,
      kind: 'attention',
      label: `Self-Attention ${i + 1}`,
      sublabel: `${nHeads} heads · pre-norm`,
      inShape: seqShape,
      outShape: seqShape,
      params: mhaP(d) + layerNormP(d),
      column: col,
      lane,
      detail: {
        n_heads: nHeads,
        d_model: d,
        d_head: Math.floor(d / nHeads),
        'scale': `1/sqrt(${Math.floor(d / nHeads)})`,
        norm: 'LayerNorm before attn (pre-norm)',
        residual: 'x + Attn(LN(x))',
      },
      analogy: 'Every bar votes on which earlier bars matter for it, then adds that context onto itself.',
    });
    const ffId = g.add({
      id: `enc${i}_ff`,
      kind: 'linear',
      label: `Feed-Forward ${i + 1}`,
      sublabel: `d_ff ${dFF} · GELU`,
      inShape: seqShape,
      outShape: seqShape,
      params: linearP(d, dFF) + linearP(dFF, d) + layerNormP(d),
      column: col + 1,
      lane,
      detail: {
        d_model: d,
        d_ff: dFF,
        activation: 'GELU',
        dropout,
        residual: 'x + FFN(LN(x))',
      },
      analogy: 'A per-bar refinement pass — reshapes each bar’s read, then adds the change back on.',
    });
    g.edge(layerInput, saId, 'flow', i === 0 ? seqShape : undefined);
    g.edge(saId, ffId, 'flow');
    // Residual highway carrying the layer input past attention into the add.
    g.edge(layerInput, ffId, 'residual', 'skip');
    prev = ffId;
    col += 2;
  }
  return { lastId: prev, nextColumn: col };
}

// ────────────────────────────────────────────────────────────────────────────
// Temporal Fusion Transformer  (src/ml/blocks/tft.py)
// ────────────────────────────────────────────────────────────────────────────

function buildTft(hp: Hp): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_NEURAL_FEATURES);
  const W = intHp(hp, ['window_size', 'window'], 64);
  const dModel = intHp(hp, ['d_model'], 64);
  const nHeads = intHp(hp, ['n_heads'], 4);
  const L = intHp(hp, ['lstm_layers'], 1);
  const dropout = numHp(hp, ['dropout'], 0.1);
  const nClasses = intHp(hp, ['n_classes'], 2);
  const H = dModel; // hidden_size defaults to d_model
  const outSize = nClasses === 2 ? 1 : nClasses;

  const g = new GraphBuilder();
  const seqShape = shape('B', W, H);

  const input = g.add({
    id: 'input',
    kind: 'input',
    label: 'Feature Window',
    sublabel: `${F} features ${D} ${W} bars`,
    outShape: shape('B', W, F),
    column: 0,
    lane: 0,
    detail: { window_size: W, n_features: F, input_dim_per_var: 1 },
    analogy: 'A rolling window of engineered signals — the chart slice the model is about to read.',
  });

  const vsn = g.add({
    id: 'vsn',
    kind: 'gate',
    label: 'Variable Selection',
    sublabel: `${F} vars → softmax weights`,
    inShape: shape('B', W, F),
    outShape: seqShape,
    params: vsnP(F, 1, H),
    column: 1,
    lane: 0,
    detail: {
      num_variables: F,
      hidden_size: H,
      selection_grn: `GRN(${F} → ${F})`,
      per_variable_grns: `${F} × GRN(1 → ${H})`,
      dropout,
      output: 'weighted sum of per-variable GRNs',
    },
    analogy: 'A trader glancing at every indicator and deciding which few actually matter at this bar.',
  });
  g.edge(input, vsn, 'flow', shape('B', W, F));

  const lstm = g.add({
    id: 'lstm',
    kind: 'recurrent',
    label: 'LSTM + Gated Skip',
    sublabel: `${L} layer${L > 1 ? 's' : ''} · GLU add & norm`,
    inShape: seqShape,
    outShape: seqShape,
    params: lstmP(H, H, L) + gluP(H, H) + layerNormP(H),
    column: 2,
    lane: 0,
    detail: {
      lstm_layers: L,
      hidden_size: H,
      gated_skip: 'LayerNorm(vsn + GLU(lstm_out))',
    },
    analogy: 'Reads the window bar-by-bar, keeping a running memory of what just happened, then blends it back with the selected features.',
  });
  g.edge(vsn, lstm, 'flow');
  g.edge(vsn, lstm, 'residual', 'skip');

  const enrich = g.add({
    id: 'enrich',
    kind: 'gate',
    label: 'Enrichment GRN',
    sublabel: 'position-wise gated residual',
    inShape: seqShape,
    outShape: seqShape,
    params: grnP(H, H, H),
    column: 3,
    lane: 0,
    detail: { hidden_size: H, context: 'none (no static covariates)' },
    analogy: 'A valve at each bar that lets a useful transformation through and shuts off a noisy one.',
  });
  g.edge(lstm, enrich, 'flow');

  const attn = g.add({
    id: 'attn',
    kind: 'attention',
    label: 'Interpretable Attention',
    sublabel: `${nHeads} heads · shared value · gated skip`,
    inShape: seqShape,
    outShape: seqShape,
    params: interpretableMhaP(H, nHeads) + gluP(H, H) + layerNormP(H),
    column: 4,
    lane: 0,
    detail: {
      n_heads: nHeads,
      d_model: H,
      d_head: Math.floor(H / nHeads),
      shared_value: 'single V across heads (head-averaged → readable map)',
      gated_skip: 'LayerNorm(enriched + GLU(attn_out))',
    },
    analogy: 'Every bar votes on which earlier bars matter — and because heads share one value, the vote map is directly readable.',
  });
  g.edge(enrich, attn, 'flow');
  g.edge(enrich, attn, 'residual', 'skip');

  const ffn = g.add({
    id: 'ffn',
    kind: 'gate',
    label: 'Feed-Forward GRN',
    sublabel: 'position-wise gated residual',
    inShape: seqShape,
    outShape: seqShape,
    params: grnP(H, H, H) + gluP(H, H) + layerNormP(H),
    column: 5,
    lane: 0,
    detail: { hidden_size: H, gated_skip: 'LayerNorm(attended + GLU(ffn))' },
    analogy: 'One more per-bar refinement, gated so only the helpful part of the change survives.',
  });
  g.edge(attn, ffn, 'flow');
  g.edge(attn, ffn, 'residual', 'skip');

  const pool = g.add({
    id: 'last_step',
    kind: 'reshape',
    label: 'Take Last Bar',
    sublabel: 'out_seq[:, -1, :]',
    inShape: seqShape,
    outShape: shape('B', H),
    params: 0,
    column: 6,
    lane: 0,
    detail: { operation: 'slice final timestep', from: seqShape, to: shape('B', H) },
    analogy: 'Read the model’s state at the most recent bar — that’s where the forecast is taken from.',
  });
  g.edge(ffn, pool, 'flow');

  const head = g.add({
    id: 'head',
    kind: 'head',
    label: 'Output Linear',
    sublabel: nClasses === 2 ? 'direction (1 logit)' : `${nClasses}-class logits`,
    inShape: shape('B', H),
    outShape: shape('B', outSize),
    params: linearP(H, outSize),
    column: 7,
    lane: 0,
    detail: { in_dim: H, out_size: outSize, n_classes: nClasses },
    analogy: 'The final up/down lean, read straight off the last-bar summary.',
  });
  g.edge(pool, head, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: nClasses === 2 ? 'P(up) logit' : 'class logits',
    outShape: shape('B', outSize),
    params: 0,
    column: 8,
    lane: 0,
    detail: { loss: nClasses === 2 ? 'BCEWithLogits' : 'CrossEntropy' },
    analogy: 'What the model hands back — a conviction score you threshold into a trade.',
  });
  g.edge(head, out, 'flow');

  return g.finalize(
    'Temporal Fusion Transformer',
    `interpretable classification · W=${W} · F=${F} · d_model=${H} · ${nHeads} heads`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Two-stream price/volume transformer  (src/ml/blocks/encoder.py)
// Shared by transformer_2s (full) and transformer_tiny (small dims).
// ────────────────────────────────────────────────────────────────────────────

interface TwoStreamOpts {
  title: string;
  subtitleTag: string;
  wDflt: number;
  dmpDflt: number;
  dmvDflt: number;
  headsDflt: number;
  layersDflt: number;
  ffDflt: number;
  headKind: 'range' | 'direction';
}

function buildTwoStream(hp: Hp, o: TwoStreamOpts): ArchGraph {
  const W = intHp(hp, ['window_size', 'window'], o.wDflt);
  const dmp = intHp(hp, ['d_model_price'], o.dmpDflt);
  const dmv = intHp(hp, ['d_model_volume', 'd_model_vol'], o.dmvDflt);
  const dModel = intHp(hp, ['d_model'], dmp + dmv);
  const nHeads = intHp(hp, ['n_heads'], o.headsDflt);
  const nLayers = intHp(hp, ['n_layers'], o.layersDflt);
  const dFF = intHp(hp, ['d_ff'], o.ffDflt);
  const dropout = numHp(hp, ['dropout'], 0.1);

  const g = new GraphBuilder();

  // Price stream (lane 0).
  const priceIn = g.add({
    id: 'price_in',
    kind: 'input',
    label: 'Price Window',
    sublabel: `OHLC ${D} ${W} bars`,
    outShape: shape('B', W, 4),
    column: 0,
    lane: 0,
    detail: { channels: 'O, H, L, C', window_size: W, normalize: 'per-window vs last close' },
    analogy: 'The raw OHLC candles of the window, re-scaled around the latest close.',
  });
  const priceProj = g.add({
    id: 'price_proj',
    kind: 'embedding',
    label: 'Price Projection',
    sublabel: `Linear 4 → ${dmp}`,
    inShape: shape('B', W, 4),
    outShape: shape('B', W, dmp),
    params: linearP(4, dmp),
    column: 1,
    lane: 0,
    detail: { in_dim: 4, out_dim: dmp },
    analogy: 'Re-expresses each candle in the model’s internal vocabulary.',
  });
  const pricenPE = g.add({
    id: 'price_pe',
    kind: 'positional',
    label: 'Positional Encoding',
    sublabel: 'sinusoidal (fixed)',
    inShape: shape('B', W, dmp),
    outShape: shape('B', W, dmp),
    params: 0,
    column: 2,
    lane: 0,
    detail: { type: 'Vaswani sin/cos', trainable: 'no (buffer)', max_len: W },
    analogy: 'Stamps each bar with its position so order survives once bars start comparing themselves.',
  });
  g.edge(priceIn, priceProj, 'flow', shape('B', W, 4));
  g.edge(priceProj, pricenPE, 'flow');

  // Volume stream (lane 1) — no positional encoding.
  const volIn = g.add({
    id: 'vol_in',
    kind: 'input',
    label: 'Volume Window',
    sublabel: `V ${D} ${W} bars`,
    outShape: shape('B', W, 1),
    column: 0,
    lane: 1,
    detail: { channels: 'V', window_size: W, normalize: 'per-window z-score' },
    analogy: 'The traded volume behind each candle, z-scored across the window.',
  });
  const volProj = g.add({
    id: 'vol_proj',
    kind: 'embedding',
    label: 'Volume Projection',
    sublabel: `Linear 1 → ${dmv}`,
    inShape: shape('B', W, 1),
    outShape: shape('B', W, dmv),
    params: linearP(1, dmv),
    column: 1,
    lane: 1,
    detail: { in_dim: 1, out_dim: dmv, positional_encoding: 'none' },
    analogy: 'Lifts the single volume number into its own small feature space (no position stamp).',
  });
  g.edge(volIn, volProj, 'flow', shape('B', W, 1));

  // Fusion — concat streams to d_model = dmp + dmv.
  const fuse = g.add({
    id: 'fuse',
    kind: 'fusion',
    label: 'Concat Streams',
    sublabel: `${dmp} + ${dmv} → ${dModel}`,
    inShape: `${shape('B', W, dmp)}  |  ${shape('B', W, dmv)}`,
    outShape: shape('B', W, dModel),
    params: 0,
    column: 3,
    lane: 0,
    detail: { price_width: dmp, volume_width: dmv, d_model: dModel },
    analogy: 'Glues the price feel and the volume feel into one combined bar representation.',
  });
  g.edge(pricenPE, fuse, 'flow');
  g.edge(volProj, fuse, 'flow');

  const enc = addTransformerEncoder(g, {
    inputId: fuse,
    startColumn: 4,
    lane: 0,
    d: dModel,
    nHeads,
    dFF,
    W,
    nLayers,
    dropout,
  });

  const pool = g.add({
    id: 'pool',
    kind: 'pool',
    label: 'Temporal Pool',
    sublabel: 'mean over T',
    inShape: shape('B', W, dModel),
    outShape: shape('B', dModel),
    params: 0,
    column: enc.nextColumn,
    lane: 0,
    detail: { operation: 'mean over window', from: shape('B', W, dModel), to: shape('B', dModel) },
    analogy: 'Compresses the whole window into a single summary read for the final decision.',
  });
  g.edge(enc.lastId, pool, 'flow');

  const isRange = o.headKind === 'range';
  const nBuckets = 21;
  const headOut = isRange ? nBuckets : 2;
  const head = g.add({
    id: 'head',
    kind: 'head',
    label: isRange ? 'Range-Bucket Head' : 'Direction Head',
    sublabel: isRange ? `Linear → ${nBuckets} buckets` : 'Linear → 2 logits',
    inShape: shape('B', dModel),
    outShape: shape('B', headOut),
    params: linearP(dModel, headOut),
    column: enc.nextColumn + 1,
    lane: 0,
    detail: isRange
      ? { in_dim: dModel, n_buckets: nBuckets, output: 'log-softmax over buckets' }
      : { in_dim: dModel, n_classes: 2, output: 'raw 2-logit direction' },
    analogy: isRange
      ? 'Bins the forecast into where the next-N-bar range lands.'
      : 'The final up/down lean, read off the pooled summary.',
  });
  g.edge(pool, head, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: isRange ? 'P(bucket)' : 'P(up)',
    outShape: shape('B', headOut),
    params: 0,
    column: enc.nextColumn + 2,
    lane: 0,
    detail: { loss: isRange ? 'NLL (range bucket)' : 'CrossEntropy (direction)' },
    analogy: 'The score the model hands back for the trade decision.',
  });
  g.edge(head, out, 'flow');

  return g.finalize(
    o.title,
    `${o.subtitleTag} · W=${W} · d_model=${dModel} (${dmp}+${dmv}) · ${nLayers} layers · ${nHeads} heads`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// transformer_seq  (src/templates/architectures/transformer_seq.py.j2)
// ────────────────────────────────────────────────────────────────────────────

function buildTransformerSeq(hp: Hp): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_NEURAL_FEATURES);
  const W = intHp(hp, ['window_size', 'window'], 64);
  const dmp = intHp(hp, ['d_model_price'], 32);
  const dmv = intHp(hp, ['d_model_volume', 'd_model_vol'], 8);
  const dModel = intHp(hp, ['d_model'], dmp + dmv);
  const nLayers = intHp(hp, ['n_layers'], 2);
  const nHeads = intHp(hp, ['n_heads'], 4);
  const dFF = intHp(hp, ['d_ff'], 64);
  const dropout = numHp(hp, ['dropout'], 0.1);
  const nClasses = intHp(hp, ['n_classes'], 2);

  const g = new GraphBuilder();

  const input = g.add({
    id: 'input',
    kind: 'input',
    label: 'Feature Window',
    sublabel: `${F} features ${D} ${W} bars`,
    outShape: shape('B', W, F),
    column: 0,
    lane: 0,
    detail: { window_size: W, n_features: F },
    analogy: 'A rolling window of engineered features — the model’s reading material.',
  });

  const proj = g.add({
    id: 'proj',
    kind: 'embedding',
    label: 'Input Projection',
    sublabel: `Linear ${F} → ${dModel}`,
    inShape: shape('B', W, F),
    outShape: shape('B', W, dModel),
    params: linearP(F, dModel),
    column: 1,
    lane: 0,
    detail: { in_dim: F, out_dim: dModel },
    analogy: 'Re-expresses each bar’s feature vector in the model’s working width.',
  });
  g.edge(input, proj, 'flow', shape('B', W, F));

  const pe = g.add({
    id: 'pe',
    kind: 'positional',
    label: 'Positional Encoding',
    sublabel: 'sinusoidal (fixed)',
    inShape: shape('B', W, dModel),
    outShape: shape('B', W, dModel),
    params: 0,
    column: 2,
    lane: 0,
    detail: { type: 'Vaswani sin/cos', trainable: 'no (buffer)' },
    analogy: 'Stamps bar order onto the sequence before attention scrambles positions.',
  });
  g.edge(proj, pe, 'flow');

  const enc = addTransformerEncoder(g, {
    inputId: pe,
    startColumn: 3,
    lane: 0,
    d: dModel,
    nHeads,
    dFF,
    W,
    nLayers,
    dropout,
  });

  const pool = g.add({
    id: 'pool',
    kind: 'pool',
    label: 'Mean Pool',
    sublabel: 'mean over T',
    inShape: shape('B', W, dModel),
    outShape: shape('B', dModel),
    params: 0,
    column: enc.nextColumn,
    lane: 0,
    detail: { operation: 'mean over window' },
    analogy: 'Collapses the window into one summary vector for the read-out.',
  });
  g.edge(enc.lastId, pool, 'flow');

  const head = g.add({
    id: 'head',
    kind: 'head',
    label: 'Direction Head',
    sublabel: nClasses === 2 ? 'Linear → 2 logits' : `Linear → ${nClasses} logits`,
    inShape: shape('B', dModel),
    outShape: shape('B', nClasses),
    params: linearP(dModel, nClasses),
    column: enc.nextColumn + 1,
    lane: 0,
    detail: { in_dim: dModel, n_classes: nClasses },
    analogy: 'The final up/down read off the pooled window.',
  });
  g.edge(pool, head, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: 'P(up)',
    outShape: shape('B', nClasses),
    params: 0,
    column: enc.nextColumn + 2,
    lane: 0,
    detail: { loss: 'CrossEntropy' },
    analogy: 'The conviction score the strategy trades on.',
  });
  g.edge(head, out, 'flow');

  return g.finalize(
    'Encoder-Only Transformer',
    `sequence classification · W=${W} · F=${F} · d_model=${dModel} · ${nLayers} layers`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// xgboost  (src/ml/xgb_classifier/main.py)
// Feature matrix → triple-barrier labels → additive hist-boosted trees →
// sum of margins → sigmoid → P(up). Trees carry no backprop params.
// ────────────────────────────────────────────────────────────────────────────

function buildXgboost(hp: Hp): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_XGB_FEATURES);
  const nRounds = intHp(hp, ['n_estimators', 'num_boost_round', 'n_rounds'], 500);
  const maxDepth = intHp(hp, ['max_depth'], 6);
  const lr = numHp(hp, ['learning_rate'], 0.05);
  const horizon = intHp(hp, ['label_horizon_bars', 'horizon'], 5);
  const thr = numHp(hp, ['label_threshold_bp'], 5);

  const g = new GraphBuilder();

  const feat = g.add({
    id: 'features',
    kind: 'input',
    label: 'Feature Matrix',
    sublabel: `${F} engineered features`,
    outShape: shape('N', F),
    column: 0,
    lane: 0,
    detail: { n_features: F, source: 'price_action / volatility / volume / momentum' },
    analogy: 'One row of indicator readings per bar — the model’s tabular input.',
  });

  const labels = g.add({
    id: 'labels',
    kind: 'reshape',
    label: 'Triple-Barrier Labels',
    sublabel: `H=${horizon} · thr=${thr}bp`,
    outShape: shape('N', 1),
    params: 0,
    column: 0,
    lane: 1,
    detail: {
      horizon_bars: horizon,
      threshold_bp: thr,
      target: 'first hit of profit / stop / time barrier',
    },
    analogy: 'Labels each bar by which happened first — profit, stop, or timeout — the answer key trees learn against.',
  });

  const treeCount = Math.min(nRounds, TREE_DISPLAY_CAP);
  const leaves = Math.pow(2, maxDepth);
  let prev = feat;
  let col = 1;
  const treeIds: string[] = [];
  for (let i = 0; i < treeCount; i += 1) {
    const isLastShown = i === treeCount - 1;
    const collapsed = isLastShown && nRounds > TREE_DISPLAY_CAP;
    const id = g.add({
      id: `tree_${i}`,
      kind: 'tree',
      label: collapsed ? `Trees ${i + 1}…${nRounds}` : `Tree ${i + 1}`,
      sublabel: collapsed ? `+${nRounds - TREE_DISPLAY_CAP + 1} boosting rounds` : `depth ${maxDepth}`,
      inShape: shape('N', F),
      outShape: shape('N', 1),
      params: 0,
      column: col,
      lane: 0,
      detail: {
        max_depth: maxDepth,
        'leaves / tree (max)': leaves,
        learning_rate: lr,
        fits: i === 0 ? 'the labels' : 'residual errors of prior trees',
        ...(collapsed ? { boosting_rounds: nRounds } : {}),
      },
      analogy: 'A flowchart of if-then price rules; each new tree patches the mistakes the last ones made.',
    });
    treeIds.push(id);
    g.edge(prev, id, 'flow', i === 0 ? shape('N', F) : 'residuals');
    prev = id;
    col += 1;
  }
  // Supervision edge (labels are the training target for the whole ensemble).
  g.edge(labels, treeIds[0]!, 'context', 'target');

  const sum = g.add({
    id: 'sum',
    kind: 'ensemble',
    label: 'Sum of Margins',
    sublabel: `Σ over ${nRounds} trees · × lr`,
    inShape: shape('N', 1),
    outShape: shape('N', 1),
    params: 0,
    column: col,
    lane: 0,
    detail: { boosting_rounds: nRounds, learning_rate: lr, combine: 'additive raw log-odds margin' },
    analogy: 'Adds up every tree’s small rule-vote into one raw score.',
  });
  g.edge(prev, sum, 'flow');

  const sig = g.add({
    id: 'sigmoid',
    kind: 'activation',
    label: 'Sigmoid',
    sublabel: 'logit → probability',
    inShape: shape('N', 1),
    outShape: shape('N', 1),
    params: 0,
    column: col + 1,
    lane: 0,
    detail: { objective: 'binary:logistic', calibration: 'reliability diagram + ECE reported' },
    analogy: 'Squashes the raw score into a 0–100% chance of the next move being up.',
  });
  g.edge(sum, sig, 'flow');

  const out = g.add({
    id: 'prob',
    kind: 'output',
    label: 'P(up)',
    sublabel: 'calibrated probability',
    outShape: shape('N', 1),
    params: 0,
    column: col + 2,
    lane: 0,
    detail: { output: 'P(up) per bar', reported: 'AUC, log-loss, Brier, ECE, cost-adjusted PnL' },
    analogy: 'The per-bar up-probability the strategy thresholds into trades.',
  });
  g.edge(sig, out, 'flow');

  return g.finalize(
    'XGBoost Direction Classifier',
    `hist GPU boosting · ${nRounds} rounds · depth ${maxDepth} · ${F} features`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// pytorch_mlp  (src/templates/architectures/pytorch_mlp.py.j2)
// ────────────────────────────────────────────────────────────────────────────

function buildMlp(hp: Hp): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_NEURAL_FEATURES);
  const hidden = listHp(hp, ['hidden_dims'], [128, 64]);
  const dropout = numHp(hp, ['dropout'], 0.1);
  const nClasses = intHp(hp, ['n_classes'], 2);

  const g = new GraphBuilder();
  const input = g.add({
    id: 'input',
    kind: 'input',
    label: 'Feature Vector',
    sublabel: `${F} features`,
    outShape: shape('B', F),
    column: 0,
    lane: 0,
    detail: { n_features: F },
    analogy: 'One flat row of indicator readings for the current bar.',
  });

  let prev = input;
  let inDim = F;
  let col = 1;
  hidden.forEach((width, i) => {
    const id = g.add({
      id: `dense_${i}`,
      kind: 'linear',
      label: `Dense ${i + 1}`,
      sublabel: `Linear → ${width} · GELU · drop ${dropout}`,
      inShape: shape('B', inDim),
      outShape: shape('B', width),
      params: linearP(inDim, width),
      column: col,
      lane: 0,
      detail: { in_dim: inDim, out_dim: width, activation: 'GELU', dropout },
      analogy: 'A fully-connected layer mixing every feature into a new set of learned combinations.',
    });
    g.edge(prev, id, 'flow', i === 0 ? shape('B', inDim) : undefined);
    prev = id;
    inDim = width;
    col += 1;
  });

  const head = g.add({
    id: 'head',
    kind: 'head',
    label: 'Direction Head',
    sublabel: nClasses === 2 ? 'Linear → 2 logits' : `Linear → ${nClasses} logits`,
    inShape: shape('B', inDim),
    outShape: shape('B', nClasses),
    params: linearP(inDim, nClasses),
    column: col,
    lane: 0,
    detail: { in_dim: inDim, n_classes: nClasses },
    analogy: 'Reads the up/down lean off the final hidden representation.',
  });
  g.edge(prev, head, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: 'P(up)',
    outShape: shape('B', nClasses),
    params: 0,
    column: col + 1,
    lane: 0,
    detail: { loss: 'CrossEntropy' },
    analogy: 'The conviction score handed back to the strategy.',
  });
  g.edge(head, out, 'flow');

  return g.finalize('Multi-Layer Perceptron', `flat classifier · F=${F} · hidden [${hidden.join(', ')}]`);
}

// ────────────────────────────────────────────────────────────────────────────
// pytorch_cnn  (src/templates/architectures/pytorch_cnn.py.j2)
// ────────────────────────────────────────────────────────────────────────────

function buildCnn(hp: Hp): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_NEURAL_FEATURES);
  const W = intHp(hp, ['window_size', 'window'], 64);
  const channels = listHp(hp, ['channels'], [16, 32]);
  const kernels = listHp(hp, ['kernel_sizes'], [5, 3]);
  const dropout = numHp(hp, ['dropout'], 0.1);
  const nClasses = intHp(hp, ['n_classes'], 2);

  const g = new GraphBuilder();
  const input = g.add({
    id: 'input',
    kind: 'input',
    label: 'Rolling Windows',
    sublabel: `${F} channels ${D} ${W} bars`,
    outShape: shape('B', F, W),
    column: 0,
    lane: 0,
    detail: { in_channels: F, time: W, layout: '(B, C=F, T=W)' },
    analogy: 'Each feature is a channel; the conv reads them along the time axis of the window.',
  });

  let prev = input;
  let inCh = F;
  let col = 1;
  channels.forEach((ch, i) => {
    const k = kernels[i] ?? kernels[kernels.length - 1] ?? 3;
    const id = g.add({
      id: `conv_${i}`,
      kind: 'conv',
      label: `Conv1D ${i + 1}`,
      sublabel: `${ch} ch · k=${k} · GELU`,
      inShape: shape('B', inCh, W),
      outShape: shape('B', ch, W),
      params: conv1dP(inCh, ch, k),
      column: col,
      lane: 0,
      detail: { in_channels: inCh, out_channels: ch, kernel: k, padding: Math.floor(k / 2), dropout },
      analogy: 'A pattern-scanner sliding a k-bar magnifying glass along the window.',
    });
    g.edge(prev, id, 'flow', i === 0 ? shape('B', inCh, W) : undefined);
    prev = id;
    inCh = ch;
    col += 1;
  });

  const pool = g.add({
    id: 'pool',
    kind: 'pool',
    label: 'Global Avg Pool',
    sublabel: 'mean over T',
    inShape: shape('B', inCh, W),
    outShape: shape('B', inCh),
    params: 0,
    column: col,
    lane: 0,
    detail: { operation: 'mean over time', from: shape('B', inCh, W), to: shape('B', inCh) },
    analogy: 'Squashes the scanned window down to one summary per channel.',
  });
  g.edge(prev, pool, 'flow');

  const head = g.add({
    id: 'head',
    kind: 'head',
    label: 'Direction Head',
    sublabel: nClasses === 2 ? 'Linear → 2 logits' : `Linear → ${nClasses} logits`,
    inShape: shape('B', inCh),
    outShape: shape('B', nClasses),
    params: linearP(inCh, nClasses),
    column: col + 1,
    lane: 0,
    detail: { in_dim: inCh, n_classes: nClasses },
    analogy: 'Reads the up/down lean off the pooled convolution features.',
  });
  g.edge(pool, head, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: 'P(up)',
    outShape: shape('B', nClasses),
    params: 0,
    column: col + 2,
    lane: 0,
    detail: { loss: 'CrossEntropy' },
    analogy: 'The conviction score the strategy trades on.',
  });
  g.edge(head, out, 'flow');

  return g.finalize(
    '1D Convolutional Network',
    `windowed classifier · W=${W} · channels [${channels.join(', ')}] · kernels [${kernels.join(', ')}]`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// pytorch_autoencoder / pytorch_vae
//   src/templates/architectures/pytorch_autoencoder.py.j2 (variational=false)
//   src/templates/architectures/pytorch_vae.py.j2         (variational=true)
// ────────────────────────────────────────────────────────────────────────────

function buildAutoencoder(hp: Hp, variational: boolean): ArchGraph {
  const F = intHp(hp, ['n_features', 'num_features'], DEFAULT_NEURAL_FEATURES);
  const hidden = listHp(hp, ['hidden_dims'], [128, 64]);
  const latent = intHp(hp, ['latent_dim'], 16);
  const dropout = numHp(hp, ['dropout'], 0.1);
  const beta = numHp(hp, ['beta'], 1.0);
  const lastHidden = hidden[hidden.length - 1]!;

  // MLPEncoder body params: chained Linear(F→h0→h1→…). (latent = last hidden.)
  let encParams = 0;
  let prevDim = F;
  for (const h of hidden) {
    encParams += linearP(prevDim, h);
    prevDim = h;
  }
  // MLPDecoder body params: Linear(latent → reversed hidden → F).
  const revHidden = [...hidden].reverse();
  let decParams = 0;
  let dPrev = latent;
  for (const h of revHidden) {
    decParams += linearP(dPrev, h);
    dPrev = h;
  }
  decParams += linearP(dPrev, F);

  const g = new GraphBuilder();

  const input = g.add({
    id: 'input',
    kind: 'input',
    label: 'Feature Vector',
    sublabel: `${F} features`,
    outShape: shape('B', F),
    column: 0,
    lane: 0,
    detail: { n_features: F },
    analogy: 'One flat row of indicator readings — what the model tries to reconstruct.',
  });

  const encoder = g.add({
    id: 'encoder',
    kind: 'linear',
    label: 'Encoder MLP',
    sublabel: `hidden [${hidden.join(', ')}] · GELU`,
    inShape: shape('B', F),
    outShape: shape('B', lastHidden),
    params: encParams,
    column: 1,
    lane: 0,
    detail: { in_dim: F, hidden_dims: hidden.join(', '), dropout },
    analogy: 'Squeezes the features down through narrowing layers toward the bottleneck.',
  });
  g.edge(input, encoder, 'flow', shape('B', F));

  if (!variational) {
    const bottleneck = g.add({
      id: 'bottleneck',
      kind: 'linear',
      label: 'Bottleneck z',
      sublabel: `Linear → ${latent}`,
      inShape: shape('B', lastHidden),
      outShape: shape('B', latent),
      params: linearP(lastHidden, latent),
      column: 2,
      lane: 0,
      detail: { in_dim: lastHidden, latent_dim: latent },
      analogy: 'The narrow neck — only the essential structure of a normal bar survives here.',
    });
    g.edge(encoder, bottleneck, 'flow');

    const decoder = g.add({
      id: 'decoder',
      kind: 'linear',
      label: 'Decoder MLP',
      sublabel: `hidden [${revHidden.join(', ')}] → ${F}`,
      inShape: shape('B', latent),
      outShape: shape('B', F),
      params: decParams,
      column: 3,
      lane: 0,
      detail: { latent_dim: latent, hidden_dims: revHidden.join(', '), out_dim: F },
      analogy: 'Rebuilds the original features from the compressed sketch.',
    });
    g.edge(bottleneck, decoder, 'flow');

    const out = g.add({
      id: 'output',
      kind: 'output',
      label: 'Reconstruction x̂',
      sublabel: 'anomaly = recon MSE',
      outShape: shape('B', F),
      params: 0,
      column: 4,
      lane: 0,
      detail: { loss: 'MSE(x, x̂)', score: 'per-sample recon error = anomaly score' },
      analogy: 'Big rebuild error means the bar looks unlike normal market structure — an anomaly.',
    });
    g.edge(decoder, out, 'flow');

    return g.finalize(
      'Autoencoder (Anomaly)',
      `reconstruction · F=${F} · hidden [${hidden.join(', ')}] · latent ${latent}`,
    );
  }

  // Variational: parallel μ / logσ² branches (lanes 0/1) → reparameterize.
  const mu = g.add({
    id: 'mu',
    kind: 'linear',
    label: 'μ Projection',
    sublabel: `Linear → ${latent}`,
    inShape: shape('B', lastHidden),
    outShape: shape('B', latent),
    params: linearP(lastHidden, latent),
    column: 2,
    lane: 0,
    detail: { in_dim: lastHidden, latent_dim: latent, role: 'posterior mean' },
    analogy: 'The center of the compressed "normal market" description.',
  });
  const logvar = g.add({
    id: 'logvar',
    kind: 'linear',
    label: 'log σ² Projection',
    sublabel: `Linear → ${latent}`,
    inShape: shape('B', lastHidden),
    outShape: shape('B', latent),
    params: linearP(lastHidden, latent),
    column: 2,
    lane: 1,
    detail: { in_dim: lastHidden, latent_dim: latent, role: 'posterior log-variance' },
    analogy: 'The spread (uncertainty) around that center.',
  });
  g.edge(encoder, mu, 'flow');
  g.edge(encoder, logvar, 'flow');

  const reparam = g.add({
    id: 'reparam',
    kind: 'fusion',
    label: 'Reparameterize',
    sublabel: 'z = μ + σ ⊙ ε',
    inShape: `${shape('B', latent)}  |  ${shape('B', latent)}`,
    outShape: shape('B', latent),
    params: 0,
    column: 3,
    lane: 0,
    detail: { latent_dim: latent, sample: 'z = mu + exp(0.5·logvar) · eps', eps: 'N(0, I)' },
    analogy: 'Draws one plausible compressed sample from the center-and-spread — keeps the graph differentiable.',
  });
  g.edge(mu, reparam, 'flow');
  g.edge(logvar, reparam, 'flow');

  const decoder = g.add({
    id: 'decoder',
    kind: 'linear',
    label: 'Decoder MLP',
    sublabel: `hidden [${revHidden.join(', ')}] → ${F}`,
    inShape: shape('B', latent),
    outShape: shape('B', F),
    params: decParams,
    column: 4,
    lane: 0,
    detail: { latent_dim: latent, hidden_dims: revHidden.join(', '), out_dim: F, beta },
    analogy: 'Rebuilds the original features from the sampled sketch.',
  });
  g.edge(reparam, decoder, 'flow');

  const out = g.add({
    id: 'output',
    kind: 'output',
    label: 'Reconstruction x̂',
    sublabel: `MSE + ${beta}·KL`,
    outShape: shape('B', F),
    params: 0,
    column: 5,
    lane: 0,
    detail: { loss: `MSE(x, x̂) + ${beta} · KL(N(μ,σ²) || N(0,I))`, score: 'per-sample recon error' },
    analogy: 'Big rebuild error flags an anomalous bar; the KL term keeps the latent well-behaved.',
  });
  g.edge(decoder, out, 'flow');

  return g.finalize(
    'Variational Autoencoder',
    `variational · F=${F} · hidden [${hidden.join(', ')}] · latent ${latent} · β=${beta}`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Public surface.
// ────────────────────────────────────────────────────────────────────────────

/** Algorithm / family ids deriveArchGraph can build (primitives_cnn is
 *  excluded: its trainer lives in an unavailable sibling repo, so it cannot be
 *  derived faithfully). */
export const SUPPORTED_ALGORITHMS: string[] = [
  'temporal_fusion_transformer',
  'transformer_2s',
  'transformer_tiny',
  'transformer_seq',
  'xgboost',
  'pytorch_mlp',
  'pytorch_cnn',
  'pytorch_autoencoder',
  'pytorch_vae',
];

/** Per-id numeric hyperparameters whose value reshapes / re-derives the diagram. */
export const TUNABLE_HPS: Record<string, TunableHp[]> = {
  temporal_fusion_transformer: [
    { name: 'window_size', label: 'Window (bars)', min: 16, max: 256, step: 8 },
    { name: 'd_model', label: 'Hidden width', min: 16, max: 256, step: 16 },
    { name: 'n_heads', label: 'Attention heads', min: 1, max: 16, step: 1 },
    { name: 'lstm_layers', label: 'LSTM layers', min: 1, max: 4, step: 1 },
  ],
  transformer_2s: [
    { name: 'window_size', label: 'Window (bars)', min: 16, max: 512, step: 8 },
    { name: 'd_model_price', label: 'Price width', min: 8, max: 256, step: 8 },
    { name: 'd_model_volume', label: 'Volume width', min: 4, max: 64, step: 4 },
    { name: 'n_layers', label: 'Encoder layers', min: 1, max: 8, step: 1 },
    { name: 'n_heads', label: 'Attention heads', min: 1, max: 16, step: 1 },
    { name: 'd_ff', label: 'Feed-forward dim', min: 32, max: 1024, step: 32 },
  ],
  transformer_tiny: [
    { name: 'window_size', label: 'Window (bars)', min: 8, max: 128, step: 8 },
    { name: 'd_model_price', label: 'Price width', min: 4, max: 128, step: 4 },
    { name: 'd_model_volume', label: 'Volume width', min: 4, max: 64, step: 4 },
    { name: 'n_layers', label: 'Encoder layers', min: 1, max: 8, step: 1 },
    { name: 'n_heads', label: 'Attention heads', min: 1, max: 16, step: 1 },
  ],
  transformer_seq: [
    { name: 'window_size', label: 'Window (bars)', min: 16, max: 256, step: 8 },
    { name: 'd_model', label: 'Hidden width', min: 8, max: 256, step: 8 },
    { name: 'n_layers', label: 'Encoder layers', min: 1, max: 8, step: 1 },
    { name: 'n_heads', label: 'Attention heads', min: 1, max: 16, step: 1 },
    { name: 'd_ff', label: 'Feed-forward dim', min: 16, max: 512, step: 16 },
  ],
  xgboost: [
    { name: 'n_estimators', label: 'Boosting rounds', min: 50, max: 5000, step: 50 },
    { name: 'max_depth', label: 'Tree depth', min: 2, max: 12, step: 1 },
  ],
  pytorch_mlp: [{ name: 'dropout', label: 'Dropout', min: 0, max: 0.6, step: 0.05 }],
  pytorch_cnn: [
    { name: 'window_size', label: 'Window (bars)', min: 16, max: 256, step: 8 },
    { name: 'dropout', label: 'Dropout', min: 0, max: 0.6, step: 0.05 },
  ],
  pytorch_autoencoder: [
    { name: 'latent_dim', label: 'Bottleneck width', min: 2, max: 128, step: 2 },
    { name: 'dropout', label: 'Dropout', min: 0, max: 0.6, step: 0.05 },
  ],
  pytorch_vae: [
    { name: 'latent_dim', label: 'Latent width', min: 2, max: 128, step: 2 },
    { name: 'beta', label: 'KL weight (β)', min: 0, max: 4, step: 0.25 },
    { name: 'dropout', label: 'Dropout', min: 0, max: 0.6, step: 0.05 },
  ],
};

/**
 * Derive a faithful architecture graph for a supported algorithm/family id.
 * Returns null for unsupported ids (including primitives_cnn).
 */
export function deriveArchGraph(
  algorithmId: string,
  hyperparameters: Record<string, number | string | boolean> = {},
): ArchGraph | null {
  const hp = hyperparameters ?? {};
  switch (algorithmId) {
    case 'temporal_fusion_transformer':
      return buildTft(hp);
    case 'transformer_2s':
      return buildTwoStream(hp, {
        title: 'Two-Stream Transformer',
        subtitleTag: 'price + volume · range bucket',
        wDflt: 128,
        dmpDflt: 112,
        dmvDflt: 16,
        headsDflt: 4,
        layersDflt: 4,
        ffDflt: 512,
        headKind: 'range',
      });
    case 'transformer_tiny':
      return buildTwoStream(hp, {
        title: 'Tiny Two-Stream Transformer',
        subtitleTag: 'low-data · daily direction',
        wDflt: 32,
        dmpDflt: 28,
        dmvDflt: 4,
        headsDflt: 4,
        layersDflt: 2,
        ffDflt: 64,
        headKind: 'direction',
      });
    case 'transformer_seq':
      return buildTransformerSeq(hp);
    case 'xgboost':
      return buildXgboost(hp);
    case 'pytorch_mlp':
      return buildMlp(hp);
    case 'pytorch_cnn':
      return buildCnn(hp);
    case 'pytorch_autoencoder':
      return buildAutoencoder(hp, false);
    case 'pytorch_vae':
      return buildAutoencoder(hp, true);
    default:
      return null;
  }
}
