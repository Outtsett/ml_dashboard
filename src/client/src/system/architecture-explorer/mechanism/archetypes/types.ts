/**
 * The archetype contract. Every one of the 17 engines implements exactly this,
 * so the shell never learns anything model-specific.
 *
 * An archetype RECEIVES real features and DRAWS. It never fetches, and it never
 * invents data: any number it renders comes either from its compute kernel or
 * from the researched spec.
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import type { ArchetypeId, MechanismSpec } from '../registry';
import type { FeatureMatrix } from '../data/candleGeometry';

export interface ArchetypeProgress {
  /** Stage currently active, matching a `spec.stages[].id`. */
  stageId: string;
  /** Real iteration index within the mechanism's own loop. */
  iteration: number;
  /** Total iterations the kernel actually ran. */
  totalIterations: number;
  /** What the mechanism's own progress metric is called, e.g. "inertia". */
  metricLabel: string;
  metricValue: number;
  converged: boolean;
}

export interface ArchetypeProps {
  spec: MechanismSpec;
  features: FeatureMatrix;
  playing: boolean;
  /** Increments to advance exactly one step while paused. */
  stepSignal: number;
  /** Playback multiplier, 0.25 .. 4. */
  speed: number;
  /** Beat id the user clicked, or null. Engines highlight its stage. */
  activeBeat: string | null;
  onProgress?: (p: ArchetypeProgress) => void;
}

export type ArchetypeComponentMap = Partial<
  Record<ArchetypeId, LazyExoticComponent<ComponentType<ArchetypeProps>>>
>;
