/**
 * Same-origin proxy for every sidecar: `<proxyPrefix>/**` on :5000 forwards to
 * `127.0.0.1:<port>/**` with the prefix stripped (`/api/live/quotes` ->
 * `/quotes`). Mounted before the body parsers, like the marimo proxy, so a POST
 * body reaches the sidecar unconsumed; exempt from compression and the 30 s
 * request timeout in main.ts, because both sidecars stream server-sent events.
 *
 * A request that arrives while the sidecar is down starts it first (bounded by
 * the sidecar's ready timeout) rather than failing — the Claude panel opens a
 * session on first use, and the live hub may be mid-restart after a crash.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { Logger } from "@nestjs/common";
import { loadSidecarsConfig } from "./config";
import { ensureSidecar, sidecarStatus } from "./supervisor";

const logger = new Logger("SidecarProxy");

export function isSidecarPath(pathname: string): boolean {
  return loadSidecarsConfig().sidecars.some((s) => pathname === s.proxyPrefix || pathname.startsWith(`${s.proxyPrefix}/`));
}

export function registerSidecarProxies(app: Express): void {
  for (const sidecar of loadSidecarsConfig().sidecars) {
    const prefix = sidecar.proxyPrefix;

    app.use(prefix, async (req: Request, res: Response, next: NextFunction) => {
      if (sidecarStatus(sidecar.slug) === "ready") return next();
      try {
        const runtime = await ensureSidecar(sidecar.slug);
        if (runtime.status === "ready") return next();
        res.status(503).json({ error: `${sidecar.label} is not running`, detail: runtime.error ?? runtime.status });
      } catch (err) {
        res.status(503).json({ error: `${sidecar.label} could not be started`, detail: (err as Error).message });
      }
    });

    const proxy = createProxyMiddleware<Request, Response>({
      target: `http://127.0.0.1:${sidecar.port}`,
      changeOrigin: true,
      // app.use(prefix, ...) already strips the prefix from req.url; keep the
      // rest of the path exactly as sent.
      proxyTimeout: 0,
      on: {
        error: (err, _req, res) => {
          logger.warn(`${sidecar.slug}: ${err.message}`);
          const response = res as Response;
          if (typeof response.status === "function" && !response.headersSent) {
            response.status(502).json({ error: `${sidecar.label} did not answer`, detail: err.message });
          }
        },
      },
    });
    app.use(prefix, proxy);
  }
}
