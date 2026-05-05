import type { Response } from 'express';
import type { DomainEvent } from '@shared/event-types';
import type { EventBus } from './event-bus';

// ── Channel definitions ─────────────────────────────────────
export type SSEChannel = 'pipeline' | 'training' | 'system';

const CHANNEL_PATTERNS: Record<SSEChannel, string[]> = {
  pipeline: ['pipeline.', 'market.'],
  training: ['training.'],
  system: ['cache.', 'system.', 'model.', 'ingestion.'],
};

const ALL_CHANNELS: SSEChannel[] = ['pipeline', 'training', 'system'];

// ── Client tracking ─────────────────────────────────────────
interface SSEClient {
  channel: SSEChannel;
  res: Response;
}

// ── Keepalive interval (ms) ─────────────────────────────────
const KEEPALIVE_MS = 15_000;

// ── SSEAdapter ──────────────────────────────────────────────
export class SSEAdapter {
  private clients: Map<SSEChannel, Set<SSEClient>> = new Map();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private bus: EventBus) {
    // Initialize client sets for each channel
    for (const ch of ALL_CHANNELS) {
      this.clients.set(ch, new Set());
    }

    // Subscribe to all events via onAny and broadcast
    this.bus.onAny((event: DomainEvent) => {
      this.broadcast(event);
    });

    // Start keepalive timer
    this.keepaliveTimer = setInterval(() => {
      this.sendKeepalive();
    }, KEEPALIVE_MS);
  }

  /** Register a new SSE client on a channel. */
  addClient(channel: SSEChannel, res: Response): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client: SSEClient = { channel, res };
    this.clients.get(channel)!.add(client);

    // Send connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ channel })}\n\n`);

    // Cleanup on disconnect
    res.on('close', () => {
      this.clients.get(channel)!.delete(client);
    });
  }

  /** Count connected clients for a channel. */
  clientCount(channel: SSEChannel): number {
    return this.clients.get(channel)?.size ?? 0;
  }

  /** Match event type against channel patterns and send to matching clients. */
  private broadcast(event: DomainEvent): void {
    for (const channel of ALL_CHANNELS) {
      const patterns = CHANNEL_PATTERNS[channel];
      const matches = patterns.some((prefix) => event.type.startsWith(prefix));
      if (!matches) continue;

      const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      const clients = this.clients.get(channel)!;
      for (const client of clients) {
        try {
          client.res.write(payload);
        } catch (e) {
          console.warn('[sse] Dead client, removing:', (e as Error).message);
          clients.delete(client);
        }
      }
    }
  }

  /** Send keepalive comment to all connected clients. */
  private sendKeepalive(): void {
    const comment = `: keepalive ${Date.now()}\n\n`;
    for (const channel of ALL_CHANNELS) {
      const clients = this.clients.get(channel)!;
      for (const client of clients) {
        try {
          client.res.write(comment);
        } catch (e) {
          console.warn('[sse] Stale client detected during keepalive, removing:', (e as Error).message);
          clients.delete(client);
        }
      }
    }
  }

  /** Shutdown: clear keepalive, close all connections. */
  shutdown(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    for (const channel of ALL_CHANNELS) {
      const clients = this.clients.get(channel)!;
      for (const client of clients) {
        client.res.end();
      }
      clients.clear();
    }
  }
}
