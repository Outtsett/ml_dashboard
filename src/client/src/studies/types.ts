/**
 * A study: one analytic page that replaced a marimo notebook.
 *
 * Each lives in its own folder, `src/client/src/studies/pages/<slug>/`, with
 *   meta.ts   `export const meta: StudyMeta`   (read eagerly for the index)
 *   Page.tsx  `export default function Page()` (loaded when the study opens)
 * and its numbers come from `GET /api/studies/<slug>` (src/server/studies/).
 * Adding a study edits no shared file: the registry globs the folders.
 */

export type StudyStatus = "active-research" | "record-of-past-round" | "diagnostic-tool";

export interface StudyMeta {
  /** kebab-case, equal to the folder name and the server handler's slug. */
  slug: string;
  title: string;
  /** One or two sentences: the question the page answers. */
  summary: string;
  /** Index group, e.g. "Candles", "Labels", "Strategies", "Data", "Models", "Forex", "System". */
  category: string;
  status: StudyStatus;
  /** The marimo notebook this page replaced (absolute path as it was in notebooks.json). */
  replaces: string;
  /** Existing dashboard pages that show related things, linked from the header. */
  related?: Array<{ label: string; href: string }>;
}
