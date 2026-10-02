import { Injectable } from '@nestjs/common';
import {
  startTraining,
  stopTraining,
  controlTraining,
  getTrainingSession,
  listTrainingSessions,
} from './orchestrator';
import type { TrainingRequest, TrainingSession } from '@shared/trainingTypes';
import type { CycleControl } from '@shared/cycle/schema';

@Injectable()
export class TrainingService {

  /** Start a training job. Returns immediately with session handle. */
  start(request: TrainingRequest): Promise<{ sessionId: string; modelId: string }> {
    return startTraining(request);
  }

  /** Stop an active training job by model ID. */
  stop(modelId: string): boolean {
    return stopTraining(modelId);
  }

  /** Send a Model Cycle control command (pause/resume/pace/stop) to a running job's stdin. */
  control(modelId: string, command: CycleControl): "delivered" | "no_session" | "not_supported" {
    return controlTraining(modelId, command);
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
