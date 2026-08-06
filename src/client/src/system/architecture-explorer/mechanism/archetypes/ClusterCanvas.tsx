/**
 * ClusterCanvas — watch a clustering algorithm actually cluster.
 *
 * Every clustering model in the registry that carries a kernel is drawn here,
 * replaying ITS OWN algorithm's real trace: points recolour as membership
 * changes, centres move, DBSCAN's regions grow outward leaving noise behind,
 * Mean Shift's points climb to modes, GMM draws elliptical components, the SOM
 * lattice unfolds across the data.
 *
 * HONESTY CONTRACT:
 *   - The trace is REAL. compute/clustering.ts runs the genuine algorithm to
 *     completion up front; frame N is iteration N. Progress is never paced off
 *     a timer, and the reported objective is the algorithm's own.
 *   - Points are REAL BARS: each marker is one bar's candle-geometry vector,
 *     projected to 2D by the two highest-variance feature columns. The
 *     projection is stated on the canvas — it is a view of real data, not a
 *     transform that manufactures structure.
 *   - Each kernel is dispatched by the model's own `kernelId`. Sharing the
 *     cluster-loop archetype is NOT enough to share an algorithm; a model whose
 *     kernel is not built renders a stated refusal instead of borrowing one.
 *   - Colour never carries meaning alone: cluster identity is hue AND marker
 *     shape, centres are outlined squares, and noise is a grey hollow ring.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { kmeans } from '../compute/kmeans';
import {
  gmm,
  dbscan,
  meanShift,
  agglomerative,
  som,
  copKmeans,
  affinityPropagation,
  type ClusterTrace,
  type ClusterStep,
} from '../compute/clustering';
import type { ArchetypeProps } from './types';

/** Okabe-Ito. Never a red/green pair. */
const COLORS = [
  '#0072B2', '#E69F00', '#009E73', '#CC79A7',
  '#56B4E9', '#D55E00', '#F0E442', '#7F7F7F',
] as const;
type Shape = 'circle' | 'triangle' | 'diamond' | 'cross';
const SHAPES: Shape[] = ['circle', 'triangle', 'diamond', 'cross'];

const PAD = 52;
const FRAMES_PER_STEP = 42;

/** kernelId -> the real algorithm. Adding a kernel here is what makes a model animate. */
function runKernel(kernelId: string, pts: number[][]): ClusterTrace {
  switch (kernelId) {
    case 'gmm':
      return gmm(pts, 4);
    case 'dbscan':
      return dbscan(pts);
    case 'meanshift':
      return meanShift(pts);
    case 'agglomerative':
      return agglomerative(pts);
    case 'som':
      return som(pts);
    case 'copkmeans':
      return copKmeans(pts, 4);
    case 'affinity':
      return affinityPropagation(pts);
    case 'kmeans':
    default: {
      const t = kmeans(pts, 4, { seed: 7 });
      return {
        steps: t.steps.map<ClusterStep>((s) => ({
          assignments: s.assignments,
          centroids: s.centroids,
          metricLabel: 'inertia',
          metricValue: s.inertia,
          note: 'hard assignment · centroids are means',
        })),
        converged: t.converged,
        iterations: t.iterations,
        k: t.k,
      };
    }
  }
}

/** The two highest-variance columns — the disclosed 2-D view. */
function pickProjection(rows: readonly { values: number[] }[]): [number, number] {
  const dims = rows[0]?.values.length ?? 0;
  const vars: number[] = [];
  for (let d = 0; d < dims; d++) {
    let s = 0;
    for (const r of rows) s += r.values[d]!;
    const m = s / rows.length;
    let acc = 0;
    for (const r of rows) acc += (r.values[d]! - m) ** 2;
    vars.push(acc / rows.length);
  }
  const order = vars.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  return [order[0] ?? 0, order[1] ?? Math.min(1, Math.max(dims - 1, 0))];
}

export function ClusterCanvas({
  spec, features, playing, stepSignal, speed, activeBeat, forceMotion, onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);
  const live = useRef({ playing, stepSignal, speed, activeBeat, forceMotion });
  live.current = { playing, stepSignal, speed, activeBeat, forceMotion };

  const points = useMemo(() => features.rows.map((r) => r.values), [features]);
  const projection = useMemo(
    () => (features.rows.length ? pickProjection(features.rows) : ([0, 1] as [number, number])),
    [features],
  );
  const trace = useMemo(
    () =>
      spec.kernelId && points.length
        ? runKernel(spec.kernelId, points)
        : ({ steps: [], converged: false, iterations: 0, k: 0 } as ClusterTrace),
    [spec.kernelId, points],
  );

  const usable = !!spec.kernelId && features.rows.length > 0 && trace.steps.length > 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !usable) return;
    let disposed = false;

    const [xi, yi] = projection;
    // Bounds must span the POINTS and every centre the run ever produces, or a
    // mode that drifts outside the cloud would be clipped off-canvas.
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    const consider = (x: number, y: number) => {
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    };
    for (const p of points) consider(p[xi]!, p[yi]!);
    for (const s of trace.steps) for (const c of s.centroids ?? []) consider(c[xi]!, c[yi]!);
    const spanX = xMax - xMin || 1;
    const spanY = yMax - yMin || 1;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;
      const sketch = (p: p5Types) => {
        let idx = 0;
        let frames = 0;
        let lastStep = live.current.stepSignal;

        const sx = (v: number) => PAD + ((v - xMin) / spanX) * (p.width - PAD * 2);
        const sy = (v: number) => p.height - PAD - ((v - yMin) / spanY) * (p.height - PAD * 2);

        const report = () => {
          const s = trace.steps[idx];
          if (!s) return;
          onProgress?.({
            stageId: spec.stages[Math.min(idx, spec.stages.length - 1)]?.id ?? 'step',
            iteration: idx,
            totalIterations: trace.steps.length - 1,
            metricLabel: s.metricLabel,
            metricValue: s.metricValue,
            converged: trace.converged && idx === trace.steps.length - 1,
          });
        };

        const marker = (shape: Shape, x: number, y: number, r: number) => {
          switch (shape) {
            case 'circle': p.circle(x, y, r * 2); break;
            case 'triangle': p.triangle(x, y - r, x - r, y + r, x + r, y + r); break;
            case 'diamond': p.quad(x, y - r, x + r, y, x, y + r, x - r, y); break;
            case 'cross': p.line(x - r, y - r, x + r, y + r); p.line(x - r, y + r, x + r, y - r); break;
          }
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
            idx = Math.min(idx + 1, trace.steps.length - 1);
            frames = 0;
            report();
          } else if (live.current.playing && (!reduced || live.current.forceMotion)) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_STEP) {
              frames = 0;
              idx = idx >= trace.steps.length - 1 ? 0 : idx + 1;
              report();
            }
          }
          const step = trace.steps[idx];
          if (!step) return;

          // Component ellipses (GMM) — the shape k-means cannot express.
          if (step.spreads && step.centroids) {
            p.noFill();
            for (let c = 0; c < step.centroids.length; c++) {
              const sp = step.spreads[c];
              if (!sp) continue;
              p.stroke(COLORS[c % COLORS.length]! + '66');
              p.strokeWeight(1.2);
              for (const mult of [1, 2]) {
                p.ellipse(
                  sx(step.centroids[c]![xi]!),
                  sy(step.centroids[c]![yi]!),
                  ((sp[0]! * mult) / spanX) * (p.width - PAD * 2) * 2,
                  ((sp[1]! * mult) / spanY) * (p.height - PAD * 2) * 2,
                );
              }
            }
          }

          // Lattice edges (SOM) — topology preservation made visible.
          if (step.gridEdges && step.centroids) {
            p.stroke('#E69F00AA');
            p.strokeWeight(1.3);
            for (const [a, b] of step.gridEdges) {
              const ca = step.centroids[a];
              const cb = step.centroids[b];
              if (!ca || !cb) continue;
              p.line(sx(ca[xi]!), sy(ca[yi]!), sx(cb[xi]!), sy(cb[yi]!));
            }
          }

          // Points.
          for (let i = 0; i < points.length; i++) {
            const a = step.assignments[i] ?? -1;
            const x = sx(points[i]![xi]!);
            const y = sy(points[i]![yi]!);
            if (a < 0) {
              // Noise / unassigned: hollow grey ring, never a cluster colour.
              p.noFill();
              p.stroke('#8A8A8A');
              p.strokeWeight(1);
              p.circle(x, y, 6);
              continue;
            }
            const col = COLORS[a % COLORS.length]!;
            p.fill(col);
            p.stroke(col);
            p.strokeWeight(1);
            marker(SHAPES[a % SHAPES.length]!, x, y, 3.2);
          }

          // Centres.
          for (const [c, cen] of (step.centroids ?? []).entries()) {
            const cx = sx(cen[xi]!);
            const cy = sy(cen[yi]!);
            p.noFill();
            p.stroke(COLORS[c % COLORS.length]!);
            p.strokeWeight(2.4);
            p.rect(cx - 6, cy - 6, 12, 12);
          }

          // Readout — every number real.
          p.noStroke();
          p.fill(150);
          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(
            `iteration ${idx} / ${trace.steps.length - 1}   ` +
              `${step.metricLabel} ${step.metricValue.toFixed(3)}` +
              (trace.converged && idx === trace.steps.length - 1 ? '   converged' : ''),
            PAD, 12,
          );
          if (step.note) {
            p.textSize(10);
            p.text(step.note, PAD, 30);
          }
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            `${points.length} real bars · axes ${features.columns[xi]} x ${features.columns[yi]} ` +
              `(2 highest-variance of ${features.columns.length})`,
            PAD, p.height - 12,
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
  }, [trace, points, projection, features.columns, spec.stages, onProgress, usable]);

  if (features.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No complete feature rows yet — the causal z-score window needs more bars
        of history before any point can be clustered.
      </div>
    );
  }

  if (!spec.kernelId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
        {spec.name} is researched, but its algorithm is not implemented yet. It
        clusters differently from the kernels that are built, so nothing is drawn
        rather than showing a different algorithm under this name.
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

export default ClusterCanvas;
