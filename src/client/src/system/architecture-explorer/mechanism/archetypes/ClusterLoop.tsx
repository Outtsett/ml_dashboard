/**
 * cluster-loop — the assign/update convergence picture, drawn with p5.
 *
 * HONESTY CONTRACT:
 *   - The points are REAL bars: each marker is one bar's candle-geometry vector,
 *     projected to 2D by taking the two feature columns with the highest
 *     variance. The projection is stated on the canvas; it is a view of real
 *     data, not a transform that invents structure.
 *   - The clustering is REAL: compute/kmeans.ts runs to convergence up front and
 *     the sketch replays its actual trace. Iteration N on screen is iteration N
 *     of the algorithm — progress is never paced off a timer.
 *   - The inertia shown is the real objective value at that step.
 *   - This engine renders ONLY specs whose `kernelId` is 'kmeans'. Sharing the
 *     cluster-loop archetype is not enough: DBSCAN and Mean Shift are different
 *     algorithms, and drawing a k-means run under their name would be a lie.
 *     The shell gates on kernelId; this guard is the second line of defence.
 *   - Colour never carries meaning alone: each cluster has both an Okabe-Ito hue
 *     and a distinct marker shape, and centroids are squares while member points
 *     are small markers.
 *
 * p5 runs in INSTANCE mode and is imported lazily inside the effect.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { kmeans, type KMeansTrace } from '../compute/kmeans';
import type { ArchetypeProps } from './types';

/** Okabe-Ito, deuteranopia-safe. Never a red/green pair. */
const CLUSTER_COLORS = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#CC79A7', // reddish purple
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
] as const;

/** Marker shape per cluster, so colour is never the only channel. */
type Shape = 'circle' | 'triangle' | 'diamond' | 'cross';
const CLUSTER_SHAPES: Shape[] = ['circle', 'triangle', 'diamond', 'cross'];

const K = 4;
/** Frames each real iteration is held on screen at speed 1. */
const FRAMES_PER_STEP = 45;
const PAD = 46;

/** Indices of the two highest-variance columns — the disclosed 2-D view. */
function pickProjection(rows: readonly { values: number[] }[]): [number, number] {
  const dims = rows[0]?.values.length ?? 0;
  const variances: number[] = [];
  for (let d = 0; d < dims; d++) {
    let sum = 0;
    for (const r of rows) sum += r.values[d]!;
    const mean = sum / rows.length;
    let acc = 0;
    for (const r of rows) acc += (r.values[d]! - mean) ** 2;
    variances.push(acc / rows.length);
  }
  const order = variances
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  return [order[0] ?? 0, order[1] ?? Math.min(1, Math.max(dims - 1, 0))];
}

export function ClusterLoop({
  spec,
  features,
  playing,
  stepSignal,
  speed,
  activeBeat,
  onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);

  // Mutable box the sketch reads each frame — avoids recreating p5 on prop change.
  const live = useRef({ playing, stepSignal, speed, activeBeat });
  live.current = { playing, stepSignal, speed, activeBeat };

  const points = useMemo(() => features.rows.map((r) => r.values), [features]);
  const projection = useMemo(
    () =>
      features.rows.length
        ? pickProjection(features.rows)
        : ([0, 1] as [number, number]),
    [features],
  );
  const trace: KMeansTrace = useMemo(
    () => (points.length ? kmeans(points, K, { seed: 7 }) : { steps: [], converged: false, iterations: 0, k: 0 }),
    [points],
  );

  const usable = spec.kernelId === 'kmeans' && features.rows.length > 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !usable || trace.steps.length === 0) return;

    let disposed = false;
    const [xi, yi] = projection;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of points) {
      const x = p[xi]!;
      const y = p[yi]!;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const spanX = xMax - xMin || 1;
    const spanY = yMax - yMin || 1;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;

      const sketch = (p: p5Types) => {
        let stepIndex = 0;
        let frames = 0;
        let lastStepSignal = live.current.stepSignal;

        const sx = (v: number) => PAD + ((v - xMin) / spanX) * (p.width - PAD * 2);
        const sy = (v: number) =>
          p.height - PAD - ((v - yMin) / spanY) * (p.height - PAD * 2);

        const report = () => {
          const s = trace.steps[stepIndex];
          if (!s) return;
          onProgress?.({
            stageId:
              stepIndex === 0 ? 'init' : stepIndex % 2 === 1 ? 'assign' : 'update',
            iteration: stepIndex,
            totalIterations: trace.steps.length - 1,
            metricLabel: 'inertia',
            metricValue: s.inertia,
            converged: trace.converged && stepIndex === trace.steps.length - 1,
          });
        };

        const marker = (shape: Shape, x: number, y: number, r: number) => {
          switch (shape) {
            case 'circle':
              p.circle(x, y, r * 2);
              break;
            case 'triangle':
              p.triangle(x, y - r, x - r, y + r, x + r, y + r);
              break;
            case 'diamond':
              p.quad(x, y - r, x + r, y, x, y + r, x - r, y);
              break;
            case 'cross':
              p.line(x - r, y - r, x + r, y + r);
              p.line(x - r, y + r, x + r, y - r);
              break;
          }
        };

        // Mirrors graph/NeuralCanvas.tsx exactly: `new P5(sketch, host)` already
        // parents the canvas, so calling `.parent()` again re-attaches it and
        // stops the draw loop after a single frame. Do not reintroduce it.
        p.setup = () => {
          const r = host.getBoundingClientRect();
          p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          report();
        };

        p.draw = () => {
          p.clear();

          if (live.current.stepSignal !== lastStepSignal) {
            lastStepSignal = live.current.stepSignal;
            stepIndex = Math.min(stepIndex + 1, trace.steps.length - 1);
            frames = 0;
            report();
          } else if (live.current.playing && !reduced) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_STEP) {
              frames = 0;
              stepIndex = stepIndex >= trace.steps.length - 1 ? 0 : stepIndex + 1;
              report();
            }
          }

          const step = trace.steps[stepIndex];
          if (!step) return;

          // Member points.
          for (let i = 0; i < points.length; i++) {
            const c = step.assignments[i]! % CLUSTER_COLORS.length;
            const shape = CLUSTER_SHAPES[c % CLUSTER_SHAPES.length]!;
            p.fill(CLUSTER_COLORS[c]!);
            p.stroke(CLUSTER_COLORS[c]!);
            p.strokeWeight(1);
            marker(shape, sx(points[i]![xi]!), sy(points[i]![yi]!), 3.2);
          }

          // Centroids: squares with tick marks, never confusable with members.
          for (let c = 0; c < step.centroids.length; c++) {
            const cx = sx(step.centroids[c]![xi]!);
            const cy = sy(step.centroids[c]![yi]!);
            p.noFill();
            p.stroke(CLUSTER_COLORS[c % CLUSTER_COLORS.length]!);
            p.strokeWeight(2.5);
            p.rect(cx - 7, cy - 7, 14, 14);
            p.line(cx - 12, cy, cx - 9, cy);
            p.line(cx + 9, cy, cx + 12, cy);
          }

          // Readout — every number here is real.
          p.noStroke();
          p.fill(150);
          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(
            `iteration ${stepIndex} / ${trace.steps.length - 1}` +
              `   inertia ${step.inertia.toFixed(3)}` +
              (trace.converged && stepIndex === trace.steps.length - 1
                ? '   converged'
                : ''),
            PAD,
            14,
          );
          p.text(
            `${points.length} real bars · axes ${features.columns[xi]} × ` +
              `${features.columns[yi]} (2 highest-variance of ${features.columns.length})`,
            PAD,
            p.height - 24,
          );
        };

        p.windowResized = () => {
          const r = host.getBoundingClientRect();
          p.resizeCanvas(Math.max(1, r.width), Math.max(1, r.height));
        };
      };

      p5Ref.current = new P5(sketch, host);
    });

    return () => {
      disposed = true;
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, [trace, points, projection, features.columns, onProgress, usable]);

  if (features.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No complete feature rows yet — the causal z-score window needs more bars
        of history before any point can be plotted.
      </div>
    );
  }

  if (spec.kernelId !== 'kmeans') {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
        {spec.name} is researched, but its kernel is not built yet. It is a
        cluster-loop, not a k-means run, so nothing is drawn rather than showing
        a different algorithm under this name.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — clustering ${features.rows.length} real bars`}
    />
  );
}

export default ClusterLoop;
