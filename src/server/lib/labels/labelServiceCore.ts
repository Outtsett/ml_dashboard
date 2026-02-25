/**
 * Label Service Core — backward-compatible barrel.
 *
 * Re-exports from focused modules:
 *  - labelGenerator.ts   (generation + contrastive labels)
 *  - labelPreview.ts     (chart preview without persistence)
 *  - labelRepository.ts  (CRUD for persisted label sets)
 */

export {
  generateLabels,
  generateLabelSQL,
  getCategoryForGenerator,
  isContrastiveGenerator,
  calculateLabelDistribution,
  type LabelGenerationRequest,
  type LabelGenerationResult,
} from './labelGenerator';

export {
  previewLabels,
  type LabelPreviewRequest,
} from './labelPreview';

export {
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
} from './labelRepository';

// Composed service object for backward compat
import { generateLabels } from './labelGenerator';
import { previewLabels } from './labelPreview';
import { getLabelSets, getLabelSetById, getContrastivePairsForLabelSet, deleteLabelSet } from './labelRepository';

export const labelService = {
  generateLabels,
  previewLabels,
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
};
