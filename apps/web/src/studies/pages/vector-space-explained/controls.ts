/** Every control on the page, kept in the URL by useStudyControls so a view is linkable. */

import type { Basis, PrincipalComponents, VectorSpaceBody } from "@shared/studies/vector-space-explained";

export type Controls = {
  featureX: string;
  featureY: string;
  /** Direction of the line through the pair's cloud, degrees. */
  angle: number;
  /** Bars included in the variance sum (i = 1 … terms). */
  terms: number;
  /** Reveal the pair's best direction on the plot. */
  showBest: boolean;
  basis: string;
  /** Components kept on the scree. */
  kept: number;
  component: number;
  /** HNSW search step. */
  step: number;
  /** HNSW links per node (M). */
  links: number;
  showLinks: boolean;
};

export const DEFAULTS: Controls = {
  featureX: "volume.volume_causal_zscore",
  featureY: "kinematics.range_log_high_low_causal_zscore",
  angle: 20,
  terms: 40,
  showBest: false,
  basis: "continuous",
  kept: 2,
  component: 1,
  step: 0,
  links: 4,
  showLinks: false,
};

export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

/** One basis: its feature names and blocks, in order, and the principal components of those columns. */
export interface BasisComponents {
  names: string[];
  blocks: string[];
  principal: PrincipalComponents;
}

export interface PartProps {
  body: VectorSpaceBody;
  controls: Controls;
  set: SetControl;
  reset: () => void;
  bases: Record<Basis, BasisComponents>;
}

export function asBasis(value: string): Basis {
  return value === "full" ? "full" : "continuous";
}

/** The index of a feature by name, falling back when a URL names one the run does not have. */
export function featureIndex(body: VectorSpaceBody, name: string, fallback: number): number {
  const found = body.featureNames.indexOf(name);
  return found >= 0 ? found : Math.min(fallback, Math.max(0, body.featureNames.length - 1));
}
