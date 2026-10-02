/**
 * Blueprints — Neural Network Architectures / Recurrent & Sequential Models.
 *
 * This file is the REFERENCE for every other blueprint group: one entry per
 * catalog spec id, stages in data-flow order, every count from `P`.
 */

import type { ArchGraph } from '../types';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;
const H = 128;

export const RECURRENT_BLUEPRINTS: Record<string, ArchGraph> = {
  'neural-network-architectures-recurrent-sequential-models-long-short-term-memory-lstm': blueprint({
    title: 'Long Short-Term Memory (LSTM)',
    subtitle: `2 stacked layers · ${H} hidden units · ${T}-bar window`,
    nodes: [
      {
        id: 'input', kind: 'input', label: 'Bar window', sublabel: `${T} bars × ${F} features`,
        outShape: `B × ${T} × ${F}`, column: 0,
        analogy: 'Think of it as the last 64 candles laid out left to right, each with its 35 measurements.',
      },
      {
        id: 'lstm1', kind: 'recurrent', label: 'LSTM layer 1', sublabel: `${H} units · 4 gates`,
        inShape: `B × ${T} × ${F}`, outShape: `B × ${T} × ${H}`, params: P.lstm(F, H), column: 1,
        detail: { 'forget / input / output / candidate': '4 gates', 'hidden units': H, 'formula': '4·H·(F + H + 2)' },
        analogy: 'Think of it as a trader reading bar by bar with a notepad: each bar, the gates decide what to cross out, what to write down, and what to say out loud.',
      },
      {
        id: 'cell', kind: 'memory', label: 'Cell state', sublabel: 'additive carry, bar to bar',
        outShape: `B × ${H}`, column: 1, lane: 1,
        analogy: 'Think of it as the notepad itself — updated by addition, so an old note survives hundreds of bars without fading.',
      },
      {
        id: 'drop', kind: 'dropout', label: 'Dropout', sublabel: 'between layers, p = 0.2',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, column: 2,
      },
      {
        id: 'lstm2', kind: 'recurrent', label: 'LSTM layer 2', sublabel: `${H} units · 4 gates`,
        inShape: `B × ${T} × ${H}`, outShape: `B × ${T} × ${H}`, params: P.lstm(H, H), column: 3,
        detail: { 'hidden units': H, 'formula': '4·H·(H + H + 2)' },
        analogy: 'Think of it as a second reader who only sees the first one\'s summaries, and looks for patterns in those.',
      },
      {
        id: 'last', kind: 'pool', label: 'Last hidden state', sublabel: 'h at the final bar',
        inShape: `B × ${T} × ${H}`, outShape: `B × ${H}`, column: 4,
        analogy: 'Think of it as asking the reader for a verdict only after the newest candle — never a peek ahead.',
      },
      {
        id: 'head', kind: 'head', label: 'Direction head', sublabel: `Linear ${H} → ${C}`,
        inShape: `B × ${H}`, outShape: `B × ${C}`, params: P.linear(H, C), column: 5,
      },
      {
        id: 'output', kind: 'output', label: 'Down · flat · up', sublabel: 'softmax probabilities',
        outShape: `B × ${C}`, column: 6,
      },
    ],
    edges: [
      ...chain('input', 'lstm1', 'drop', 'lstm2', 'last', 'head', 'output'),
      ['lstm1', 'cell', 'context', 'write'],
      ['cell', 'lstm1', 'context', 'read at next bar'],
    ],
  }),
};
