/**
 * tests/server/deployments/mlbridgeClient.test.ts
 *
 * Verifies the W9.b MLBridge REQ client against a hand-rolled mock socket.
 * The real zeromq native binary is NEVER loaded — we inject a `socketFactory`
 * via the constructor seam so all tests are deterministic and don't require a
 * running MLBridge server on tcp://127.0.0.1:5555.
 *
 * Cases:
 *   1. Happy path — request is JSON-encoded; reply is parsed + schema-validated
 *   2. Timeout   — receive() never resolves; client throws MLBridgeError('TIMEOUT')
 *                  AND closes the socket so the REQ state machine is clean
 *   3. Invalid   — server returns malformed JSON / schema-violating payload;
 *                  client throws MLBridgeError('INVALID_RESPONSE')
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MLBridgeClient,
  MLBridgeError,
  type ZmqRequestLike,
  type PredictRequest,
} from '../../../src/server/deployments/mlbridgeClient';

interface MockSocket extends ZmqRequestLike {
  sent: string[];
  connectCalls: number;
  closeCalls: number;
  /** Override the next receive() — return a buffer or throw. */
  nextReply: (() => Promise<Buffer[]>) | null;
}

function makeMockSocket(): MockSocket {
  const socket: MockSocket = {
    sent: [],
    connectCalls: 0,
    closeCalls: 0,
    nextReply: null,
    connect(_endpoint: string) {
      this.connectCalls += 1;
    },
    async send(msg: string | Buffer) {
      this.sent.push(typeof msg === 'string' ? msg : msg.toString('utf-8'));
    },
    async receive(): Promise<Buffer[]> {
      if (!this.nextReply) {
        // Default: hang forever — the client's timeout race must win.
        return new Promise<Buffer[]>(() => {});
      }
      return this.nextReply();
    },
    close() {
      this.closeCalls += 1;
    },
  };
  return socket;
}

const VALID_REQUEST: PredictRequest = {
  version_id: 42,
  symbol: 'MNQ',
  timeframe: '1m',
  features: [1.0, 2.0, 3.0, 4.0, 5.0],
  ts: 1_700_000_000_000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('MLBridgeClient', () => {
  it('encodes the request as JSON and parses a well-formed reply', async () => {
    const socket = makeMockSocket();
    socket.nextReply = async () => [
      Buffer.from(
        JSON.stringify({ prediction: 0.73, confidence: 0.91, model_version: 'v_042' }),
        'utf-8',
      ),
    ];
    const client = new MLBridgeClient({
      endpoint: 'tcp://127.0.0.1:5555',
      timeoutMs: 1000,
      socketFactory: () => socket,
    });

    const reply = await client.predict(VALID_REQUEST);

    expect(reply).toEqual({ prediction: 0.73, confidence: 0.91, model_version: 'v_042' });
    expect(socket.connectCalls).toBe(1);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual(VALID_REQUEST);
    client.close();
  });

  it('throws MLBridgeError(TIMEOUT) when receive() exceeds timeoutMs and resets the socket', async () => {
    const socket = makeMockSocket();
    // nextReply stays null -> receive() hangs forever.
    const client = new MLBridgeClient({
      endpoint: 'tcp://127.0.0.1:5555',
      timeoutMs: 25, // tight — keeps the test fast
      socketFactory: () => socket,
    });

    await expect(client.predict(VALID_REQUEST)).rejects.toMatchObject({
      name: 'MLBridgeError',
      code: 'TIMEOUT',
    });

    // After a timeout, the REQ socket is reset (closed) so the next predict()
    // can re-establish a fresh state machine.
    expect(socket.closeCalls).toBe(1);
  });

  it('throws MLBridgeError(INVALID_RESPONSE) when the reply violates the Zod schema', async () => {
    const socket = makeMockSocket();
    socket.nextReply = async () => [
      Buffer.from(
        // confidence out of range (Zod schema enforces 0..1)
        JSON.stringify({ prediction: 1, confidence: 1.5, model_version: 'v_bad' }),
        'utf-8',
      ),
    ];
    const client = new MLBridgeClient({
      endpoint: 'tcp://127.0.0.1:5555',
      timeoutMs: 1000,
      socketFactory: () => socket,
    });

    let caught: unknown;
    try {
      await client.predict(VALID_REQUEST);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MLBridgeError);
    expect((caught as MLBridgeError).code).toBe('INVALID_RESPONSE');
  });

  it('throws MLBridgeError(INVALID_RESPONSE) on malformed JSON', async () => {
    const socket = makeMockSocket();
    socket.nextReply = async () => [Buffer.from('not-json-at-all', 'utf-8')];
    const client = new MLBridgeClient({
      endpoint: 'tcp://127.0.0.1:5555',
      timeoutMs: 1000,
      socketFactory: () => socket,
    });

    await expect(client.predict(VALID_REQUEST)).rejects.toMatchObject({
      name: 'MLBridgeError',
      code: 'INVALID_RESPONSE',
    });
  });
});
