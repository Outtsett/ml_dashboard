import { type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getEventBus } from '../events/event-bus';
import { log } from '../lib/log';
import type { DomainEvent } from '@shared/event-types';
import * as zmq from 'zeromq';

/**
 * The snapshot every /metrics client receives. It is a running mirror rather
 * than a per-message diff, so a client that connects mid-run sees the whole
 * state immediately instead of waiting for the next update of each field.
 */
interface MetricsSnapshot {
  reward: number;
  loss: number;
  kl: number;
  entropy: number;
  equity: number;
  epsilon: number;
  win_rate: number;
  dist_buy: number;
  dist_sell: number;
  dist_hold: number;
  gpuLoad: number;
  cpuLoad: number;
  ping: number;
  status: 'idle' | 'training' | 'completed' | 'failed';
  symbol: string;
  bars: number;
  span: string;
  progress: number;
  eta: string;
}

/** The four scalars a training event may carry under either payload shape. */
const TRAINING_SCALARS = ['reward', 'loss', 'kl', 'entropy'] as const;

/**
 * Event payloads cross a process boundary, so their fields are unknown until
 * checked. These two narrow without widening to `any`: anything that is not a
 * finite number or a plain object is treated as absent, which is what keeps a
 * malformed publisher from writing NaN into the snapshot every client reads.
 */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function attachMetricsWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Share the same HTTP server, intercept upgrade requests for /metrics
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/metrics') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Keep track of the latest metrics to serve new connections immediately
  const latestPayload: MetricsSnapshot = {
    reward: 0.0,
    loss: 0.0,
    kl: 0.0,
    entropy: 0.0,
    equity: 10000.0,
    epsilon: 1.0,
    win_rate: 0.0,
    dist_buy: 0.0,
    dist_sell: 0.0,
    dist_hold: 0.0,
    gpuLoad: 0,
    cpuLoad: 0,
    ping: 0,
    status: 'idle',
    symbol: 'MNQ',
    bars: 0,
    span: 'N/A',
    progress: 0,
    eta: 'N/A'
  };

  const broadcast = (payload: unknown) => {
    const frame = JSON.stringify(payload);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    });
  };

  const bus = getEventBus();

  // Listen for real PyTorch telemetry from the pythonRunner/parsers
  bus.on('metric', (event: DomainEvent) => {
    const data = asRecord(event.data) ?? {};
    const metrics = asRecord(data.metrics);

    if (metrics) {
      for (const key of TRAINING_SCALARS) {
        const value = asNumber(metrics[key]);
        if (value !== undefined) latestPayload[key] = value;
      }
    } else if (typeof data.name === 'string') {
      const value = asNumber(data.value);
      if (value !== undefined) {
        for (const key of TRAINING_SCALARS) {
          if (data.name.includes(key)) latestPayload[key] = value;
        }
      }
    }

    const iteration = asNumber(data.iteration);
    const total = asNumber(data.total);
    if (iteration && total) {
      latestPayload.progress = Math.min(100, Math.round((iteration / total) * 100));
      latestPayload.bars = iteration;
    }

    latestPayload.status = 'training';
    broadcast(latestPayload);
  });

  bus.on('done', () => {
    latestPayload.status = 'completed';
    broadcast(latestPayload);
  });

  bus.on('error', () => {
    latestPayload.status = 'failed';
    broadcast(latestPayload);
  });

  bus.on('log', (event: DomainEvent) => {
    broadcast({ type: 'log', ...(asRecord(event.data) ?? {}) });
  });

  // Listen to hardware telemetry for CPU/GPU load
  bus.on('system.gpu', (event: DomainEvent) => {
    const utilization = asNumber(asRecord(event.data)?.utilization);
    if (utilization !== undefined) latestPayload.gpuLoad = utilization;
    broadcast(latestPayload);
  });

  bus.on('system.matrix', (event: DomainEvent) => {
    const cpuLoad = asNumber(asRecord(asRecord(event.data)?.cpu)?.load);
    if (cpuLoad !== undefined) {
      latestPayload.cpuLoad = cpuLoad;
      broadcast(latestPayload);
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    log('[WS] Client connected to /metrics', 'ws');
    // Send immediate snapshot on connect
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(latestPayload));
    }
  });

  // ZeroMQ Ultra-Fast Binary Telemetry Stream Listener
  const zmqSub = new zmq.Subscriber();
  zmqSub.connect('tcp://127.0.0.1:5555');
  zmqSub.subscribe('');

  log('[ZMQ] Listening for high-frequency binary telemetry on tcp://127.0.0.1:5555', 'ws');

  /**
   * A telemetry message is one binary frame of at least 40 bytes (ten LE
   * float32s). Anything else is a publisher-side fault, so it is logged rather
   * than dropped in silence — but only the FIRST occurrence of each fault,
   * because this loop runs at telemetry frequency and a misbehaving publisher
   * would otherwise flood the log faster than it could be read.
   */
  const TELEMETRY_FRAME_BYTES = 40;
  let warnedEmptyMessage = false;
  let warnedShortFrame = false;

  (async () => {
    try {
      for await (const frames of zmqSub) {
        const msg = frames[0];

        if (!msg) {
          if (!warnedEmptyMessage) {
            warnedEmptyMessage = true;
            console.warn('[ZMQ] Telemetry message carried no frames — dropping it. Further occurrences are silent.');
          }
          continue;
        }

        if (msg.length < TELEMETRY_FRAME_BYTES) {
          if (!warnedShortFrame) {
            warnedShortFrame = true;
            console.warn(
              `[ZMQ] Telemetry frame too short (${msg.length} bytes, need ${TELEMETRY_FRAME_BYTES}) — dropping it. Further occurrences are silent.`,
            );
          }
          continue;
        }

        latestPayload.loss = msg.readFloatLE(0);
        latestPayload.reward = msg.readFloatLE(4);
        latestPayload.equity = msg.readFloatLE(8);
        latestPayload.epsilon = msg.readFloatLE(12);
        latestPayload.win_rate = msg.readFloatLE(16);
        latestPayload.dist_buy = msg.readFloatLE(20);
        latestPayload.dist_sell = msg.readFloatLE(24);
        latestPayload.dist_hold = msg.readFloatLE(28);
        latestPayload.progress = Math.min(100, Math.round(msg.readFloatLE(32)));
        latestPayload.bars = msg.readFloatLE(36);

        latestPayload.status = 'training';

        // Broadcast instantly
        broadcast(latestPayload);
      }
    } catch (err) {
      console.error('[ZMQ] Telemetry Listener Error:', err);
    }
  })();
}
