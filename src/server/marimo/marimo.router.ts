/**
 * Marimo notebook routes — HTTP layer only.
 *
 * SRP: parse + validate via Zod, dispatch to catalog.ts / servers.ts,
 * format the response. No process-management logic here — that lives in
 * servers.ts; no filesystem scanning here — that lives in catalog.ts.
 *
 * Routes (mounted at /api by routes.ts, so the paths below are relative to
 * that):
 *   GET  /marimo/notebooks?refresh=1
 *     -> { groups: [{ slug, label, python, cwd, port, status, error? }],
 *          notebooks: NotebookEntry[] }
 *   POST /marimo/groups/:slug/start   -> { status, url } (waits for ready)
 *   GET  /marimo/groups/:slug/status  -> { status, error? }
 *   POST /marimo/editor { path }      -> { url } (path must be a catalog notebook)
 *   POST /marimo/groups/:slug/stop    -> { status }
 *
 * Errors: standard { error } envelope; 400 for invalid input, 404 for an
 * unknown group/path, 500 (with the group's own error message) when a
 * marimo process failed to become ready.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { loadNotebooksConfig } from "./config";
import { getCatalog, findNotebookByPath } from "./catalog";
import { startGroup, stopGroup, getGroupStatus, listGroupStatuses, startEditor, getEditorStatus } from "./servers";

const router = Router();
const logger = new Logger("MarimoRoutes");

router.use(queryRateLimiter);

function slugParamSchema() {
  const config = loadNotebooksConfig();
  const slugs = config.groups.map((g) => g.slug) as [string, ...string[]];
  return z.object({ slug: z.enum(slugs) });
}

const editorBodySchema = z.object({
  path: z.string().min(1),
});

router.get("/marimo/notebooks", (req: Request, res: Response) => {
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const catalog = getCatalog(refresh);
  const groups = listGroupStatuses().map((runtime) => {
    const config = loadNotebooksConfig();
    const group = config.groups.find((g) => g.slug === runtime.slug)!;
    return {
      slug: group.slug,
      label: group.label,
      python: group.python,
      cwd: group.cwd,
      port: group.port,
      status: runtime.status,
      error: runtime.error,
    };
  });
  res.json({ groups, notebooks: catalog.notebooks });
});

router.post("/marimo/groups/:slug/start", async (req: Request, res: Response) => {
  const parsed = slugParamSchema().safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "unknown notebook group", details: parsed.error.flatten() });
    return;
  }
  try {
    const runtime = await startGroup(parsed.data.slug);
    if (runtime.status === "error") {
      res.status(500).json({ error: runtime.error ?? "group failed to start" });
      return;
    }
    res.json({ status: runtime.status, url: `/marimo/${runtime.slug}/` });
  } catch (err) {
    logger.error(`start group "${parsed.data.slug}" failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/marimo/groups/:slug/status", (req: Request, res: Response) => {
  const parsed = slugParamSchema().safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "unknown notebook group", details: parsed.error.flatten() });
    return;
  }
  const runtime = getGroupStatus(parsed.data.slug);
  res.json({ status: runtime.status, error: runtime.error });
});

router.post("/marimo/groups/:slug/stop", async (req: Request, res: Response) => {
  const parsed = slugParamSchema().safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "unknown notebook group", details: parsed.error.flatten() });
    return;
  }
  const runtime = await stopGroup(parsed.data.slug);
  res.json({ status: runtime.status });
});

router.post("/marimo/editor", async (req: Request, res: Response) => {
  const parsed = editorBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  const notebook = findNotebookByPath(parsed.data.path);
  if (!notebook) {
    res.status(404).json({ error: `"${parsed.data.path}" is not a catalog notebook` });
    return;
  }
  try {
    const runtime = await startEditor(notebook.path);
    if (runtime.status === "error") {
      res.status(500).json({ error: runtime.error ?? "editor failed to start" });
      return;
    }
    res.json({ url: "/marimo/editor/" });
  } catch (err) {
    logger.error(`start editor for "${notebook.path}" failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/marimo/editor/status", (_req: Request, res: Response) => {
  const runtime = getEditorStatus();
  res.json({ status: runtime.status, error: runtime.error, currentFile: runtime.currentFile });
});

export default router;
