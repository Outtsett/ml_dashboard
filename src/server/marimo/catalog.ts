/**
 * Notebook catalog — scans every configured root for real marimo notebooks
 * and extracts display metadata, without ever running Python.
 *
 * A file counts as a notebook only when: it is a DIRECT CHILD of a configured
 * root (no recursion — `chart_cnn/pkg` and `chart_cnn/synth` both hold plain
 * modules alongside their notebooks, and only the top-level `.py` files are
 * notebooks), it ends in `.py`, and `marimo.App(` appears in the first 64 KB
 * of its source. This mirrors marimo's own `is_marimo_app()` detection
 * closely enough that what we list is exactly what `marimo run` will serve.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { Logger } from "@nestjs/common";
import { loadNotebooksConfig, type NotebookGroup, type NotebookRoot } from "./config";

const logger = new Logger("MarimoCatalog");

const DETECT_WINDOW_BYTES = 64 * 1024;
const MARIMO_MARKER = "marimo.App(";

export interface NotebookEntry {
  /** Absolute filesystem path. */
  path: string;
  groupSlug: string;
  /** Display grouping, e.g. "Data lake" — from the root's `category`. */
  category: string;
  /** e.g. "datalake/notebooks" — from the root's `repoLabel`. */
  repoLabel: string;
  /** repoLabel + filename, for display without leaking the absolute path. */
  relativePath: string;
  title: string;
  description: string;
  sizeBytes: number;
  modifiedAtIso: string;
  /** The URL to open this notebook through the proxy (gallery mode, ?file=). */
  url: string;
}

export interface CatalogResult {
  notebooks: NotebookEntry[];
  scannedAtIso: string;
}

/** True on Windows, where the filesystem is case-insensitive so path
 *  comparisons (e.g. matching a client-supplied `?file=` back to a catalog
 *  entry) must not be case-sensitive either. */
function normalizeForCompare(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isNotebookSource(source: string): boolean {
  return source.slice(0, DETECT_WINDOW_BYTES).includes(MARIMO_MARKER);
}

/** First `mo.md("""...""")` (or `'''...'''`) block in the source — this is
 *  where a marimo notebook's own header cell lives. */
function extractFirstMarimoMdBlock(source: string): string | null {
  const match = /mo\.md\(\s*r?("""|''')([\s\S]*?)\1\s*\)/.exec(source);
  return match?.[2] ?? null;
}

/** The module docstring, when there is no mo.md header cell to read instead. */
function extractModuleDocstring(source: string): string | null {
  const match = /^(?:#!.*\n)?(?:#[^\n]*\n)*\s*("""|''')([\s\S]*?)\1/.exec(source);
  return match?.[2] ?? null;
}

/** Title = the block's first markdown heading (or its first line, if the
 *  block opens with prose instead of a heading). Description = the next
 *  non-empty line after it. Falls back to the file stem when neither a
 *  mo.md block nor a docstring is found. */
function extractTitleAndDescription(source: string, fallbackStem: string): { title: string; description: string } {
  const block = extractFirstMarimoMdBlock(source) ?? extractModuleDocstring(source);
  if (block) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length > 0) {
      const headingMatch = /^#{1,6}\s+(.+)$/.exec(lines[0]!);
      const title = (headingMatch?.[1] ?? lines[0]!).trim();
      const descriptionLine = lines[1];
      const description = descriptionLine ? descriptionLine.replace(/^#{1,6}\s+/, "").trim() : "";
      if (title) return { title, description };
    }
  }
  return { title: fallbackStem, description: "" };
}

function scanRoot(group: NotebookGroup, root: NotebookRoot): NotebookEntry[] {
  let names: string[];
  try {
    names = readdirSync(root.path);
  } catch (err) {
    logger.warn(`root "${root.path}" (group "${group.slug}") could not be read: ${(err as Error).message}`);
    return [];
  }

  const entries: NotebookEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".py")) continue;
    const filePath = path.join(root.path, name);

    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(filePath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue; // direct children only — no recursion into subdirectories

    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (!isNotebookSource(source)) continue;

    const absolutePath = path.resolve(filePath);
    const stem = name.slice(0, -3);
    const { title, description } = extractTitleAndDescription(source, stem);

    entries.push({
      path: absolutePath,
      groupSlug: group.slug,
      category: root.category,
      repoLabel: root.repoLabel,
      relativePath: `${root.repoLabel}/${name}`,
      title,
      description,
      sizeBytes: stats.size,
      modifiedAtIso: stats.mtime.toISOString(),
      url: `/marimo/${group.slug}/?file=${encodeURIComponent(absolutePath)}`,
    });
  }
  return entries;
}

export function scanCatalog(): CatalogResult {
  const config = loadNotebooksConfig();
  const notebooks: NotebookEntry[] = [];
  for (const group of config.groups) {
    for (const root of group.roots) {
      notebooks.push(...scanRoot(group, root));
    }
  }
  notebooks.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { notebooks, scannedAtIso: new Date().toISOString() };
}

let cache: CatalogResult | null = null;

/** Cached; pass `refresh: true` (the API's `?refresh=1`) to force a rescan —
 *  picks up notebooks added or removed on disk since the last scan. */
export function getCatalog(refresh = false): CatalogResult {
  if (refresh || !cache) cache = scanCatalog();
  return cache;
}

export function getGroupNotebookPaths(slug: string): string[] {
  return getCatalog()
    .notebooks.filter((n) => n.groupSlug === slug)
    .map((n) => n.path);
}

/** Looks up a client-supplied absolute path against the catalog, case-
 *  insensitively on Windows. Used to validate `POST /marimo/editor`. */
export function findNotebookByPath(absolutePath: string): NotebookEntry | undefined {
  const needle = normalizeForCompare(absolutePath);
  return getCatalog().notebooks.find((n) => normalizeForCompare(n.path) === needle);
}
