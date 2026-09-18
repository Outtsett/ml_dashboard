/**
 * Blueprint registry — catalog spec id -> the architecture that spec describes.
 *
 * One file per corpus group; this only merges them. `getBlueprint` is TOTAL in
 * the honest sense: a graph, or null — never a sibling's diagram standing in.
 */

import type { ArchGraph } from '../types';
import { RECURRENT_BLUEPRINTS } from './recurrent';
import { NEURAL_NETWORK_BLUEPRINTS } from './neuralNetwork';
import { GENERATIVE_BLUEPRINTS } from './generative';
import { HYBRID_COMPOSITE_BLUEPRINTS } from './hybridComposite';
import { SUPERVISED_BLUEPRINTS } from './supervised';
import { UNSUPERVISED_BLUEPRINTS } from './unsupervised';
import { SEMI_SUPERVISED_BLUEPRINTS } from './semiSupervised';
import { SELF_SUPERVISED_BLUEPRINTS } from './selfSupervised';

const GROUPS: Record<string, ArchGraph>[] = [
  RECURRENT_BLUEPRINTS,
  NEURAL_NETWORK_BLUEPRINTS,
  GENERATIVE_BLUEPRINTS,
  HYBRID_COMPOSITE_BLUEPRINTS,
  SUPERVISED_BLUEPRINTS,
  UNSUPERVISED_BLUEPRINTS,
  SEMI_SUPERVISED_BLUEPRINTS,
  SELF_SUPERVISED_BLUEPRINTS,
];

export const BLUEPRINTS: Record<string, ArchGraph> = Object.assign({}, ...GROUPS);

export function getBlueprint(specId: string): ArchGraph | null {
  return BLUEPRINTS[specId] ?? null;
}
