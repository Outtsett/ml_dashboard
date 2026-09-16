/**
 * Same-origin proxy for every notebook group's `marimo run` (and the editor's
 * `marimo edit`) process — `/marimo/<slug>/**` on :5000 forwards to
 * `127.0.0.1:<pinned port>` with no path rewriting, because marimo's own
 * routing already expects that full path as its `--base-url`.
 *
 * WebSocket upgrades are dispatched manually (the "External WebSocket
 * upgrade" pattern from the http-proxy-middleware README) rather than via
 * its `ws: true` auto-subscribe, so exactly one handler owns the shared
 * httpServer's 'upgrade' event for this feature and it is trivial to reason
 * about: not a `/marimo/` URL -> return immediately and touch nothing, so
 * Vite's HMR socket (`/vite-hmr`), the PTY terminal socket and the metrics
 * socket (`ws.ts`) are never at risk from this listener.
 */

import type { Express } from "express";
import type { Server } from "http";
import type { Socket } from "net";
import { createProxyMiddleware, type RequestHandler } from "http-proxy-middleware";
import { Logger } from "@nestjs/common";
import { loadNotebooksConfig } from "./config";

const logger = new Logger("MarimoProxy");

type MarimoProxyHandler = RequestHandler & { upgrade: (req: import("http").IncomingMessage, socket: Socket, head: Buffer) => void };

const proxiesBySlug = new Map<string, MarimoProxyHandler>();

/** Pure — extracts the group slug from a request URL, or null when the URL
 *  is not one of ours. Exported so the dispatch logic is unit-testable
 *  without a real HTTP server or socket. */
export function matchMarimoSlug(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = /^\/marimo\/([a-z0-9][a-z0-9-]*)(?:\/|\?|$)/.exec(url);
  return match ? match[1]! : null;
}

/** Mounts one proxy per configured group (+ the editor pseudo-group) and
 *  wires the shared httpServer's 'upgrade' event to dispatch to the right
 *  one. Call once, before Vite's SPA catch-all so a proxied path is never
 *  shadowed by the dashboard's own index.html. */
export function registerMarimoProxies(app: Express, httpServer: Server): void {
  const config = loadNotebooksConfig();
  const targets = [
    ...config.groups.map((g) => ({ slug: g.slug, port: g.port })),
    { slug: config.editor.slug, port: config.editor.port },
  ];

  for (const { slug, port } of targets) {
    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      pathFilter: `/marimo/${slug}`,
    }) as MarimoProxyHandler;
    proxiesBySlug.set(slug, proxy);
    app.use(proxy);
  }

  httpServer.on("upgrade", (req, socket, head) => {
    const slug = matchMarimoSlug(req.url);
    if (!slug) return; // not ours — leave the event for Vite HMR / PTY / metrics listeners

    const proxy = proxiesBySlug.get(slug);
    if (!proxy) {
      logger.warn(`upgrade for unknown marimo group "${slug}" (${req.url}) — closing`);
      socket.destroy();
      return;
    }
    proxy.upgrade(req, socket as Socket, head);
  });

  logger.log(`proxying ${targets.length} marimo group(s) at /marimo/<slug>: ${targets.map((t) => `${t.slug}:${t.port}`).join(", ")}`);
}
