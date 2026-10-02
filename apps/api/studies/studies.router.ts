/**
 * Studies: the analytic pages that replaced the marimo notebooks.
 *
 * Routes (mounted under /api):
 *   GET /studies          every study with the lake views it reads and whether each is served
 *   GET /studies/:slug    one study's body for the parsed query: { slug, notes, data }
 *
 * Handlers are looked up in a Map, never a plain object (`constructor` would
 * resolve). A handler that throws answers 500 with its message; a study whose
 * data is not landed answers 200 with a note and empty data, so the page can
 * say what is missing instead of failing.
 */

import { Router, type Request, type Response } from "express";
import { Logger } from "@nestjs/common";
import { LRUCache } from "lru-cache";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { STUDY_HANDLERS } from "./handlers";
import { lake as defaultLake } from "./lake";
import type { StudyHandler, StudyLake, StudyListing, StudyResponse } from "./types";

const logger = new Logger("StudiesRoutes");
const DEFAULT_CACHE_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 120_000;

export function createStudiesRouter(handlers: readonly StudyHandler[] = STUDY_HANDLERS, lake: StudyLake = defaultLake): Router {
  const router = Router();
  const bySlug = new Map<string, StudyHandler>();
  for (const handler of handlers) {
    if (bySlug.has(handler.slug)) throw new Error(`two study handlers share the slug ${handler.slug}`);
    bySlug.set(handler.slug, handler);
  }
  const cache = new LRUCache<string, StudyResponse>({ max: 200, ttlAutopurge: false });

  router.get("/studies", queryRateLimiter, async (_request: Request, response: Response) => {
    try {
      const listing: StudyListing[] = await Promise.all(
        [...bySlug.values()].map(async (handler) => ({
          slug: handler.slug,
          datasets: await Promise.all(handler.datasets.map(async (name) => ({ name, served: await lake.hasView(name) }))),
        })),
      );
      response.json({ studies: listing });
    } catch (error) {
      logger.error(`studies listing: ${String(error)}`);
      response.status(500).json({ error: "Could not list the studies." });
    }
  });

  router.get("/studies/:slug", queryRateLimiter, async (request: Request, response: Response) => {
    const handler = bySlug.get(String(request.params.slug));
    if (!handler) {
      response.status(404).json({ error: `No study named ${JSON.stringify(request.params.slug)}.` });
      return;
    }
    request.setTimeout(handler.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const parsed = handler.query.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      response.status(400).json({ error: issue ? `${issue.path.join(".") || "query"}: ${issue.message}` : "bad request" });
      return;
    }
    const cacheSeconds = handler.cacheSeconds ?? DEFAULT_CACHE_SECONDS;
    const key = `${handler.slug}|${JSON.stringify(parsed.data)}`;
    const hit = cacheSeconds > 0 ? cache.get(key) : undefined;
    if (hit) {
      response.json(hit);
      return;
    }
    try {
      const notes: string[] = [];
      const data = await handler.run(parsed.data, { lake, notes });
      const body: StudyResponse = { slug: handler.slug, notes, data };
      if (cacheSeconds > 0) cache.set(key, body, { ttl: cacheSeconds * 1000 });
      response.set("Cache-Control", "private, max-age=60");
      response.json(body);
    } catch (error) {
      logger.error(`study ${handler.slug}: ${String(error)}`);
      response.status(500).json({ error: `The ${handler.slug} study failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  return router;
}

export default createStudiesRouter();
