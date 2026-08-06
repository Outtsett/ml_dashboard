import { Injectable, Inject } from '@nestjs/common';
import { QuestDBService } from '../../infrastructure/database/questdb.service';
import { SQLiteService } from '../../infrastructure/database/sqlite.service';
import {
  generateLabels,
  previewLabels,
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
  type LabelGenerationRequest,
  type LabelGenerationResult,
  type LabelPreviewRequest,
} from '../../infrastructure/lib/labels/labelServiceCore';

@Injectable()
export class LabelsService {
  constructor(
    @Inject(QuestDBService) private questdb: QuestDBService,
    @Inject(SQLiteService) private sqlite: SQLiteService,
  ) {}

  /** Generate labels for a symbol using a SQL generator. Stores result in SQLite. */
  generate(request: LabelGenerationRequest): Promise<LabelGenerationResult> {
    return generateLabels(request);
  }

  /** Preview labels without persisting (real-time chart overlay). */
  preview(request: LabelPreviewRequest) {
    return previewLabels(request);
  }

  /** Query stored label sets with optional filters. */
  list(filters?: { symbol?: string; generatorType?: string; modelId?: number; status?: string }) {
    return getLabelSets(filters);
  }

  /** Fetch a single label set by ID. */
  getById(id: number) {
    return getLabelSetById(id);
  }

  /** Fetch contrastive pairs for a label set. */
  getPairs(labelSetId: number, limit = 1000) {
    return getContrastivePairsForLabelSet(labelSetId, limit);
  }

  /** Delete a label set and its associated contrastive pairs. */
  delete(id: number) {
    return deleteLabelSet(id);
  }
}
