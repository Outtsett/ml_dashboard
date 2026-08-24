/**
 * AttentionMatrix — watch attention actually decide which bars matter.
 *
 * The attention family's mechanism is not a left-to-right sweep, it is a
 * COMPARISON: every bar scores every other bar, those scores are softmaxed into
 * weights, and the output is a weighted sum. So this engine draws the thing that
 * actually happens — a T x T map filling in row by row, each row normalising as
 * it completes, with the query bar and the bars it attends to called out.
 *
 * HONESTY CONTRACT:
 *   - The arithmetic is REAL: compute/attention.ts does genuine projections,
 *     genuine dot products, a genuine row softmax, and a genuine weighted sum
 *     over the real candle-geometry window.
 *   - The projections are SEEDED, not learned. No attention model here has
 *     trained weights, so the map reflects what this operation relates to what
 *     on your bars, but it is NOT the map a trained model would produce. Stated
 *     on the canvas, every frame.
 *   - Row sums are drawn from the real softmax output, so "each row sums to 1"
 *     is a fact you can read off the picture rather than a claim.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { attention } from '../compute/attention';
import type { ArchetypeProps } from './types';

/** Bars attended over. Small enough that individual cells stay readable. */
const T_MAX = 18;
const FRAMES_PER_ROW = 16;

export function AttentionMatrix({
  spec, features, playing, stepSignal, speed, forceMotion, onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);
  const live = useRef({ playing, stepSignal, speed, forceMotion });
  live.current = { playing, stepSignal, speed, forceMotion };

  /** The most recent T_MAX bars — attention reads a window, not the whole history. */
  const win = useMemo(
    () => features.rows.slice(-T_MAX).map((r) => r.values),
    [features],
  );
  const result = useMemo(() => attention(win), [win]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || result.T === 0) return;
    let disposed = false;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;
      const sketch = (p: p5Types) => {
        let row = 0;      // rows revealed so far
        let frames = 0;
        let lastStep = live.current.stepSignal;

        const report = () => {
          onProgress?.({
            stageId: spec.stages[Math.min(row, spec.stages.length - 1)]?.id ?? 'attn',
            iteration: row,
            totalIterations: result.T,
            metricLabel: 'rows softmaxed',
            metricValue: row,
            converged: row >= result.T,
          });
        };

        p.setup = () => {
          const r = host.getBoundingClientRect();
          p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          report();
        };

        p.draw = () => {
          p.clear();
          const T = result.T;

          if (live.current.stepSignal !== lastStep) {
            lastStep = live.current.stepSignal;
            row = row >= T ? 0 : row + 1;
            frames = 0;
            report();
          } else if (live.current.playing && (!reduced || live.current.forceMotion)) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_ROW) {
              frames = 0;
              row = row >= T ? 0 : row + 1;
              report();
            }
          }

          // Geometry: a square map, left-aligned, with room for labels.
          const top = 44;
          const left = 92;
          const size = Math.min(p.height - top - 62, p.width - left - 240);
          const cell = size / T;

          // ── the map ──
          for (let i = 0; i < Math.min(row, T); i++) {
            for (let j = 0; j < T; j++) {
              const a = result.attn[i]![j]!;
              // Sequential single-hue ramp (blue), so it reads as magnitude and
              // never as a red/green judgement.
              const t = Math.min(1, a / result.attnMax);
              p.noStroke();
              p.fill(0, 114, 178, 26 + t * 229);
              p.rect(left + j * cell, top + i * cell, cell - 1, cell - 1);
            }
          }
          // Rows not yet computed stay empty, so progress is legible.
          p.noFill();
          p.stroke('#3a4250');
          p.strokeWeight(0.6);
          for (let i = Math.min(row, T); i < T; i++) {
            for (let j = 0; j < T; j++) {
              p.rect(left + j * cell, top + i * cell, cell - 1, cell - 1);
            }
          }

          // ── the row currently being softmaxed ──
          if (row > 0 && row <= T) {
            const i = row - 1;
            p.noFill();
            p.stroke('#E69F00');
            p.strokeWeight(2);
            p.rect(left - 1, top + i * cell - 1, size + 1, cell + 1);
            const sum = result.attn[i]!.reduce((a, b) => a + b, 0);
            p.noStroke();
            p.fill('#E69F00');
            p.textSize(11);
            p.textAlign(p.LEFT, p.CENTER);
            p.text(`row sums to ${sum.toFixed(3)}`, left + size + 14, top + i * cell + cell / 2);
          }

          // ── axis labels ──
          p.noStroke();
          p.fill(150);
          p.textSize(10);
          p.textAlign(p.RIGHT, p.CENTER);
          p.text('query bar →', left - 10, top + size / 2);
          p.textAlign(p.CENTER, p.BOTTOM);
          p.text('key bar (which other bars it looks at)', left + size / 2, top - 12);

          // ── readout ──
          p.textAlign(p.LEFT, p.TOP);
          p.fill(150);
          p.textSize(11);
          p.text(
            `${Math.min(row, T)} / ${T} rows softmaxed · ` +
              `${T} bars · d_k ${result.dk}`,
            18, 14,
          );
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            'softmax(QKᵀ/√d_k)V computed on real bars · projections are SEEDED, ' +
              'not learned — this is the operation, not a trained model’s attention',
            18, p.height - 12,
          );
        };

        p.windowResized = () => {
          const r = host.getBoundingClientRect();
          p.resizeCanvas(Math.max(1, r.width), Math.max(1, r.height));
        };
      };
      p5Ref.current = new P5(sketch, host);
    });

    return () => { disposed = true; p5Ref.current?.remove(); p5Ref.current = null; };
  }, [result, spec.stages, onProgress]);

  if (features.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No complete feature rows yet — attention needs a real bar window before it
        can score anything.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — attention map over ${result.T} real bars`}
    />
  );
}

export default AttentionMatrix;
