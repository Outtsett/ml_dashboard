/** A link that opens a notebook on the Notebooks tab. `reference` is the
 *  notebook's id, its relative path, or the tail of that path — for example
 *  `notebookHref("notebooks/model_cycle_runs.py")` from the Model Cycle page. */
export function notebookHref(reference: string): string {
  return `/marimo?notebook=${encodeURIComponent(reference)}`;
}
