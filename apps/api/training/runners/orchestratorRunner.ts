import { Logger } from "@nestjs/common";
import WebSocket from "ws";
import { encode, decode } from "@msgpack/msgpack";
import type { ResolvedTrainingConfig, TrainingSession } from "@shared/trainingTypes";
import type { CycleControl } from "@shared/cycle/schema";
import { createSession, emitSessionEvent, type ITrainerRunner } from "./types";
import * as trainingStorage from "../../infrastructure/storage/trainingStorage";

const logger = new Logger("OrchestratorRunner");

export class OrchestratorRunner implements ITrainerRunner {
  private activeSessions = new Map<string, { session: TrainingSession; ws: WebSocket }>();
  private readonly ORCHESTRATOR_URL = "ws://127.0.0.1:5001";

  async start(config: ResolvedTrainingConfig, existingSession?: TrainingSession): Promise<TrainingSession> {
    const sessionId = existingSession?.sessionId || `orch-${Date.now()}`;
    const session = existingSession || createSession(sessionId, config);
    
    logger.log(`Starting orchestrator session ${sessionId} for ${config.modelType}`);
    
    // Connect to Python Orchestrator
    const ws = new WebSocket(this.ORCHESTRATOR_URL);
    
    ws.on("open", () => {
      logger.log(`Connected to ML Orchestrator for session ${sessionId}`);
      emitSessionEvent(session, "info", { message: "Connected to Async ML Orchestrator" });
      
      // Send initial configuration payload
      const initPayload = {
        type: "init",
        sessionId,
        config,
      };
      ws.send(encode(initPayload));
    });

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const payload = decode(data as Uint8Array) as any;
        if (payload.type === "telemetry") {
          // Map Python telemetry to Node.js TrainingEvent format
          emitSessionEvent(session, "metrics", {
            epoch: payload.queue_depth,
            loss: payload.inference?.prediction || 0,
            metrics: {
              fps: payload.fps,
              gpu_util: payload.gpu_util,
              confidence: payload.inference?.confidence,
              volatility: payload.inference?.volatility,
              paradigm: payload.inference?.paradigm
            }
          });
        }
      } catch (err) {
        logger.error(`Error decoding orchestrator message: ${err}`);
      }
    });

    ws.on("close", (code, reason) => {
      logger.log(`Orchestrator connection closed for ${sessionId}. Code: ${code}`);
      session.finished = true;
      session.exitCode = code === 1000 ? 0 : 1;
      emitSessionEvent(session, "info", { message: `Orchestrator closed connection: ${reason}` });
      this.activeSessions.delete(sessionId);
      const dbSessId = (session as any).dbSessionId;
      if (dbSessId) {
        Promise.resolve(trainingStorage.finalizeSession(dbSessId, {
          status: code === 1000 ? "completed" : "failed",
          exitCode: code === 1000 ? 0 : 1,
          elapsedSec: parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1))
        })).catch(e => logger.error("Failed to save session", e));
      }
    });

    ws.on("error", (error) => {
      logger.error(`Orchestrator connection error on ${sessionId}: ${error.message}`);
      session.finished = true;
      session.exitCode = 1;
      emitSessionEvent(session, "error", { message: error.message });
      this.activeSessions.delete(sessionId);
    });

    this.activeSessions.set(sessionId, { session, ws });
    return session;
  }

  stop(sessionId: string): void {
    const record = this.activeSessions.get(sessionId);
    if (record) {
      logger.log(`Stopping orchestrator session ${sessionId}`);
      record.ws.close();
      record.session.finished = true;
      emitSessionEvent(record.session, "info", { message: "Training manually stopped by user" });
      this.activeSessions.delete(sessionId);
    }
  }

  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSession(sessionId: string): TrainingSession | undefined {
    return this.activeSessions.get(sessionId)?.session;
  }

  sendControl(sessionId: string, command: CycleControl): boolean {
    const record = this.activeSessions.get(sessionId);
    if (!record || record.ws.readyState !== WebSocket.OPEN) return false;
    
    // Forward control commands to Python
    record.ws.send(encode({ type: "control", command }));
    return true;
  }
}
