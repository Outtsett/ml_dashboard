/**
 * Engine resolution.
 *
 * Every researched model animates. Which engine draws it depends on how much we
 * can honestly show:
 *
 *   kernelId set + a bespoke engine exists  ->  that engine, with REAL computed
 *                                               values from the real algorithm
 *   otherwise                               ->  StageFlow, which animates the
 *                                               model's real researched stage
 *                                               flow and computes nothing
 *
 * The fallback is not a lookalike substitution: StageFlow renders THIS model's
 * own cited stages, loop shape and beats, and states on the canvas that no
 * values are computed. What it never does is borrow another model's algorithm.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { MechanismSpec } from '../registry';
import type { ArchetypeProps } from './types';

export * from './types';

type Engine = LazyExoticComponent<ComponentType<ArchetypeProps>>;

/** Bespoke engines, keyed by the kernel they genuinely reproduce. */
export const KERNEL_ENGINES: Record<string, Engine> = {
  kmeans: lazy(() =>
    import('./ClusterLoop').then((m) => ({ default: m.ClusterLoop })),
  ),
};

/** The universal flow engine. Drives any spec with two or more stages. */
export const STAGE_FLOW: Engine = lazy(() =>
  import('./StageFlow').then((m) => ({ default: m.StageFlow })),
);

/** Never returns undefined for a researched spec — everything animates. */
export function resolveEngine(spec: MechanismSpec): Engine {
  if (spec.kernelId) {
    const bespoke = KERNEL_ENGINES[spec.kernelId];
    if (bespoke) return bespoke;
  }
  return STAGE_FLOW;
}

/** True when the panel shows real computed values rather than flow alone. */
export function hasLiveKernel(spec: MechanismSpec): boolean {
  return !!(spec.kernelId && KERNEL_ENGINES[spec.kernelId]);
}
