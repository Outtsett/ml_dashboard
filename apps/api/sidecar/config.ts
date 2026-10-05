/**
 * Sidecar configuration — packages/config/sidecars.json validated + typed.
 *
 * A sidecar is a long-lived process the dashboard owns but does not host in its
 * own event loop: the live data hub (Python — sockets, FinBERT on the GPU) and
 * the Claude Code host (Node — Agent SDK sessions). Each is pinned to one port
 * and proxied same-origin under its `proxyPrefix`, so the browser never learns
 * the port. They live outside the dev server because `tsx --watch` restarts it
 * on every server-file save: a stream socket, a scoring job or a Claude session
 * inside it would die on each edit, and the Claude session is the thing making
 * those edits.
 */

import { readFileSync, statSync } from "fs";
import path from "path";
import { z } from "zod";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const SidecarSchema = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be lowercase kebab-case"),
  label: z.string().min(1),
  description: z.string().default(""),
  port: z.number().int().min(1024).max(19999),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  proxyPrefix: z.string().regex(/^\/api\/[a-z0-9-]+$/, "proxyPrefix must be /api/<name>"),
  autostart: z.boolean().default(false),
  readyTimeoutSeconds: z.number().int().positive().default(60),
});

const SidecarsConfigSchema = z.object({ sidecars: z.array(SidecarSchema).min(1) });

export type Sidecar = z.infer<typeof SidecarSchema>;
export type SidecarsConfig = z.infer<typeof SidecarsConfigSchema>;

const CONFIG_PATH = path.join(process.cwd(), "packages", "config", "sidecars.json");

let cached: SidecarsConfig | null = null;
let cachedMtimeMs = 0;

/** Slugs, ports and prefixes must each be unique — two sidecars on one port
 *  would adopt each other's process. */
export function parseSidecarsConfig(raw: unknown): SidecarsConfig {
  const config = SidecarsConfigSchema.parse(raw);
  for (const key of ["slug", "port", "proxyPrefix"] as const) {
    const seen = new Set<unknown>();
    for (const sidecar of config.sidecars) {
      if (seen.has(sidecar[key])) throw new Error(`sidecars.json: ${key} ${String(sidecar[key])} is used twice`);
      seen.add(sidecar[key]);
    }
  }
  return config;
}

export function loadSidecarsConfig(): SidecarsConfig {
  const mtime = statSync(CONFIG_PATH).mtimeMs;
  if (!cached || mtime !== cachedMtimeMs) {
    cached = parseSidecarsConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
    cachedMtimeMs = mtime;
  }
  return cached;
}

export function findSidecar(slug: string): Sidecar | undefined {
  return loadSidecarsConfig().sidecars.find((s) => s.slug === slug);
}

/** The command resolved against the repo root when it is a relative path
 *  (`.venv/Scripts/python.exe`); a bare name (`node`) is left for PATH. */
export function resolveCommand(sidecar: Sidecar): string {
  const looksRelative = sidecar.command.startsWith(".") || sidecar.command.includes("/") || sidecar.command.includes("\\");
  return looksRelative ? path.resolve(process.cwd(), sidecar.command) : sidecar.command;
}

export function resolveCwd(sidecar: Sidecar): string {
  return path.resolve(process.cwd(), sidecar.cwd);
}
