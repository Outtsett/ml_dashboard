/**
 * MLBridge ZMQ REQ client (W9.b).
 *
 * Talks to the MLBridge Rust scoring engine over a ZMQ REQ/REP socket. The
 * engine binds `tcp://127.0.0.1:5555` (REP side) by default; override with the
 * `MLBRIDGE_ENDPOINT` env var.
 *
 * Wire protocol (JSON, UTF-8, single frame each direction):
 *   request : { version_id, symbol, timeframe, features: float[], ts }
 *   reply   : { prediction: number|string, confidence: float (0..1), model_version: str }
 *
 * Timeout: zeromq 6.x has no per-call receive timeout, so we race
 * `socket.receive()` against `setTimeout`. On timeout we recreate the socket
 * because REQ/REP is strict-state and a timed-out REQ cannot send again until
 * a matching reply (or socket reset) clears the state machine.
 *
 * Singleton accessor `getMLBridgeClient()` keeps one socket per server
 * process — opening a fresh REQ socket per HTTP request would burn TCP
 * handshakes and break the lifecycle loop's steady-state polling pattern.
 */

import { Request as ZmqRequest } from 'zeromq';
import { z } from 'zod';

// ─── Wire schemas ──────────────────────────────────────────────────────────

export const PredictRequestSchema = z.object({
  version_id: z.number().int().positive(),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  features: z.array(z.number()).min(1),
  ts: z.number().int().nonnegative(),
});
export type PredictRequest = z.infer<typeof PredictRequestSchema>;

export const PredictResponseSchema = z.object({
  prediction: z.union([z.number(), z.string()]),
  confidence: z.number().min(0).max(1),
  model_version: z.string().min(1),
});
export type PredictResponse = z.infer<typeof PredictResponseSchema>;

// ─── Error class ───────────────────────────────────────────────────────────

export type MLBridgeErrorCode = 'TIMEOUT' | 'NETWORK' | 'INVALID_RESPONSE';

export class MLBridgeError extends Error {
  readonly code: MLBridgeErrorCode;
  readonly cause?: unknown;
  constructor(code: MLBridgeErrorCode, message: string, cause?: unknown) {
    super(`[MLBridge ${code}] ${message}`);
    this.name = 'MLBridgeError';
    this.code = code;
    this.cause = cause;
  }
}

// ─── Client ────────────────────────────────────────────────────────────────

/**
 * Minimal subset of the zeromq Request socket surface that we depend on. Kept
 * narrow so tests can hand-roll a mock without dragging the full native binary.
 */
export interface ZmqRequestLike {
  connect(endpoint: string): void;
  send(msg: string | Buffer): Promise<void>;
  receive(): Promise<Buffer[]>;
  close(): void;
}

export interface MLBridgeClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  /** Test seam — inject a custom socket factory. */
  socketFactory?: () => ZmqRequestLike;
}

export class MLBridgeClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly socketFactory: () => ZmqRequestLike;
  private socket: ZmqRequestLike | null = null;
  private connected = false;

  constructor(options: MLBridgeClientOptions = {}) {
    this.endpoint = options.endpoint ?? 'tcp://127.0.0.1:5555';
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.socketFactory = options.socketFactory ?? (() => new ZmqRequest() as unknown as ZmqRequestLike);
  }

  /**
   * Lazily open the REQ socket. ZMQ `connect()` is non-blocking — the actual
   * TCP handshake happens on first send, so this never throws on a missing
   * server; instead the first predict() will time out.
   */
  async connect(): Promise<void> {
    if (this.connected && this.socket) return;
    try {
      this.socket = this.socketFactory();
      this.socket.connect(this.endpoint);
      this.connected = true;
    } catch (err) {
      throw new MLBridgeError('NETWORK', `failed to connect to ${this.endpoint}`, err);
    }
  }

  /**
   * Send one predict request and wait for the reply.
   *
   * On timeout the socket is hard-reset because the REQ state machine forbids
   * a second send until the matching reply arrives — without reset, the next
   * call would throw "Cannot send another message until a reply has been
   * received."
   */
  async predict(req: PredictRequest): Promise<PredictResponse> {
    const validated = PredictRequestSchema.parse(req);
    await this.connect();
    if (!this.socket) {
      throw new MLBridgeError('NETWORK', 'socket unavailable after connect');
    }

    const payload = JSON.stringify(validated);

    try {
      await this.socket.send(payload);
    } catch (err) {
      this.resetSocket();
      throw new MLBridgeError('NETWORK', 'send failed', err);
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new MLBridgeError('TIMEOUT', `no reply within ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    let frames: Buffer[];
    try {
      frames = await Promise.race([this.socket.receive(), timeoutPromise]);
    } catch (err) {
      this.resetSocket();
      if (err instanceof MLBridgeError) throw err;
      throw new MLBridgeError('NETWORK', 'receive failed', err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!frames.length || !frames[0]) {
      throw new MLBridgeError('INVALID_RESPONSE', 'empty frame');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(frames[0].toString('utf-8'));
    } catch (err) {
      throw new MLBridgeError('INVALID_RESPONSE', 'reply is not valid JSON', err);
    }

    const validatedReply = PredictResponseSchema.safeParse(parsed);
    if (!validatedReply.success) {
      throw new MLBridgeError(
        'INVALID_RESPONSE',
        `reply failed schema: ${validatedReply.error.issues.map((i) => i.message).join('; ')}`,
        validatedReply.error,
      );
    }
    return validatedReply.data;
  }

  /**
   * Reset the socket after an error so the next predict() can establish a
   * clean REQ state. Synchronous — close() never throws meaningfully.
   */
  private resetSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
    }
    this.socket = null;
    this.connected = false;
  }

  close(): void {
    this.resetSocket();
  }
}

// ─── Singleton accessor ────────────────────────────────────────────────────

let singleton: MLBridgeClient | null = null;

export function getMLBridgeClient(): MLBridgeClient {
  if (!singleton) {
    singleton = new MLBridgeClient({
      endpoint: process.env.MLBRIDGE_ENDPOINT,
      timeoutMs: process.env.MLBRIDGE_TIMEOUT_MS
        ? Number.parseInt(process.env.MLBRIDGE_TIMEOUT_MS, 10)
        : undefined,
    });
  }
  return singleton;
}

/** Test-only: blow away the cached singleton so a fresh client (or mock) is built next call. */
export function resetMLBridgeClientForTests(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
