/**
 * NeuralCanvas — the 2D neural network, drawn with p5.js.
 *
 * The classic picture: neurons as circles in columns, weighted wires between
 * adjacent columns, and a signal front propagating left→right, lighting each
 * neuron as it arrives.
 *
 * HONESTY CONTRACT (see neurons.ts):
 *   - Neuron counts, layer widths and parameter counts are REAL, derived from
 *     the model source via derive.ts.
 *   - Wire OPACITY is uniform. It is NOT a weight magnitude — no trained
 *     weights exist here, and shading wires by a made-up number would read as
 *     data. Wires show connectivity, which is a structural fact.
 *   - The pulse animates SIGNAL ARRIVAL, not activation strength. A lit neuron
 *     means "the forward pass has reached this layer", nothing more.
 *   - Columns wider than DRAW_CAP are sampled, and the overlay says so.
 *
 * p5 runs in INSTANCE mode (never global) and is imported lazily by the parent
 * so it stays out of the main bundle. Canvas cannot read `hsl(var(--token))`,
 * so tokens are resolved through getComputedStyle on mount and re-resolved when
 * the theme flips.
 */

import { useEffect, useRef, useState } from 'react';
import type p5Types from 'p5';
import { cn } from '@/shared/utils/utils';
import { LAYER_PALETTE } from './palette';
import {
  buildNeuronModel,
  DRAW_CAP,
  type NeuronModel,
  type NeuronLayer,
} from './neurons';
import type { ArchGraph } from './types';

/** Resolve `--token` (an unitless HSL triplet like "217 91% 60%") to a css color. */
function resolveToken(root: HTMLElement, token: string, alpha = 1): string {
  const raw = getComputedStyle(root).getPropertyValue(token).trim();
  if (!raw) return alpha < 1 ? `hsla(0 0% 50% / ${alpha})` : 'hsl(0 0% 50%)';
  return alpha < 1 ? `hsl(${raw} / ${alpha})` : `hsl(${raw})`;
}

interface Palette {
  perKind: Record<string, string>;
  wire: string;
  wireLit: string;
  text: string;
  dim: string;
}

function readPalette(root: HTMLElement): Palette {
  const perKind: Record<string, string> = {};
  for (const [kind, entry] of Object.entries(LAYER_PALETTE)) {
    perKind[kind] = resolveToken(root, entry.token);
  }
  return {
    perKind,
    wire: resolveToken(root, '--muted-foreground', 0.18),
    wireLit: resolveToken(root, '--data-cat-1', 0.9),
    text: resolveToken(root, '--foreground'),
    dim: resolveToken(root, '--muted-foreground'),
  };
}

export interface NeuralCanvasProps {
  graph: ArchGraph;
  className?: string;
  /** Externally driven play state. */
  playing?: boolean;
  /** Layers per second the signal front advances. */
  speed?: number;
  /** Pin the front to one layer index (step mode). Overrides the clock. */
  stepIndex?: number | null;
  onModel?: (m: NeuronModel) => void;
  /** Fires with the column under the cursor, or null when the pointer leaves. */
  onHoverLayer?: (layer: NeuronLayer | null) => void;
  /**
   * Real pixel x of each visible candle, from the chart's own time scale. When
   * supplied, an input tape is drawn along the top — one node per bar, sitting
   * directly beneath its candle — which fans into the network's first layer.
   * That makes the window physically expand and contract with the chart.
   * Omit (or pass empty) to draw the network alone.
   */
  barXs?: number[];
}

export function NeuralCanvas({
  graph,
  className,
  playing = true,
  speed = 1,
  stepIndex = null,
  onModel,
  onHoverLayer,
  barXs,
}: NeuralCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sketchRef = useRef<p5Types | null>(null);
  const [reduced, setReduced] = useState(false);

  // Live props for the draw loop — the sketch is constructed ONCE per graph, so
  // it reads these refs instead of being torn down on every prop change.
  const playRef = useRef(playing);
  const speedRef = useRef(speed);
  const stepRef = useRef(stepIndex);
  const reducedRef = useRef(reduced);
  const hoverRef = useRef(-1);
  const barXsRef = useRef<number[] | undefined>(barXs);
  barXsRef.current = barXs;
  const onHoverRef = useRef(onHoverLayer);
  playRef.current = playing;
  speedRef.current = speed;
  stepRef.current = stepIndex;
  reducedRef.current = reduced;
  onHoverRef.current = onHoverLayer;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const model = buildNeuronModel(graph);
    onModel?.(model);

    let disposed = false;
    let instance: p5Types | null = null;

    // p5 is heavy and only this tab needs it — keep it out of the main chunk.
    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;

      const sketch = (p: p5Types) => {
        let palette = readPalette(document.documentElement);
        let front = 0; // signal front position, in layer-index units
        let themeObserver: MutationObserver | null = null;

        p.setup = () => {
          const r = host.getBoundingClientRect();
          p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          // The viewer's theme toggle stamps data-theme on <html>; re-resolve
          // tokens when it does, otherwise the canvas keeps stale colors.
          themeObserver = new MutationObserver(() => {
            palette = readPalette(document.documentElement);
          });
          themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme'],
          });
        };

        p.windowResized = () => {
          const r = host.getBoundingClientRect();
          p.resizeCanvas(Math.max(1, r.width), Math.max(1, r.height));
        };

        const layerX = (i: number, w: number) => {
          const n = model.layers.length;
          if (n === 1) return w / 2;
          const pad = Math.min(90, w * 0.1);
          return pad + (i / (n - 1)) * (w - pad * 2);
        };

        /** Vertical band reserved for the bar-aligned input tape. */
        const TAPE_H = 34;
        const TOP_BASE = 56;
        const BOT_PAD = 52;
        /** Network top — pushed down to leave room when the tape is drawn. */
        const topFor = (hasTape: boolean) => (hasTape ? TOP_BASE + TAPE_H : TOP_BASE);

        /**
         * Vertical positions for a column's circles. Attention columns are laid
         * out as `heads.drawn` bands with a real gap between them, so the head
         * split is visible as structure rather than asserted in a label.
         */
        const neuronYs = (
          layer: (typeof model.layers)[number],
          h: number,
          hasTape: boolean,
        ): number[] => {
          const top = topFor(hasTape);
          const bot = h - BOT_PAD;
          const span = bot - top;
          const count = layer.sampled;
          if (count === 1) return [top + span / 2];

          if (layer.heads) {
            const bands = layer.heads.drawn;
            const per = Math.max(1, Math.floor(count / bands));
            const bandGap = 14;
            const usable = span - bandGap * (bands - 1);
            const bandH = usable / bands;
            const out: number[] = [];
            for (let b = 0; b < bands; b++) {
              const bTop = top + b * (bandH + bandGap);
              const inner = Math.min(20, per > 1 ? bandH / (per - 1) : 0);
              const total = inner * (per - 1);
              const start = bTop + (bandH - total) / 2;
              for (let i = 0; i < per; i++) out.push(start + i * inner);
            }
            return out;
          }

          const gap = Math.min(26, span / Math.max(1, count - 1));
          const total = gap * (count - 1);
          const start = top + (span - total) / 2;
          return Array.from({ length: count }, (_, i) => start + i * gap);
        };

        p.draw = () => {
          const w = p.width;
          const h = p.height;
          p.clear();

          const n = model.layers.length;
          if (n === 0) return;

          // Advance the front. Step mode pins it; reduced-motion pins it to the
          // end so the full network is visible without animation.
          if (stepRef.current != null) {
            front = stepRef.current;
          } else if (reducedRef.current) {
            front = n - 1;
          } else if (playRef.current) {
            front += (p.deltaTime / 1000) * speedRef.current;
            if (front > n - 1 + 0.75) front = 0;
          }

          // barXs arrive in PAGE space (the chart is a separate element with its
          // own insets). Translate into canvas-local by subtracting this host's
          // left edge, re-read each frame so pan/resize stays exact.
          const originX = host.getBoundingClientRect().left;
          const tape = (barXsRef.current ?? []).map((x) => x - originX);
          const hasTape = tape.length > 0;
          const xs = model.layers.map((_, i) => layerX(i, w));
          const ys = model.layers.map((l) => neuronYs(l, h, hasTape));

          // Nearest column to the cursor — drives hover emphasis + the inspect
          // callback. -1 when the pointer is off-canvas.
          let hover = -1;
          if (p.mouseX > 0 && p.mouseX < w && p.mouseY > 0 && p.mouseY < h) {
            let best = Infinity;
            xs.forEach((x, i) => {
              const d = Math.abs(x - p.mouseX);
              if (d < best && d < 46) {
                best = d;
                hover = i;
              }
            });
          }
          if (hover !== hoverRef.current) {
            hoverRef.current = hover;
            onHoverRef.current?.(hover >= 0 ? model.layers[hover]! : null);
          }

          // ── input tape ────────────────────────────────────────────────────
          // One node per visible candle, at the chart's REAL pixel x, fanning
          // into the first layer. This is what makes the window expand and
          // contract with the chart: change window_size and both the candles
          // above and these nodes change count together.
          //
          // Each node is one BAR (one timestep), not one neuron — a bar carries
          // the layer's whole feature vector. It is labelled as bars for exactly
          // that reason.
          if (hasTape) {
            const tapeY = TOP_BASE + TAPE_H / 2;
            const firstX = xs[0];
            const firstYs = ys[0];

            // Fan-in: every bar feeds the first layer. Drawn faint — this is
            // connectivity, not weight.
            if (firstX != null && firstYs && firstYs.length > 0) {
              p.stroke(palette.wire);
              p.strokeWeight(0.4);
              const lit = front >= 0 && front < 1;
              if (lit) {
                p.stroke(palette.wireLit);
                p.strokeWeight(0.6);
              }
              // Cap the fan so a 256-bar window does not draw 256*24 segments.
              const stride = Math.max(1, Math.ceil(tape.length / 48));
              for (let i = 0; i < tape.length; i += stride) {
                const bx = tape[i]!;
                for (const fy of firstYs) p.line(bx, tapeY + 4, firstX, fy);
              }
            }

            // The bar nodes themselves.
            p.noStroke();
            const arrived = front >= 0;
            const glow = Math.max(0, 1 - Math.abs(front + 0.5) * 1.6);
            for (const bx of tape) {
              if (glow > 0.02) {
                p.fill(palette.perKind['input'] ?? palette.dim);
                p.circle(bx, tapeY, 5 * (1 + glow));
              }
              p.fill(arrived ? (palette.perKind['input'] ?? palette.dim) : palette.wire);
              p.circle(bx, tapeY, 4.5);
            }
            // No caption here: the tape spans the full width, so any label drawn
            // in-canvas collides with the nodes themselves. The alignment strip
            // directly above already states the bar count.
          }

          // ── wires ─────────────────────────────────────────────────────────
          p.noFill();
          for (const { from, to } of model.wires) {
            const lit = front >= from && front <= to + 0.35;
            p.stroke(lit ? palette.wireLit : palette.wire);
            p.strokeWeight(lit ? 1.1 : 0.6);
            const a = ys[from]!;
            const b = ys[to]!;
            // Fully-connected fan. Capped columns keep this bounded at
            // DRAW_CAP^2 segments per gap.
            for (const y1 of a) {
              for (const y2 of b) {
                p.line(xs[from]!, y1, xs[to]!, y2);
              }
            }
          }

          // ── neurons ───────────────────────────────────────────────────────
          p.noStroke();
          model.layers.forEach((layer, i) => {
            const reach = front - i;
            const arrived = reach >= 0;
            // Arrival pulse: peaks as the front crosses, then settles. Bounded
            // so a lit column reads as circles, not a bloomed bar.
            const glow = arrived ? Math.max(0, 1 - Math.abs(reach) * 1.6) : 0;
            const base = palette.perKind[layer.kind] ?? palette.dim;
            const x = xs[i]!;
            const isHover = hover === i;
            const r = 6.5;

            // Head bands: draw the real split as separated groups + a per-band
            // rule, so n_heads is visible structure rather than a claim.
            if (layer.heads && ys[i]!.length > 1) {
              const per = Math.max(1, Math.floor(layer.sampled / layer.heads.drawn));
              p.stroke(palette.wire);
              p.strokeWeight(0.5);
              for (let b = 0; b < layer.heads.drawn; b++) {
                const band = ys[i]!.slice(b * per, (b + 1) * per);
                const y0 = band[0];
                const y1 = band[band.length - 1];
                if (y0 == null || y1 == null) continue;
                p.line(x - 16, y0 - 6, x + 16, y0 - 6);
              }
              p.noStroke();
            }

            for (const y of ys[i]!) {
              if (glow > 0.02) {
                p.fill(base);
                // Halo capped at ~2x the dot — no unbounded bloom.
                p.circle(x, y, r * (1 + glow));
              }
              p.fill(arrived ? base : palette.wire);
              p.circle(x, y, isHover ? r * 1.25 : r);
            }

            // ── caption: real width + explicit sampling disclosure ──────────
            p.textAlign(p.CENTER, p.TOP);
            p.fill(isHover ? palette.text : palette.dim);
            p.textSize(10);
            p.text(layer.label, x, h - 40);

            p.fill(palette.dim);
            p.textSize(9);
            const width =
              layer.units == null
                ? 'width not derivable'
                : layer.truncated
                  ? `${layer.sampled} of ${layer.units} shown`
                  : `${layer.units} units`;
            p.text(width, x, h - 27);

            // Real head split, only where derive.ts genuinely reports one.
            if (layer.heads) {
              const { count, dHead, drawn } = layer.heads;
              p.text(
                drawn < count
                  ? `${drawn} of ${count} heads · d_head ${dHead}`
                  : `${count} heads · d_head ${dHead}`,
                x,
                h - 15,
              );
            } else if (layer.outShape) {
              p.text(layer.outShape, x, h - 15);
            }
          });
        };

        p.remove = ((orig) =>
          function patched(this: p5Types) {
            themeObserver?.disconnect();
            return orig.call(this);
          })(p.remove) as typeof p.remove;
      };

      instance = new P5(sketch, host);
      sketchRef.current = instance;
    });

    const ro = new ResizeObserver(() => {
      sketchRef.current?.windowResized?.();
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      instance?.remove();
      sketchRef.current = null;
    };
    // Rebuild only when the derived graph itself changes — play/speed/step are
    // read from refs inside the loop, so prop churn never tears down the sketch.
  }, [graph, onModel]);

  return (
    <div
      ref={hostRef}
      className={cn('relative h-full min-h-0 w-full', className)}
      data-testid="neural-canvas"
      aria-label={`2D neural network view: ${graph.nodes.length} layers, ${graph.totalParams.toLocaleString()} trainable parameters. Columns wider than ${DRAW_CAP} neurons are sampled; each column states its real width.`}
      role="img"
    />
  );
}

export default NeuralCanvas;
