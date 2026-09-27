/**
 * The neural view's model, kept pure so it can be tested without a DOM: the
 * explained bar (`bar.neural`, `bar.inputs`) becomes an ordered list of
 * stages the user steps through left to right —
 *
 *   input (the window as time × feature, or the input vector)
 *   → every layer the explainer recorded (sequence layers time × units, dense layers a column of units)
 *   → output (head → logit → sigmoid → P(up), or the price head's move)
 *
 * Each stage carries a plain-language caption keyed on its layer kind. Layer
 * kinds are free strings written by the neural explainer
 * (`networks.NeuralAdapter.trace`); `classifyLayerKind` reads them by the
 * words they contain, so "lstm", "gated_recurrent_unit", "transformer_encoder_layer",
 * "causal_convolution_block", "dense", "head", … all land on a caption, and an
 * unknown kind still gets a generic one.
 */
import type { CycleExplainBar, CycleExplainRole, CycleExplainStructure } from "@shared/cycle/explain";

import { type ColorDomain, finiteDomain } from "./colorScale";

/** Most drawn rows (units / features) and columns (time steps) per heatmap; hover stays exact beyond these. */
export const MAX_DRAWN_ROWS = 48;
export const MAX_DRAWN_COLUMNS = 64;

export type LayerFamily =
  | "input"
  | "lstm"
  | "gated_recurrent_unit"
  | "recurrent"
  | "attention"
  | "transformer"
  | "convolution"
  | "projection"
  | "normalization"
  | "dense"
  | "dropout"
  | "head"
  | "other";

/** Activations as a time × unit grid, row-major [time][unit]; a dense layer has one time step. */
export interface NeuralGrid {
  timeCount: number;
  unitCount: number;
  values: (number | null)[];
}

export interface NeuralStage {
  index: number;
  /** "input", the layer's own name, or "output". */
  id: string;
  title: string;
  kind: string;
  family: LayerFamily;
  /** The layer kind in full words, e.g. "Long short-term memory". */
  kindLabel: string;
  grid: NeuralGrid | null;
  /** One timestamp per time step when the layer's time axis is the window's. */
  timestamps: number[] | null;
  /** Names for the unit axis (the input's feature names); null = numbered units. */
  unitLabels: string[] | null;
  unitNoun: string;
  shapeText: string;
  caption: string;
  domain: ColorDomain;
  /** Why the layer cannot be drawn (its values do not fill its shape); null when fine. */
  problem: string | null;
}

export function classifyLayerKind(kind: string, name = ""): LayerFamily {
  const text = `${kind} ${name}`.toLowerCase();
  const has = (...words: string[]) => words.some((word) => text.includes(word));
  if (kind.toLowerCase() === "input" || name.toLowerCase() === "input") return "input";
  if (has("transformer", "encoder")) return "transformer";
  if (has("attention")) return "attention";
  if (has("lstm", "long_short")) return "lstm";
  if (has("gru", "gated")) return "gated_recurrent_unit";
  if (has("recurrent", "rnn", "elman")) return "recurrent";
  if (has("conv", "temporal")) return "convolution";
  if (has("projection", "embedding", "position")) return "projection";
  if (has("norm")) return "normalization";
  if (has("head", "output", "logit")) return "head";
  if (has("dropout")) return "dropout";
  if (has("dense", "linear", "hidden", "perceptron", "gelu", "relu", "tanh", "activation", "mlp")) return "dense";
  return "other";
}

const FAMILY_LABEL: Record<LayerFamily, string> = {
  input: "Model inputs",
  lstm: "Long short-term memory",
  gated_recurrent_unit: "Gated recurrent unit",
  recurrent: "Recurrent layer",
  attention: "Attention",
  transformer: "Transformer encoder layer",
  convolution: "Causal convolution",
  projection: "Projection",
  normalization: "Normalization",
  dense: "Dense hidden layer",
  dropout: "Dropout",
  head: "Prediction head",
  other: "Layer",
};

/** Turns `encoder_layer_1` into "Encoder layer 1". */
const ACRONYMS = new Set(["lstm", "gru", "mlp", "rnn"]);

export function humanizeName(name: string): string {
  const words = name.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return name;
  const text = words.map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word)).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface CaptionContext {
  timeCount: number;
  unitCount: number;
  featureCount: number;
  sequence: boolean;
}

function bars(count: number): string {
  return count === 1 ? "1 bar" : `${count} bars`;
}

/** One plain sentence saying what a layer of this family does to this bar. */
export function captionForFamily(family: LayerFamily, context: CaptionContext): string {
  const { timeCount, unitCount, featureCount, sequence } = context;
  switch (family) {
    case "input":
      return sequence
        ? `The window: the ${bars(timeCount)} the model reads, oldest on the left and the bar being predicted at the right edge, one row per input (${featureCount} rolling z-scores).`
        : `The inputs: this bar's ${featureCount} features as rolling z-scores, one cell each — a dense network sees only this one bar.`;
    case "lstm":
      return `The LSTM reads the ${bars(timeCount)} in order, oldest first, and keeps a running memory: each column is its ${unitCount}-number memory after reading that bar.`;
    case "gated_recurrent_unit":
      return `The gated recurrent unit reads the ${bars(timeCount)} in order and keeps a running memory, with gates deciding how much of each new bar to let in (${unitCount} numbers per bar).`;
    case "recurrent":
      return `The recurrent layer reads the ${bars(timeCount)} in order, mixing each new bar into a ${unitCount}-number state it carries forward to the next bar.`;
    case "attention":
      return `The attention step looks back over the states of all ${bars(timeCount)} and weighs which ones matter for this prediction.`;
    case "transformer":
      return `The transformer layer lets each bar look back at the bars before it (never ahead) and mix in what it finds; the attention chart below shows where the last bar looked.`;
    case "convolution":
      return `The causal convolution slides a small filter along the ${bars(timeCount)}, each position seeing only that bar and the ones before it, looking for short patterns (${unitCount} filters).`;
    case "projection":
      return `The projection turns each bar's ${featureCount} inputs into a ${unitCount}-number description, plus a learned marker of the bar's position in the window.`;
    case "normalization":
      return `The normalization rescales each bar's ${unitCount} numbers to a common size, so no single unit drowns out the rest.`;
    case "dense":
      return `The hidden layer mixes every number coming in into ${unitCount} new numbers; each cell is one unit's activation for this bar.`;
    case "dropout":
      return `Dropout switches off random units while training; when predicting it passes everything through unchanged.`;
    case "head":
      return `The head reads the last bar's numbers and weighs them into one number: the logit.`;
    default:
      return sequence
        ? `This layer turns the ${bars(timeCount)} into ${unitCount} numbers per bar.`
        : `This layer turns what comes in into ${unitCount} numbers.`;
  }
}

function shapeText(grid: NeuralGrid, unitNoun: string, sequence: boolean): string {
  const units = `${grid.unitCount} ${grid.unitCount === 1 ? unitNoun : `${unitNoun}s`}`;
  return sequence ? `${bars(grid.timeCount)} × ${units}` : units;
}

/** The output stage's caption: what turns the head's number into the reported output. */
export function outputCaption(role: CycleExplainRole): string {
  return role === "price"
    ? "The price head's number is the predicted move in target units; times the bar's volatility scale it becomes points."
    : "The logit goes through the sigmoid, which squeezes any number into a probability between 0 and 1: P(up).";
}

export interface BuildStagesInput {
  bar: CycleExplainBar;
  structure: CycleExplainStructure;
  featureNames: string[];
  role: CycleExplainRole;
}

export function buildNeuralStages({ bar, structure, featureNames, role }: BuildStagesInput): NeuralStage[] {
  const neural = bar.neural;
  const window = bar.inputs.window;
  const featureCount = bar.inputs.values.length;
  const stages: NeuralStage[] = [];

  // ─── input ───
  let inputGrid: NeuralGrid;
  let inputTimestamps: number[] | null = null;
  const sequence = window !== null && window.timestamps.length > 0;
  if (sequence && window) {
    const timeCount = window.timestamps.length;
    const values: (number | null)[] = [];
    for (let time = 0; time < timeCount; time += 1) {
      const row = window.values[time] ?? [];
      for (let feature = 0; feature < featureCount; feature += 1) values.push(row[feature] ?? null);
    }
    inputGrid = { timeCount, unitCount: featureCount, values };
    inputTimestamps = window.timestamps;
  } else {
    inputGrid = { timeCount: 1, unitCount: featureCount, values: bar.inputs.values.slice() };
  }
  const inputContext: CaptionContext = { timeCount: inputGrid.timeCount, unitCount: featureCount, featureCount, sequence };
  stages.push({
    index: 0,
    id: "input",
    title: sequence ? "Input window" : "Input vector",
    kind: "input",
    family: "input",
    kindLabel: FAMILY_LABEL.input,
    grid: inputGrid,
    timestamps: inputTimestamps,
    unitLabels: featureNames.length === featureCount ? featureNames : null,
    unitNoun: "feature",
    shapeText: shapeText(inputGrid, "feature", sequence),
    caption: captionForFamily("input", inputContext),
    domain: finiteDomain(inputGrid.values),
    problem: null,
  });

  // ─── layers ───
  const structureKinds = new Map((structure.neural?.layers ?? []).map((layer) => [layer.name, layer.kind]));
  for (const layer of neural?.layers ?? []) {
    const kind = layer.kind || structureKinds.get(layer.name) || "";
    const family = classifyLayerKind(kind, layer.name);
    if (family === "input") continue; // the input column above already shows it
    const layerSequence = layer.shape.length >= 2;
    const timeCount = layerSequence ? (layer.shape[0] ?? 1) : 1;
    const unitCount = layerSequence ? layer.shape.slice(1).reduce((product, size) => product * size, 1) : (layer.shape[0] ?? layer.values.length);
    const expected = timeCount * unitCount;
    const problem =
      layer.values.length === expected ? null : `This layer reports shape [${layer.shape.join(", ")}] but ${layer.values.length} values, so it is not drawn.`;
    const grid: NeuralGrid | null = problem ? null : { timeCount, unitCount, values: layer.values };
    const unitNoun = family === "convolution" ? "filter" : "unit";
    const context: CaptionContext = { timeCount, unitCount, featureCount, sequence: layerSequence };
    stages.push({
      index: stages.length,
      id: layer.name,
      title: humanizeName(layer.name),
      kind,
      family,
      kindLabel: FAMILY_LABEL[family],
      grid,
      timestamps: layerSequence && inputTimestamps && inputTimestamps.length === timeCount ? inputTimestamps : null,
      unitLabels: null,
      unitNoun,
      shapeText: grid ? shapeText(grid, unitNoun, layerSequence) : `[${layer.shape.join(" × ")}]`,
      caption: captionForFamily(family, context),
      domain: grid ? finiteDomain(grid.values) : { low: 0, high: 0 },
      problem,
    });
  }

  // ─── output ───
  stages.push({
    index: stages.length,
    id: "output",
    title: role === "price" ? "Predicted move" : "Probability of up",
    kind: "output",
    family: "head",
    kindLabel: role === "price" ? "Price output" : "Sigmoid",
    grid: null,
    timestamps: null,
    unitLabels: null,
    unitNoun: "unit",
    shapeText: "1 number",
    caption: outputCaption(role),
    domain: { low: 0, high: 0 },
    problem: null,
  });
  return stages;
}

/** One colour domain across every stage — the "raw values" mode, so magnitudes compare across layers. */
export function sharedDomain(stages: NeuralStage[]): ColorDomain {
  const low = Math.min(...stages.filter((stage) => stage.grid).map((stage) => stage.domain.low));
  const high = Math.max(...stages.filter((stage) => stage.grid).map((stage) => stage.domain.high));
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : { low: 0, high: 0 };
}

// ─── drawing grid (downsampled) and exact hover ─────────────────────────────

/** Bin b covers source indices [edges[b], edges[b + 1]); proportional, so a pointer fraction maps to the same bin and the exact index. */
export function binEdges(count: number, maxBins: number): number[] {
  const bins = Math.max(1, Math.min(count, maxBins));
  const edges: number[] = [];
  for (let bin = 0; bin <= bins; bin += 1) edges.push(Math.floor((bin * count) / bins));
  return edges;
}

export interface DrawnGrid {
  /** Drawn rows (units, top = unit 0) and columns (time, right = the bar being predicted). */
  rows: number;
  columns: number;
  /** Row-major [row][column]: the mean of the bin's finite values, null when the bin holds none. */
  cells: (number | null)[];
  rowEdges: number[];
  columnEdges: number[];
  /** True when units or time steps were merged for drawing. */
  downsampled: boolean;
}

export function drawnGrid(grid: NeuralGrid, maxRows = MAX_DRAWN_ROWS, maxColumns = MAX_DRAWN_COLUMNS): DrawnGrid {
  const rowEdges = binEdges(grid.unitCount, maxRows);
  const columnEdges = binEdges(grid.timeCount, maxColumns);
  const rows = rowEdges.length - 1;
  const columns = columnEdges.length - 1;
  const cells: (number | null)[] = new Array(rows * columns).fill(null);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      let count = 0;
      const timeEnd = columnEdges[column + 1] ?? 0;
      const unitEnd = rowEdges[row + 1] ?? 0;
      for (let time = columnEdges[column] ?? 0; time < timeEnd; time += 1) {
        for (let unit = rowEdges[row] ?? 0; unit < unitEnd; unit += 1) {
          const value = grid.values[time * grid.unitCount + unit];
          if (value !== null && value !== undefined && Number.isFinite(value)) {
            sum += value;
            count += 1;
          }
        }
      }
      cells[row * columns + column] = count > 0 ? sum / count : null;
    }
  }
  return { rows, columns, cells, rowEdges, columnEdges, downsampled: rows < grid.unitCount || columns < grid.timeCount };
}

/** The exact source cell under a pointer at fractions (fx, fy) of the heatmap's width and height. */
export function cellAtPointer(fractionX: number, fractionY: number, grid: NeuralGrid): { time: number; unit: number } {
  const clamp = (value: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(value * count)));
  return { time: clamp(fractionX, grid.timeCount), unit: clamp(fractionY, grid.unitCount) };
}

export function gridValue(grid: NeuralGrid, time: number, unit: number): number | null {
  return grid.values[time * grid.unitCount + unit] ?? null;
}

// ─── attention ──────────────────────────────────────────────────────────────

export interface AttentionLayer {
  layer: string;
  heads: { head: number; weights: number[] }[];
}

export function attentionLayers(bar: CycleExplainBar): AttentionLayer[] {
  const byLayer = new Map<string, AttentionLayer>();
  for (const entry of bar.neural?.attention ?? []) {
    const group = byLayer.get(entry.layer) ?? { layer: entry.layer, heads: [] };
    group.heads.push({ head: entry.head, weights: entry.weights });
    byLayer.set(entry.layer, group);
  }
  for (const group of byLayer.values()) group.heads.sort((a, b) => a.head - b.head);
  return [...byLayer.values()];
}

/** Mean of the heads' weights position by position. */
export function averageHeads(heads: { weights: number[] }[]): number[] {
  if (heads.length === 0) return [];
  const length = Math.max(...heads.map((head) => head.weights.length));
  const sums = new Array(length).fill(0);
  for (const head of heads) head.weights.forEach((weight, position) => (sums[position] += weight));
  return sums.map((sum) => sum / heads.length);
}

// ─── numbers ────────────────────────────────────────────────────────────────

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/** An activation for reading: 4 decimals, exponent form for very large or very small magnitudes, "missing" for null. */
export function formatActivation(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "missing";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 10_000 || magnitude < 0.0001)) return value.toExponential(3);
  return value.toFixed(4);
}
