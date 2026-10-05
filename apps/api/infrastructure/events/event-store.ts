import { eq, gt, and, asc, sql, like } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { events } from '@shared/schema';
import type { StoredEvent, NewEvent, EventMetadata } from '@shared/event-types';

type DrizzleDb = BetterSQLite3Database<Record<string, unknown>>;

/**
 * Convert a raw DB row into a typed StoredEvent.
 * `data` and `metadata` are stored as JSON strings — parse them here.
 */
function toStoredEvent(row: typeof events.$inferSelect): StoredEvent {
  return {
    id: row.id,
    streamId: row.streamId,
    streamPosition: row.streamPosition,
    type: row.type,
    version: row.version,
    data: JSON.parse(row.data) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as EventMetadata,
    createdAt: row.createdAt,
  };
}

/**
 * Append-only event store backed by SQLite via Drizzle.
 *
 * Optimistic concurrency is enforced by the UNIQUE(stream_id, stream_position)
 * constraint — if two writers race for the same position, one gets a constraint
 * violation and must retry.
 */
export class EventStore {
  constructor(private db: DrizzleDb) {}

  /**
   * Append one or more events to a stream.
   *
   * @param streamId         Identifies the aggregate / process stream.
   * @param expectedPosition The caller's last-known position (-1 for new streams).
   *                         Events will be written starting at expectedPosition + 1.
   * @param newEvents        Events to append (data & metadata will be JSON-serialised).
   * @returns The stored events (with assigned ids and positions).
   * @throws On UNIQUE constraint violation (optimistic concurrency conflict).
   */
  async appendToStream(
    streamId: string,
    expectedPosition: number,
    newEvents: NewEvent[],
  ): Promise<StoredEvent[]> {
    const rows = newEvents.map((evt, i) => ({
      streamId,
      streamPosition: expectedPosition + 1 + i,
      type: evt.type,
      version: evt.version ?? 1,
      data: JSON.stringify(evt.data),
      metadata: JSON.stringify(evt.metadata),
    }));

    // Insert all rows inside a transaction for atomicity.
    // The UNIQUE constraint on (stream_id, stream_position) rejects stale writes.
    const inserted = await this.db.transaction(async (tx) => {
      const results: StoredEvent[] = [];
      for (const row of rows) {
        const [result] = await tx.insert(events).values(row).returning();
        results.push(toStoredEvent(result!));
      }
      return results;
    });

    return inserted;
  }

  /**
   * Read all events for a stream, ordered by position.
   *
   * @param streamId     The stream to read.
   * @param fromPosition Start reading from this position (inclusive). Defaults to 0.
   */
  async readStream(streamId: string, fromPosition = 0): Promise<StoredEvent[]> {
    const rows = await this.db
          .select()
          .from(events)
          .where(
            and(
              eq(events.streamId, streamId),
              sql`${events.streamPosition} >= ${fromPosition}`,
            ),
          )
          .orderBy(asc(events.streamPosition));

    return rows.map(toStoredEvent);
  }

  /**
   * Read events of a given type across all streams.
   *
   * @param type    Event type string (e.g. 'pipeline.started').
   * @param afterId Only return events with id > afterId (cursor pagination).
   */
  async readByType(type: string, afterId?: number): Promise<StoredEvent[]> {
    const conditions = [eq(events.type, type)];
    if (afterId !== undefined) {
      conditions.push(gt(events.id, afterId));
    }

    const rows = await this.db
          .select()
          .from(events)
          .where(and(...conditions))
          .orderBy(asc(events.id));

    return rows.map(toStoredEvent);
  }

  /**
   * Read all events in insertion order.
   *
   * @param afterId Only return events with id > afterId (cursor pagination).
   */
  async readAll(afterId?: number): Promise<StoredEvent[]> {
    const condition = afterId !== undefined ? gt(events.id, afterId) : undefined;

    const rows = await this.db
          .select()
          .from(events)
          .where(condition)
          .orderBy(asc(events.id));

    return rows.map(toStoredEvent);
  }

  /**
   * Get the current highest stream_position for a stream.
   *
   * @returns The highest position, or -1 if the stream has no events.
   */
  async getStreamPosition(streamId: string): Promise<number> {
    const [row] = await this.db
          .select({ maxPos: sql<number>`MAX(${events.streamPosition})` })
          .from(events)
          .where(eq(events.streamId, streamId));

    return row?.maxPos ?? -1;
  }

  /**
   * Find streams matching a prefix that were started but never reached a
   * terminal state (completed / failed / compensated).
   *
   * Useful for crash-recovery: find pipelines that need to be resumed or
   * rolled back after a server restart.
   */
  async findIncompleteStreams(prefix: string): Promise<StoredEvent[]> {
    // Step 1: find all distinct stream IDs matching the prefix
    const allStreams = await this.db
          .selectDistinct({ streamId: events.streamId })
          .from(events)
          .where(like(events.streamId, `${prefix}%`));

    if (allStreams.length === 0) return [];

    // Step 2: find streams that contain a terminal event
    const completedStreams = await this.db
          .selectDistinct({ streamId: events.streamId })
          .from(events)
          .where(
            and(
              like(events.streamId, `${prefix}%`),
              sql`(${events.type} LIKE '%.completed' OR ${events.type} LIKE '%.failed' OR ${events.type} LIKE '%.compensated')`,
            ),
          );

    const completedIds = new Set(completedStreams.map((r) => r.streamId));

    // Step 3: filter to incomplete streams
    const incompleteIds = allStreams
      .map((r) => r.streamId)
      .filter((id) => !completedIds.has(id));

    if (incompleteIds.length === 0) return [];

    // Step 4: return the latest event from each incomplete stream
    // (gives the caller enough context to decide what to do)
    const results: StoredEvent[] = [];
    for (const sid of incompleteIds) {
      const [latest] = await this.db
              .select()
              .from(events)
              .where(eq(events.streamId, sid))
              .orderBy(asc(events.streamPosition))
              .limit(1);

      if (latest) {
        results.push(toStoredEvent(latest));
      }
    }

    return results;
  }
}

