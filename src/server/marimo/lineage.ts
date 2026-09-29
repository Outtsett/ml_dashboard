/**
 * What a notebook reads, and where a word appears inside it — both read from
 * the notebook's SOURCE, never by running it.
 *
 * Lineage names four kinds of source, each matched by the shape it has in code:
 *   - `lake view`       `derived_<dataset>[_<table>]`, the views the dashboard's
 *                       DuckDB defines over every manifested derived dataset
 *   - `lake dataset`    `s3://derived/<dataset>/…`, a derived dataset read by path
 *   - `Iceberg table`   `market.bars` / `ticks` / `quotes` / `book`
 *   - `serving table`   a `FROM` / `JOIN` of a table the serving layer defines
 *                       (`ohlcv_1d`, `mnq_ohlcv_1m`, …)
 *
 * A name ending in `_` is the fixed part of an f-string (`derived_model_cycle_runs_{table}`)
 * and is reported as a family, `derived_model_cycle_runs_*`. A `FROM` of a name the
 * serving layer does not define is a table the notebook built itself (its own
 * DuckDB) and is not a lake source, so it is left out rather than guessed at.
 */

export type DatasetKind = "lake view" | "lake dataset" | "Iceberg table" | "serving table";

export interface DatasetReference {
  /** What the notebook names: `derived_labels`, `derived/model_cycle_runs`, `market.bars`, `ohlcv_1d`. */
  name: string;
  kind: DatasetKind;
}

const DERIVED_VIEW = /\bderived_[a-z0-9_]+/g;
const DERIVED_PATH = /s3:\/\/derived\/([a-z0-9_]+)/g;
const ICEBERG_TABLE = /\bmarket\.(bars|ticks|quotes|book)\b/g;
const FROM_OR_JOIN = /\b(?:FROM|JOIN)\s+"?([a-z][a-z0-9_]{2,})"?/gi;

/** The serving tables the dashboard's DuckDB defines from the pinned QuestDB-era
 *  snapshot, by family. Used when the live list is not loaded yet (it is empty
 *  until the first market-data query), so lineage does not depend on whether
 *  someone opened the chart first. */
const SERVING_TABLE_FAMILY =
  /^(?:bars|ohlcv|ohlcv_1h_v|symbols|ticks|candle_anatomy|candle_geometry_1m|ta_indicators_1m|(?:ohlcv|ohlcv_full|mnq_ohlcv|candle_anatomy)_[0-9]+[smhdw]|mnq_(?:labels|indicators_norm|zigzag|tbl|swing)_[a-z0-9_]+)$/;

function familyName(name: string): string {
  return name.endsWith("_") ? `${name}*` : name;
}

/** The source with its prose removed — `#` comment lines and the text of
 *  `mo.md(...)` blocks — so "rows from bars" in a sentence is not read as a
 *  `FROM bars`. Only the FROM / JOIN scan uses it: a derived view or lake path
 *  named in prose is still worth listing, because it names a real object. */
export function stripProse(source: string): string {
  return source
    .replace(/mo\.md\(\s*[rRfFbBuU]{0,2}("""|''')[\s\S]*?\1\s*\)/g, "mo.md()")
    .split(/\r?\n/)
    .map((line) => (/^\s*#/.test(line) ? "" : line.replace(/\s#\s.*$/, "")))
    .join("\n");
}

/** Every lake source a notebook's code names, deduplicated and sorted by kind then name. */
export function extractDatasets(source: string, knownServingTables: ReadonlySet<string> = new Set()): DatasetReference[] {
  const found = new Map<string, DatasetReference>();
  const add = (name: string, kind: DatasetKind) => {
    const key = `${kind}\u0000${name}`;
    if (!found.has(key)) found.set(key, { name, kind });
  };

  for (const match of source.matchAll(DERIVED_VIEW)) add(familyName(match[0]), "lake view");
  for (const match of source.matchAll(DERIVED_PATH)) {
    // `s3://derived/recipe=…` is the serving snapshot itself, not a dataset.
    if (match[1] === "recipe") continue;
    add(`derived/${familyName(match[1]!)}`, "lake dataset");
  }
  for (const match of source.matchAll(ICEBERG_TABLE)) add(`market.${match[1]}`, "Iceberg table");
  for (const match of stripProse(source).matchAll(FROM_OR_JOIN)) {
    const name = match[1]!.toLowerCase();
    if (name.startsWith("derived_")) continue; // already a lake view
    if (knownServingTables.has(name) || SERVING_TABLE_FAMILY.test(name)) add(name, "serving table");
  }

  const kindOrder: DatasetKind[] = ["lake view", "lake dataset", "Iceberg table", "serving table"];
  return [...found.values()].sort(
    (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.name.localeCompare(b.name),
  );
}

/** Cells in a marimo notebook: one `@app.cell` decorator each. */
export function countCells(source: string): number {
  return source.match(/^@app\.cell\b/gm)?.length ?? 0;
}

export interface SourceMatch {
  /** 1-based line number in the file. */
  lineNumber: number;
  /** The matching line, trimmed and clipped to SNIPPET_LENGTH characters around the hit. */
  text: string;
  /** Where the hit starts and ends inside `text`, for highlighting. */
  matchStart: number;
  matchEnd: number;
}

const SNIPPET_LENGTH = 160;

/** Case-insensitive plain-text search of one notebook's source. Returns at most
 *  `limit` matching lines, each clipped around the hit so a 400-character SQL line
 *  still shows the word that matched. */
export function searchSource(source: string, query: string, limit = 5): { matches: SourceMatch[]; total: number } {
  const needle = query.toLowerCase();
  const matches: SourceMatch[] = [];
  let total = 0;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const at = raw.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    total++;
    if (matches.length >= limit) continue;
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const hit = at - leading;
    const start = Math.max(0, Math.min(hit - 40, trimmed.length - SNIPPET_LENGTH));
    const text = trimmed.slice(start, start + SNIPPET_LENGTH);
    matches.push({
      lineNumber: index + 1,
      text,
      matchStart: hit - start,
      matchEnd: Math.min(text.length, hit - start + needle.length),
    });
  }
  return { matches, total };
}
