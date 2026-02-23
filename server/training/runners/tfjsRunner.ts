/**
 * TF.js Runner — Wraps the in-process MLTrainer for CNN models.
 *
 * Translates MLTrainer's EventEmitter 'progress' events into
 * the standardized TrainingEvent format.
 */

import type { ResolvedTrainingConfig, TrainingSession } from "@shared/trainingTypes";
import { createSession, emitSessionEvent } from "./types";
import type { ITrainerRunner } from "./types";
import { getTrainingConfig } from "../registry";

export class TfjsRunner implements ITrainerRunner {
  private sessions = new Map<string, TrainingSession>();

  async start(config: ResolvedTrainingConfig): Promise<TrainingSession> {
    const session = createSession(config.modelId, config);
    this.sessions.set(session.sessionId, session);

    // Import MLTrainer lazily (it pulls in @tensorflow/tfjs-node)
    const { trainer } = await import("../../ml/trainer");

    // Extract CNN-specific hyperparameters
    const hp = config.hyperparameters;
    const epochs = (hp.epochs as number) ?? 50;
    const batchSize = (hp.batchSize as number) ?? 32;

    const universalConfig: Record<string, unknown> = {
      symbol: config.symbol,
      timeframeSec: config.timeframeSec,
      maxBars: getTrainingConfig().limits.maxBarsDefault,
      sequenceLength: (hp.sequenceLength as number) ?? 60,
      trainSplit: (hp.trainSplit as number) ?? 0.8,
    };

    const cnnOverrides: Record<string, unknown> = {
      learningRate: (hp.learningRate as number) ?? 0.0005,
      dropoutRate: (hp.dropoutRate as number) ?? 0.3,
    };

    // Listen for MLTrainer progress events and translate
    const progressHandler = (progress: any) => {
      if (progress.status === "error") {
        emitSessionEvent(session, "error", {
          message: progress.message || "Training error",
        });
        session.finished = true;
        session.exitCode = 1;
        cleanup();
        return;
      }

      if (progress.status === "completed") {
        emitSessionEvent(session, "done", {
          modelId: config.modelId,
          elapsedSec: progress.elapsedMs ? progress.elapsedMs / 1000 : (Date.now() - session.startedAt) / 1000,
        });
        session.finished = true;
        session.exitCode = 0;
        cleanup();
        return;
      }

      // Regular epoch progress → metric event
      emitSessionEvent(session, "metric", {
        iteration: progress.epoch,
        totalIterations: progress.totalEpochs,
        metrics: {
          loss: progress.loss,
          valLoss: progress.valLoss,
          accuracy: progress.accuracy,
          valAccuracy: progress.valAccuracy,
        },
      });

      // Also emit progress
      emitSessionEvent(session, "progress", {
        phase: "training",
        step: progress.epoch,
        totalSteps: progress.totalEpochs,
        pct: Math.round((progress.epoch / progress.totalEpochs) * 100),
        message: `Epoch ${progress.epoch}/${progress.totalEpochs} — loss: ${progress.loss?.toFixed(4)}, val_loss: ${progress.valLoss?.toFixed(4)}`,
      });
    };

    const cleanup = () => {
      trainer.removeListener("progress", progressHandler);
      const retentionMs = (getTrainingConfig().limits.jobRetentionSec ?? 120) * 1000;
      setTimeout(() => this.sessions.delete(session.sessionId), retentionMs);
    };

    trainer.on("progress", progressHandler);

    // Start training (runs async in background)
    try {
      await trainer.startUniversalTraining(
        config.symbol,
        epochs,
        batchSize,
        universalConfig as any,
        cnnOverrides as any,
      );
    } catch (err: any) {
      emitSessionEvent(session, "error", { message: err.message });
      session.finished = true;
      session.exitCode = 1;
      cleanup();
    }

    return session;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.finished) {
      // MLTrainer has a shouldStop flag
      import("../../ml/trainer").then(({ trainer }) => {
        trainer.stopTraining();
      });
      emitSessionEvent(session, "error", { message: "Training stopped by user" });
      session.finished = true;
      session.exitCode = -1;
      setTimeout(() => this.sessions.delete(sessionId), 10000);
    }
  }

  isActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && !session.finished;
  }

  getSession(sessionId: string): TrainingSession | undefined {
    return this.sessions.get(sessionId);
  }
}
