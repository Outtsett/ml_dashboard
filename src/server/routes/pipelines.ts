import { Router, type Request, type Response } from 'express';
import { EventStore } from '../events/event-store.js';
import { db } from '../database/db.js';
import type { StoredEvent, PipelineStatus, PipelineType } from '@shared/event-types';

const router = Router();
const eventStore = new EventStore(db as any);

// ── Derive pipeline status from its event stream ────────────
interface PipelineState {
  pipelineId: string;
  pipelineType: PipelineType;
  status: PipelineStatus;
  currentStep: string | null;
  completedSteps: string[];
  error: string | null;
  config: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
  totalDurationMs: number | null;
}

function derivePipelineState(events: StoredEvent[]): PipelineState | null {
  if (events.length === 0) return null;

  const first = events[0]!;
  const startData = first.data as Record<string, unknown>;

  const state: PipelineState = {
    pipelineId: (startData.pipelineId as string) ?? first.streamId,
    pipelineType: (startData.pipelineType as PipelineType) ?? 'training',
    status: 'idle',
    currentStep: null,
    completedSteps: [],
    error: null,
    config: (startData.config as Record<string, unknown>) ?? {},
    startedAt: first.createdAt,
    updatedAt: first.createdAt,
    totalDurationMs: null,
  };

  for (const evt of events) {
    state.updatedAt = evt.createdAt;
    const data = evt.data as Record<string, unknown>;

    switch (evt.type) {
      case 'pipeline.started':
        state.status = 'running';
        state.pipelineType = (data.pipelineType as PipelineType) ?? state.pipelineType;
        state.config = (data.config as Record<string, unknown>) ?? state.config;
        break;

      case 'pipeline.step.started':
        state.currentStep = data.step as string;
        break;

      case 'pipeline.step.completed':
        state.completedSteps.push(data.step as string);
        state.currentStep = null;
        break;

      case 'pipeline.step.failed':
        state.status = 'failed';
        state.error = data.error as string;
        state.currentStep = null;
        break;

      case 'pipeline.completed':
        state.status = 'completed';
        state.totalDurationMs = (data.totalDurationMs as number) ?? null;
        state.currentStep = null;
        break;

      case 'pipeline.failed':
        state.status = 'failed';
        state.error = data.error as string;
        state.currentStep = null;
        break;

      case 'pipeline.compensating':
        state.status = 'compensating';
        break;

      case 'pipeline.compensated':
        state.status = 'compensated';
        break;

      case 'pipeline.paused':
        state.status = 'paused';
        state.currentStep = data.step as string;
        break;

      case 'pipeline.resumed':
        state.status = 'running';
        state.currentStep = data.step as string;
        break;
    }
  }

  return state;
}

// ── GET /api/pipelines — list all pipelines ─────────────────
router.get('/pipelines', async (_req: Request, res: Response) => {
  try {
    // Read all pipeline.started events to discover pipelines
    const startedEvents = await eventStore.readByType('pipeline.started');

    // Derive current state for each pipeline from its full event stream
    const pipelines: PipelineState[] = [];
    for (const evt of startedEvents) {
      const streamEvents = await eventStore.readStream(evt.streamId);
      const state = derivePipelineState(streamEvents);
      if (state) pipelines.push(state);
    }

    res.json(pipelines);
  } catch (error) {
    console.error('Error listing pipelines:', error);
    res.status(500).json({ error: 'Failed to list pipelines' });
  }
});

// ── GET /api/pipelines/:id/events — event log for a pipeline
router.get('/pipelines/:id/events', async (req: Request, res: Response) => {
  try {
    const streamId = req.params.id!;
    const events = await eventStore.readStream(streamId);

    if (events.length === 0) {
      res.status(404).json({ error: `No events found for pipeline: ${streamId}` });
      return;
    }

    res.json(events);
  } catch (error) {
    console.error('Error reading pipeline events:', error);
    res.status(500).json({ error: 'Failed to read pipeline events' });
  }
});

// ── GET /api/pipelines/:id/state — derived current state ────
router.get('/pipelines/:id/state', async (req: Request, res: Response) => {
  try {
    const streamId = req.params.id!;
    const events = await eventStore.readStream(streamId);

    if (events.length === 0) {
      res.status(404).json({ error: `No events found for pipeline: ${streamId}` });
      return;
    }

    const state = derivePipelineState(events);
    res.json(state);
  } catch (error) {
    console.error('Error deriving pipeline state:', error);
    res.status(500).json({ error: 'Failed to derive pipeline state' });
  }
});

export default router;
