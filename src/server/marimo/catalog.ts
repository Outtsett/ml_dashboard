/**
 * Notebook catalog — scans every configured root for real marimo notebooks
 * and extracts display metadata, without ever running Python.
 *
 * A file counts as a notebook only when it ends in `.py` and `marimo.App(`
 * appears in the first 64 KB of its source. That marker is what separates a
 * notebook from the plain modules sitting beside it (`chart_cnn/pkg` and
 * `chart_cnn/synth` hold both), and it mirrors marimo's own `is_marimo_app()`
 * closely enough that what we list is exactly what `marimo run` will serve.
 *
 * The scan descends up to MAX_SCAN_DEPTH levels below each root, skipping
 * generated directories, so a notebook filed in a subfolder is still found —
 * before 2026-09-15 it was simply absent from the dashboard with nothing said.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { Logger } from "@nestjs/common";
import { configChangedOnDisk, loadNotebooksConfig, type NotebookGroup, type NotebookRoot } from "./config";

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
  /** When the file was created, from the filesystem (NTFS records it). Falls
   *  back to the modified time on a filesystem that does not. */
  createdAtIso: string;
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

/** First `mo.md("""...""")` block in the source — where a marimo notebook's own
 *  header cell lives.
 *
 *  The prefix class is `[rRfFbBuU]{0,2}`, not `r?`, and that is the whole point:
 *  the regex used to accept only a bare or raw string, so a header written as
 *  `mo.md(f"""# …""")` was skipped and the scan ran on to the NEXT mo.md block —
 *  giving the notebook the title of an unrelated section. Measured 2026-09-15:
 *  12 notebooks on this machine open with an f-string header, and
 *  findings_casebook.py was listed as "0 · Every recent finding, and what it
 *  means in dollars" (its second cell) instead of "The last three weeks, on the
 *  tape". An f-string header is the normal way to write one — it is how a
 *  notebook puts its own numbers in its title. */
function extractFirstMarimoMdBlock(source: string): string | null {
  const match = /mo\.md\(\s*[rRfFbBuU]{0,2}("""|''')([\s\S]*?)\1\s*\)/.exec(source);
  return match?.[2] ?? null;
}

/** The module docstring, when there is no mo.md header cell to read instead. */
function extractModuleDocstring(source: string): string | null {
  const match = /^(?:#!.*\n)?(?:#[^\n]*\n)*\s*("""|''')([\s\S]*?)\1/.exec(source);
  return match?.[2] ?? null;
}

/** An f-string header can carry `{expression}` placeholders. The catalog reads
 *  source, never runs it, so the value is unknowable here — show the surrounding
 *  words rather than a raw Python expression in the notebook list. */
function cleanInterpolation(text: string): string {
  return text.replace(/\{[^{}]*\}/g, "…").replace(/\s+/g, " ").trim();
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
      const title = cleanInterpolation((headingMatch?.[1] ?? lines[0]!).trim());
      const descriptionLine = lines[1];
      const description = descriptionLine
        ? cleanInterpolation(descriptionLine.replace(/^#{1,6}\s+/, "").trim())
        : "";
      if (title) return { title, description };
    }
  }
  return { title: fallbackStem, description: "" };
}

/** Directories that hold generated or vendored files, never research. */
const SKIP_DIRECTORIES = new Set([
  "__pycache__", "__marimo__", ".ipynb_checkpoints", ".git", ".venv", "venv",
  "node_modules", ".pytest_cache", ".mypy_cache", ".ruff_cache", "wandb", "dist", "build",
]);

/** How deep below a root a notebook is still found. A root is a notebook folder,
 *  not a whole repository, so this is generous rather than unbounded. */
const MAX_SCAN_DEPTH = 3;

function scanRoot(group: NotebookGroup, root: NotebookRoot, directory = root.path, depth = 0): NotebookEntry[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (err) {
    logger.warn(`root "${directory}" (group "${group.slug}") could not be read: ${(err as Error).message}`);
    return [];
  }

  const entries: NotebookEntry[] = [];
  for (const name of names) {
    const filePath = path.join(directory, name);

    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(filePath);
    } catch {
      continue;
    }

    // Recurse. Scanning direct children only meant a notebook filed one folder
    // down was invisible to the dashboard with no error anywhere — it simply was
    // not in the list, which is the hardest kind of missing to notice.
    if (stats.isDirectory()) {
      if (depth >= MAX_SCAN_DEPTH || SKIP_DIRECTORIES.has(name) || name.startsWith(".")) continue;
      entries.push(...scanRoot(group, root, filePath, depth + 1));
      continue;
    }
    if (!stats.isFile() || !name.endsWith(".py")) continue;

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
    const relative = path.relative(root.path, filePath).split(path.sep).join("/");

    entries.push({
      path: absolutePath,
      groupSlug: group.slug,
      category: root.category,
      repoLabel: root.repoLabel,
      relativePath: `${root.repoLabel}/${relative}`,
      title,
      description,
      sizeBytes: stats.size,
      modifiedAtIso: stats.mtime.toISOString(),
      createdAtIso: (stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime).toISOString(),
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
  // Newest work first: the notebook you just wrote is the one you want to open,
  // and a research library sorted by filename buries it next to a 2024 audit.
  notebooks.sort((a, b) => b.modifiedAtIso.localeCompare(a.modifiedAtIso));
  return { notebooks, scannedAtIso: new Date().toISOString() };
}

let cache: CatalogResult | null = null;

/** How long a scan is trusted before the filesystem is walked again. Short
 *  enough that a notebook saved a moment ago is in the list by the time you
 *  switch tabs; long enough that a burst of requests does not re-read ~50 files
 *  each time. */
const CATALOG_TTL_MS = 15_000;

/** The catalog, rescanned when it is stale, when notebooks.json has changed, or
 *  when the caller asks (the API's `?refresh=1`).
 *
 *  It used to cache forever, so a new notebook never appeared without a restart
 *  or a hand-typed refresh parameter — which meant "write a notebook, see it on
 *  the dashboard" was not actually true. */
export function getCatalog(refresh = false): CatalogResult {
  const stale = !cache
    || refresh
    || configChangedOnDisk()
    || Date.now() - Date.parse(cache.scannedAtIso) > CATALOG_TTL_MS;
  if (stale) cache = scanCatalog();
  return cache!;
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
