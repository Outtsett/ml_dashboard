/** "Read by these notebooks": links from any page to the notebooks whose code
 *  names a given lake table or view, from GET /api/marimo/lineage. Renders
 *  nothing while loading or when no notebook reads it. */

import { Link } from "wouter";
import { NotebookPen } from "lucide-react";
import { useNotebookLineage } from "./api";
import { notebookHref } from "./links";

/** True when a lineage name covers `table`: the same name, a family
 *  (`derived_model_cycle_runs_*`) the table belongs to, or the dataset path of a
 *  derived view (`derived/labels` for `derived_labels`). */
export function datasetCovers(name: string, table: string): boolean {
  const wanted = table.toLowerCase();
  if (name === wanted) return true;
  if (name.endsWith("*") && wanted.startsWith(name.slice(0, -1))) return true;
  if (name.startsWith("derived/")) {
    const dataset = name.slice("derived/".length).replace(/\*$/, "");
    return wanted === `derived_${dataset}` || wanted.startsWith(`derived_${dataset}_`);
  }
  return false;
}

export function ReadByNotebooks({ tables, prefix = "Read by" }: { tables: string[]; prefix?: string }) {
  const lineage = useNotebookLineage();
  const seen = new Map<string, { id: string; title: string; relativePath: string }>();
  for (const dataset of lineage.data?.datasets ?? []) {
    if (!tables.some((table) => datasetCovers(dataset.name, table))) continue;
    for (const notebook of dataset.notebooks) seen.set(notebook.id, notebook);
  }
  if (seen.size === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="read-by-notebooks">
      <NotebookPen className="h-3 w-3" aria-hidden="true" />
      {prefix}
      {[...seen.values()].map((notebook) => (
        <Link key={notebook.id} href={notebookHref(notebook.id)} className="text-foreground underline decoration-dotted underline-offset-2 hover:text-primary" title={notebook.relativePath}>
          {notebook.title}
        </Link>
      ))}
    </span>
  );
}
