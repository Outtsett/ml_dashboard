/**
 * Marimo notebook routes — HTTP layer only.
 *
 * SRP: parse + validate via Zod, dispatch to catalog.ts / servers.ts /
 * health.ts / store.ts / template.ts, format the response. No process
 * management, filesystem scanning or persistence here.
 *
 * Routes (mounted at /api by routes.ts, so the paths below are relative to
 * that):
 *   GET  /marimo/notebooks?refresh=1
 *     -> { groups: GroupView[], notebooks: NotebookView[], roots: RootView[],
 *          idleStopMinutes, healthQueue: { queued, running } }
 *   GET  /marimo/search?q=<text>      -> { query, results: [{ id, title, relativePath, total, matches }] }
 *   GET  /marimo/lineage              -> { datasets: [{ name, kind, notebooks: [{ id, title, relativePath }] }] }
 *   POST /marimo/pins { path, pinned } -> { pinnedPaths }
 *   POST /marimo/health/check { paths } -> { queued } (empty paths = every notebook)
 *   POST /marimo/health/cancel        -> { cancelled }
 *   POST /marimo/notebooks/new { rootPath, fileName, title, description } -> { path, id } (201)
 *   POST /marimo/groups/:slug/start   -> { status, url } (waits for ready; ?wait=0 answers 202 at once)
 *   GET  /marimo/groups/:slug/status  -> { status, error? }
 *   POST /marimo/editor { path }      -> { url } (path must be a catalog notebook)
 *   POST /marimo/groups/:slug/stop    -> { status }
 *
 * Errors: standard { error } envelope; 400 for invalid input, 404 for an
 * unknown group/path, 409 when a new notebook's file already exists, 500 (with
 * the group's own error message) when a marimo process failed to become ready.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Logger } from "@nestjs/common";
import { queryRateLimiter } from "../infrastructure/lib/rateLimiter";
import { loadNotebooksConfig } from "./config";
import { getCatalog, findNotebookByPath, notebookId, notebookSource } from "./catalog";
import {
  startGroup,
  stopGroup,
  getGroupStatus,
  listGroupStatuses,
  startEditor,
  getEditorStatus,
  groupMemoryBytes,
  groupHasPinnedNotebook,
  expectedStartupSeconds,
  warmGroup,
} from "./servers";
import { activityOf } from "./activity";
import { cancelHealthChecks, healthQueueSize, queueHealthChecks } from "./health";
import { healthOf, isPinned, pruneHealth, samePath, setPinned } from "./store";
import { searchSource, type DatasetKind } from "./lineage";
import { cachedGitState, refreshGitStatus } from "./git";
import { validateFileName, writeNotebookFromTemplate } from "./template";

const router = Router();
const logger = new Logger("MarimoRoutes");

// Scoped to the notebook paths: an unscoped router.use on a router mounted at
// /api limited EVERY /api request that passed through this router, not just these.
router.use("/marimo", queryRateLimiter);

function slugParamSchema() {
  const config = loadNotebooksConfig();
  const slugs = config.groups.map((g) => g.slug) as [string, ...string[]];
  return z.object({ slug: z.enum(slugs) });
}

const editorBodySchema = z.object({
  path: z.string().min(1),
});

const pinBodySchema = z.object({
  path: z.string().min(1),
  pinned: z.boolean(),
});

const healthCheckBodySchema = z.object({
  paths: z.array(z.string().min(1)).max(500).default([]),
});

const newNotebookBodySchema = z.object({
  rootPath: z.string().min(1),
  fileName: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(600).default(""),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

router.get("/marimo/notebooks", async (req: Request, res: Response) => {
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const config = loadNotebooksConfig();
  await refreshGitStatus(config.groups.flatMap((g) => g.roots.map((r) => r.path)), refresh);
  const catalog = getCatalog(refresh);
  pruneHealth(catalog.notebooks.map((n) => n.path));
  const memory = await groupMemoryBytes();
  const nowMs = Date.now();

  const groups = listGroupStatuses().map((runtime) => {
    const group = config.groups.find((g) => g.slug === runtime.slug)!;
    const activity = activityOf(group.slug);
    return {
      slug: group.slug,
      label: group.label,
      python: group.python,
      cwd: group.cwd,
      port: group.port,
      status: runtime.status,
      error: runtime.error,
      startingSinceIso: runtime.startingSinceIso,
      lastOutputLine: runtime.lastOutputLine,
      expectedStartupSeconds: expectedStartupSeconds(group.slug),
      stoppedForIdleAtIso: runtime.stoppedForIdleAtIso,
      memoryBytes: memory.get(group.slug) ?? null,
      openConnections: activity.openConnections,
      idleSeconds: runtime.status === "ready" && activity.openConnections === 0
        ? Math.round((nowMs - activity.lastActivityMs) / 1000)
        : null,
      keptWarm: groupHasPinnedNotebook(group.slug),
    };
  });

  const notebooks = catalog.notebooks.map((notebook) => ({
    ...notebook,
    gitState: cachedGitState(notebook.path),
    pinned: isPinned(notebook.path),
    health: healthOf(notebook.path) ?? null,
  }));

  const roots = config.groups.flatMap((group) =>
    group.roots.map((root) => ({ groupSlug: group.slug, groupLabel: group.label, path: root.path, category: root.category, repoLabel: root.repoLabel })),
  );

  res.json({ groups, notebooks, roots, idleStopMinutes: config.idleStopMinutes, healthQueue: healthQueueSize() });
});

router.get("/marimo/search", (req: Request, res: Response) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "q must be 2 to 120 characters", details: parsed.error.flatten() });
    return;
  }
  const query = parsed.data.q;
  const results = [];
  for (const notebook of getCatalog().notebooks) {
    const source = notebookSource(notebook.path);
    if (!source) continue;
    const { matches, total } = searchSource(source, query);
    if (total === 0) continue;
    results.push({ id: notebook.id, path: notebook.path, title: notebook.title, relativePath: notebook.relativePath, total, matches });
  }
  results.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  res.json({ query, results: results.slice(0, 100), notebookCount: results.length });
});

router.get("/marimo/lineage", (_req: Request, res: Response) => {
  const byDataset = new Map<string, { name: string; kind: DatasetKind; notebooks: Array<{ id: string; title: string; relativePath: string }> }>();
  for (const notebook of getCatalog().notebooks) {
    for (const dataset of notebook.datasets) {
      const key = `${dataset.kind}\u0000${dataset.name}`;
      const entry = byDataset.get(key) ?? { ...dataset, notebooks: [] };
      entry.notebooks.push({ id: notebook.id, title: notebook.title, relativePath: notebook.relativePath });
      byDataset.set(key, entry);
    }
  }
  const datasets = [...byDataset.values()].sort((a, b) => b.notebooks.length - a.notebooks.length || a.name.localeCompare(b.name));
  res.json({ datasets });
});

router.post("/marimo/pins", (req: Request, res: Response) => {
  const parsed = pinBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  const notebook = findNotebookByPath(parsed.data.path);
  if (!notebook) {
    res.status(404).json({ error: `"${parsed.data.path}" is not a catalog notebook` });
    return;
  }
  const pinnedPaths = setPinned(notebook.path, parsed.data.pinned);
  // A pinned notebook's group is kept warm: start it now rather than at the next boot.
  if (parsed.data.pinned) warmGroup(notebook.groupSlug);
  res.json({ pinnedPaths });
});

router.post("/marimo/health/check", (req: Request, res: Response) => {
  const parsed = healthCheckBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  const unknown = parsed.data.paths.filter((p) => !findNotebookByPath(p));
  if (unknown.length > 0) {
    res.status(404).json({ error: `not catalog notebooks: ${unknown.join(", ")}` });
    return;
  }
  res.json({ queued: queueHealthChecks(parsed.data.paths) });
});

router.post("/marimo/health/cancel", (_req: Request, res: Response) => {
  res.json({ cancelled: cancelHealthChecks() });
});

router.post("/marimo/notebooks/new", (req: Request, res: Response) => {
  const parsed = newNotebookBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { rootPath, fileName, title, description } = parsed.data;
  const root = loadNotebooksConfig().groups.flatMap((g) => g.roots).find((r) => samePath(r.path, rootPath));
  if (!root) {
    res.status(404).json({ error: `"${rootPath}" is not a notebook folder in packages/config/notebooks.json` });
    return;
  }
  const nameProblem = validateFileName(fileName, root.path);
  if (nameProblem) {
    res.status(400).json({ error: nameProblem });
    return;
  }
  try {
    const written = writeNotebookFromTemplate(root.path, fileName, title, description);
    getCatalog(true);
    res.status(201).json({ path: written, id: notebookId(written) });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      res.status(409).json({ error: `${fileName}.py already exists in ${root.repoLabel}` });
      return;
    }
    logger.error(`new notebook ${fileName} in ${root.path} failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/marimo/groups/:slug/start", async (req: Request, res: Response) => {
  const parsed = slugParamSchema().safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "unknown notebook group", details: parsed.error.flatten() });
    return;
  }
  // ?wait=0 answers at once and leaves the start running: the page follows it by
  // polling the list. Holding the request open for the whole start (up to a
  // minute) kept one of the browser's six connections to this host busy, and the
  // dashboard's event streams already hold most of the others.
  if (req.query.wait === "0") {
    const slug = parsed.data.slug;
    startGroup(slug).catch((err: Error) => logger.error(`start group "${slug}" failed: ${err.message}`));
    res.status(202).json({ status: getGroupStatus(slug).status, url: `/marimo/${slug}/` });
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
