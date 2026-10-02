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
import { RL_HIERARCHICAL_META_BLUEPRINTS } from './rlHierarchicalMeta';
import { RL_MODEL_BASED_BLUEPRINTS } from './rlModelBased';
import { RL_POLICY_VALUE_BLUEPRINTS } from './rlPolicyValue';
import { STATISTICAL_BLUEPRINTS } from './statistical';
import { OPTIMIZATION_BLUEPRINTS } from './optimization';
import { PROBABILISTIC_SYMBOLIC_BLUEPRINTS } from './probabilisticSymbolic';
import { SIMULATION_DECISION_BLUEPRINTS } from './simulationDecision';
import { SUPERVISED_CLASSICAL_BLUEPRINTS } from './supervisedClassical';

const GROUPS: Record<string, ArchGraph>[] = [
  RECURRENT_BLUEPRINTS,
  NEURAL_NETWORK_BLUEPRINTS,
  GENERATIVE_BLUEPRINTS,
  HYBRID_COMPOSITE_BLUEPRINTS,
  SUPERVISED_BLUEPRINTS,
  UNSUPERVISED_BLUEPRINTS,
  SEMI_SUPERVISED_BLUEPRINTS,
  SELF_SUPERVISED_BLUEPRINTS,
  RL_HIERARCHICAL_META_BLUEPRINTS,
  RL_MODEL_BASED_BLUEPRINTS,
  RL_POLICY_VALUE_BLUEPRINTS,
  STATISTICAL_BLUEPRINTS,
  OPTIMIZATION_BLUEPRINTS,
  PROBABILISTIC_SYMBOLIC_BLUEPRINTS,
  SIMULATION_DECISION_BLUEPRINTS,
  SUPERVISED_CLASSICAL_BLUEPRINTS,
];

export const BLUEPRINTS: Record<string, ArchGraph> = Object.assign({}, ...GROUPS);

export function getBlueprint(specId: string): ArchGraph | null {
  return BLUEPRINTS[specId] ?? null;
}
