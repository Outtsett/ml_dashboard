/**
 * NodeFlow — the universal NODES-AND-LINES engine.
 *
 * This is the classic neural-network picture (the one graph/NeuralCanvas.tsx
 * draws for the 9 source-derived models) generalised so EVERY researched model
 * gets it: each stage becomes a column of nodes, adjacent columns are fully
 * wired, and a signal front sweeps left to right lighting each node as it
 * arrives. Iterative models close the loop and the front runs again.
 *
 * Topology varies by archetype because the mechanisms genuinely differ:
 *   duel    — two opposed stacks (generator up, discriminator down) meeting at
 *             a judge node; the adversarial models
 *   loop    — the front returns to an earlier column and re-runs, with the
 *             return path drawn; anything with an update/loss stage
 *   stack    — straight left-to-right propagation; the feed-forward models
 *
 * HONESTY CONTRACT:
 *   - Column ORDER, labels, roles and the loop shape are the researched
 *     stages, cited to the spec. They are real and per-model.
 *   - Node COUNT per column is ILLUSTRATIVE and the canvas says so. These
 *     specs carry no layer widths, so a specific count would be invented.
 *     Drawing four circles never claims the layer has four units.
 *   - NO VALUE is drawn on any node. A lit node means "the signal has reached
 *     this stage", which is a structural fact. Rendering a made-up activation
 *     is precisely the lie this module exists to prevent — see
 *     graph/neurons.ts, which makes the same distinction for real widths.
 *
 * p5 runs in INSTANCE mode, lazily imported. `new P5(sketch, host)` already
 * parents the canvas, so `.parent()` is NOT called again.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import type { ArchetypeProps } from './types';
import type { ArchetypeId, MechanismStage, StageRole } from '../registry';

/** Okabe-Ito per role. Never a red/green pair; the role is always labelled too. */
const ROLE_COLOR: Record<StageRole, string> = {
  input: '#56B4E9',
  transform: '#0072B2',
  latent: '#CC79A7',
  score: '#009E73',
  loss: '#E69F00',
  update: '#D55E00',
  output: '#F0E442',
};

/** Node shape per role, so colour is never the only channel. */
type Shape = 'circle' | 'square' | 'diamond' | 'ring';
const ROLE_SHAPE: Record<StageRole, Shape> = {
  input: 'circle',
  transform: 'circle',
  latent: 'diamond',
  score: 'ring',
  loss: 'ring',
  update: 'diamond',
  output: 'square',
};

/** Illustrative node count per role — disclosed on the canvas, never a width. */
const ROLE_NODES: Record<StageRole, number> = {
  input: 5,
  transform: 4,
  latent: 3,
  score: 2,
  loss: 1,
  update: 3,
  output: 2,
};

type Topology = 'stack' | 'loop' | 'duel';

const DUEL_ARCHETYPES: ReadonlySet<string> = new Set([
  'adversarial-duel',
  'contrastive-pair',
  'teacher-student',
]);
const LOOPING_ROLES: ReadonlySet<StageRole> = new Set(['update', 'loss']);

function topologyFor(archetype: ArchetypeId, stages: readonly MechanismStage[]): Topology {
  if (DUEL_ARCHETYPES.has(archetype)) return 'duel';
  if (stages.some((s) => LOOPING_ROLES.has(s.role))) return 'loop';
  return 'stack';
}

/** Column the loop returns to, or -1 when the flow is feed-forward. */
function loopTarget(stages: readonly MechanismStage[]): number {
  const last = [...stages]
    .map((s, i) => [s, i] as const)
    .reverse()
    .find(([s]) => LOOPING_ROLES.has(s.role));
  if (!last) return -1;
  const t = stages.findIndex((s) => s.role === 'transform' || s.role === 'latent');
  return t >= 0 && t < last[1] ? t : 0;
}

interface Column {
  stage: MechanismStage;
  x: number;
  ys: number[];
  /** -1 lower bank, +1 upper bank, 0 centred. Only meaningful for `duel`. */
  bank: number;
}

export function NodeFlow({
  spec,
  features,
  playing,
  stepSignal,
  speed,
  activeBeat,
  forceMotion,
  onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);

  const live = useRef({ playing, stepSignal, speed, activeBeat, forceMotion });
  live.current = { playing, stepSignal, speed, activeBeat, forceMotion };

  const stages = useMemo(() => spec.stages, [spec]);
  const topo = useMemo(() => topologyFor(spec.archetype, stages), [spec.archetype, stages]);
  const loopTo = useMemo(() => (topo === 'loop' ? loopTarget(stages) : -1), [topo, stages]);
  const beatStage = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of spec.beats) {
      const i = stages.findIndex((s) => s.id === b.at);
      if (i >= 0) m.set(b.id, i);
    }
    return m;
  }, [spec, stages]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || stages.length < 2) return;

    let disposed = false;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;

      const sketch = (p: p5Types) => {
        let front = 0; // continuous signal position, in column units
        let laps = 0;
        let lastStep = live.current.stepSignal;
        let cols: Column[] = [];

        const layout = () => {
          const padX = 76;
          const n = stages.length;
          const usable = Math.max(120, p.width - padX * 2);
          const gap = n > 1 ? usable / (n - 1) : 0;
          const midY = p.height / 2;

          cols = stages.map((stage, i) => {
            const count = ROLE_NODES[stage.role];
            // In a duel the two competing halves sit on opposite banks and
            // converge on the scoring stage, which stays centred.
            let bank = 0;
            if (topo === 'duel') {
              if (stage.role === 'score' || stage.role === 'loss') bank = 0;
              else bank = i % 2 === 0 ? -1 : 1;
            }
            const spread = Math.min(30, (p.height - 190) / Math.max(count, 1));
            const centre = midY + bank * Math.min(96, p.height * 0.19);
            const ys = Array.from(
              { length: count },
              (_, k) => centre + (k - (count - 1) / 2) * spread,
            );
            return { stage, x: padX + gap * i, ys, bank };
          });
        };

        const report = (idx: number) => {
          const s = stages[Math.min(idx, stages.length - 1)];
          if (!s) return;
          onProgress?.({
            stageId: s.id,
            iteration: laps,
            totalIterations: 0,
            metricLabel: 'stage',
            metricValue: idx,
            converged: false,
          });
        };

        const node = (shape: Shape, x: number, y: number, r: number) => {
          switch (shape) {
            case 'square':
              p.rect(x - r, y - r, r * 2, r * 2, 2);
              break;
            case 'diamond':
              p.quad(x, y - r, x + r, y, x, y + r, x - r, y);
              break;
            case 'ring':
              p.circle(x, y, r * 2);
              break;
            default:
              p.circle(x, y, r * 2);
          }
        };

        p.setup = () => {
          const r = host.getBoundingClientRect();
          p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          layout();
          report(0);
        };

        p.draw = () => {
          p.clear();
          if (cols.length === 0) return;
          const last = cols.length - 1;
          const prev = Math.floor(front);

          if (live.current.stepSignal !== lastStep) {
            lastStep = live.current.stepSignal;
            front = Math.floor(front) + 1;
            if (front > last) { front = loopTo >= 0 ? loopTo : 0; laps++; }
            report(Math.floor(front));
          } else if (live.current.playing && (!reduced || live.current.forceMotion)) {
            front += 0.014 * Math.max(0.25, live.current.speed);
            if (front > last) { front = loopTo >= 0 ? loopTo : 0; laps++; }
            if (Math.floor(front) !== prev) report(Math.floor(front));
          }

          const highlight = live.current.activeBeat
            ? (beatStage.get(live.current.activeBeat) ?? -1)
            : -1;

          // ── wires: every node of column i to every node of column i+1 ──
          for (let i = 0; i < cols.length - 1; i++) {
            const a = cols[i]!;
            const b = cols[i + 1]!;
            const lit = i < front;
            p.stroke(lit ? '#0072B2' : '#48505c');
            p.strokeWeight(lit ? 1.15 : 0.5);
            for (const ay of a.ys) for (const by of b.ys) p.line(a.x, ay, b.x, by);
          }

          // ── the return path, for models that genuinely iterate ──
          if (loopTo >= 0) {
            const from = cols[last]!;
            const to = cols[loopTo]!;
            const arcY = p.height - 54;
            p.stroke('#D55E00');
            p.strokeWeight(1.5);
            const qx = (t: number) =>
              (1 - t) ** 2 * from.x + 2 * (1 - t) * t * ((from.x + to.x) / 2) + t ** 2 * to.x;
            const qy = (t: number) => {
              const y0 = from.ys[from.ys.length - 1]!;
              const y1 = to.ys[to.ys.length - 1]!;
              return (1 - t) ** 2 * y0 + 2 * (1 - t) * t * arcY + t ** 2 * y1;
            };
            for (let s = 0; s < 40; s += 2) {
              p.line(qx(s / 40), qy(s / 40), qx((s + 1) / 40), qy((s + 1) / 40));
            }
            p.noStroke();
            p.fill('#D55E00');
            p.textSize(10);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.text('repeats until converged', (from.x + to.x) / 2, arcY + 16);
          }

          // ── nodes ──
          for (let i = 0; i < cols.length; i++) {
            const c = cols[i]!;
            const col = ROLE_COLOR[c.stage.role];
            const shape = ROLE_SHAPE[c.stage.role];
            const reached = i <= front;
            const isBeat = i === highlight;
            // A soft pulse as the front crosses this column.
            const d = Math.abs(front - i);
            const pulse = d < 1 ? (1 - d) * 3.2 : 0;

            for (const y of c.ys) {
              if (shape === 'ring') {
                p.noFill();
                p.stroke(col);
                p.strokeWeight(reached ? 2.2 : 1);
              } else {
                p.noStroke();
                p.fill(reached ? col : '#39414d');
              }
              node(shape, c.x, y, 5.4 + pulse);
              if (isBeat) {
                p.noFill();
                p.stroke(col);
                p.strokeWeight(1.4);
                p.circle(c.x, y, 20);
              }
            }

            // Column caption: role above, stage label below.
            p.noStroke();
            p.fill(col);
            p.textSize(9);
            p.textAlign(p.CENTER, p.BOTTOM);
            const top = Math.min(...c.ys) - 14;
            p.text(c.stage.role, c.x, top);

            p.fill(reached ? 225 : 130);
            p.textSize(10);
            p.textAlign(p.CENTER, p.TOP);
            const bottom = Math.max(...c.ys) + 10;
            let label = c.stage.label;
            if (p.textWidth(label) > 132) {
              while (label.length > 1 && p.textWidth(label + '…') > 132) {
                label = label.slice(0, -1);
              }
              label += '…';
            }
            p.text(label, c.x, bottom);
          }

          // ── the travelling signal packet ──
          const i0 = Math.min(Math.floor(front), last);
          const i1 = Math.min(i0 + 1, last);
          const t = front - i0;
          const a = cols[i0]!;
          const b = cols[i1]!;
          const ay = a.ys[Math.floor(a.ys.length / 2)]!;
          const by = b.ys[Math.floor(b.ys.length / 2)]!;
          p.noStroke();
          p.fill('#F0E442');
          p.circle(a.x + (b.x - a.x) * t, ay + (by - ay) * t, 10);

          // ── footer: exactly what is and is not being claimed ──
          p.fill(140);
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            `${stages.length} stages from ${spec.specPath.split('/').pop()} · ` +
              `node counts are illustrative of structure, not layer width · ` +
              `a lit node means the signal reached that stage, not its value`,
            18,
            p.height - 12,
          );
        };

        p.windowResized = () => {
          const r = host.getBoundingClientRect();
          p.resizeCanvas(Math.max(1, r.width), Math.max(1, r.height));
          layout();
        };
      };

      p5Ref.current = new P5(sketch, host);
    });

    return () => {
      disposed = true;
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, [stages, topo, loopTo, beatStage, spec.specPath, onProgress, features.rows.length]);

  if (stages.length < 2) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
        {spec.name} has fewer than two researched stages, so there is no flow to
        animate yet.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — signal propagating across ${stages.length} stages`}
    />
  );
}

export default NodeFlow;
