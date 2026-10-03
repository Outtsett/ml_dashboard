/**
 * The lake object registry â€” one identity per thing the serving layer exposes.
 *
 * The 439 objects DuckDB answers `information_schema.tables` with are not 439
 * tables. They are 439 *views*, and their names are computed rather than stored:
 *
 *   - 41 snapshot views, named from the `table=` segment of a parquet directory
 *     (`connection.ts`), so the name is the object's address;
 *   - 397 derived views, synthesized as `derived_<dataset>[_<table>]` from the
 *     ingest manifests (`derivedDatasets.ts`);
 *   - `bars`, the only real Iceberg table, read through `iceberg_scan`.
 *
 * So "rename the tables" is not a rename â€” it is a change to the two functions
 * that manufacture names, and the readers that hold those names as string
 * literals do not move with them. `bars` alone is referenced across ~26 files
 * and is genuinely ambiguous: the same token names the Iceberg bar table, the
 * Model Cycle's bar table and a training record's bar table.
 *
 * This registry is the other way round. It assigns each object a stable id, a
 * canonical name, a kind and a category *without touching the physical name*,
 * and resolves either spelling back to the object. Every existing reader keeps
 * working, and a rename later becomes a one-line change to a mapping rather than
 * a 439-object migration.
 *
 * Two identifiers, deliberately:
 *
 *   objectId  `market.candles.ohlcv_1m` â€” how code and the UI refer to it.
 *             Stable across a rename of either the view or the dataset.
 *   viewName  `ohlcv_1m` â€” what DuckDB knows it by, and the only thing a query
 *             can actually name. Never invent this; read it from here.
 */

export type LakeObjectKind =
  | 'candles'        // OHLCV bars, at a timeframe
  | 'features'       // computed per-bar feature columns
  | 'labels'         // per-bar labels
  | 'news'           // headlines and sentiment
  | 'calendar'       // session, macro and symbol reference data
  | 'events';        // discrete occurrences (patterns, sweeps, zones)

export interface LakeObject {
  /** Stable identity, e.g. `market.candles.ohlcv_1m`. The name to store. */
  objectId: string;
  /** The DuckDB view name. The only string a query can name. */
  viewName: string;
  /** Human-facing name, derived from the view name. */
  displayName: string;
  kind: LakeObjectKind;
  /** Where it came from â€” the two different identification paths. */
  origin: 'iceberg' | 'snapshot' | 'manifest';
  /** The manifest dataset, when the object came from one. */
  dataset?: string;
  /** The `table=` part, when the dataset landed several. */
  table?: string;
}

const TIMEFRAME_SUFFIX = /_([0-9]+[smhdw])$/;

/** `MNQ` / `mnq` prefix on a snapshot table, e.g. `mnq_ohlcv_1m`. */
const ROOT_PREFIX = /^(mnq|es|nq|eurusd)_/;

/**
 * Classify a snapshot view by its name.
 *
 * The snapshot is a frozen export of what was in the original high-frequency store, so these names predate
 * any convention and carry real ambiguity â€” `mnq_tbl_5m` has no producer
 * anywhere in the repo, and `mnq_labels_1m` is byte-identical to
 * `mnq_labels_1m_new`. The rules are therefore ordered, first match wins, and an
 * unrecognised name falls through to `events` rather than being forced into a
 * bucket it does not belong in.
 */
function classifySnapshot(viewName: string): LakeObjectKind {
  const name = viewName.toLowerCase();
  if (/^symbols$/.test(name)) return 'calendar';
  if (/candle_geometry|candle_anatomy|indicators|talib/.test(name)) return 'features';
  if (/labels|zigzag|swing|tbl/.test(name)) return 'labels';
  if (/ohlcv|candles/.test(name)) return 'candles';
  return 'events';
}

/**
 * Classify a manifest-derived view.
 *
 * A separate rule set from `classifySnapshot`, because the two populations are
 * different things. The snapshot is a frozen export carrying legacy names;
 * the derived views are named by whoever wrote the ingest manifest, and most of
 * them are a study or an audit whose output happens to be parquet. Reusing the
 * snapshot rules here classified 338 of 397 derived views as `events`, which is a
 * fact about the rules and not about the lake.
 *
 * Matching is on the *dataset* name, because that is the authored part â€” the
 * table part is usually a column grouping (`predictions`, `folds`, `metrics`)
 * and carries no kind of its own.
 */
function classifyDerived(dataset: string): LakeObjectKind {
  const name = dataset.toLowerCase();
  if (/label/.test(name)) return 'labels';
  if (/news|sentiment|finbert/.test(name)) return 'news';
  if (/calendar|fred|symbols/.test(name)) return 'calendar';
  if (/ohlcv|candles|bars/.test(name)) return 'candles';
  if (/feature|indicator|talib|zone_|trend_state/.test(name)) return 'features';
  return 'events';
}

/** `ohlcv_1m` -> `OHLCV 1m`; `mnq_ohlcv_1m` -> `MNQ OHLCV 1m`. */
function displayNameFor(viewName: string): string {
  const timeframe = TIMEFRAME_SUFFIX.exec(viewName);
  if (timeframe) {
    const stem = viewName.slice(0, -timeframe[0].length);
    const root = ROOT_PREFIX.exec(stem);
    const symbol = root ? root[1]!.toUpperCase() : '';
    const kind = stem.slice(root ? root[0].length : 0).replace(/_/g, ' ');
    return [symbol, kind.toUpperCase(), timeframe[1]].filter(Boolean).join(' ');
  }
  return viewName.replace(/_/g, ' ');
}

/** The object id for a snapshot view: `market.<kind>.<viewName>`. */
function snapshotObjectId(viewName: string, kind: LakeObjectKind): string {
  return `market.${kind}.${viewName}`;
}

/**
 * The object id for a derived view: `lake.<dataset>[.<table>]`.
 *
 * The view name is not parsed â€” it cannot be, since dataset and table are both
 * underscore-joined and `derived_label_audit_findings` splits three ways. The
 * dataset and table arrive as separate fields from the manifest.
 */
function derivedObjectId(dataset: string, table: string | null): string {
  return table ? `lake.${dataset}.${table}` : `lake.${dataset}`;
}

/** Build the registry entry for one manifest-derived view. */
function fromDerived(view: {
  viewName: string;
  dataset: string;
  table: string | null;
}): LakeObject {
  return {
    objectId: derivedObjectId(view.dataset, view.table),
    viewName: view.viewName,
    displayName: [view.dataset, view.table].filter(Boolean).join(' / ').replace(/_/g, ' '),
    kind: classifyDerived(view.dataset),
    origin: 'manifest',
    dataset: view.dataset,
    table: view.table ?? undefined,
  };
}

/** Build the registry entry for one snapshot view. */
function fromSnapshot(viewName: string): LakeObject {
  const kind = classifySnapshot(viewName);
  return {
    objectId: snapshotObjectId(viewName, kind),
    viewName,
    displayName: displayNameFor(viewName),
    kind,
    origin: 'snapshot',
  };
}

let registry: LakeObject[] = [];
/** Every spelling we accept â€” object id, view name, dataset â€” to a view name. */
let aliases = new Map<string, string>();

/**
 * Rebuild the registry from what the serving layer currently exposes.
 *
 * Called after `buildInstance()` and again by `refreshDerivedViews()`, because a
 * dataset landed mid-session must appear without a restart.
 */
export function buildObjectRegistry(options: {
  snapshotViews: string[];
  derivedViews: ReadonlyArray<{ viewName: string; dataset: string; table: string | null }>;
  icebergViews?: string[];
}): LakeObject[] {
  const rows: LakeObject[] = [];
  for (const name of options.icebergViews ?? []) {
    rows.push({ objectId: `market.bars.${name}`, viewName: name, displayName: displayNameFor(name), kind: 'candles', origin: 'iceberg' });
  }
  for (const name of options.snapshotViews) {
    rows.push(fromSnapshot(name));
  }
  for (const view of options.derivedViews) {
    rows.push(fromDerived(view));
  }

  registry = rows;

  // Aliases: object id, view name, and the bare dataset all resolve, so a
  // caller holding any of the three names finds the object.
  const next = new Map<string, string>();
  for (const row of rows) {
    next.set(row.objectId.toLowerCase(), row.viewName);
    next.set(row.viewName.toLowerCase(), row.viewName);
    if (row.dataset) next.set(row.dataset.toLowerCase(), row.viewName);
  }
  aliases = next;

  return registry;
}

/** Every registered lake object. */
export function lakeObjects(): LakeObject[] {
  return registry;
}

/**
 * Resolve any accepted spelling to the DuckDB view name.
 *
 * Returns the input unchanged when nothing matches, so a caller passing a name
 * the registry has never seen is not blocked by it â€” the registry resolves what
 * it knows and defers on what it does not.
 */
export function resolveViewName(nameOrId: string): string {
  return aliases.get(nameOrId.toLowerCase()) ?? nameOrId;
}

/** The registry entry for any accepted spelling, or undefined. */
export function findLakeObject(nameOrId: string): LakeObject | undefined {
  const viewName = aliases.get(nameOrId.toLowerCase());
  if (!viewName) return undefined;
  return registry.find((row) => row.viewName === viewName);
}

/**
 * Objects grouped by kind, for a UI that lists by kind rather than by name.
 */
export function lakeObjectsByKind(): Record<LakeObjectKind, LakeObject[]> {
  const grouped = {} as Record<LakeObjectKind, LakeObject[]>;
  for (const row of registry) (grouped[row.kind] ??= []).push(row);
  return grouped;
}
