/**
 * `POST /api/training/control/:modelId`, `GET /api/training/cycle` and
 * `GET /api/training/cycle/:modelId` — the three Model Cycle routes added to
 * `training.router.ts`.
 *
 * The NestJS DI bridge (`getNestApp().get(TrainingService)`) is mocked so
 * this is a route-contract test (status codes + response shape for each
 * `TrainingService.control` outcome), not an end-to-end training run.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { TrainingService } from '../training/training.service';
import { resetCycleAccumulatorForTests } from '../training/cycle';

const controlMock = vi.fn();

vi.mock('../infrastructure/lib/nest-context', () => ({
  getNestApp: () => ({
    get: (Cls: unknown) => {
      if (Cls === TrainingService) {
        return { control: controlMock, getSession: () => undefined, listSessions: () => [] };
      }
      throw new Error(`unmocked NestJS token in test: ${String(Cls)}`);
    },
  }),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetCycleAccumulatorForTests();
  // Imported after the mock is registered so training.router.ts's
  // `getNestApp` calls resolve to the fake above.
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

describe('POST /training/control/:modelId', () => {
  it('400s on an invalid command', async () => {
    const res = await fetch(`${baseUrl}/training/control/MNQ_5m_xgboost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'not_a_real_command' }),
    });
    expect(res.status).toBe(400);
    expect(controlMock).not.toHaveBeenCalled();
  });

  it('404s when the service reports no_session', async () => {
    controlMock.mockReturnValueOnce('no_session');
    const res = await fetch(`${baseUrl}/training/control/nope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pause' }),
    });
    expect(res.status).toBe(404);
    expect(controlMock).toHaveBeenCalledWith('nope', { command: 'pause' });
  });

  it('409s when the service reports not_supported', async () => {
    controlMock.mockReturnValueOnce('not_supported');
    const res = await fetch(`${baseUrl}/training/control/MNQ_5m_xgboost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'resume' }),
    });
    expect(res.status).toBe(409);
  });

  it('202s with {delivered:true} when the service delivers it', async () => {
    controlMock.mockReturnValueOnce('delivered');
    const res = await fetch(`${baseUrl}/training/control/MNQ_5m_xgboost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pace', barsPerSecond: 200 }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ delivered: true });
    expect(controlMock).toHaveBeenCalledWith('MNQ_5m_xgboost', { command: 'pace', barsPerSecond: 200 });
  });

  it('accepts the stop command', async () => {
    controlMock.mockReturnValueOnce('delivered');
    const res = await fetch(`${baseUrl}/training/control/MNQ_5m_xgboost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'stop' }),
    });
    expect(res.status).toBe(202);
  });
});

describe('GET /training/cycle and /training/cycle/:modelId', () => {
  it('lists no runs before any have been tracked', async () => {
    const res = await fetch(`${baseUrl}/training/cycle`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('404s a snapshot request for an untracked model', async () => {
    const res = await fetch(`${baseUrl}/training/cycle/never-started`);
    expect(res.status).toBe(404);
  });
});
