/**
 * EncodeDecode — watch a real bar squeeze through a bottleneck and come back.
 *
 * The autoencoder family's mechanism is COMPRESSION AND RECOVERY: a vector is
 * forced through a narrower representation and rebuilt, and what survives that
 * squeeze is what the model considers essential. The interesting quantity is
 * therefore the reconstruction error, and how it falls as the bottleneck widens.
 *
 * HONESTY CONTRACT:
 *   - The encode and decode are REAL and, for a linear autoencoder under squared
 *     error, OPTIMAL: compute/pca.ts diagonalises the real covariance matrix
 *     exactly (Jacobi), and projecting onto the top k components is provably the
 *     best k-dimensional linear bottleneck. Nothing is seeded or fitted by
 *     gradient descent.
 *   - Every bar drawn is a real bar; every reconstruction is that bar actually
 *     pushed through the bottleneck and rebuilt; the error bars are the real
 *     per-feature residuals.
 *   - What it is NOT: a deep, non-linear autoencoder. A trained non-linear model
 *     could do better than this bound, and the canvas says the number shown is
 *     the linear optimum, not a claim about the model's ceiling.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { pca, encode, decode, reconstructionError } from '../compute/pca';
import type { ArchetypeProps } from './types';

const FRAMES_PER_BAR = 24;

export function EncodeDecode({
  spec, features, playing, stepSignal, speed, forceMotion, onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);
  const live = useRef({ playing, stepSignal, speed, forceMotion });
  live.current = { playing, stepSignal, speed, forceMotion };

  const rows = useMemo(() => features.rows.map((r) => r.values), [features]);
  const model = useMemo(() => pca(rows), [rows]);
  /** Bottleneck width: half the feature count, at least 2 — a real squeeze. */
  const k = Math.max(2, Math.floor((features.columns.length || 6) / 2));
  const mse = useMemo(() => reconstructionError(rows, model, k), [rows, model, k]);
  const kept = useMemo(() => (model.cumulative[k - 1] ?? 0) * 100, [model, k]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || rows.length === 0 || model.components.length === 0) return;
    let disposed = false;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;
      const sketch = (p: p5Types) => {
        let bar = 0;
        let frames = 0;
        let lastStep = live.current.stepSignal;

        const report = () => {
          onProgress?.({
            stageId: spec.stages[Math.min(1, spec.stages.length - 1)]?.id ?? 'latent',
            iteration: bar,
            totalIterations: rows.length,
            metricLabel: 'reconstruction MSE',
            metricValue: mse,
            converged: false,
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
          if (live.current.stepSignal !== lastStep) {
            lastStep = live.current.stepSignal;
            bar = (bar + 1) % rows.length;
            frames = 0;
            report();
          } else if (live.current.playing && (!reduced || live.current.forceMotion)) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_BAR) { frames = 0; bar = (bar + 1) % rows.length; report(); }
          }

          const x = rows[bar]!;
          const code = encode(x, model, k);
          const back = decode(code, model);

          const D = x.length;
          const midY = p.height / 2;
          const colIn = 150;
          const colLat = p.width / 2;
          const colOut = p.width - 210;
          const spread = Math.min(26, (p.height - 150) / Math.max(D, 1));
          const yIn = (i: number) => midY + (i - (D - 1) / 2) * spread;
          const yLat = (j: number) => midY + (j - (k - 1) / 2) * spread * 1.5;

          // ── the squeeze: every input dim wires into every latent dim ──
          p.stroke('#0072B255');
          p.strokeWeight(0.8);
          for (let i = 0; i < D; i++) for (let j = 0; j < k; j++) p.line(colIn, yIn(i), colLat, yLat(j));
          p.stroke('#CC79A755');
          for (let j = 0; j < k; j++) for (let i = 0; i < D; i++) p.line(colLat, yLat(j), colOut, yIn(i));

          // ── input, latent, reconstruction ──
          p.textSize(9);
          for (let i = 0; i < D; i++) {
            p.noStroke();
            p.fill('#56B4E9');
            p.circle(colIn, yIn(i), 11);
            p.fill(150);
            p.textAlign(p.RIGHT, p.CENTER);
            p.text(`${features.columns[i]} ${x[i]!.toFixed(2)}`, colIn - 12, yIn(i));

            // Reconstruction, with the real residual drawn as a bar.
            const err = Math.abs(x[i]! - back[i]!);
            p.noStroke();
            p.fill('#F0E442');
            p.circle(colOut, yIn(i), 11);
            p.fill('#E69F00');
            p.rect(colOut + 12, yIn(i) - 3, Math.min(120, err * 90), 6, 2);
            p.fill(150);
            p.textAlign(p.LEFT, p.CENTER);
            p.text(`${back[i]!.toFixed(2)}  err ${err.toFixed(3)}`, colOut + 138, yIn(i));
          }
          for (let j = 0; j < k; j++) {
            p.noStroke();
            p.fill('#CC79A7');
            p.quad(colLat, yLat(j) - 9, colLat + 9, yLat(j), colLat, yLat(j) + 9, colLat - 9, yLat(j));
            p.fill(225);
            p.textAlign(p.CENTER, p.TOP);
            p.text(code[j]!.toFixed(2), colLat, yLat(j) + 12);
          }

          // ── captions ──
          p.noStroke();
          p.fill(150);
          p.textSize(10);
          p.textAlign(p.CENTER, p.BOTTOM);
          p.text(`input · ${D} features`, colIn, midY - (D / 2) * spread - 22);
          p.text(`bottleneck · ${k}`, colLat, midY - (k / 2) * spread * 1.5 - 22);
          p.text('reconstruction', colOut, midY - (D / 2) * spread - 22);

          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(
            `bar ${bar + 1} / ${rows.length} · ${D} → ${k} → ${D} · ` +
              `MSE ${mse.toFixed(4)} · ${kept.toFixed(1)}% of variance kept`,
            18, 12,
          );
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            'exact PCA on your bars — the OPTIMAL linear autoencoder at this bottleneck. ' +
              'A trained non-linear autoencoder could beat this bound.',
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
  }, [rows, model, k, mse, kept, features.columns, spec.stages, onProgress]);

  if (features.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No complete feature rows yet — there is nothing to compress until the
        causal z-score window has filled.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — compressing real bars through a ${k}-dimensional bottleneck`}
    />
  );
}

export default EncodeDecode;
