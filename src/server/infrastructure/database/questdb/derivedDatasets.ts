/**
 * Derived datasets as serving views — the manifest is the registry.
 *
 * Think of it as: the lake's mailroom log. Every landing under
 * `s3://derived/<dataset>/recipe=<recipe>/` appends a line to
 * `s3://meta/ingest_manifests/<dataset>.jsonl` (the `lake.writer` convention).
 * Reading those lines back tells the dashboard which datasets exist without
 * walking the object store, and each becomes a view the SQL console, the
 * Data page and every router can query:
 *
 *   derived_<dataset>            one table per recipe (the default layout)
 *   derived_<dataset>_<table>    when a dataset lands several `table=` parts
 *
 * Every view keeps the hive `recipe` column so one query can compare recipes;
 * `union_by_name` lets a recipe that added a column sit beside one that did
 * not. The pinned QuestDB snapshot (`derived/recipe=questdb_full_2026-09-09/`)
 * is not a dataset in this sense — it has no manifest and its views keep their
 * QuestDB names (`connection.ts`).
 *
 * This closes the gap `CLAUDE.md` recorded under *Open findings*: a newly
 * landed derived dataset was invisible to the dashboard's own DuckDB.
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import { readJsonLines } from '../../lake/objects';
import { logInfo } from '../../lib/log';

const DERIVED_BUCKET = process.env.LAKE_DERIVED_BUCKET || 'derived';
const META_BUCKET = process.env.LAKE_META_BUCKET || 'meta';
const MANIFEST_PREFIX = `s3://${META_BUCKET}/ingest_manifests`;

/** Dataset and table names are path segments and view names; anything else is refused. */
const SAFE_NAME = /^[a-z0-9_]+$/;

export interface DerivedView {
  viewName: string;
  dataset: string;
  table: string | null;
  glob: string;
  recipeCount: number;
}

interface ManifestLine {
  dataset?: unknown;
  zone?: unknown;
  recipe?: unknown;
  table?: unknown;
}

/** Views defined by the last refresh, for health and for the lifecycle's `cataloged` check. */
let definedViews: DerivedView[] = [];
/** Recipes seen per view name, so a caller can ask whether a recipe is served without a scan. */
let recipesByView = new Map<string, Set<string>>();

export function derivedViews(): DerivedView[] {
  return definedViews;
}

export function servedRecipes(viewName: string): string[] {
  return [...(recipesByView.get(viewName) ?? [])].sort();
}

/**
 * Manifest file names under the prefix, from DuckDB's glob (it is already
 * authenticated against the store; a second listing client would be one more
 * thing to keep in step).
 */
async function manifestObjects(con: DuckDBConnection): Promise<string[]> {
  const reader = await con.runAndReadAll(
    `SELECT file FROM glob('${MANIFEST_PREFIX}/*.jsonl') ORDER BY file`,
  );
  return reader.getRowObjectsJS().map((row) => String(row.file));
}

/** Group manifest lines into the views they imply. */
export function planDerivedViews(lines: Array<ManifestLine & { source: string }>): DerivedView[] {
  const byDataset = new Map<string, { tables: Set<string>; recipes: Set<string>; untabled: boolean }>();
  for (const line of lines) {
    if (line.zone !== undefined && line.zone !== 'derived') continue;
    const dataset = typeof line.dataset === 'string' ? line.dataset : '';
    if (!SAFE_NAME.test(dataset)) continue;
    const table = typeof line.table === 'string' && SAFE_NAME.test(line.table) ? line.table : null;
    const recipe = typeof line.recipe === 'string' ? line.recipe : null;
    const entry = byDataset.get(dataset) ?? { tables: new Set<string>(), recipes: new Set<string>(), untabled: false };
    if (table) entry.tables.add(table);
    else entry.untabled = true;
    if (recipe) entry.recipes.add(recipe);
    byDataset.set(dataset, entry);
  }
  const views: DerivedView[] = [];
  for (const [dataset, entry] of [...byDataset.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const tables = [...entry.tables].sort();
    if (tables.length === 0) {
      views.push({ viewName: `derived_${dataset}`, dataset, table: null, glob: `s3://${DERIVED_BUCKET}/${dataset}/recipe=*/**/*.parquet`, recipeCount: entry.recipes.size });
    } else if (tables.length === 1 && !entry.untabled) {
      views.push({ viewName: `derived_${dataset}`, dataset, table: tables[0]!, glob: `s3://${DERIVED_BUCKET}/${dataset}/recipe=*/table=${tables[0]}/**/*.parquet`, recipeCount: entry.recipes.size });
    } else {
      for (const table of tables) {
        views.push({ viewName: `derived_${dataset}_${table}`, dataset, table, glob: `s3://${DERIVED_BUCKET}/${dataset}/recipe=*/table=${table}/**/*.parquet`, recipeCount: entry.recipes.size });
      }
    }
  }
  return views;
}

/**
 * (Re)define every derived view on `con`. A dataset whose objects are gone is
 * logged and skipped — one missing dataset must not take the others with it.
 */
export async function defineDerivedViews(con: DuckDBConnection): Promise<DerivedView[]> {
  const started = performance.now();
  const objects = await manifestObjects(con);
  const lines: Array<ManifestLine & { source: string }> = [];
  const recipesByDataset = new Map<string, Set<string>>();
  for (const object of objects) {
    const path = object.startsWith('s3://') ? object : `s3://${object}`;
    for (const line of await readJsonLines<ManifestLine>(path)) {
      lines.push({ ...line, source: path });
      if (typeof line.dataset === 'string' && typeof line.recipe === 'string') {
        const set = recipesByDataset.get(line.dataset) ?? new Set<string>();
        set.add(line.recipe);
        recipesByDataset.set(line.dataset, set);
      }
    }
  }
  const planned = planDerivedViews(lines);
  const defined: DerivedView[] = [];
  const recipes = new Map<string, Set<string>>();
  for (const view of planned) {
    try {
      // `table` is a reserved word and only ever the object's address, so it is
      // dropped where the layout has it; `recipe` stays because it is how one
      // query tells recipes apart.
      const projection = view.table ? 'SELECT * EXCLUDE ("table")' : 'SELECT *';
      await con.run(
        `CREATE OR REPLACE VIEW "${view.viewName}" AS ` +
          `${projection} FROM read_parquet('${view.glob}', hive_partitioning = true, union_by_name = true)`,
      );
      defined.push(view);
      recipes.set(view.viewName, recipesByDataset.get(view.dataset) ?? new Set());
    } catch (error) {
      console.warn(`[lake] derived view '${view.viewName}' not defined: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  definedViews = defined;
  recipesByView = recipes;
  logInfo(`[lake] ${defined.length} derived-dataset views defined from ${objects.length} manifests in ${(performance.now() - started).toFixed(0)}ms`);
  return defined;
}
