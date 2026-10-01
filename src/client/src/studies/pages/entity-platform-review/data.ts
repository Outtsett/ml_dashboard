/**
 * The entity platform review of 2026-10-01: every kind of thing the dashboard
 * tracks, the links between kinds that code or data already proves, and the
 * suggestions that survived an adversarial check against the source.
 * Counts were measured read-only on data/ml_dashboard.db, data/models and the
 * lake manifests that day.
 */

export type Store = "sqlite" | "lake" | "files";

export interface KindNode {
  kind: string;
  label: string;
  store: Store;
  /** Where the identity lives, in words. */
  identity: string;
  /** Rows, directories or files on 2026-10-01; null when not counted. */
  count: number | null;
  x: number;
  y: number;
  /** A new SQLite table that copies this kind, if any. */
  duplicatedBy?: string;
  /** A new SQLite table worth keeping for this kind, if any. */
  keptAs?: string;
}

export const KINDS: KindNode[] = [
  { kind: "spec", label: "Catalog spec", store: "files", identity: "slug of the markdown path", count: 299, x: 80, y: 50 },
  { kind: "runner", label: "Runner", store: "files", identity: "algorithm+task key in runners.json", count: null, x: 235, y: 50 },
  { kind: "session", label: "Training session", store: "sqlite", identity: "integer id in training_sessions", count: 83, x: 390, y: 50 },
  { kind: "run", label: "Provenance run", store: "sqlite", identity: "run_<ULID> in runs", count: 53, x: 545, y: 50 },
  { kind: "cycle", label: "Model Cycle run", store: "lake", identity: "model_id in derived/model_cycle_runs", count: null, x: 235, y: 160, duplicatedBy: "wfv_definitions (the cycle folds table already holds every fold)" },
  { kind: "model", label: "Trained model", store: "files", identity: "directory name under data/models", count: 126, x: 465, y: 160, duplicatedBy: "model_drift_metrics (drift belongs in the lake)" },
  { kind: "version", label: "Model version", store: "sqlite", identity: "integer id in model_versions", count: 0, x: 630, y: 160 },
  { kind: "deployment", label: "Deployment", store: "sqlite", identity: "integer id in deployments", count: 0, x: 700, y: 260 },
  { kind: "backtest", label: "Backtest run", store: "sqlite", identity: "integer id in backtest_runs", count: null, x: 560, y: 260 },
  { kind: "labels", label: "Label set", store: "sqlite", identity: "recipe string, unique", count: 49, x: 390, y: 260 },
  { kind: "study", label: "Study", store: "files", identity: "folder name under studies/pages", count: 58, x: 80, y: 260, duplicatedBy: "studies (the page registry already lists them)" },
  { kind: "notebook", label: "Notebook", store: "files", identity: "path in notebooks.json", count: null, x: 80, y: 360 },
  { kind: "dataset", label: "Lake dataset", store: "lake", identity: "manifest line: dataset, recipe, table", count: 85, x: 235, y: 360, duplicatedBy: "datasets and dataset_versions (the ingest manifests already list them)" },
  { kind: "feature", label: "Feature", store: "files", identity: "entry in features.json", count: 35, x: 465, y: 360, duplicatedBy: "features (features.json is the single definition)" },
  { kind: "annotation", label: "Note / asserted link", store: "sqlite", identity: "the only rows a person writes", count: 0, x: 660, y: 360, keptAs: "entity_annotations and entity_relationships (asserted links only)" },
];

export interface KindEdge {
  from: string;
  to: string;
  /** The column or file that proves the link. */
  proof: string;
  /** A measured gap in this link, if any. */
  gap?: string;
}

export const EDGES: KindEdge[] = [
  { from: "spec", to: "runner", proof: "algorithms.json catalogSpec; lifecycle.ts:99-106" },
  { from: "runner", to: "session", proof: "training_sessions.model_type; lifecycle.ts:108-126" },
  { from: "session", to: "model", proof: "training_sessions.versioned_model_id; schema.ts:78", gap: "40 session or run ids point at a directory that is gone; 83 of 126 directories have no row pointing at them" },
  { from: "run", to: "session", proof: "runs.training_session_id; schema.ts:1357" },
  { from: "run", to: "model", proof: "runs.legacy_model_id; schema.ts:1346", gap: "22 of 53 runs.catalog_id values hold a runner key, 31 a spec slug" },
  { from: "cycle", to: "spec", proof: "runs.catalog_spec_id in the cycle record; store.py:140" },
  { from: "cycle", to: "dataset", proof: "the run record lands under derived/model_cycle_runs; store.py:291-294" },
  { from: "session", to: "labels", proof: "training_sessions.label_set_id; schema.ts:98", gap: "0 of 83 sessions carry a label set id" },
  { from: "labels", to: "dataset", proof: "generated_labels.recipe; schema.ts:504" },
  { from: "version", to: "spec", proof: "model_versions.catalog_id; schema.ts:1098-1107", gap: "model_versions has 0 rows" },
  { from: "deployment", to: "version", proof: "deployments.version_id; schema.ts:1126" },
  { from: "backtest", to: "model", proof: "backtest_runs.model_id; schema.ts:595" },
  { from: "study", to: "dataset", proof: "StudyHandler.datasets; server/studies/types.ts:38", gap: "matched today by a name prefix in the browser, ReadByStudies.tsx:22-26" },
  { from: "notebook", to: "dataset", proof: "table names read from notebook source; marimo/lineage.ts:73-116" },
];

export type Impact = "high" | "medium" | "low";
export type Effort = "small" | "medium" | "large";

export interface Suggestion {
  id: string;
  step: number;
  title: string;
  /** What is true today. */
  today: string;
  /** The change. */
  change: string;
  evidence: string;
  impact: Impact;
  effort: Effort;
  /** A defect that is live in the working tree now. */
  defect: boolean;
  kinds: string[];
}

export const STEPS = [
  { step: 1, title: "Repair what is broken now", why: "Seven things in the uncommitted change fail today. Nothing built on top is trustworthy until they are fixed." },
  { step: 2, title: "Give every entity one identity", why: "The word model means four different ids. Every later step joins on this, so it comes before any new surface." },
  { step: 3, title: "Derive the graph from what already exists", why: "Fourteen links are already provable from columns and files. A stored copy can only drift from them." },
  { step: 4, title: "Shrink the new tables to what a person writes", why: "Six of the nine new tables copy a source that already exists. Notes and asserted links are the only new facts." },
  { step: 5, title: "Make the filter visible, then make it stick", why: "An active model silently filters six pages. Saving that across reloads is safe only once it is visible and its ids match." },
  { step: 6, title: "Lineage and drift that can be trusted", why: "A graph that shows dead runs as live, or a run with no record of its inputs, answers the wrong question." },
  { step: 7, title: "Reach: search and the Claude panel", why: "Once the graph is real, the command palette and Claude can use it at almost no cost." },
] as const;

export const SUGGESTIONS: Suggestion[] = [
  { id: "A1", step: 1, defect: true, impact: "high", effort: "medium", kinds: ["annotation", "model", "study"],
    title: "The entity page asks for routes the server does not serve",
    today: "The profile page requests /api/entity/<type>/<id> and its relationships, metrics, annotations and lineage. The server only serves /api/entities/... table CRUD, and has no annotations route at all, so every tab is empty.",
    change: "Serve one read-only GET /api/entity/:kind/:id plus GET and POST annotations under it, which is what the client already calls.",
    evidence: "entity/useEntityProfile.ts:43-78; server/entities/entities.router.ts:37-61" },
  { id: "A2", step: 1, defect: true, impact: "high", effort: "small", kinds: ["model", "cycle", "dataset", "feature"],
    title: "Analytics fails for three entity kinds and matches nothing for a model",
    today: "The client has five kinds and forwards whichever is active; the server accepts two, so an active dataset, feature or strategy returns HTTP 400. For a model the filter compares a catalog id with run ids, so it empties the model panels.",
    change: "Send the entity only for a model, resolve it to run ids first (step 2), and list an ignored kind in the response notes instead of failing.",
    evidence: "analytics/data.ts:23-26; server/analytics/analytics.router.ts:40,66,86-89" },
  { id: "A3", step: 1, defect: true, impact: "medium", effort: "small", kinds: ["study"],
    title: "A hook runs after an early return in the study page",
    today: "useEntityStore is called after the 'no study named' return. Moving between a known and an unknown study throws 'Rendered fewer hooks than expected'. Lint is silent because the react-hooks plugin is registered with no rule switched on.",
    change: "Move the call above the return and add react-hooks/rules-of-hooks as an error (one line; expect it to surface other cases).",
    evidence: "studies/StudyPage.tsx:44-53; eslint.config.js:19-27" },
  { id: "A4", step: 1, defect: true, impact: "high", effort: "small", kinds: [],
    title: "The rail selects but never navigates, and four pages lost their link",
    today: "The left rail became an entity browser; clicking a row changes the chip and nothing else. The new top navigation leaves out Studies, Model Cycle, Notebooks and System. The end-to-end drift test still reads the rail for links and finds none.",
    change: "Make a rail click open the entity (study to its page, model to its profile), put the four pages back, and point the drift test at the new navigation.",
    evidence: "quant-layout/HorizontalNav.tsx:6-19; e2e/specs/smoke/route-table-drift.spec.ts:62-76" },
  { id: "A5", step: 1, defect: true, impact: "medium", effort: "small", kinds: ["model"],
    title: "A Lens link with a model in it loses to the active entity",
    today: "On opening /lens?model=B the page overwrites B with whatever model is active, and rewrites the address. A bookmarked or shared link never wins.",
    change: "Let the address win on first load; apply the active entity only when the address names no model, using the lens id from the lifecycle response.",
    evidence: "lens/LensPage.tsx:141-152; shared/catalogLifecycle.ts:56" },
  { id: "A6", step: 1, defect: true, impact: "medium", effort: "small", kinds: ["cycle"],
    title: "The Analytics 'Models & Cycles' tab embeds the whole Model Cycle page",
    today: "A full page with its own scrolling and heading sits inside another scrolling page; the sizing classes on the tab do nothing, and the page remounts each time the tab opens.",
    change: "Show a compact list of the model's runs with a link to /cycle, and keep /cycle as its own page.",
    evidence: "analytics/AnalyticsPage.tsx:137-149; backtest/components/PageShell.tsx:55-59" },
  { id: "A7", step: 1, defect: true, impact: "low", effort: "small", kinds: [],
    title: "README table and a lake path were corrupted by the same edit",
    today: "The DIKW block was pasted into the table's separator row, and the raw landing path is split across two lines. The arrows in the DIKW line are question marks, here and in CLAUDE.md.",
    change: "Restore the separator row, move the block below the table, write the path as E:\\lake\\raw\\vendor=<name>\\ and the arrows as '->'.",
    evidence: "README.md:28-38,127-128" },

  { id: "B1", step: 2, defect: true, impact: "high", effort: "medium", kinds: ["spec", "runner", "model", "cycle", "session"],
    title: "One 'model' id carries four different meanings",
    today: "Depending on what set it, the active model holds a catalog slug, a runner key, a data/models directory name or a Model Cycle run id. Lens, Training, Labels, Regression, the run picker and Analytics each compare it with a different one, so a rail selection matches nothing.",
    change: "A model entity is always the catalog spec. Resolve it to runner keys, the lens model and run ids through GET /api/model-catalog/lifecycle (it already returns runnerKeys and lensModelId) and add the one link it lacks, cycle run to spec.",
    evidence: "quant-layout/LeftSidebar.tsx:284,311; lens/LensPage.tsx:148-152; cycle/RunPicker.tsx:29-31; shared/catalogLifecycle.ts:37-59" },
  { id: "B2", step: 2, defect: false, impact: "high", effort: "small", kinds: [],
    title: "Declare the kinds and the reference once, shared by browser and server",
    today: "The kind list is typed by hand in two places that disagree (five in the store, two in the Analytics route). The repo already writes references as kind:id elsewhere: model_lens:<id>, set:<id>, lake:<object>:<column>.",
    change: "One file, src/shared/entityRef.ts: a validated {kind, id} written as kind:id, each kind using its store's own id. Names are looked up on read, never stored.",
    evidence: "shared/contexts/EntityContext.tsx:3-15; server/analytics/analytics.router.ts:40; shared/lens/analytics.ts:71-72" },
  { id: "B3", step: 2, defect: false, impact: "medium", effort: "small", kinds: ["run", "model", "cycle"],
    title: "Never recover a runner key by splitting a directory name",
    today: "A model directory keeps the '+' of a cycle runner and replaces it with '_' for every other runner, and the lake recipe spells the same run a third way.",
    change: "Read the runner from the run or session row (runs.runner_key, the summary's modelType) inside the resolver.",
    evidence: "server/infrastructure/lib/modelResults.ts:130-149; src/ml/cycle/store.py:291-294" },

  { id: "C1", step: 3, defect: false, impact: "high", effort: "medium", kinds: ["spec", "runner", "session", "run", "cycle", "model", "version", "deployment", "backtest", "labels", "study", "notebook", "dataset"],
    title: "Build the graph as a pure function over the links that already exist",
    today: "Each link in the picture above is already a column or a file. Two modules each join one chain (catalog lifecycle, label lifecycle); nothing joins across kinds. The stored edge table is empty and nothing fills it.",
    change: "src/server/entities/graph.ts: buildEntityGraph(inputs) returns each edge with the column or file that proves it, and returns an end that is missing as a visible dangling node. About 400 lines, same test shape as lifecycle.ts.",
    evidence: "server/ml/lifecycle.ts:97-126,177-184; shared/schema.ts:78,98,504,595,1126,1343-1357" },
  { id: "C2", step: 3, defect: true, impact: "medium", effort: "small", kinds: ["dataset", "feature", "annotation"],
    title: "Replace the 589-line table CRUD with three small handlers",
    today: "The router is five handlers pasted seven times. It lets the browser create and delete datasets and features, a second editable copy of things the lake and features.json define. Its graph lookup matches on id alone, so the same id in two kinds collides.",
    change: "Read-only profile and search, notes, and asserted links only, every lookup by (kind, id), a duplicate answered 409. Roughly 200 lines.",
    evidence: "server/entities/entities.router.ts:61-76,131-184,522-575" },
  { id: "C3", step: 3, defect: false, impact: "high", effort: "medium", kinds: [],
    title: "A shared contract and three tests; the feature has none",
    today: "No test or end-to-end spec mentions the entity store, router, profile page or the nine tables. The browser and the server drifted apart (A1) with nothing to catch it.",
    change: "Validated response shapes in src/shared/entities/ imported by both sides; a graph test on fixtures (full chain, a dangling end, an abandoned run); a round-trip test that every real spec, run and study id resolves; a route test with injected sources.",
    evidence: "tests/ and e2e/: no file matches useEntityStore, entities.router or EntityProfile" },
  { id: "C4", step: 3, defect: false, impact: "low", effort: "small", kinds: ["study", "dataset"],
    title: "Study-to-dataset links exist; build them on the server",
    today: "Every study handler declares the lake views it reads. The only code that uses this matches names by prefix in the browser, so derived_labels also 'covers' any view that starts with it.",
    change: "Emit these as graph edges marked exact or family, and have the 'read by studies' strip consume them.",
    evidence: "server/studies/types.ts:38; studies/ReadByStudies.tsx:22-26" },
  { id: "C5", step: 3, defect: false, impact: "medium", effort: "medium", kinds: ["labels", "dataset", "run"],
    title: "Give each link a time and each far end a state",
    today: "Links describe 'now' only and are hard-deleted. Label sets retire, datasets are re-landed, directories disappear; the graph has no way to say so.",
    change: "Stamp a derived link with its child's own time and accept ?as_of=; mark a far end present, retired or missing; close an asserted link instead of deleting it.",
    evidence: "shared/schema.ts:1560-1569; server/entities/entities.router.ts:111-119" },

  { id: "D1", step: 4, defect: false, impact: "high", effort: "small", kinds: ["study", "dataset", "feature", "cycle", "model", "annotation"],
    title: "Drop six of the nine new tables; keep notes and asserted links",
    today: "studies, datasets, dataset_versions, features, wfv_definitions and system_components copy the page registry, the lake manifests, features.json, the cycle folds table and sidecars.json. All nine hold 0 rows and have no foreign key, check, lookup index or migration.",
    change: "Keep entity_annotations and an asserted-link table with a kind check, a uniqueness rule across (from, to, link kind) and an index on the target; add the migration. Removing the six means the next db:push drops them: harmless at 0 rows, but it is a table drop, so run it against a copy first.",
    evidence: "shared/schema.ts:1529-1622; data/ml_dashboard.db (nine tables, 0 rows each)" },
  { id: "D2", step: 4, defect: false, impact: "medium", effort: "small", kinds: ["annotation"],
    title: "Notes are the only rows that cannot be rebuilt, so land them in the lake",
    today: "Everything else in the graph can be re-derived. Notes and asserted links live only in a database file that is outside git and outside the lake, with no author column.",
    change: "Write each note as an append-only line landed under derived/entity_notes with its manifest line; SQLite becomes the read cache. Record who wrote it (user or Claude) and supersede rather than edit.",
    evidence: ".gitignore:62; shared/schema.ts:1544-1551" },
  { id: "D3", step: 4, defect: false, impact: "low", effort: "small", kinds: [],
    title: "Rename the 'Level 3 MLOps' banner or earn it",
    today: "Google's scale stops at level 2. On Microsoft's 0-4 scale, level 3 is automated deployment with traceability from a deployed model back to its data, which the code does not do (0 deployments, 0 versions).",
    change: "Call the section 'Entity graph and lineage tables'. The traceability test becomes one query once F2 exists: deployed version back to run, config hash, code hash and data version.",
    evidence: "shared/schema.ts:1557; Google Cloud MLOps levels 0-2; Azure MLOps maturity model levels 0-4" },
  { id: "D4", step: 4, defect: false, impact: "medium", effort: "medium", kinds: ["study"],
    title: "The findings ledger exists twice; keep one",
    today: "The same findings are free text in docs/EMPIRICAL_SOURCE_OF_TRUTH.md (its last row is malformed) and structured rows in the ledger study's data file.",
    change: "Make the structured rows the single definition, add the study each row came from, and generate the markdown from them or delete it. Do not add a third copy as notes.",
    evidence: "docs/EMPIRICAL_SOURCE_OF_TRUTH.md:12-46; studies/pages/empirical-source-of-truth/data.ts" },

  { id: "E1", step: 5, defect: true, impact: "medium", effort: "medium", kinds: ["model"],
    title: "Six pages are filtered by the active model without saying so",
    today: "Training, ML Studio, the run picker, Labels, Regression and Analytics all narrow themselves to the active model. Two show a passive banner; none offers 'show all'. ML Studio also jumps to its Evaluate stage.",
    change: "One shared filter bar with clear and show-all on all six; remove the forced stage jump; read the store through a selector so pages do not re-render on every change.",
    evidence: "ml/MLStudioPage.tsx:43-55; training/TrainingPage.tsx:113-120; labels/LabelsPage.tsx:131-172" },
  { id: "E2", step: 5, defect: false, impact: "medium", effort: "small", kinds: ["model", "cycle"],
    title: "Keep the entity separate from symbol and timeframe",
    today: "Analytics sends the chart's symbol beside the entity, so a model trained on MNQ 5m with the chart on EURUSD 1m gives an empty result with no explanation.",
    change: "Leave SymbolContext as the only writer of symbol and timeframe. Offer a 'follow this entity's market' button and show a chip when the chart and the entity disagree.",
    evidence: "analytics/AnalyticsPage.tsx:68-83; shared/contexts/SymbolContext.tsx:27-30" },
  { id: "E3", step: 5, defect: false, impact: "medium", effort: "small", kinds: [],
    title: "Persist the selection last, and hold it in one place",
    today: "The selection lives in memory in one tab. Saving it now would make a filter that matches nothing survive every reload. The dashboard runs in several windows at once, and browser storage is per window profile.",
    change: "After B1 and E1: put ?entity=kind:id in the address for links, and hold the active selection in one server record beside the chart context, which already works this way.",
    evidence: "shared/contexts/EntityContext.tsx:11-15; server/market/chartLink.ts:45" },

  { id: "F1", step: 6, defect: true, impact: "high", effort: "small", kinds: ["run", "session", "cycle"],
    title: "A run that dies with the server stays 'running' forever",
    today: "Startup cleanup marks orphaned training sessions failed, but not provenance runs. A run's heartbeat is written and never read, so a restart leaves it live in any graph.",
    change: "A startup reconciler: a run still 'running' with a stale heartbeat becomes 'crashed'. The profile returns the recorded and the effective status.",
    evidence: "server/main.ts:359-363; server/training/provenance.ts:681-695" },
  { id: "F2", step: 6, defect: false, impact: "high", effort: "medium", kinds: ["session", "run", "labels", "dataset"],
    title: "Record what each run read before drawing lineage",
    today: "0 of 83 sessions carry a label set id, and manifest lines carry no content hash and are replaced on re-landing, so 'which data did this model see' has no answer.",
    change: "Have the trainer and the Model Cycle emit the data content hash and the label recipe at start, then store run inputs and outputs from those. Reuse the existing hashes; mint no new ids.",
    evidence: "shared/schema.ts:98; server/training/provenance.ts:272-283,408-418" },
  { id: "F3", step: 6, defect: false, impact: "medium", effort: "medium", kinds: ["model", "version", "dataset"],
    title: "Drift is a lake dataset with its bins frozen, feeding the gate that waits for it",
    today: "The drift table stores two scores with no bin edges, baseline window or sample size, and nothing computes them. A promotion gate already waits for a drift producer. The column names psi_score and kl_divergence break the full-word rule.",
    change: "One shared definition with bin edges frozen on the training window, a floor for empty bins and the sample count; land it under derived/ as population_stability_index and a symmetric divergence; wire the gate to read it; drop the SQLite table.",
    evidence: "shared/schema.ts:1606-1613; server/infrastructure/lib/promotionGates.ts:184" },

  { id: "G1", step: 7, defect: false, impact: "medium", effort: "small", kinds: [],
    title: "One entity search for the rail and the command palette",
    today: "The rail reads five separate sources (three always empty, one a route that does not exist, errors swallowed). The palette lists pages only.",
    change: "GET /api/entity/search over the same resolvers, one hook, used by both. Hide a section until it has a real source.",
    evidence: "shared/hooks/useEntityBrowser.ts:23-86; quant-layout/LeftSidebar.tsx:77-81,103-109" },
  { id: "G2", step: 7, defect: false, impact: "medium", effort: "small", kinds: ["annotation"],
    title: "Let the Claude panel see the active entity and propose notes",
    today: "The panel is told the route, symbol and timeframe only. Its read tool cuts a response at 30,000 characters and it has no write tool.",
    change: "Add the entity and the cycle run to the panel's context; keep a profile response under 20,000 characters with counts and a cursor; a note Claude writes arrives as 'proposed' and waits for accept or reject.",
    evidence: "claude/ClaudePanel.tsx:96-101; server/claude/tools.ts:15-19,38-70" },
];
