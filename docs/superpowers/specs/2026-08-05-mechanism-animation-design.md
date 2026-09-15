# Mechanism Animation — design

> **Superseded data layer (2026-09-10).** Where this spec says QuestDB, read: the Iceberg lake
> at `E:\lake`, queried in-process by DuckDB (`from lake.serving import connect`). The QuestDB
> serving cache was emptied and retired — every table was copied to parquet in the lake and
> row-count verified first — and nothing may read or write it. The design below is kept as the
> record of what was decided at the time.

**Date:** 2026-08-05
**Status:** Wave 1 implemented and live-verified 2026-08-05 (spine + `cluster-loop`). Waves 2–5 outstanding.
**Surface:** new `Mechanism` tab on `/architecture`

---

## Problem

The `/architecture` page's Neurons view animates a model's forward pass with p5.js. It is
honest about what it draws, but it can only draw what `derive.ts` implements: 9 algorithm
ids. The catalog served by `GET /api/model-catalog/trainable` has **140 entries**.

The gap is worse than the count suggests. Of the 73 entries that currently resolve to a
graph, **48 resolve through `templateId: pytorch_mlp`**. BigGAN, CycleGAN, StyleGAN,
diffusion-model, normalizing-flow and neural-ODE-generator therefore all render the
*identical* three-layer MLP picture. The catalog entry names a published architecture; the
canvas draws the generic codegen fallback; nothing on screen says these are different
things.

Meanwhile a corpus of **300 markdown specs** sits at
`Trading/_architecture/educational/algo_models/` (reachable via `ALGO_MODELS_ROOT`, already
read by `infrastructure/lib/modelImport/catalogService.ts`). Each spec carries a real
Architecture section and a reference PyTorch implementation. `BigGAN.md` documents
class-conditional BatchNorm, skip-z, self-attention, a projection discriminator and hinge
loss — none of which reaches the screen today.

### Catalog ground truth (measured 2026-08-04, live server)

| templateId | n | | category | n | | runnerSource | n |
|---|---|---|---|---|---|---|---|
| *(none)* | 48 | | neural-network | 22 | | generate | 92 |
| `pytorch_mlp` | 48 | | generative | 20 | | browse-only | 44 |
| `sklearn` | 20 | | self-supervised | 20 | | wired | 4 |
| `pytorch_autoencoder` | 7 | | unsupervised | 20 | | | |
| `transformer_seq` | 6 | | hybrid-composite | 19 | | | |
| `pytorch_cnn` | 4 | | semi-supervised | 19 | | | |
| `temporal_fusion_transformer` | 2 | | supervised | 19 (+1) | | | |
| `pytorch_vae` | 1 | | | | | | |
| `composite_*` | 4 | | **total** | **140** | | **total** | **140** |

---

## Decisions

Four decisions were settled before design; they constrain everything below.

1. **Source of truth — both, side by side.** The main animation shows the *published*
   mechanism, researched from the spec corpus. An always-present banner states what this
   repo would actually train instead, and expands to show that graph.
2. **Granularity — archetype engine + per-model overlays.** 17 animated mechanisms. Each
   model is researched individually and rendered on its family's engine with its own stage
   labels and 1–3 distinguishing beats. WGAN is visibly not BigGAN.
3. **Placement — new top-level tab.** `/architecture` becomes
   `graph | trees | concepts | mechanism`. The existing Neurons view is untouched.
4. **Data — real MNQ bars everywhere.** Every archetype consumes real OHLCV from QuestDB.
   Seeded (untrained) weights are used only where no trained model exists, and are
   disclosed on the panel — the same honesty contract `NeuralCanvas` already holds.

An upgrade follows from (4): several archetypes can **genuinely train in the browser**
rather than run seeded. A two-layer generator and discriminator over six candle-geometry
features is trivial JavaScript, so the adversarial duel actually converges on real bars.

---

## Provenance tiers

Every panel states which tier it is in. This is the core honesty mechanism.

| Tier | Meaning | Archetypes |
|---|---|---|
| `analytic` | Math fully determined; the result is genuinely correct | cluster-loop, projection-embed, tree-route, density-boundary, graph-message-pass, ensemble-route |
| `trained-live` | Really optimized in-browser on real bars; step + loss shown | adversarial-duel, contrastive-pair, teacher-student, convex-fit, encode-bottleneck-decode |
| `seeded` | Real arithmetic, untrained weights; output is **not** a prediction | feedforward-stack, attention-match, autoregressive, iterative-denoise, symbolic-hybrid, agent-environment |

---

## Architecture

```
  /api/model-catalog/trainable          /api/charts/ohlcv
        140 entries                      real MNQ bars
             |                                 |
             v                                 v
   +------------------+            +----------------------+
   | mechanism/       |            | mechanism/data/      |
   |   registry/      |            |  candleGeometry.ts   |
   |  140 researched  |            |  -> 6 scale-free     |
   |  entries, cited  |            |     features/bar     |
   +--------+---------+            +----------+-----------+
            |  archetype id                   |  Float64 matrix
            v                                 v
      +---------------------------------------------+
      |  mechanism/archetypes/<id>.tsx  (p5, lazy)   |
      |  <- mechanism/compute/*.ts  (real math)      |
      +------------------+--------------------------+
                         v
            +----------------------------+
            | MechanismTab shell         |
            |  picker . canvas . beats   |
            |  provenance badge          |
            |  repo-runs-X banner        |
            +----------------------------+
```

### Module layout

All under `src/client/src/system/architecture-explorer/mechanism/`.

| Path | Contents | Target size |
|---|---|---|
| `registry/<archetype>.ts` x17 | researched entries for one archetype | 150–250 ln |
| `registry/types.ts` | `MechanismSpec`, `MechanismStage`, `MechanismBeat`, `ArchetypeId` | 90 ln |
| `registry/index.ts` | merge + `resolveMechanism()` + `unresearched()` | 80 ln |
| `archetypes/<id>.tsx` x17 | one p5 sketch each | 200–300 ln |
| `archetypes/index.ts` | `ArchetypeId -> lazy component` map | 40 ln |
| `compute/*.ts` | pure math kernels, no p5 import | 60–150 ln each |
| `data/candleGeometry.ts` | OHLCV -> 6 scale-free features | 90 ln |
| `data/useMechanismBars.ts` | real bars via existing chart API | 70 ln |
| `ProvenancePanel.tsx` | non-dismissible honesty block | 120 ln |
| `RepoRunnerBanner.tsx` | "what actually runs" + expand to `derive.ts` graph | 110 ln |
| `MechanismTab.tsx` | shell: picker, canvas host, controls | 250 ln |

No file targets the size of the existing 788-line `NeuralCanvas.tsx`. Every module stays
small enough to hold in one read.

### Resolution is total

`resolveMechanism(catalogKey)` returns either a researched entry or
`{ researched: false, reason }`. A catalog key with no entry renders a stated empty state.
**A sibling model's animation is never substituted for an unresearched one** — the same
refusal `catalog.ts` already makes for `templateId: 'tree'`.

---

## The registry

The research artifact. One typed entry per catalog key, each citing the spec file it was
read from.

```ts
export interface MechanismSpec {
  /** Catalog key from /api/model-catalog/trainable — the join key. */
  catalogKey: string;
  /** Display name, from the catalog. */
  name: string;
  /** Which of the 17 engines animates this. */
  archetype: ArchetypeId;
  /** Provenance of the numbers this panel shows. */
  provenance: 'analytic' | 'trained-live' | 'seeded';
  /** Spec this was researched from, relative to ALGO_MODELS_ROOT. Citation. */
  specPath: string;
  /** One-line trading-grounded "Think of it as ..." summary. */
  analogy: string;
  /** Ordered stages the engine labels. Real names from the spec. */
  stages: MechanismStage[];
  /** 1–3 beats distinguishing THIS model from its archetype siblings. */
  beats: MechanismBeat[];
  /** What this repo would actually train instead. Null when they match. */
  repoRunner: { templateId: string; note: string } | null;
}

export interface MechanismStage {
  id: string;
  label: string;    // "Class-conditional BatchNorm"
  detail?: string;  // "gamma_y, beta_y from shared class embedding"
  role: 'input' | 'transform' | 'latent' | 'score' | 'loss' | 'update' | 'output';
}

export interface MechanismBeat {
  id: string;
  label: string;    // "spectral normalization"
  at: string;       // stage id this fires at
  detail: string;   // one sentence, from the spec
}
```

Worked example:

```ts
{
  catalogKey: 'biggan',
  name: 'BigGAN',
  archetype: 'adversarial-duel',
  provenance: 'trained-live',
  specPath: 'Generative Models/Adversarial/BigGAN.md',
  analogy: 'Two traders: one forges tape, one calls the forgery. '
         + 'Each gets better because the other does.',
  stages: [
    { id: 'z',     role: 'input',     label: 'latent z',        detail: '128-d Gaussian' },
    { id: 'embed', role: 'input',     label: 'class embedding', detail: 'shared, linearly projected' },
    { id: 'g',     role: 'transform', label: 'Generator',       detail: 'FC -> conv blocks' },
    { id: 'd',     role: 'score',     label: 'Discriminator',   detail: 'projection, spectral-norm' },
    { id: 'loss',  role: 'loss',      label: 'hinge loss' },
  ],
  beats: [
    { id: 'cbn',   at: 'g', label: 'class-conditional BatchNorm',
      detail: 'gamma_y, beta_y come from the shared class embedding, not a per-layer MLP.' },
    { id: 'skipz', at: 'g', label: 'skip-z',
      detail: 'z is split per resolution and re-injected at each block.' },
    { id: 'sa',    at: 'g', label: 'self-attention',
      detail: 'SAGAN module lets distant regions attend to each other.' },
  ],
  repoRunner: {
    templateId: 'pytorch_mlp',
    note: 'This spec has no BigGAN runner. Training it here renders the generic '
        + 'pytorch_mlp template — a 3-layer MLP over the 35-feature vector.',
  },
}
```

Three invariants:

1. **Every entry cites its spec path.** Any claim on screen is traceable to a file, so a
   wrong beat is a findable bug rather than an opinion.
2. **`beats` carries the per-model granularity.** WGAN's beat is *critic + weight clipping,
   no sigmoid*; BigGAN's are *cond-BN, skip-z, self-attention*. Same engine, different runs.
3. **`repoRunner` is non-null for all 48 `pytorch_mlp` entries** — the banner is populated
   from measured data, not hand-waved.

---

## The 17 archetypes

| # | ArchetypeId | What the viewer watches | Tier | ~n |
|---|---|---|---|---|
| 1 | `feedforward-stack` | packet crosses columns left to right, layer by layer | seeded | 11 |
| 2 | `adversarial-duel` | G forges a bar, D calls it, loss arrows push both back | trained-live | 10 |
| 3 | `encode-bottleneck-decode` | funnel narrows to latent, re-expands, reconstruction error shrinks | trained-live | 8 |
| 4 | `iterative-denoise` | noise vector walks T steps toward structure, schedule bar draining | seeded | 7 |
| 5 | `attention-match` | Q·K^T heat cells fill one by one, row softmaxes, V weighted-sums | seeded | 8 |
| 6 | `autoregressive` | mask slides along the bar strip, each step predicting the next | seeded | 4 |
| 7 | `tree-route` | a real bar falls through real splits, leaf values accumulating | analytic | 7 |
| 8 | `convex-fit` | hyperplane rotates into place under real gradient descent + live loss curve | trained-live | 15 |
| 9 | `cluster-loop` | points recolor, centroids jump, assign/update until genuine convergence | analytic | 11 |
| 10 | `projection-embed` | 35-d cloud collapses onto real principal axes, variance % ticking up | analytic | 6 |
| 11 | `contrastive-pair` | two augmented views of one window pull together, negatives shove apart | trained-live | 12 |
| 12 | `graph-message-pass` | messages travel edges, neighbour features average into each node | analytic | 7 |
| 13 | `teacher-student` | teacher labels unlabeled bars, student fits, EMA arrow drags teacher | trained-live | 13 |
| 14 | `ensemble-route` | N sub-models each emit a value; gate/vote/meta-learner folds them | analytic | 8 |
| 15 | `symbolic-hybrid` | rule box fires and lights, net box scores, merge node reconciles | seeded | 7 |
| 16 | `agent-environment` | action -> env -> reward -> policy update, closing the loop | seeded | 3 |
| 17 | `density-boundary` | contour tightens around inliers; outliers pop out and get flagged | analytic | 3 |

Counts are planning estimates that sum to 140; the research will shift models between
families as the specs are read. **Exact per-model assignment is the research deliverable.**
Total coverage holds regardless of how the counts land, because `resolveMechanism` covers
every catalog key or states why not — enforced by the coverage test below.

---

## Data and compute

### Feature source

`data/candleGeometry.ts` mirrors `scripts/candle_geometry.py` exactly:

- **Shape ÷ range (scale-free):** `open_norm`, `close_norm`, `body_norm` in [-1,1],
  `upper_norm`, `lower_norm`. Range 0 yields the neutral value.
- **Causal trailing rolling z-scores:** `range_z`, `body_z`, `wick_z`, `return_z`,
  `volume_z`. Window 100, `min_periods = 100`, clipped to +/-5.

Chosen over the 35-feature Python pipeline because candle geometry is **scale-free and
causal by construction**, so a browser-side K-Means over it is a genuinely correct result
rather than a toy. It is already the repo's canonical per-bar embedding
(`candle_geometry_1m` view, `scripts/candle_geometry.py`), and a TypeScript port is
verifiable against the Python on identical bars.

No raw price level or tick count is exposed, matching the price-normalization rule.

### Compute kernels

Pure, synchronous, unit-testable, no p5 import.

| Kernel | Contents |
|---|---|
| `compute/kmeans.ts` | Lloyd's algorithm, k-means++ init, real convergence test |
| `compute/pca.ts` | covariance -> Jacobi eigendecomposition -> components + explained variance |
| `compute/attention.ts` | `softmax(QK^T / sqrt(d)) V` — the real operation, seeded projections |
| `compute/conv.ts` | 1-D convolution + pooling over the bar window |
| `compute/treeRoute.ts` | walks the REAL `.ubj` tree served by `/api/anatomy/trees/:id` |
| `compute/gan.ts` | tiny G/D, real SGD, real hinge and BCE losses |
| `compute/infonce.ts` | real InfoNCE over augmented candle views |
| `compute/gd.ts` | gradient descent for the convex family (ridge, lasso, logistic, SVM, quantile) |
| `compute/lof.ts` | real local outlier factor / one-class boundary |
| `compute/graph.ts` | message passing / label propagation |

### Bars and cold start

Bars come from the existing `/api/charts/ohlcv` path via `data/useMechanismBars.ts`. The
first candle-geometry window needs >= 100 bars of warmup; until then the panel shows a
stated loading state and never renders a silent partial result.

---

## UI

```
+- Mechanism ------------------------------------------------------+
| MNQ v  1m v  240 bars        Model: BigGAN v (grouped by family)  |
+----------------------------------------------+-------------------+
|                                              | WHAT MAKES THIS   |
|                                              | BigGAN            |
|        [ p5 canvas — the duel running ]      |  - class-cond BN  |
|                                              |  - skip-z         |
|                                              |  - self-attention |
|                                              |   (click to fire) |
|  <<  || pause   >> step    speed --o--       +-------------------+
|                                              | data  MNQ 1m 240  |
|                                              |       real, QuestDB|
|                                              | weights trained-  |
|                                              |       live step 412|
|                                              |       D-loss 0.68 |
|                                              | source BigGAN.md  |
+----------------------------------------------+-------------------+
| This repo has no BigGAN runner. Training this spec renders the   |
| generic pytorch_mlp template.     [ show what actually runs v ]  |
+------------------------------------------------------------------+
```

**Beats panel** lists the model's distinguishing beats; clicking one fires that beat in the
animation and highlights the stage it attaches to.

**Provenance panel** is non-dismissible and always populated from real values: bar count and
date range from the executed query, training step and loss from the live optimizer, spec
path from the registry citation.

**Repo-runs-X banner** appears only when `repoRunner` is non-null. Expanding it swaps the
canvas to the genuine `derive.ts` graph for that template — so the comparison is two real
animations, not a text disclaimer.

**Controls:** play/pause, single-step, speed, reset. `prefers-reduced-motion` pauses to a
settled frame, matching `NeuralCanvas`.

### Colour

Okabe-Ito throughout. **No red/green pairing anywhere.** Positive/up = orange `#E69F00`,
negative/down = blue `#0072B2`. Every categorical distinction also carries shape or label,
never hue alone: centroids are squares, points circles, outliers ringed, real samples
solid, generated samples outlined.

---

## Verification

The "all models" claim is a test, not an assertion in prose.

```ts
// tests/client/mechanism-coverage.test.ts
it('resolves every catalog key', () => {
  for (const key of CATALOG_FIXTURE_KEYS) {          // all 140, fixtured
    const r = resolveMechanism(key);
    expect(r.researched || r.reason).toBeTruthy();   // never silently blank
  }
});

it('has researched all 140', () => {
  expect(unresearched()).toEqual([]);                // goes green in wave 5
});
```

Additionally:

- **Known-answer tests per compute kernel** — PCA against a hand-built covariance matrix
  with known eigenvectors; K-Means on separable blobs; attention rows summing to 1; tree
  routing against a fixture produced by `scripts/dump_model_trees.py`.
- **Candle-geometry parity test** — a bar fixture plus expected values generated by
  `scripts/candle_geometry.py`, asserting the TypeScript port matches the Python.
- **Registry integrity** — every `archetype` exists in the engine map; every `specPath` is
  non-empty; no entry claims `trained-live` for an archetype with no training kernel.
- **Mount/unmount smoke test per archetype** — jsdom with p5 mocked, asserting no crash and
  no leaked p5 instance.

Gates before each wave is called done: `npm run verify`, `tsc --noEmit` exit 0, full vitest
suite with no new failures, and a live browser check with zero console errors.

---

## Waves

Each ships working and verifiable on its own.

| Wave | Contents | Proves |
|---|---|---|
| **1 — spine** | registry types + resolver + coverage test; `candleGeometry.ts` + parity test; `MechanismTab` shell; `ProvenancePanel`; `RepoRunnerBanner`; `cluster-loop` end to end | the whole path works on real bars and genuinely converges |
| **2 — analytic** | `tree-route`, `projection-embed`, `density-boundary`, `graph-message-pass` + their registry entries | the correct-by-construction tier |
| **3 — trained-live** | `convex-fit`, `adversarial-duel`, `contrastive-pair`, `teacher-student`, `encode-bottleneck-decode` + entries | in-browser optimization really converges |
| **4 — seeded** | `attention-match`, `feedforward-stack`, `autoregressive`, `iterative-denoise`, `ensemble-route`, `symbolic-hybrid`, `agent-environment` + entries | full 17-archetype coverage |
| **5 — close out** | remaining registry research; `unresearched()` returns `[]`; CLAUDE.md and docs updated | 140/140, mechanically enforced |

Wave 1 is the risk checkpoint. If the spine reads wrong on screen it is cheap to change
there and expensive later.

---

## Out of scope

Named explicitly rather than assumed:

- No changes to `derive.ts`, the Neurons view, the Blocks view, or the trees tab.
- No changes to any training, codegen, or backend path.
- No new server endpoints. The tab is read-only against `/api/model-catalog/trainable`,
  `/api/charts/ohlcv` and `/api/anatomy/trees/:id`, all of which already exist.
- No modification to the spec corpus at `ALGO_MODELS_ROOT`; it is read as research input
  and cited, never edited.
- The `gradcam.ts` synthetic-attention module remains unused and untouched; it is not a
  source for `attention-match`, which computes the real operation.
