/**
 * TreeRoute — watch a real bar fall through a real tree.
 *
 * The tree family's mechanism is ROUTING: a sample is compared against a
 * threshold, sent left or right, and repeats until it lands in a leaf whose
 * class distribution is the answer. A node-and-wire sweep shows none of that.
 *
 * HONESTY CONTRACT:
 *   - The tree is REAL. compute/tree.ts grows CART on the real candle-geometry
 *     rows: exhaustive split search, Gini impurity reduction, real thresholds.
 *     Nothing is seeded and nothing is invented — these bars produce this tree.
 *   - The label is the SIGN OF THE NEXT BAR'S RETURN, a genuine target taken
 *     from the data, and the footer says so.
 *   - The routed path is REAL: the highlighted branch is the comparison chain
 *     the current bar actually takes, and the printed threshold and feature are
 *     the ones it was tested against.
 *   - It is NOT a trained trading model, and the canvas says that too. Depth is
 *     capped at 4 on a few hundred bars; train accuracy is shown as train
 *     accuracy, never as an edge.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { growTree, routePath, type TreeNode } from '../compute/tree';
import type { ArchetypeProps } from './types';

const FRAMES_PER_HOP = 26;

interface Placed {
  node: TreeNode;
  x: number;
  y: number;
}

/** Tidy left-to-right placement by depth, spread by in-order position. */
function place(root: TreeNode | null, w: number, h: number, pad: number): Placed[] {
  if (!root) return [];
  const out: Placed[] = [];
  const leaves: TreeNode[] = [];
  const collectLeaves = (n?: TreeNode) => {
    if (!n) return;
    if (n.feature === null) { leaves.push(n); return; }
    collectLeaves(n.left);
    collectLeaves(n.right);
  };
  collectLeaves(root);
  const slot = new Map<number, number>();
  leaves.forEach((l, i) => slot.set(l.id, i));

  let maxDepth = 0;
  const depthOf = (n?: TreeNode) => {
    if (!n) return;
    maxDepth = Math.max(maxDepth, n.depth);
    depthOf(n.left);
    depthOf(n.right);
  };
  depthOf(root);

  const xFor = (n: TreeNode): number => {
    if (n.feature === null) return slot.get(n.id) ?? 0;
    const l = n.left ? xFor(n.left) : 0;
    const r = n.right ? xFor(n.right) : 0;
    return (l + r) / 2;
  };

  const span = Math.max(leaves.length - 1, 1);
  const walk = (n?: TreeNode) => {
    if (!n) return;
    out.push({
      node: n,
      x: pad + (xFor(n) / span) * (w - pad * 2),
      y: pad + (n.depth / Math.max(maxDepth, 1)) * (h - pad * 2),
    });
    walk(n.left);
    walk(n.right);
  };
  walk(root);
  return out;
}

export function TreeRoute({
  spec, features, playing, stepSignal, speed, forceMotion, onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);
  const live = useRef({ playing, stepSignal, speed, forceMotion });
  live.current = { playing, stepSignal, speed, forceMotion };

  const rows = useMemo(() => features.rows.map((r) => r.values), [features]);
  /** return_z is the column the label is derived from. */
  const returnCol = useMemo(
    () => Math.max(0, features.columns.indexOf('return_z')),
    [features.columns],
  );
  const tree = useMemo(() => growTree(rows, returnCol), [rows, returnCol]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !tree.root) return;
    let disposed = false;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;
      const sketch = (p: p5Types) => {
        let sample = 0;   // which bar is being routed
        let hop = 0;      // how far down its path it has fallen
        let frames = 0;
        let lastStep = live.current.stepSignal;
        let placed: Placed[] = [];
        let path: TreeNode[] = [];

        const relayout = () => {
          placed = place(tree.root, p.width - 260, p.height - 40, 46);
          path = routePath(tree.root, rows[sample] ?? []);
        };

        const report = () => {
          const leaf = path[Math.min(hop, path.length - 1)];
          onProgress?.({
            stageId: spec.stages[Math.min(hop, spec.stages.length - 1)]?.id ?? 'route',
            iteration: hop,
            totalIterations: Math.max(path.length - 1, 0),
            metricLabel: 'gini at node',
            metricValue: leaf?.gini ?? 0,
            converged: hop >= path.length - 1,
          });
        };

        p.setup = () => {
          const r = host.getBoundingClientRect();
          p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          relayout();
          report();
        };

        const advance = () => {
          if (hop < path.length - 1) hop++;
          else { sample = (sample + 1) % Math.max(rows.length, 1); hop = 0; relayout(); }
          report();
        };

        p.draw = () => {
          p.clear();
          if (!placed.length) return;

          if (live.current.stepSignal !== lastStep) {
            lastStep = live.current.stepSignal;
            advance();
            frames = 0;
          } else if (live.current.playing && (!reduced || live.current.forceMotion)) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_HOP) { frames = 0; advance(); }
          }

          const byId = new Map(placed.map((q) => [q.node.id, q]));
          const onPath = new Set(path.slice(0, hop + 1).map((n) => n.id));

          // ── branches ──
          for (const q of placed) {
            for (const child of [q.node.left, q.node.right]) {
              if (!child) continue;
              const c = byId.get(child.id);
              if (!c) continue;
              const lit = onPath.has(q.node.id) && onPath.has(child.id);
              p.stroke(lit ? '#E69F00' : '#4a5262');
              p.strokeWeight(lit ? 2.6 : 1);
              p.line(q.x, q.y, c.x, c.y);
            }
          }

          // ── nodes ──
          for (const q of placed) {
            const n = q.node;
            const lit = onPath.has(n.id);
            const isLeaf = n.feature === null;
            // Leaf fill shows the class split: blue = down-majority,
            // orange = up-majority. Never red/green.
            const up = n.counts[1] > n.counts[0];
            p.noStroke();
            if (isLeaf) {
              p.fill(up ? '#E69F00' : '#0072B2');
              p.circle(q.x, q.y, lit ? 20 : 15);
            } else {
              p.fill(lit ? '#E69F00' : '#5a6373');
              p.rect(q.x - 8, q.y - 8, 16, 16, 3);
            }
            if (lit) {
              p.noFill();
              p.stroke('#F0E442');
              p.strokeWeight(1.6);
              p.circle(q.x, q.y, 28);
            }
          }

          // ── the comparison being made right now ──
          const cur = path[Math.min(hop, path.length - 1)];
          const curPlaced = cur ? byId.get(cur.id) : undefined;
          if (cur && curPlaced) {
            p.noStroke();
            p.fill(235);
            p.textSize(11);
            p.textAlign(p.LEFT, p.CENTER);
            const bar = rows[sample] ?? [];
            const txt =
              cur.feature === null
                ? `leaf · ${cur.counts[0]} down / ${cur.counts[1]} up · gini ${cur.gini.toFixed(3)}`
                : `${features.columns[cur.feature]} = ${(bar[cur.feature] ?? 0).toFixed(3)}` +
                  ` ${(bar[cur.feature] ?? 0) <= cur.threshold ? '<=' : '>'} ${cur.threshold.toFixed(3)}` +
                  ` → ${(bar[cur.feature] ?? 0) <= cur.threshold ? 'left' : 'right'}`;
            p.text(txt, p.width - 250, curPlaced.y);
          }

          // ── readout ──
          p.noStroke();
          p.fill(150);
          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(
            `bar ${sample + 1} / ${rows.length} · depth ${hop} / ${Math.max(path.length - 1, 0)}` +
              ` · ${tree.nodeCount} nodes, max depth ${tree.maxDepth}`,
            18, 12,
          );
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(
            `real CART grown on ${tree.samples} of your bars · label = sign of the NEXT bar's return · ` +
              `train accuracy ${(tree.trainAccuracy * 100).toFixed(1)}% (in-sample, not an edge)`,
            18, p.height - 12,
          );
        };

        p.windowResized = () => {
          const r = host.getBoundingClientRect();
          p.resizeCanvas(Math.max(1, r.width), Math.max(1, r.height));
          relayout();
        };
      };
      p5Ref.current = new P5(sketch, host);
    });

    return () => { disposed = true; p5Ref.current?.remove(); p5Ref.current = null; };
  }, [tree, rows, features.columns, spec.stages, onProgress]);

  if (features.rows.length === 0 || !tree.root) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Not enough complete feature rows to grow a tree yet — the causal z-score
        window needs more bars of history.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — routing real bars through a real tree`}
    />
  );
}

export default TreeRoute;
