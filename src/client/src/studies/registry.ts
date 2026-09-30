/**
 * Every study, found by globbing `pages/<slug>/meta.ts` (eager, small) and
 * `pages/<slug>/Page.tsx` (lazy, one chunk per study). A folder is a study
 * only when it has both, and its meta.slug must equal the folder name.
 */

import type { ComponentType } from "react";
import type { StudyMeta } from "./types";

type PageModule = { default: ComponentType };

const metaModules = import.meta.glob<{ meta: StudyMeta }>("./pages/*/meta.ts", { eager: true });
const pageModules = import.meta.glob<PageModule>("./pages/*/Page.tsx");

function folderOf(modulePath: string): string {
  return modulePath.split("/")[2] ?? "";
}

export interface StudyEntry {
  meta: StudyMeta;
  load: () => Promise<PageModule>;
}

const entries = new Map<string, StudyEntry>();
for (const [modulePath, module] of Object.entries(metaModules)) {
  const folder = folderOf(modulePath);
  const load = pageModules[`./pages/${folder}/Page.tsx`];
  if (!load || !module.meta || module.meta.slug !== folder) {
    console.error(`[studies] ${folder}: needs meta.ts with slug "${folder}" and Page.tsx`);
    continue;
  }
  entries.set(folder, { meta: module.meta, load });
}

export function studyEntry(slug: string): StudyEntry | undefined {
  return entries.get(slug);
}

/** Every study, sorted by category then title. */
export function allStudies(): StudyMeta[] {
  return [...entries.values()]
    .map((entry) => entry.meta)
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}
