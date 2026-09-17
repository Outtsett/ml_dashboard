/**
 * The ten stages a bar passes through, each showing the real tensor at that point.
 *
 *   1  Raw bars              the candles, as they came out of the lake
 *   2  Vectorize             OHLCV -> the five modality blocks
 *   3  Normalize             each block on its own scale, per-block LayerNorm
 *   4  Window into a tensor  (batch, time, features)
 *   5  Embed                 block projections summed into one d_model token
 *   6  Add position          the sinusoidal encoding, added to every token
 *   7  Self-attention        what the attention sub-layers emitted
 *   8  Feed-forward          the position-wise network inside each block
 *   9  Predict               the head, and the two logits it produces
 *  10  Loss and gradient     the objective, and what flowed back
 *
 * Every panel draws from the run's own artefacts. Nothing here is illustrative:
 * a heatmap cell is a number the model actually held.
 */
import { useMemo } from "react";
import { LensFrame } from "../Frame";
import {
  eventsOfType, toMatrix, useSnapshot,
  type BlocksEvent, type EpochEvent, type LayersEvent, type RunStartedEvent,
  type TrainingStreamEvent,
} from "./api";

// Okabe-Ito. Nothing is distinguished by a red/green contrast.
const ORANGE = "#E69F00";
const BLUE = "#0072B2";
const GREY = "#8C8C8C";

/** Cividis, sampled. Perceptually uniform and safe for deuteranopia. */
const CIVIDIS = [
  "#00224e", "#123570", "#3b496c", "#575d6d", "#707173",
  "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838",
];

function cividis(t: number): string {
  if (!Number.isFinite(t)) return "#1a1a1a";
  const index = Math.min(CIVIDIS.length - 1, Math.max(0, Math.round(t * (CIVIDIS.length - 1))));
  return CIVIDIS[index]!;
}

// ── Shared primitives ────────────────────────────────────────────────────────

/**
 * A matrix as coloured cells, drawn with plain divs.
 *
 * Deliberately not a charting library: these grids are up to 32x64 and redraw on
 * every epoch scrub, and a full chart runtime per panel costs more than the
 * pixels are worth.
 */
export function Matrix({ values, rowLabels, columnLabel, maxRows = 24, fill = false }: {
  values: number[][];
  rowLabels?: string[];
  columnLabel?: string;
  maxRows?: number;
  /**
   * Divide whatever height the frame has among the rows instead of pinning
   * each to 12px. The Theatre layout gives a stage ~700px, and a matrix that
   * keeps its card-sized rows leaves most of that empty.
   */
  fill?: boolean;
}) {
  const { shown, low, high } = useMemo(() => {
    const rows = values.slice(0, maxRows);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      for (const value of row) {
        if (!Number.isFinite(value)) continue;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    return { shown: rows, low: lo, high: hi };
  }, [values, maxRows]);

  if (shown.length === 0) {
    return <div className="text-[11px] text-zinc-500">no values</div>;
  }
  const span = high - low || 1;

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col gap-1" : "space-y-1"}>
      <div className="flex shrink-0 items-center gap-2 text-[10px] font-mono text-zinc-500">
        <span>{low.toFixed(3)}</span>
        <div className="h-2 flex-1 rounded-sm"
             style={{ background: `linear-gradient(to right, ${CIVIDIS.join(",")})` }} />
        <span>{high.toFixed(3)}</span>
      </div>
      <div className={fill ? "flex min-h-0 flex-1 flex-col gap-[1px]" : "space-y-[1px]"}>
        {shown.map((row, rowIndex) => (
          <div key={rowIndex}
               className={`flex items-center gap-1 ${fill ? "min-h-0 flex-1" : ""}`}>
            {rowLabels && (
              <span className="w-40 shrink-0 truncate text-right font-mono text-[10px] text-zinc-500">
                {rowLabels[rowIndex]}
              </span>
            )}
            <div className={`flex flex-1 gap-[1px] ${fill ? "h-full" : ""}`}>
              {row.map((value, columnIndex) => (
                <div key={columnIndex}
                     className={`flex-1 rounded-[1px] ${fill ? "h-full" : "h-3"}`}
                     title={`row ${rowIndex}, ${columnLabel ?? "col"} ${columnIndex}: ${
                       Number.isFinite(value) ? value.toFixed(5) : "—"}`}
                     style={{ background: cividis((value - low) / span) }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {values.length > shown.length && (
        <div className="shrink-0 text-[10px] text-zinc-500">
          showing {shown.length} of {values.length} rows
        </div>
      )}
    </div>
  );
}

/** A horizontal bar per named quantity — used wherever a per-layer or
 *  per-block magnitude is the whole point. */
export function BarList({
  items, colour = BLUE, format = (v: number) => v.toFixed(4), maxItems, fill = false,
}: {
  items: { label: string; value: number; hint?: string }[];
  colour?: string;
  format?: (value: number) => string;
  maxItems?: number;
  /** Share the frame's height among the bars rather than pinning each to 12px. */
  fill?: boolean;
}) {
  const shown = maxItems ? items.slice(0, maxItems) : items;
  const peak = Math.max(...shown.map(i => Math.abs(i.value)), 1e-12);
  return (
    // justify-around + a capped row height, rather than letting six bars split
    // 700px into six 110px slabs. The bars stay a readable thickness and the
    // slack becomes spacing between them.
    <div className={fill
      ? "flex h-full min-h-0 flex-col justify-around gap-[3px]" : "space-y-[3px]"}>
      {shown.map(item => (
        <div key={item.label} title={item.hint}
             className={`flex items-center gap-2 ${fill ? "min-h-0 max-h-[52px] flex-1" : ""}`}>
          <span className="w-52 shrink-0 truncate text-right font-mono text-[10px] text-zinc-400">
            {item.label}
          </span>
          <div className={`flex-1 rounded-sm bg-white/[0.04] ${fill ? "h-full" : "h-3"}`}>
            <div className={`rounded-sm ${fill ? "h-full" : "h-3"}`}
                 style={{ width: `${(Math.abs(item.value) / peak) * 100}%`, background: colour }} />
          </div>
          <span className="w-20 shrink-0 font-mono text-[10px] text-zinc-400">
            {format(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-sm text-zinc-200">{value}</div>
      {hint && <div className="text-[9px] text-zinc-600">{hint}</div>}
    </div>
  );
}

/** Layer-name prefixes that identify each stage of the forward pass. */
function layersMatching(readings: LayersEvent["readings"], test: (name: string) => boolean) {
  return readings.filter(r => test(r.name));
}

// ── 1. Raw bars ──────────────────────────────────────────────────────────────

export function RawBarsStage({ run, events }: { run: string; events: TrainingStreamEvent[] }) {
  const started = eventsOfType<RunStartedEvent>(events, "run_started")[0];
  const bars = useSnapshot(run, "bars.parquet", undefined, 4000);
  const rows = bars.data?.rows ?? [];
  const recent = rows.slice(-160) as unknown as
    { timestamp: string; open: number; high: number; low: number; close: number; volume: number }[];

  const { low, high } = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const bar of recent) { lo = Math.min(lo, bar.low); hi = Math.max(hi, bar.high); }
    return { low: lo, high: hi };
  }, [recent]);
  const span = high - low || 1;

  return (
    <LensFrame
      title="1 — Raw bars"
      question="What came out of the lake, before anything was done to it?"
      basis={started ? `${started.config.symbol} ${started.config.timeframe} · ${rows.length.toLocaleString()} bars loaded` : undefined}
      resizeKey="lens-train-bars" defaultHeight={260} fillBody
    >
      {recent.length === 0 ? <div className="text-[11px] text-zinc-500">loading bars…</div> : (
        <>
          <div className="flex min-h-[120px] flex-1 items-end gap-[2px]">
            {recent.map((bar, index) => {
              const up = bar.close >= bar.open;
              const bodyTop = Math.max(bar.open, bar.close);
              const bodyBottom = Math.min(bar.open, bar.close);
              return (
                // h-full, not just flex-1: the candle's wick and body are
                // absolutely positioned against this box, and a flex child with
                // no height resolves to zero — which renders an empty chart with
                // the data sitting right there, loaded.
                <div key={index} className="relative h-full flex-1"
                     title={`${bar.timestamp}\nO ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close}\nvolume ${bar.volume}`}>
                  <div className="absolute left-1/2 w-[1px] -translate-x-1/2"
                       style={{
                         bottom: `${((bar.low - low) / span) * 100}%`,
                         height: `${((bar.high - bar.low) / span) * 100}%`,
                         background: up ? ORANGE : BLUE,
                       }} />
                  <div className="absolute left-0 right-0"
                       style={{
                         bottom: `${((bodyBottom - low) / span) * 100}%`,
                         height: `${Math.max(((bodyTop - bodyBottom) / span) * 100, 0.6)}%`,
                         background: up ? ORANGE : BLUE,
                       }} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex shrink-0 gap-5">
            <Stat label="bars shown" value={String(recent.length)} hint="most recent" />
            <Stat label="price range" value={`${low.toFixed(2)} – ${high.toFixed(2)}`} />
            {started && (
              <Stat label="labelled" value={`${(started.label_counts.up + started.label_counts.down).toLocaleString()}`}
                    hint={`${started.label_counts.up.toLocaleString()} up / ${started.label_counts.down.toLocaleString()} down`} />
            )}
          </div>
        </>
      )}
    </LensFrame>
  );
}

// ── 2 & 3. Vectorize and normalize ───────────────────────────────────────────

export function VectorizeStage({ run, events, block, onBlockChange }: {
  run: string; events: TrainingStreamEvent[];
  block: string | null; onBlockChange: (block: string) => void;
}) {
  const blocksEvent = eventsOfType<BlocksEvent>(events, "blocks")[0];
  const names = blocksEvent ? Object.keys(blocksEvent.fields) : [];
  const active = block ?? names[0] ?? null;
  const snapshot = useSnapshot(run, blocksEvent?.file ?? null, active ?? undefined, 40_000);

  const matrix = useMemo(() => {
    const rows = snapshot.data?.rows ?? [];
    return toMatrix(rows).slice(-40);
  }, [snapshot.data]);

  const fields = active && blocksEvent ? blocksEvent.fields[active] ?? [] : [];
  // Transposed: one row per feature, so a feature's behaviour reads across.
  const byFeature = useMemo(() => {
    if (matrix.length === 0) return [];
    const width = matrix[0]!.length;
    return Array.from({ length: width }, (_, column) => matrix.map(row => row[column] ?? Number.NaN));
  }, [matrix]);

  return (
    <LensFrame
      title="2 / 3 — Vectorize and normalize"
      question="What did each bar become, and on what scale?"
      basis={blocksEvent ? `${names.length} blocks · ${blocksEvent.count.toLocaleString()} bars` : undefined}
      actions={
        <div className="flex gap-1">
          {names.map(name => (
            <button key={name} onClick={() => onBlockChange(name)}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                      name === active ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
              {name}
            </button>
          ))}
        </div>
      }
      resizeKey="lens-train-blocks" defaultHeight={280} fillBody
    >
      {byFeature.length === 0 ? <div className="text-[11px] text-zinc-500">loading blocks…</div> : (
        <>
          <Matrix values={byFeature} rowLabels={fields} columnLabel="bar" maxRows={16} fill />
          <div className="mt-2 shrink-0 text-[10px] text-zinc-500">
            One row per feature, most recent {matrix.length} bars left to right. Each block is
            LayerNorm&apos;d at its own input before projection, so no block enters the sum louder
            than another because of the units it happens to be measured in.
          </div>
        </>
      )}
    </LensFrame>
  );
}

// ── 4 & 5. Window and embed ──────────────────────────────────────────────────

export function EmbedStage({ events, epoch }: { events: TrainingStreamEvent[]; epoch: number }) {
  const started = eventsOfType<RunStartedEvent>(events, "run_started")[0];
  const epochs = eventsOfType<EpochEvent>(events, "epoch");
  const current = epochs.find(e => e.epoch === epoch) ?? epochs[epochs.length - 1];
  const layers = eventsOfType<LayersEvent>(events, "layers");
  const layerEvent = layers.find(l => l.epoch === epoch) ?? layers[layers.length - 1];

  const projections = layerEvent
    ? layersMatching(layerEvent.readings, n => n.includes("_projection") || n.endsWith("token_norm"))
    : [];

  const window = Number(started?.config.window ?? 0);
  const batch = Number(started?.config.batch_size ?? 0);

  return (
    <LensFrame
      title="4 / 5 — Window into a tensor, then embed"
      question="How do many bars become one vector the model can attend over?"
      basis={started ? `(batch ${batch}, time ${window}, d_model 64) · summed block projections` : undefined}
      resizeKey="lens-train-embed" defaultHeight={280} fillBody
    >
      {!current ? <div className="text-[11px] text-zinc-500">waiting for the first epoch…</div> : (
        <>
          <div className="mb-3 flex shrink-0 flex-wrap gap-5">
            <Stat label="window" value={`${window} bars`} hint="one training sample" />
            <Stat label="token width" value="64" hint="d_model" />
            <Stat label="blocks summed" value={String(Object.keys(current.block_norms).length)} />
          </div>
          <div className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
            each block&apos;s contribution to the summed token
          </div>
          <div className="min-h-0 flex-1">
            <BarList colour={ORANGE} fill
                     items={Object.entries(current.block_norms)
                       .sort((a, b) => b[1] - a[1])
                       .map(([label, value]) => ({ label, value, hint: "mean token norm" }))} />
          </div>
          {projections.length > 0 && (
            <>
              <div className="mb-1 mt-3 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
                the projection layers that produced it
              </div>
              <div className="min-h-0 flex-1">
                <BarList colour={BLUE} fill
                         items={projections.map(r => ({
                           label: r.name.replace("encoder.", ""),
                           value: r.standard_deviation,
                           hint: `${r.module_type} ${r.output_shape.join("x")} · mean ${r.mean.toFixed(4)}`,
                         }))} />
              </div>
            </>
          )}
        </>
      )}
    </LensFrame>
  );
}

// ── 6. Position ──────────────────────────────────────────────────────────────

export function PositionStage({ run, events, epoch }: {
  run: string; events: TrainingStreamEvent[]; epoch: number;
}) {
  const layers = eventsOfType<LayersEvent>(events, "layers");
  const layerEvent = layers.find(l => l.epoch === epoch) ?? layers[layers.length - 1];
  const reading = layerEvent?.readings.find(r => r.name.includes("pos_enc"));
  const snapshot = useSnapshot(run, layerEvent?.file ?? null,
                               reading ? reading.name.replace(/\./g, "__") : undefined, 8_000);
  const matrix = useMemo(() => toMatrix(snapshot.data?.rows ?? []), [snapshot.data]);

  return (
    <LensFrame
      title="6 — Add position"
      question="How does the model know which bar came first?"
      basis={reading ? `${reading.module_type} · ${reading.output_shape.join(" x ")}` : undefined}
      unavailableReason={!reading ? "no positional-encoding capture in this run" : undefined}
      resizeKey="lens-train-position" defaultHeight={260} fillBody
    >
      {reading && (
        <>
          <Matrix values={matrix} columnLabel="unit" maxRows={20} fill />
          <div className="mt-2 shrink-0 text-[10px] text-zinc-500">
            Every row is one position in the window, every column one of the 64 token
            dimensions. The banding is the sinusoid: position is added, not learned, so this
            pattern is identical at epoch 1 and epoch 100 — what changes is the token it is
            added to.
          </div>
        </>
      )}
    </LensFrame>
  );
}

// ── 7 & 8. Attention and feed-forward ────────────────────────────────────────

export function AttentionStage({ events, epoch }: { events: TrainingStreamEvent[]; epoch: number }) {
  const layers = eventsOfType<LayersEvent>(events, "layers");
  const layerEvent = layers.find(l => l.epoch === epoch) ?? layers[layers.length - 1];

  const attention = layerEvent
    ? layersMatching(layerEvent.readings, n => /layers\.\d+\.(norm1|dropout1)/.test(n)) : [];
  const feedForward = layerEvent
    ? layersMatching(layerEvent.readings, n => /layers\.\d+\.(linear1|linear2|norm2|dropout)$/.test(n)) : [];

  return (
    <LensFrame
      title="7 / 8 — Self-attention and feed-forward"
      question="What did each encoder sub-layer actually emit?"
      basis={layerEvent ? `epoch ${layerEvent.epoch} · ${attention.length + feedForward.length} sub-layers` : undefined}
      unavailableReason={!layerEvent ? "no layer capture in this run" : undefined}
      resizeKey="lens-train-attention" defaultHeight={300} fillBody
    >
      {layerEvent && (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
              attention path — output spread
            </div>
            <BarList colour={ORANGE} fill
                     items={attention.map(r => ({
                       label: r.name.replace("transformer.transformer.", ""),
                       value: r.standard_deviation,
                       hint: `${r.output_shape.join("x")} · ${(r.zero_fraction * 100).toFixed(1)}% zero`,
                     }))} />
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
              feed-forward path — output spread
            </div>
            <BarList colour={BLUE} fill
                     items={feedForward.map(r => ({
                       label: r.name.replace("transformer.transformer.", ""),
                       value: r.standard_deviation,
                       hint: `${r.output_shape.join("x")} · ${(r.zero_fraction * 100).toFixed(1)}% zero`,
                     }))} />
          </div>
        </div>
      )}
    </LensFrame>
  );
}

// ── 9. Predict ───────────────────────────────────────────────────────────────

export function PredictStage({ events, epoch }: { events: TrainingStreamEvent[]; epoch: number }) {
  const layers = eventsOfType<LayersEvent>(events, "layers");
  const layerEvent = layers.find(l => l.epoch === epoch) ?? layers[layers.length - 1];
  const epochs = eventsOfType<EpochEvent>(events, "epoch");
  const current = epochs.find(e => e.epoch === epoch) ?? epochs[epochs.length - 1];
  const head = layerEvent ? layersMatching(layerEvent.readings, n => n.includes("head")) : [];

  const accuracy = current?.metrics.direction_accuracy ?? null;
  const baseline = current?.metrics.majority_baseline ?? null;
  const skill = current?.metrics.skill ?? null;

  return (
    <LensFrame
      title="9 — Predict"
      question="What does the head output, and is it better than guessing?"
      basis={head.length > 0 ? `${head.length} head layers · 2 logits [down, up]` : undefined}
      resizeKey="lens-train-predict" defaultHeight={240} fillBody
    >
      <div className="mb-3 flex shrink-0 flex-wrap gap-5">
        <Stat label="direction accuracy" value={accuracy !== null ? accuracy.toFixed(4) : "—"} />
        <Stat label="majority baseline" value={baseline !== null ? baseline.toFixed(4) : "—"}
              hint="what always-guess-one-side gets" />
        <Stat label="skill" value={skill !== null ? `${skill >= 0 ? "+" : ""}${skill.toFixed(4)}` : "—"}
              hint={skill !== null ? (skill > 0 ? "beats the baseline" : "does not beat it") : undefined} />
      </div>
      {head.length > 0 && (
        <div className="min-h-0 flex-1">
          <BarList colour={ORANGE} fill
                   items={head.map(r => ({
                     label: r.name.replace("transformer.", ""),
                     value: r.standard_deviation,
                     hint: `${r.module_type} ${r.output_shape.join("x")} · range ${r.minimum.toFixed(3)} to ${r.maximum.toFixed(3)}`,
                   }))} />
        </div>
      )}
      <div className="mt-2 shrink-0 text-[10px] text-zinc-500">
        Accuracy above 50% is not the bar. The bar is the majority baseline, and after that the
        cost-implied break-even hit rate — MNQ&apos;s $2.8011 round trip needs 1.40 points of
        movement before a correct call is worth anything.
      </div>
    </LensFrame>
  );
}

// ── 10. Loss and gradient ────────────────────────────────────────────────────

export function LossGradientStage({ events, epoch }: { events: TrainingStreamEvent[]; epoch: number }) {
  const epochs = eventsOfType<EpochEvent>(events, "epoch");
  const layers = eventsOfType<LayersEvent>(events, "layers");
  const layerEvent = layers.find(l => l.epoch === epoch) ?? layers[layers.length - 1];

  const losses = epochs.map(e => Number(e.metrics.train_loss ?? Number.NaN));
  const accuracies = epochs.map(e => Number(e.metrics.direction_accuracy ?? Number.NaN));
  const finite = losses.filter(Number.isFinite);
  const lossLow = Math.min(...finite);
  const lossHigh = Math.max(...finite);
  const lossSpan = lossHigh - lossLow || 1;

  const gradients = layerEvent
    ? Object.entries(layerEvent.gradient_norms).sort((a, b) => b[1] - a[1])
    : [];
  // Bound to a const before the closure: narrowing from the ternary does not
  // survive into the filter callback, because `layerEvent` is a mutable binding
  // as far as the checker is concerned.
  const norms = layerEvent?.gradient_norms ?? {};
  const starved = (layerEvent?.readings ?? [])
    .filter(r => r.parameter_count > 0 && !((norms[r.name] ?? 0) > 0));

  return (
    <LensFrame
      title="10 — Loss and gradient"
      question="Is it learning, and does the signal reach every layer?"
      basis={epochs.length > 0 ? `${epochs.length} epochs · ${gradients.length} modules taking gradient` : undefined}
      resizeKey="lens-train-loss" defaultHeight={300} fillBody
    >
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
            training loss, epoch by epoch
          </div>
          <div className="flex min-h-[110px] flex-1 items-end gap-[2px]">
            {epochs.map((entry, index) => {
              const loss = losses[index] ?? Number.NaN;
              const isCurrent = entry.epoch === epoch;
              return (
                // Capped, not just flex-1: a two-epoch run would otherwise
                // draw two 300px slabs across the Theatre stage.
                <div key={entry.epoch} className="max-w-[72px] flex-1 rounded-sm"
                     title={`epoch ${entry.epoch}: loss ${loss.toFixed(5)} · accuracy ${accuracies[index]?.toFixed(4)}`}
                     style={{
                       height: `${Number.isFinite(loss) ? ((lossHigh - loss) / lossSpan) * 85 + 10 : 2}%`,
                       background: isCurrent ? ORANGE : BLUE,
                       opacity: isCurrent ? 1 : 0.55,
                     }} />
              );
            })}
          </div>
          <div className="mt-1 flex shrink-0 justify-between font-mono text-[10px] text-zinc-500">
            <span>{Number.isFinite(lossHigh) ? lossHigh.toFixed(5) : "—"}</span>
            <span>taller is lower loss</span>
            <span>{Number.isFinite(lossLow) ? lossLow.toFixed(5) : "—"}</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
            gradient norm reaching each module
          </div>
          <BarList colour={GREY} maxItems={12} fill
                   items={gradients.map(([label, value]) => ({
                     label: label.replace("transformer.transformer.", "").replace("encoder.", ""),
                     value,
                     hint: "backward pass, same batch the activations came from",
                   }))}
                   format={v => v.toExponential(2)} />
        </div>
      </div>
      <div className="mt-2 shrink-0 text-[10px] text-zinc-500">
        {starved.length > 0
          ? `${starved.length} module(s) with parameters took no gradient: ${starved.slice(0, 3).map(r => r.name).join(", ")}.`
          : "Every module with parameters is taking gradient."}
      </div>
    </LensFrame>
  );
}
