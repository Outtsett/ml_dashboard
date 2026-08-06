/**
 * ArchetypeId -> lazy component. Waves 2-4 add their engines here; an id with
 * no entry means "researched but not yet animated", which the shell states
 * plainly rather than rendering a blank canvas.
 */

import { lazy } from 'react';
import type { ArchetypeComponentMap } from './types';

export * from './types';

export const ARCHETYPE_COMPONENTS: ArchetypeComponentMap = {
  'cluster-loop': lazy(() =>
    import('./ClusterLoop').then((m) => ({ default: m.ClusterLoop })),
  ),
};
