/**
 * Requests the server makes to itself (the per-tab event stream opens each real
 * stream as a loopback request — apps/api/stream/mux.ts) carry a secret made
 * fresh in every process. A request is internal only when it carries that exact
 * secret AND arrived over the loopback interface, so a browser cannot claim to be
 * one: it never sees the secret.
 *
 * Internal requests skip the per-IP rate limiters. The browser's own request
 * that asked for the stream was already counted, and counting its loopback twin
 * again halved the budget every tab on 127.0.0.1 shares.
 */

import { randomBytes } from "crypto";
import type { Request } from "express";

export const INTERNAL_REQUEST_HEADER = "x-internal-request";
export const internalRequestToken = randomBytes(24).toString("hex");

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isInternalRequest(req: Request): boolean {
  return req.headers[INTERNAL_REQUEST_HEADER] === internalRequestToken && LOOPBACK.has(req.socket.remoteAddress ?? "");
}
