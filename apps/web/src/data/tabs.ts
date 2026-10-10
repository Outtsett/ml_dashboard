/**
 * The Data page's selection, read from and written to the URL.
 *
 * Everything a link needs to reopen the page where it was (which tab, which
 * lake object or SQLite table, rows or columns) is a query parameter, so a
 * reload, a pasted link and the left sidebar's `?dataset=` / `?feature=` links
 * all land in the same place.
 */

export const DATA_TABS = ["lake", "sqlite", "postgres", "query", "engine"] as const;
export type DataTab = (typeof DATA_TABS)[number];

export const DATA_TAB_LABELS: Record<DataTab, string> = {
  lake: "Lake",
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  query: "SQL",
  engine: "Engine",
};

export type LakeView = "rows" | "columns";

export interface DataSelection {
  tab: DataTab;
  /** Lake tab: a view name, an object id or a bare dataset name. */
  dataset: string | null;
  /** Lake tab: a feature id from the feature registry. */
  feature: string | null;
  /** Lake tab: the rows grid or one panel per column. */
  view: LakeView;
  /** SQLite tab: the table being browsed. */
  table: string | null;
}

function isDataTab(value: string | null): value is DataTab {
  return value !== null && (DATA_TABS as readonly string[]).includes(value);
}

/** An unknown tab falls back to the lake; `?dataset=` or `?feature=` alone means the lake tab. */
export function parseDataSelection(search: string): DataSelection {
  const parameters = new URLSearchParams(search);
  const requested = parameters.get("tab");
  return {
    tab: isDataTab(requested) ? requested : "lake",
    dataset: parameters.get("dataset") || null,
    feature: parameters.get("feature") || null,
    view: parameters.get("view") === "columns" ? "columns" : "rows",
    table: parameters.get("table") || null,
  };
}

/** The query string for a selection, carrying only what its tab uses and omitting defaults. */
export function dataSelectionSearch(selection: DataSelection): string {
  const parameters = new URLSearchParams();
  if (selection.tab !== "lake") parameters.set("tab", selection.tab);
  if (selection.tab === "lake") {
    if (selection.dataset) parameters.set("dataset", selection.dataset);
    if (selection.feature) parameters.set("feature", selection.feature);
    if (selection.dataset && selection.view === "columns") parameters.set("view", "columns");
  }
  if (selection.tab === "sqlite" && selection.table) parameters.set("table", selection.table);
  const text = parameters.toString();
  return text ? `?${text}` : "";
}

export function dataHref(selection: DataSelection): string {
  return `/databases${dataSelectionSearch(selection)}`;
}
