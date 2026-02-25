import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuestDBService } from '../database/questdb.service';
import { DuckDBService } from '../database/duckdb.service';
import {
  startTraining,
  stopTraining,
  getTrainingSession,
  listTrainingSessions,
} from './orchestrator';
import type { TrainingRequest, TrainingSession } from '@shared/trainingTypes';

@Injectable()
export class TrainingService {
  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(QuestDBService) private questdb: QuestDBService,
    @Inject(DuckDBService) private duckdb: DuckDBService,
  ) {}

  /** Start a training job. Returns immediately with session handle. */
  start(request: TrainingRequest): Promise<{ sessionId: string; modelId: string }> {
    return startTraining(request);
  }

  /** Stop an active training job by model ID. */
  stop(modelId: string): boolean {
    return stopTraining(modelId);
  }

  /** Get an active/recent training session. */
  getSession(modelId: string): TrainingSession | undefined {
    return getTrainingSession(modelId);
  }

  /** List all active and recently-completed training sessions. */
  listSessions() {
    return listTrainingSessions();
  }
}
