/**
 * StageFlow — the universal mechanism engine.
 *
 * Animates ANY researched model from its own `spec.stages`: the real, cited
 * sequence of operations that model performs, with the loop closed wherever the
 * spec has an update/loss stage feeding back. This is what "how the model
 * processes information" means for a model whose exact arithmetic we have not
 * reimplemented — the FLOW is real and sourced, and nothing else is claimed.
 *
 * HONESTY CONTRACT — the whole reason this file can exist:
 *   - Stage names, order, roles and the loop shape come from the researched
 *     registry entry, which cites the markdown spec it was read from. They are
 *     not invented and not shared between models.
 *   - For a `schematic` spec NO NUMBERS ARE DRAWN. A travelling token shows
 *     where information is, never what it is worth. Rendering a made-up
 *     activation would be exactly the lie this module was built to prevent.
 *   - For a spec that DOES carry a kernel, the bespoke engine handles it
 *     instead (see ARCHETYPE_COMPONENTS); this engine never fakes that path.
 *   - Bars are NOT required. This engine computes nothing from them, so waiting
 *     on a cold OHLCV query would block the view for no reason. The footer
 *     states whether real bars happen to be loaded; the flow does not depend
 *     on it, and no bar-derived value is ever drawn.
 *
 * p5 runs in INSTANCE mode, lazily imported, and — per graph/NeuralCanvas.tsx —
 * `new P5(sketch, host)` already parents the canvas, so `.parent()` is NOT
 * called again.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import type { ArchetypeProps } from './types';
import type { MechanismStage, StageRole } from '../registry';

/** Okabe-Ito per role. Never a red/green pair; role text is always drawn too. */
const ROLE_COLOR: Record<StageRole, string> = {
  input: '#56B4E9', // sky
  transform: '#0072B2', // blue
  latent: '#CC79A7', // reddish purple
  score: '#009E73', // bluish green
  loss: '#E69F00', // orange
  update: '#D55E00', // vermillion
  output: '#F0E442', // yellow
};

/** Shape per role, so colour is never the only channel. */
const ROLE_SHAPE: Record<StageRole, 'rect' | 'round' | 'diamond' | 'hex'> = {
  input: 'round',
  transform: 'rect',
  latent: 'diamond',
  score: 'hex',
  loss: 'hex',
  update: 'diamond',
  output: 'rect',
};

/** Roles that close a loop back to an earlier stage — the iterative models. */
const LOOPING_ROLES: ReadonlySet<StageRole> = new Set(['update', 'loss']);

interface Node {
  stage: MechanismStage;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Index of the stage a loop returns TO, or -1 when the flow is feed-forward. */
function loopTargetIndex(stages: readonly MechanismStage[]): number {
  const lastLooping = [...stages]
    .map((s, i) => [s, i] as const)
    .reverse()
    .find(([s]) => LOOPING_ROLES.has(s.role));
  if (!lastLooping) return -1;
  // Return to the first stage that actually transforms — the input is read once.
  const target = stages.findIndex(
    (s) => s.role === 'transform' || s.role === 'latent',
  );
  return target >= 0 && target < lastLooping[1] ? target : -1;
}

export function StageFlow({
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

  const live = useRef({ playing, stepSignal, speed, activeBeat });
  live.current = { playing, stepSignal, speed, activeBeat };

  const stages = useMemo(() => spec.stages, [spec]);
  const loopTo = useMemo(() => loopTargetIndex(stages), [stages]);
  /** Beat id -> stage index, so clicking a beat highlights where it fires. */
  const beatStage = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of spec.beats) {
      const i = stages.findIndex((s) => s.id === b.at);
      if (i >= 0) m.set(b.id, i);
    }
    return m;
  }, [spec, stages]);

  // Deliberately NOT gated on bars. This engine computes nothing from them, so
  // blocking on a cold OHLCV query (13s+ for MNQ) would leave the panel empty
  // for no reason. Bar availability is reported in the footer instead.
  const ready = stages.length >= 2;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;

    let disposed = false;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;

      const sketch = (p: p5Types) => {
        /** Continuous position along the path, in stage units. */
        let pos = 0;
        let lastStepSignal = live.current.stepSignal;
        let laps = 0;
        let nodes: Node[] = [];

        const layout = () => {
          const pad = 70;
          const n = stages.length;
          const w = 168;
          const h = 74;
          // Cap the gap so a 3-stage flow clusters in the middle instead of
          // sprawling edge-to-edge with a lonely box in each corner. Wide gaps
          // also pushed the last label past the canvas edge and clipped it.
          const maxGap = w + 90;
          const available = Math.max(1, p.width - pad * 2 - w);
          const gap = n > 1 ? Math.min(maxGap, available / (n - 1)) : 0;
          const spanW = gap * (n - 1);
          const startX = (p.width - spanW) / 2; // centre the whole flow
          // Two rows once the flow is long, so boxes stay readable.
          const twoRow = n > 5;
          nodes = stages.map((stage, i) => ({
            stage,
            x: startX + gap * i,
            y: p.height / 2 + (twoRow ? (i % 2 === 0 ? -52 : 52) : 0),
            w,
            h,
          }));
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

        const shape = (
          kind: 'rect' | 'round' | 'diamond' | 'hex',
          x: number,
          y: number,
          w: number,
          h: number,
        ) => {
          switch (kind) {
            case 'round':
              p.rect(x - w / 2, y - h / 2, w, h, h / 2);
              break;
            case 'diamond':
              p.quad(x, y - h / 2, x + w / 2, y, x, y + h / 2, x - w / 2, y);
              break;
            case 'hex': {
              const i = w * 0.22;
              p.beginShape();
              p.vertex(x - w / 2 + i, y - h / 2);
              p.vertex(x + w / 2 - i, y - h / 2);
              p.vertex(x + w / 2, y);
              p.vertex(x + w / 2 - i, y + h / 2);
              p.vertex(x - w / 2 + i, y + h / 2);
              p.vertex(x - w / 2, y);
              p.endShape(p.CLOSE);
              break;
            }
            default:
              p.rect(x - w / 2, y - h / 2, w, h, 6);
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
          if (nodes.length === 0) return;

          const last = nodes.length - 1;
          const prevIdx = Math.floor(pos);

          if (live.current.stepSignal !== lastStepSignal) {
            lastStepSignal = live.current.stepSignal;
            pos = Math.floor(pos) + 1;
            if (pos > last) {
              pos = loopTo >= 0 ? loopTo : 0;
              laps++;
            }
            report(Math.floor(pos));
          } else if (live.current.playing && !reduced) {
            pos += 0.012 * Math.max(0.25, live.current.speed);
            if (pos > last) {
              pos = loopTo >= 0 ? loopTo : 0;
              laps++;
            }
            if (Math.floor(pos) !== prevIdx) report(Math.floor(pos));
          }

          const activeIdx = Math.floor(pos);
          const highlight = live.current.activeBeat
            ? (beatStage.get(live.current.activeBeat) ?? -1)
            : -1;

          // ── edges ────────────────────────────────────────────────────────
          p.noFill();
          for (let i = 0; i < nodes.length - 1; i++) {
            const a = nodes[i]!;
            const b = nodes[i + 1]!;
            const lit = i < pos;
            p.stroke(lit ? '#0072B2' : '#5b6470');
            p.strokeWeight(lit ? 2.2 : 1.1);
            p.line(a.x + a.w / 2, a.y, b.x - b.w / 2, b.y);
            // arrowhead
            const mx = b.x - b.w / 2;
            p.line(mx, b.y, mx - 7, b.y - 4);
            p.line(mx, b.y, mx - 7, b.y + 4);
          }

          // ── the loop-back arc, when this model genuinely iterates ────────
          if (loopTo >= 0) {
            const from = nodes[last]!;
            const to = nodes[loopTo]!;
            const arcY = p.height / 2 + 118;
            p.stroke('#D55E00');
            p.strokeWeight(1.6);
            // Dashes drawn manually: p5 2.x's drawingContext is typed as a
            // union including WebGL, so setLineDash is not reachable, and
            // bezierVertex's arity differs. Sampling a quadratic keeps this
            // renderer-agnostic and dependency-free.
            const qx = (t: number) =>
              (1 - t) ** 2 * from.x + 2 * (1 - t) * t * ((from.x + to.x) / 2) + t ** 2 * to.x;
            const qy = (t: number) => {
              const y0 = from.y + from.h / 2;
              const y1 = to.y + to.h / 2;
              return (1 - t) ** 2 * y0 + 2 * (1 - t) * t * arcY + t ** 2 * y1;
            };
            const SEGS = 48;
            for (let s = 0; s < SEGS; s += 2) {
              const t0 = s / SEGS;
              const t1 = (s + 1) / SEGS;
              p.line(qx(t0), qy(t0), qx(t1), qy(t1));
            }
            p.noStroke();
            p.fill('#D55E00');
            p.textSize(10);
            p.textAlign(p.CENTER, p.TOP);
            p.text('repeats until converged', (from.x + to.x) / 2, arcY - 14);
          }

          // ── stage boxes ──────────────────────────────────────────────────
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]!;
            const col = ROLE_COLOR[n.stage.role];
            const isActive = i === activeIdx;
            const isBeat = i === highlight;

            p.stroke(col);
            p.strokeWeight(isBeat ? 3 : isActive ? 2.4 : 1.2);
            p.fill(isActive || isBeat ? col + '2E' : '#00000000');
            shape(ROLE_SHAPE[n.stage.role], n.x, n.y, n.w, n.h);

            p.noStroke();
            p.fill(col);
            p.textSize(9);
            p.textAlign(p.CENTER, p.TOP);
            p.text(n.stage.role, n.x, n.y - n.h / 2 - 13);

            // Truncate rather than wrap. Passing a wrap width to p.text makes
            // p5 treat (x, y) as the text box's TOP-LEFT instead of its centre,
            // which pushed every label off to the right of its node.
            const fit = (s: string, size: number, max: number) => {
              p.textSize(size);
              if (p.textWidth(s) <= max) return s;
              let cut = s;
              while (cut.length > 1 && p.textWidth(cut + '…') > max) {
                cut = cut.slice(0, -1);
              }
              return cut + '…';
            };

            p.fill(230);
            p.textAlign(p.CENTER, p.CENTER);
            p.text(fit(n.stage.label, 11, n.w - 16), n.x, n.y - (n.stage.detail ? 9 : 0));

            if (n.stage.detail) {
              p.fill(145);
              p.text(fit(n.stage.detail, 9, n.w - 14), n.x, n.y + 11);
            }
          }

          // ── the travelling token: WHERE information is, never what it is ──
          const i0 = Math.min(Math.floor(pos), last);
          const i1 = Math.min(i0 + 1, last);
          const t = pos - i0;
          const a = nodes[i0]!;
          const b = nodes[i1]!;
          const tx = a.x + (b.x - a.x) * t;
          const ty = a.y + (b.y - a.y) * t;
          p.noStroke();
          p.fill('#F0E442');
          p.circle(tx, ty, 11);
          p.fill('#F0E44255');
          p.circle(tx, ty, 20);

          // ── footer: what is and is not being claimed ─────────────────────
          p.noStroke();
          p.fill(140);
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            `${stages.length} stages from ${spec.specPath.split('/').pop()} · ` +
              (features.rows.length
                ? `${features.rows.length} real bars loaded · `
                : 'bars not needed — ') +
              `flow only, no values are computed for this model`,
            18,
            p.height - 10,
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
  }, [stages, loopTo, beatStage, features.rows.length, spec.specPath, onProgress, ready]);

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
      aria-label={`${spec.name} — information flow across ${stages.length} stages`}
    />
  );
}

export default StageFlow;
