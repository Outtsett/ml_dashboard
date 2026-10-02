import type { StudyContext } from "./types";

/**
 * The views in `names` that are not defined, each added to the response notes.
 * A handler returns its empty body when this is non-empty, so a study whose
 * data has not been landed reads as "not landed yet", never as an error.
 */
export async function missingViews(context: StudyContext, names: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    if (!(await context.lake.hasView(name))) missing.push(name);
  }
  if (missing.length > 0) {
    context.notes.push(
      `Not in the lake yet: ${missing.join(", ")}. Land it (see this study's "Recompute" or its runner), then refresh the derived views.`,
    );
  }
  return missing;
}
