/**
 * `POST /api/training/start` accepts what the Model Cycle form sends: a tuned run
 * posts `tuning_pinned_parameters` as "" when nothing is pinned and as
 * "max_depth,learning_rate" when two dials are held. The hyperparameter value
 * guard once required a non-empty value without commas, which refused every
 * default tuned start with 400 "Unsafe hyperparameter value". The guard still
 * refuses shell metacharacters (the runner spawns with an argument array, but
 * the guard is the stated contract).
 *
 * The NestJS bridge is mocked: this is a route-contract test, not a training run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { TrainingService } from '../training/training.service';

const startMock = vi.fn(async (request: { modelType: string; symbol: string }) => ({
  sessionId: `${request.symbol}_5m_${request.modelType}_test`,
  modelId: `${request.symbol}_5m_${request.modelType}_test`,
}));

vi.mock('../infrastructure/lib/nest-context', () => ({
  getNestApp: () => ({
    get: (Cls: unknown) => {
      if (Cls === TrainingService) return { start: startMock, getSession: () => undefined, listSessions: () => [] };
      throw new Error(`unmocked NestJS token in test: ${String(Cls)}`);
    },
  }),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: trainingRouter } = await import('../training/training.router');
  const app = express();
  app.use(express.json());
  app.use('/api', trainingRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterAll(() => {
  server.close();
});

function start(hyperparameters: Record<string, unknown>) {
  return fetch(`${baseUrl}/training/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelType: 'xgboost+walk_forward_cycle', symbol: 'MNQ', timeframe: '5m', hyperparameters }),
  });
}

describe('POST /training/start — Model Cycle hyperparameters', () => {
  it('accepts a default tuned run: nothing pinned is an empty string', async () => {
    const res = await start({ tuning_mode: 'tuned', tuning_budget_trials: 20, tuning_pinned_parameters: '' });
    expect(res.status).toBe(202);
    expect(startMock).toHaveBeenLastCalledWith(expect.objectContaining({
      hyperparameters: expect.objectContaining({ tuning_pinned_parameters: '' }),
    }));
  });

  it('accepts two pinned dials, comma separated', async () => {
    const res = await start({ tuning_mode: 'tuned', tuning_pinned_parameters: 'max_depth,learning_rate' });
    expect(res.status).toBe(202);
  });

  it('still refuses shell metacharacters in a value', async () => {
    for (const value of ['max_depth;calc', 'a b', '$(whoami)', 'a|b']) {
      const res = await start({ tuning_pinned_parameters: value });
      expect(res.status, value).toBe(400);
      expect((await res.json()).error).toContain('Unsafe hyperparameter value');
    }
  });
});
