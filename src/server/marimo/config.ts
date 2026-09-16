/**
 * Notebook group configuration — src/config/notebooks.json validated + typed.
 *
 * One group = one interpreter + one working directory = one `marimo run`
 * process, pinned to one port, proxied same-origin at /marimo/<slug>. Adding
 * a new root is a JSON edit only (OCP) — no code here changes.
 */

import { readFileSync, statSync } from "fs";
import path from "path";
import { z } from "zod";
import { Logger } from "@nestjs/common";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const NotebookRootSchema = z.object({
  path: z.string().min(1),
  category: z.string().min(1),
  repoLabel: z.string().min(1),
});

const NotebookGroupSchema = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase kebab-case"),
  label: z.string().min(1),
  python: z.string().min(1),
  cwd: z.string().min(1),
  port: z.number().int().positive(),
  roots: z.array(NotebookRootSchema).min(1),
});

const EditorConfigSchema = z.object({
  slug: z.literal("editor"),
  port: z.number().int().positive(),
});

const NotebooksConfigSchema = z.object({
  groups: z.array(NotebookGroupSchema).min(1),
  editor: EditorConfigSchema,
});

export type NotebookRoot = z.infer<typeof NotebookRootSchema>;
export type NotebookGroup = z.infer<typeof NotebookGroupSchema>;
export type EditorConfig = z.infer<typeof EditorConfigSchema>;
export type NotebooksConfig = z.infer<typeof NotebooksConfigSchema>;

const logger = new Logger("MarimoConfig");

const CONFIG_PATH = path.join(process.cwd(), "src", "config", "notebooks.json");

let cached: NotebooksConfig | null = null;
/** Modified time of the file the cache was built from, so an edit is noticed. */
let cachedMtimeMs = 0;

/** Validates cross-field invariants the zod shape alone cannot express:
 *  slugs and ports are each unique across groups + the editor pseudo-group. */
function validateInvariants(config: NotebooksConfig): void {
  const slugs = new Set<string>();
  const ports = new Set<number>();
  for (const group of config.groups) {
    if (slugs.has(group.slug)) {
      throw new Error(`notebooks.json: duplicate group slug "${group.slug}"`);
    }
    slugs.add(group.slug);
    if (ports.has(group.port)) {
      throw new Error(`notebooks.json: port ${group.port} is used by more than one group (collision at "${group.slug}")`);
    }
    ports.add(group.port);
  }
  if (slugs.has(config.editor.slug)) {
    throw new Error(`notebooks.json: editor slug "${config.editor.slug}" collides with a group slug`);
  }
  if (ports.has(config.editor.port)) {
    throw new Error(`notebooks.json: editor port ${config.editor.port} collides with a group port`);
  }
}

export function parseNotebooksConfig(raw: unknown): NotebooksConfig {
  const config = NotebooksConfigSchema.parse(raw);
  validateInvariants(config);
  return config;
}

/** Loads + validates src/config/notebooks.json, re-reading it whenever the file
 *  on disk has changed.
 *
 *  It used to cache for the lifetime of the process, which meant adding a group
 *  or a root did nothing until someone restarted the server — and worse, said
 *  nothing about why. Measured 2026-09-15: `adorn` was deleted from the file and
 *  the running dashboard still listed it and its notebooks. The stat is one
 *  syscall on a file that is read a few times a minute; correctness is worth it.
 *  A malformed edit keeps the last good config rather than taking the feature
 *  down mid-save. */
export function loadNotebooksConfig(options: { refresh?: boolean } = {}): NotebooksConfig {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(CONFIG_PATH).mtimeMs;
  } catch {
    // Unreadable: keep whatever was last parsed rather than throwing here.
    if (cached) return cached;
  }
  if (cached && !options.refresh && mtimeMs === cachedMtimeMs) return cached;

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    cached = parseNotebooksConfig(raw);
    cachedMtimeMs = mtimeMs;
  } catch (err) {
    if (!cached) throw err;
    logger.warn(`notebooks.json is not usable, keeping the previous config: ${(err as Error).message}`);
  }
  return cached!;
}

/** True when notebooks.json has changed since the config cache was built —
 *  the catalog uses this to know its own scan is stale. */
export function configChangedOnDisk(): boolean {
  try {
    return statSync(CONFIG_PATH).mtimeMs !== cachedMtimeMs;
  } catch {
    return false;
  }
}

export function findGroup(config: NotebooksConfig, slug: string): NotebookGroup | undefined {
  return config.groups.find((g) => g.slug === slug);
}
