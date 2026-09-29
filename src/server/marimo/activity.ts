/**
 * Who is using each notebook group right now — counted at the proxy, which
 * every request and WebSocket to a group passes through.
 *
 * A notebook open in a browser holds one WebSocket to its group's kernel for as
 * long as the page is open, so "open connections > 0" means someone is looking
 * at it; the last HTTP request or socket event marks when it was last used. The
 * idle sweep in servers.ts stops a group only when both say nobody is.
 */

import type { Socket } from "net";

interface GroupActivity {
  openConnections: number;
  lastActivityMs: number;
}

const activity = new Map<string, GroupActivity>();

function entry(slug: string): GroupActivity {
  let current = activity.get(slug);
  if (!current) {
    current = { openConnections: 0, lastActivityMs: Date.now() };
    activity.set(slug, current);
  }
  return current;
}

export function noteRequest(slug: string): void {
  entry(slug).lastActivityMs = Date.now();
}

/** Counts a WebSocket until it closes; its close is activity too, because the
 *  idle clock should start when the last viewer leaves, not when they arrived. */
export function noteSocket(slug: string, socket: Socket): void {
  const current = entry(slug);
  current.openConnections++;
  current.lastActivityMs = Date.now();
  let closed = false;
  socket.once("close", () => {
    if (closed) return;
    closed = true;
    current.openConnections = Math.max(0, current.openConnections - 1);
    current.lastActivityMs = Date.now();
  });
}

/** Restarts the idle clock, e.g. when a group has just become ready. */
export function resetActivity(slug: string): void {
  entry(slug).lastActivityMs = Date.now();
}

export function activityOf(slug: string): { openConnections: number; lastActivityMs: number } {
  const current = entry(slug);
  return { openConnections: current.openConnections, lastActivityMs: current.lastActivityMs };
}
