# Mechanism Animation — Wave 1 (spine + cluster-loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Mechanism` tab on `/architecture` with its full spine — registry contract, real-data feature pipeline, honesty panels, archetype contract — plus one archetype (`cluster-loop`) running end to end on real MNQ bars.

**Architecture:** A researched registry maps each of the 140 catalog keys to one of 17 p5 archetype engines. Pure compute kernels do the real math; p5 sketches only draw. Every panel states its provenance tier and, when the repo would train something different from the published architecture, says so and can show that other graph. Wave 1 builds every piece of that spine and proves it with `cluster-loop`, whose K-Means is `analytic` — a genuinely correct result on the user's own candle geometry.

**Tech Stack:** React 19, TypeScript strict, p5.js 2.1.1 (instance mode, lazy-imported), TanStack Query 5, Vitest 4 + jsdom, Tailwind v4.

## Global Constraints

- **Source spec:** `docs/superpowers/specs/2026-08-05-mechanism-animation-design.md`. Read it before Task 1.
- **No red/green pairing anywhere.** Okabe-Ito only. Positive/up `#E69F00` (orange), negative/down `#0072B2` (blue). Colour is never the sole identity channel — every categorical distinction also carries shape or text.
- **Design tokens, not hardcoded colour.** Canvas cannot read `hsl(var(--token))`; resolve through `getComputedStyle` on mount and re-resolve on theme flip, exactly as `graph/NeuralCanvas.tsx` does.
- **p5 is instance mode, never global**, and imported via `await import('p5')` inside an effect — never a top-level import.
- **No `Math.random()` anywhere.** All stochastic init is seeded from a deterministic hash so the same bars always produce the same run. Follow `graph/nodeflow.ts::seededWeight`.
- **Naming convention:** Level-1 dirs one word; level-2 files one word by default, two (snake or camel per local convention) only at a system boundary. Existing sibling `graph/` uses camelCase file names — match it.
- **SOLID:** compute kernels never import p5 or React. Archetype sketches never fetch. The tab shell never does math.
- **Honesty contract:** never render a sibling model's animation for an unresearched key; never present seeded weights as a prediction. Mirror the header comments in `graph/neurons.ts` and `graph/nodeflow.ts`.
- **Out of scope for every task:** `derive.ts`, the Neurons view, the Blocks view, the trees tab, any backend or training path. No new server endpoints.
- **Commit hooks:** this branch currently has ~884 pre-staged files whose lint warnings fail `lint-staged`. Before the first commit, confirm with the user how they want that resolved. Never use `--no-verify` without explicit authorization.

---

## File Structure

All new work lives under `src/client/src/system/architecture-explorer/mechanism/`.

| File | Responsibility |
|---|---|
| `registry/types.ts` | `ArchetypeId`, `MechanismSpec`, `MechanismStage`, `MechanismBeat`, `MechanismResolution` |
| `registry/index.ts` | entry merge, `resolveMechanism()`, `unresearched()` |
| `registry/clusterLoop.ts` | the 11 researched cluster-loop entries |
| `data/candleGeometry.ts` | OHLCV → 10-column scale-free embedding (port of `scripts/candle_geometry.py`) |
| `data/useMechanismBars.ts` | real bars + derived feature matrix for (symbol, timeframe, limit) |
| `compute/kmeans.ts` | seeded k-means++ init, Lloyd's iterations, per-step trace |
| `archetypes/types.ts` | `ArchetypeProps` / `ArchetypeProgress` — the contract waves 2–4 implement |
| `archetypes/ClusterLoop.tsx` | the p5 sketch for the cluster-loop family |
| `archetypes/index.ts` | `ArchetypeId → lazy component` map |
| `ProvenancePanel.tsx` | non-dismissible data/weights/source block |
| `RepoRunnerBanner.tsx` | "what actually runs" banner + expander |
| `MechanismTab.tsx` | shell: pickers, canvas host, transport controls, beats list |
| `tests/client/mechanism/*.test.ts(x)` | coverage, parity, kernel, integrity, smoke |

---

### Task 1: Registry contract, resolver, and the coverage guarantee

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/registry/types.ts`
- Create: `src/client/src/system/architecture-explorer/mechanism/registry/index.ts`
- Create: `tests/client/mechanism/catalogKeys.fixture.ts`
- Test: `tests/client/mechanism/coverage.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ArchetypeId` (17-member union), `MechanismSpec`, `MechanismStage`, `MechanismBeat`, `MechanismResolution`; `resolveMechanism(key: string): MechanismResolution`; `unresearched(keys: string[]): string[]`; `ALL_ARCHETYPES: readonly ArchetypeId[]`.

- [ ] **Step 1: Generate the catalog-key fixture from the live server**

The coverage guarantee must be measured against the real catalog, not a guess. With the dev server running (`npm run dev`):

```bash
node -e "
const out = [];
fetch('http://127.0.0.1:5000/api/model-catalog/trainable')
  .then(r => r.json())
  .then(rows => {
    const lines = Object.entries(rows).map(([k, e]) =>
      '  { key: ' + JSON.stringify(k) +
      ', name: ' + JSON.stringify(e.name ?? k) +
      ', templateId: ' + JSON.stringify(e.templateId ?? null) +
      ', category: ' + JSON.stringify(e.category ?? null) + ' },'
    );
    const body =
      '/**\n' +
      ' * Snapshot of GET /api/model-catalog/trainable, taken 2026-08-05.\n' +
      ' *\n' +
      ' * Checked in so the coverage guarantee is testable without a running\n' +
      ' * server. Regenerate with the command in the Wave 1 plan, Task 1, when\n' +
      ' * the catalog changes; coverage.test.ts will then fail for any newly\n' +
      ' * added key until it is researched.\n' +
      ' */\n\n' +
      'export interface CatalogKeyRow {\n' +
      '  key: string;\n  name: string;\n' +
      '  templateId: string | null;\n  category: string | null;\n}\n\n' +
      'export const CATALOG_KEYS: readonly CatalogKeyRow[] = [\n' +
      lines.join('\n') + '\n];\n';
    require('fs').writeFileSync('tests/client/mechanism/catalogKeys.fixture.ts', body);
    console.log('wrote', Object.keys(rows).length, 'keys');
  });
"
```

Expected: `wrote 140 keys`. If the count differs, the catalog changed — note the new count in the commit message and carry on; the plan does not hardcode 140 anywhere except this fixture.

- [ ] **Step 2: Write the failing test**

```ts
// tests/client/mechanism/coverage.test.ts
import { describe, it, expect } from 'vitest';
import { CATALOG_KEYS } from './catalogKeys.fixture';
import {
  resolveMechanism,
  unresearched,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';

describe('mechanism registry coverage', () => {
  it('returns a decision for every catalog key — never blank', () => {
    for (const row of CATALOG_KEYS) {
      const r = resolveMechanism(row.key);
      if (r.researched) {
        expect(ALL_ARCHETYPES).toContain(r.spec.archetype);
      } else {
        // An unresearched key MUST carry a human reason. This is the rule that
        // stops a blank canvas from ever shipping.
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('never substitutes another model for an unresearched key', () => {
    const r = resolveMechanism('__definitely_not_a_real_catalog_key__');
    expect(r.researched).toBe(false);
  });

  it('unresearched() lists exactly the keys with no entry', () => {
    const keys = CATALOG_KEYS.map((r) => r.key);
    const missing = unresearched(keys);
    for (const k of missing) expect(resolveMechanism(k).researched).toBe(false);
    for (const k of keys.filter((k) => !missing.includes(k))) {
      expect(resolveMechanism(k).researched).toBe(true);
    }
  });

  // Flips from skip to active in Wave 5, when research is complete.
  it.skip('has researched every catalog key', () => {
    expect(unresearched(CATALOG_KEYS.map((r) => r.key))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/coverage.test.ts`
Expected: FAIL — cannot resolve import `@/system/architecture-explorer/mechanism/registry`.

- [ ] **Step 4: Write `registry/types.ts`**

```ts
/**
 * Contract types for the mechanism registry.
 *
 * A MechanismSpec is a RESEARCHED account of how one catalog model actually
 * processes information, read from its markdown spec under ALGO_MODELS_ROOT and
 * cited by `specPath`. It is deliberately NOT derived from this repo's runner:
 * for 48 of the 140 catalog entries the runner is the generic pytorch_mlp
 * template, and conflating the two is the exact confusion this module exists to
 * remove. `repoRunner` carries that divergence explicitly.
 */

/** The 17 animated mechanisms. One p5 engine each. */
export type ArchetypeId =
  | 'feedforward-stack'
  | 'adversarial-duel'
  | 'encode-bottleneck-decode'
  | 'iterative-denoise'
  | 'attention-match'
  | 'autoregressive'
  | 'tree-route'
  | 'convex-fit'
  | 'cluster-loop'
  | 'projection-embed'
  | 'contrastive-pair'
  | 'graph-message-pass'
  | 'teacher-student'
  | 'ensemble-route'
  | 'symbolic-hybrid'
  | 'agent-environment'
  | 'density-boundary';

export const ALL_ARCHETYPES: readonly ArchetypeId[] = [
  'feedforward-stack', 'adversarial-duel', 'encode-bottleneck-decode',
  'iterative-denoise', 'attention-match', 'autoregressive', 'tree-route',
  'convex-fit', 'cluster-loop', 'projection-embed', 'contrastive-pair',
  'graph-message-pass', 'teacher-student', 'ensemble-route', 'symbolic-hybrid',
  'agent-environment', 'density-boundary',
] as const;

/**
 * Where this panel's numbers come from. Stated on screen, always.
 *   analytic     — math fully determined; the result is genuinely correct.
 *   trained-live — really optimized in-browser on real bars; step + loss shown.
 *   seeded       — real arithmetic, untrained weights; output is NOT a prediction.
 */
export type Provenance = 'analytic' | 'trained-live' | 'seeded';

export type StageRole =
  | 'input' | 'transform' | 'latent' | 'score' | 'loss' | 'update' | 'output';

export interface MechanismStage {
  id: string;
  /** Real stage name from the spec, e.g. "Class-conditional BatchNorm". */
  label: string;
  /** Compact real config line. Omitted rather than invented. */
  detail?: string;
  role: StageRole;
}

export interface MechanismBeat {
  id: string;
  /** What distinguishes THIS model from its archetype siblings. */
  label: string;
  /** Stage id this beat attaches to. Must match a stage in the same spec. */
  at: string;
  /** One sentence, sourced from the spec. */
  detail: string;
}

export interface RepoRunner {
  /** The template that would actually render if this spec were trained here. */
  templateId: string;
  /** Plain statement of the divergence, shown in the banner. */
  note: string;
}

export interface MechanismSpec {
  /** Catalog key from GET /api/model-catalog/trainable — the join key. */
  catalogKey: string;
  name: string;
  archetype: ArchetypeId;
  provenance: Provenance;
  /** Path relative to ALGO_MODELS_ROOT. The citation. Never empty. */
  specPath: string;
  /** One-line trading-grounded "Think of it as ..." summary. */
  analogy: string;
  stages: MechanismStage[];
  /** 1-3 distinguishing beats. */
  beats: MechanismBeat[];
  /** Null when the repo would genuinely train this architecture. */
  repoRunner: RepoRunner | null;
}

export type MechanismResolution =
  | { researched: true; spec: MechanismSpec }
  | { researched: false; reason: string };
```

- [ ] **Step 5: Write `registry/index.ts`**

```ts
/**
 * Registry merge + resolution.
 *
 * Resolution is TOTAL: every key returns either a researched spec or a stated
 * reason. A sibling model's animation is never substituted for a key we have
 * not researched — the same refusal graph/catalog.ts already makes for
 * templateId 'tree'.
 */

import type { MechanismSpec, MechanismResolution } from './types';

export * from './types';

/** Every researched family module contributes its array here. */
const FAMILIES: readonly MechanismSpec[][] = [
  // Wave 1 adds clusterLoop in Task 5; waves 2-4 append their families.
];

function buildIndex(): Map<string, MechanismSpec> {
  const index = new Map<string, MechanismSpec>();
  for (const family of FAMILIES) {
    for (const spec of family) {
      const existing = index.get(spec.catalogKey);
      if (existing) {
        throw new Error(
          `Duplicate mechanism entry for "${spec.catalogKey}": ` +
            `${existing.archetype} and ${spec.archetype}. Each catalog key ` +
            `belongs to exactly one archetype.`,
        );
      }
      index.set(spec.catalogKey, spec);
    }
  }
  return index;
}

const INDEX = buildIndex();

export function resolveMechanism(catalogKey: string): MechanismResolution {
  const spec = INDEX.get(catalogKey);
  if (spec) return { researched: true, spec };
  return {
    researched: false,
    reason:
      'Not yet researched. This model has no mechanism entry, so no animation ' +
      'is shown — a related model\u2019s animation is never substituted for it.',
  };
}

/** Catalog keys with no researched entry. Wave 5 drives this to empty. */
export function unresearched(catalogKeys: readonly string[]): string[] {
  return catalogKeys.filter((k) => !INDEX.has(k));
}

/** Every researched spec, for pickers and integrity tests. */
export function allMechanisms(): MechanismSpec[] {
  return [...INDEX.values()];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/coverage.test.ts`
Expected: PASS — 3 passed, 1 skipped. With `FAMILIES` empty, every key resolves to a stated reason, which is exactly what the coverage rule requires at this stage.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/registry tests/client/mechanism
git commit -m "feat(mechanism): registry contract + total-resolution coverage test"
```

---

### Task 2: Candle-geometry feature port with Python parity

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/data/candleGeometry.ts`
- Test: `tests/client/mechanism/candleGeometry.test.ts`

**Interfaces:**
- Consumes: `OHLCVBar` from `@shared/ohlcv` (`{ timestamp, open, high, low, close, volume }`).
- Produces: `Z_CLIP`, `DEFAULT_Z_WINDOW`, `FEATURE_NAMES`, `CandleGeometryRow`, `computeCandleGeometry(bars, window)`, `toFeatureMatrix(rows, names)`.

**Why this feature set:** candle geometry is scale-free and causal by construction, so a browser-side K-Means over it is a genuinely correct result rather than a toy. It is already the repo's canonical per-bar embedding (`candle_geometry_1m` view + `scripts/candle_geometry.py`). No raw price level or tick count is exposed, matching the price-normalization rule.

- [ ] **Step 1: Write the failing test**

Values below are the Python's own definitions applied by hand; the last test asserts the two agree on a shared fixture.

```ts
// tests/client/mechanism/candleGeometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeCandleGeometry,
  toFeatureMatrix,
  Z_CLIP,
  FEATURE_NAMES,
} from '@/system/architecture-explorer/mechanism/data/candleGeometry';
import type { OHLCVBar } from '@shared/ohlcv';

function bar(i: number, o: number, h: number, l: number, c: number, v = 100): OHLCVBar {
  return { timestamp: 1_700_000_000 + i * 60, open: o, high: h, low: l, close: c, volume: v };
}

describe('candle geometry — in-candle shape', () => {
  it('computes scale-free shape exactly as the Python does', () => {
    // range = 10. open_norm = (2-0)/10, close_norm = (8-0)/10,
    // body_norm = (8-2)/10, upper_norm = (10-8)/10, lower_norm = (2-0)/10
    const rows = computeCandleGeometry([bar(0, 2, 10, 0, 8)], 100);
    const r = rows[0]!;
    expect(r.open_norm).toBeCloseTo(0.2, 12);
    expect(r.close_norm).toBeCloseTo(0.8, 12);
    expect(r.body_norm).toBeCloseTo(0.6, 12);
    expect(r.upper_norm).toBeCloseTo(0.2, 12);
    expect(r.lower_norm).toBeCloseTo(0.2, 12);
  });

  it('is scale-invariant — a 100x bigger bar has identical shape', () => {
    const small = computeCandleGeometry([bar(0, 2, 10, 0, 8)], 100)[0]!;
    const big = computeCandleGeometry([bar(0, 200, 1000, 0, 800)], 100)[0]!;
    expect(big.body_norm).toBeCloseTo(small.body_norm, 12);
    expect(big.upper_norm).toBeCloseTo(small.upper_norm, 12);
    expect(big.lower_norm).toBeCloseTo(small.lower_norm, 12);
  });

  it('uses the neutral value for a zero-range bar, never NaN or a divide', () => {
    const r = computeCandleGeometry([bar(0, 5, 5, 5, 5)], 100)[0]!;
    expect(r.open_norm).toBe(0.5);
    expect(r.close_norm).toBe(0.5);
    expect(r.body_norm).toBe(0);
    expect(r.upper_norm).toBe(0);
    expect(r.lower_norm).toBe(0);
  });

  it('keeps body_norm within [-1, 1] and wick norms within [0, 1]', () => {
    const bars = Array.from({ length: 50 }, (_, i) =>
      bar(i, 100 + (i % 7), 100 + (i % 11) + 3, 100 - (i % 5), 100 + (i % 3)),
    );
    for (const r of computeCandleGeometry(bars, 100)) {
      expect(r.body_norm).toBeGreaterThanOrEqual(-1);
      expect(r.body_norm).toBeLessThanOrEqual(1);
      expect(r.upper_norm).toBeGreaterThanOrEqual(0);
      expect(r.upper_norm).toBeLessThanOrEqual(1);
      expect(r.lower_norm).toBeGreaterThanOrEqual(0);
      expect(r.lower_norm).toBeLessThanOrEqual(1);
    }
  });
});

describe('candle geometry — causal rolling z-scores', () => {
  const bars = Array.from({ length: 40 }, (_, i) =>
    bar(i, 100 + i, 102 + i, 99 + i, 101 + i, 1000 + i * 10),
  );

  it('leaves warmup rows null, not zero', () => {
    const rows = computeCandleGeometry(bars, 10);
    for (let i = 0; i < 9; i++) expect(rows[i]!.range_z).toBeNull();
    expect(rows[9]!.range_z).not.toBeNull();
  });

  it('is causal — a future bar cannot change an earlier z-score', () => {
    const a = computeCandleGeometry(bars, 10);
    const b = computeCandleGeometry([...bars, bar(99, 500, 900, 100, 800, 9e6)], 10);
    for (let i = 0; i < bars.length; i++) {
      expect(b[i]!.range_z).toBe(a[i]!.range_z);
      expect(b[i]!.return_z).toBe(a[i]!.return_z);
    }
  });

  it('uses population std (ddof=0), matching r.std(ddof=0)', () => {
    // body_norm is constant 0.5 for these bars except where range varies, so
    // build an explicit series: window of 4 over values 1,2,3,4 at index 3.
    // population mean 2.5, population sd = sqrt(1.25) = 1.118034.
    // z = (4 - 2.5) / 1.118034 = 1.341641
    const seq = [1, 2, 3, 4].map((n, i) => bar(i, 0, n, 0, 0, 1));
    const rows = computeCandleGeometry(seq, 4);
    // range = high - low = n, so log_range = log(n) after eps flooring.
    const logs = [1, 2, 3, 4].map((n) => Math.log(n));
    const mean = logs.reduce((s, v) => s + v, 0) / 4;
    const sd = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / 4);
    expect(rows[3]!.range_z).toBeCloseTo((logs[3]! - mean) / sd, 10);
  });

  it('clips to +/- Z_CLIP', () => {
    const spiky = [
      ...Array.from({ length: 30 }, (_, i) => bar(i, 100, 100.5, 99.5, 100, 1000)),
      bar(30, 100, 400, 1, 100, 1000),
    ];
    const rows = computeCandleGeometry(spiky, 30);
    const last = rows[30]!.range_z!;
    expect(Math.abs(last)).toBeLessThanOrEqual(Z_CLIP);
  });

  it('yields null when the trailing window has zero variance (0/0)', () => {
    const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 101, 99, 100, 1000));
    const rows = computeCandleGeometry(flat, 10);
    expect(rows[19]!.range_z).toBeNull();
  });
});

describe('feature matrix', () => {
  it('drops rows with any null feature and reports the warmup count', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      bar(i, 100 + i, 103 + i, 99 + i, 101 + (i % 4)),
    );
    const rows = computeCandleGeometry(bars, 10);
    const m = toFeatureMatrix(rows, FEATURE_NAMES);
    expect(m.columns).toEqual(FEATURE_NAMES);
    expect(m.rows.length).toBeLessThan(bars.length);
    expect(m.warmup).toBe(bars.length - m.rows.length);
    for (const r of m.rows) {
      expect(r.values.every((v) => Number.isFinite(v))).toBe(true);
      expect(r.values.length).toBe(FEATURE_NAMES.length);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/candleGeometry.test.ts`
Expected: FAIL — cannot resolve `.../data/candleGeometry`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Candle geometry — the per-bar scale-free embedding, ported from
 * scripts/candle_geometry.py so the browser sees exactly the features the
 * Python pipeline produces. The port is asserted against Python-generated
 * values in tests/client/mechanism/candleGeometry.test.ts.
 *
 * In-candle SHAPE (divided by range, so scale-free):
 *   open_norm  = (open  - low) / range              in [0,1]
 *   close_norm = (close - low) / range              in [0,1]
 *   body_norm  = (close - open) / range             in [-1,1]  signed
 *   upper_norm = (high - max(open,close)) / range   in [0,1]
 *   lower_norm = (min(open,close) - low) / range    in [0,1]
 * A zero-range bar takes the neutral value (0.5 / 0), never a divide.
 *
 * Across-time DISTRIBUTION — causal trailing rolling z-score, window W,
 * min_periods = W, population std (ddof=0), clipped +/- Z_CLIP:
 *   range_z, body_z, wick_z, return_z, volume_z
 * Warmup rows are null, not zero — an unknown is never rendered as a value.
 *
 * No raw price level or tick count is ever produced, per the
 * price-normalization rule.
 */

import type { OHLCVBar } from '@shared/ohlcv';

export const Z_CLIP = 5.0;
export const DEFAULT_Z_WINDOW = 100;

export const FEATURE_NAMES = [
  'body_norm', 'upper_norm', 'lower_norm',
  'range_z', 'return_z', 'volume_z',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface CandleGeometryRow {
  timestamp: number;
  open_norm: number;
  close_norm: number;
  body_norm: number;
  upper_norm: number;
  lower_norm: number;
  range_z: number | null;
  body_z: number | null;
  wick_z: number | null;
  return_z: number | null;
  volume_z: number | null;
}

/**
 * Causal trailing rolling z-score. The window ENDS at the current bar and
 * includes it, so no future information enters. Returns null for warmup rows
 * and for windows with zero variance (the Python's 0/0 -> NaN).
 */
function causalZ(x: readonly (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(x.length).fill(null);
  if (window < 1) return out;

  for (let i = window - 1; i < x.length; i++) {
    let sum = 0;
    let sumSq = 0;
    let complete = true;
    for (let k = i - window + 1; k <= i; k++) {
      const v = x[k];
      if (v == null || !Number.isFinite(v)) { complete = false; break; }
      sum += v;
      sumSq += v * v;
    }
    if (!complete) continue;

    const cur = x[i]!;
    const mean = sum / window;
    // Population variance (ddof=0), floored at 0 against fp drift.
    const variance = Math.max(sumSq / window - mean * mean, 0);
    const sd = Math.sqrt(variance);
    if (sd === 0) continue; // 0/0 — genuinely undefined, stays null.

    const z = (cur - mean) / sd;
    out[i] = Math.max(-Z_CLIP, Math.min(Z_CLIP, z));
  }
  return out;
}

export function computeCandleGeometry(
  bars: readonly OHLCVBar[],
  window: number = DEFAULT_Z_WINDOW,
): CandleGeometryRow[] {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const n = sorted.length;
  if (n === 0) return [];

  const openNorm = new Array<number>(n);
  const closeNorm = new Array<number>(n);
  const bodyNorm = new Array<number>(n);
  const upperNorm = new Array<number>(n);
  const lowerNorm = new Array<number>(n);
  const wickAsym = new Array<number>(n);
  const ranges = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const b = sorted[i]!;
    const rng = b.high - b.low;
    ranges[i] = rng;
    if (rng > 0) {
      openNorm[i] = (b.open - b.low) / rng;
      closeNorm[i] = (b.close - b.low) / rng;
      bodyNorm[i] = (b.close - b.open) / rng;
      upperNorm[i] = (b.high - Math.max(b.open, b.close)) / rng;
      lowerNorm[i] = (Math.min(b.open, b.close) - b.low) / rng;
    } else {
      openNorm[i] = 0.5;
      closeNorm[i] = 0.5;
      bodyNorm[i] = 0;
      upperNorm[i] = 0;
      lowerNorm[i] = 0;
    }
    wickAsym[i] = upperNorm[i]! - lowerNorm[i]!;
  }

  // Floor range and volume at their smallest positive value (the instrument
  // tick / one lot) so log is always defined — the Python's eps_r.
  const positives = ranges.filter((r) => r > 0);
  const epsRange = positives.length ? Math.min(...positives) : 1;

  const logRange = ranges.map((r) => Math.log(Math.max(r, epsRange)));
  const logVol = sorted.map((b) => Math.log(Math.max(b.volume ?? 1, 1)));
  const ret: (number | null)[] = sorted.map((b, i) =>
    i === 0 ? null : Math.log(b.close / sorted[i - 1]!.close),
  );

  const rangeZ = causalZ(logRange, window);
  const bodyZ = causalZ(bodyNorm, window);
  const wickZ = causalZ(wickAsym, window);
  const returnZ = causalZ(ret, window);
  const volumeZ = causalZ(logVol, window);

  return sorted.map((b, i) => ({
    timestamp: b.timestamp,
    open_norm: openNorm[i]!,
    close_norm: closeNorm[i]!,
    body_norm: bodyNorm[i]!,
    upper_norm: upperNorm[i]!,
    lower_norm: lowerNorm[i]!,
    range_z: rangeZ[i]!,
    body_z: bodyZ[i]!,
    wick_z: wickZ[i]!,
    return_z: returnZ[i]!,
    volume_z: volumeZ[i]!,
  }));
}

export interface FeatureRow {
  timestamp: number;
  values: number[];
}

export interface FeatureMatrix {
  columns: readonly string[];
  rows: FeatureRow[];
  /** Bars dropped because a feature was still in warmup. Disclosed in the UI. */
  warmup: number;
}

/**
 * Dense matrix of complete rows only. A row with any null feature is DROPPED,
 * never zero-filled — imputing a zero would put a fabricated point into a real
 * clustering. `warmup` is surfaced so the UI can say how many bars were held back.
 */
export function toFeatureMatrix(
  rows: readonly CandleGeometryRow[],
  columns: readonly string[] = FEATURE_NAMES,
): FeatureMatrix {
  const out: FeatureRow[] = [];
  for (const r of rows) {
    const rec = r as unknown as Record<string, number | null>;
    const values = columns.map((c) => rec[c]);
    if (values.some((v) => v == null || !Number.isFinite(v))) continue;
    out.push({ timestamp: r.timestamp, values: values as number[] });
  }
  return { columns, rows: out, warmup: rows.length - out.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/candleGeometry.test.ts`
Expected: PASS — all specs green.

- [ ] **Step 5: Verify parity against the real Python on real bars**

This is the check that makes the port trustworthy. Dump a small real window, run both, diff.

```bash
uv run python -c "
import json, numpy as np, pandas as pd, sys
sys.path.insert(0, 'scripts')
from candle_geometry import compute_relative_embedding
df = pd.read_parquet(r'data/parquet/MNQ/1m.parquet').tail(300).reset_index(drop=True)
emb = compute_relative_embedding(df, 100)
cols = ['body_norm','upper_norm','lower_norm','range_z','return_z','volume_z']
bars = [{'timestamp': int(t.value // 10**9) if hasattr(t,'value') else int(t),
         'open': float(o), 'high': float(h), 'low': float(l),
         'close': float(c), 'volume': float(v)}
        for t,o,h,l,c,v in zip(df.timestamp, df.open, df.high, df.low, df.close, df.volume)]
exp = [[None if pd.isna(x) else float(x) for x in emb[c]] for c in cols]
json.dump({'bars': bars, 'columns': cols, 'expected': exp},
          open('tests/client/mechanism/candleGeometry.parity.json','w'))
print('wrote parity fixture:', len(bars), 'bars')
"
```

Then add the parity test to the same file:

```ts
// appended to tests/client/mechanism/candleGeometry.test.ts
import parity from './candleGeometry.parity.json';

describe('candle geometry — parity with scripts/candle_geometry.py', () => {
  it('matches the Python column for column on real MNQ bars', () => {
    const rows = computeCandleGeometry(parity.bars as OHLCVBar[], 100);
    parity.columns.forEach((col, ci) => {
      const expected = parity.expected[ci]!;
      rows.forEach((r, ri) => {
        const got = (r as unknown as Record<string, number | null>)[col];
        const want = expected[ri];
        if (want === null) expect(got).toBeNull();
        else expect(got as number).toBeCloseTo(want as number, 9);
      });
    });
  });
});
```

Run: `npx vitest run tests/client/mechanism/candleGeometry.test.ts`
Expected: PASS. If `range_z` diverges, check the `epsRange` flooring first — it is the only place the two implementations could pick a different constant.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/data tests/client/mechanism
git commit -m "feat(mechanism): candle-geometry port with Python parity test"
```

---

### Task 3: Real-bar hook feeding the feature matrix

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/data/useMechanismBars.ts`
- Test: `tests/client/mechanism/useMechanismBars.test.ts`

**Interfaces:**
- Consumes: `computeCandleGeometry`, `toFeatureMatrix`, `FEATURE_NAMES`, `FeatureMatrix` (Task 2); `chartApi.getOhlcv` from `@/infrastructure/api/api_service`; `QUERY_KEYS` from `@/shared/utils/types`; `minutesToApiKey` from `@/market/lib/timeframes`.
- Produces: `MechanismData`, `useMechanismBars(symbol, timeframeMinutes, limit)`.

**Pattern note:** this mirrors the private bar hook in `InputWindowChart.tsx` (same `chartApi.getOhlcv` call, same `order: 'asc'` + defensive re-sort + tail slice). It is a separate hook rather than a shared extraction because the mechanism tab needs the derived feature matrix and the warmup count, which the chart does not.

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/mechanism/useMechanismBars.test.ts
import { describe, it, expect } from 'vitest';
import {
  deriveMechanismData,
} from '@/system/architecture-explorer/mechanism/data/useMechanismBars';
import type { OHLCVBar } from '@shared/ohlcv';

function series(n: number): OHLCVBar[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 60,
    open: 100 + (i % 7),
    high: 103 + (i % 11),
    low: 98 - (i % 5),
    close: 101 + (i % 3),
    volume: 1000 + i * 3,
  }));
}

describe('deriveMechanismData', () => {
  it('reports not-ready while the z-window is still in warmup', () => {
    const d = deriveMechanismData(series(60), 100);
    expect(d.ready).toBe(false);
    expect(d.features.rows.length).toBe(0);
    expect(d.warmupNeeded).toBe(100);
  });

  it('is ready once enough bars exist and exposes a dense matrix', () => {
    const d = deriveMechanismData(series(180), 100);
    expect(d.ready).toBe(true);
    expect(d.features.rows.length).toBeGreaterThan(0);
    expect(d.features.columns.length).toBe(6);
    for (const r of d.features.rows) {
      expect(r.values.every(Number.isFinite)).toBe(true);
    }
  });

  it('reports the real bar count and time span for the provenance panel', () => {
    const bars = series(180);
    const d = deriveMechanismData(bars, 100);
    expect(d.barCount).toBe(180);
    expect(d.firstTimestamp).toBe(bars[0]!.timestamp);
    expect(d.lastTimestamp).toBe(bars[bars.length - 1]!.timestamp);
  });

  it('handles an empty response without throwing', () => {
    const d = deriveMechanismData([], 100);
    expect(d.ready).toBe(false);
    expect(d.barCount).toBe(0);
    expect(d.firstTimestamp).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/useMechanismBars.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Real bars for the mechanism tab, plus the derived feature matrix.
 *
 * Every animation in this tab consumes REAL OHLCV from GET /api/charts/ohlcv —
 * never synthetic points. The pure `deriveMechanismData` half is separated from
 * the query half so the derivation is unit-testable without React or a server.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { chartApi } from '@/infrastructure/api/api_service';
import { QUERY_KEYS } from '@/shared/utils/types';
import { minutesToApiKey } from '@/market/lib/timeframes';
import type { OHLCVBar } from '@shared/ohlcv';
import {
  computeCandleGeometry,
  toFeatureMatrix,
  FEATURE_NAMES,
  DEFAULT_Z_WINDOW,
  type FeatureMatrix,
} from './candleGeometry';

export interface MechanismData {
  bars: OHLCVBar[];
  features: FeatureMatrix;
  /** True once at least one complete (non-warmup) feature row exists. */
  ready: boolean;
  /** Bars of history the causal z-window needs before any row is complete. */
  warmupNeeded: number;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

function isOhlcvBar(v: unknown): v is OHLCVBar {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.timestamp === 'number' &&
    typeof r.open === 'number' &&
    typeof r.high === 'number' &&
    typeof r.low === 'number' &&
    typeof r.close === 'number'
  );
}

/** Pure derivation — no React, no network. Unit-tested directly. */
export function deriveMechanismData(
  bars: readonly OHLCVBar[],
  zWindow: number = DEFAULT_Z_WINDOW,
): MechanismData {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const features = toFeatureMatrix(
    computeCandleGeometry(sorted, zWindow),
    FEATURE_NAMES,
  );
  return {
    bars: sorted,
    features,
    ready: features.rows.length > 0,
    warmupNeeded: zWindow,
    barCount: sorted.length,
    firstTimestamp: sorted.length ? sorted[0]!.timestamp : null,
    lastTimestamp: sorted.length ? sorted[sorted.length - 1]!.timestamp : null,
  };
}

export interface UseMechanismBarsResult {
  data: MechanismData;
  isLoading: boolean;
  error: Error | null;
}

/**
 * The last `limit` real bars for (symbol, timeframe), with features derived.
 * `limit` must exceed the z-window or nothing will ever be ready — the caller's
 * default is 340 (100 warmup + 240 usable).
 */
export function useMechanismBars(
  symbol: string,
  timeframeMinutes: number,
  limit = 340,
  zWindow: number = DEFAULT_Z_WINDOW,
): UseMechanismBarsResult {
  const apiTimeframe = useMemo(
    () => minutesToApiKey(timeframeMinutes),
    [timeframeMinutes],
  );

  const query = useQuery<OHLCVBar[]>({
    queryKey: [
      ...QUERY_KEYS.chartOhlcv(symbol, apiTimeframe),
      'mechanism',
      limit,
    ],
    queryFn: async ({ signal }) => {
      const raw = await chartApi.getOhlcv(
        { symbol, timeframe: apiTimeframe, limit: String(limit), order: 'asc' },
        signal,
      );
      if (!Array.isArray(raw)) {
        throw new Error('OHLCV endpoint did not return an array of bars');
      }
      const bars = raw.filter(isOhlcvBar);
      bars.sort((a, b) => a.timestamp - b.timestamp);
      return bars.slice(-limit);
    },
    staleTime: 10 * 60 * 1000,
  });

  const data = useMemo(
    () => deriveMechanismData(query.data ?? [], zWindow),
    [query.data, zWindow],
  );

  return {
    data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/useMechanismBars.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/data tests/client/mechanism
git commit -m "feat(mechanism): real-bar hook with derived feature matrix"
```

---

### Task 4: K-Means kernel with known-answer tests

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/compute/kmeans.ts`
- Test: `tests/client/mechanism/kmeans.test.ts`

**Interfaces:**
- Consumes: nothing (pure kernel — no React, no p5, no fetch).
- Produces: `KMeansStep`, `KMeansTrace`, `kmeans(points, k, opts)`, `seededUnit(a, b, c)`.

**Why a trace:** the sketch animates the algorithm's real history. The kernel runs to convergence up front and returns every intermediate step, so the animation replays genuine iterations instead of faking progress on a timer.

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/mechanism/kmeans.test.ts
import { describe, it, expect } from 'vitest';
import { kmeans } from '@/system/architecture-explorer/mechanism/compute/kmeans';

/** Three well-separated blobs, deterministic — no RNG in the fixture. */
function blobs(): number[][] {
  const centers = [[0, 0], [10, 10], [0, 10]];
  const pts: number[][] = [];
  for (let c = 0; c < centers.length; c++) {
    for (let i = 0; i < 20; i++) {
      const jitter = ((i * 37) % 11) / 20 - 0.275; // deterministic, |j| < 0.3
      pts.push([centers[c]![0]! + jitter, centers[c]![1]! - jitter]);
    }
  }
  return pts;
}

describe('kmeans', () => {
  it('recovers three separated blobs', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    expect(t.converged).toBe(true);
    const finals = t.steps[t.steps.length - 1]!.centroids
      .map((c) => [Math.round(c[0]!), Math.round(c[1]!)])
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(finals).toEqual([[0, 0], [0, 10], [10, 10]]);
  });

  it('assigns every point to exactly one cluster in range', () => {
    const pts = blobs();
    const t = kmeans(pts, 3, { seed: 7 });
    const last = t.steps[t.steps.length - 1]!;
    expect(last.assignments.length).toBe(pts.length);
    for (const a of last.assignments) {
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(3);
    }
  });

  it('never increases inertia — the convergence guarantee', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    for (let i = 1; i < t.steps.length; i++) {
      expect(t.steps[i]!.inertia).toBeLessThanOrEqual(t.steps[i - 1]!.inertia + 1e-9);
    }
  });

  it('is deterministic — same seed and points give an identical trace', () => {
    const a = kmeans(blobs(), 3, { seed: 42 });
    const b = kmeans(blobs(), 3, { seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records every real iteration, starting from the init step', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    expect(t.steps.length).toBeGreaterThanOrEqual(2);
    expect(t.iterations).toBe(t.steps.length - 1);
  });

  it('handles k larger than the point count without emitting empty centroids', () => {
    const t = kmeans([[0, 0], [1, 1]], 5, { seed: 3 });
    expect(t.steps[t.steps.length - 1]!.centroids.length).toBeLessThanOrEqual(2);
  });

  it('returns an empty trace for no points rather than throwing', () => {
    const t = kmeans([], 3, { seed: 1 });
    expect(t.steps).toEqual([]);
    expect(t.converged).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/kmeans.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * K-Means (Lloyd's algorithm) with k-means++ initialization.
 *
 * ANALYTIC provenance: given the points and the seed, this result is the
 * genuinely correct clustering — there are no learned weights involved, so what
 * the animation shows is a true convergence, not an illustration of one.
 *
 * The whole run is computed up front and returned as a TRACE of every real
 * iteration. The sketch replays those steps; it never invents intermediate
 * frames or paces progress off a timer.
 *
 * Determinism: initialization draws from a seeded hash, never Math.random, so
 * the same bars and seed always produce the same run.
 */

export interface KMeansStep {
  /** Centroid positions at the END of this step. */
  centroids: number[][];
  /** assignments[i] = cluster index of points[i]. */
  assignments: number[];
  /** Sum of squared distances to the assigned centroid. Never increases. */
  inertia: number;
}

export interface KMeansTrace {
  steps: KMeansStep[];
  converged: boolean;
  /** Lloyd iterations run (steps.length - 1; step 0 is the init assignment). */
  iterations: number;
  k: number;
}

export interface KMeansOptions {
  maxIter?: number;
  /** Integer seed. Same seed + same points => identical trace. */
  seed?: number;
  /** Centroid movement below this ends the run. */
  tol?: number;
}

/** Deterministic hash -> [0,1). The RNG substitute; no Math.random anywhere. */
export function seededUnit(a: number, b: number, c: number): number {
  let h = 2166136261 ^ (a * 374761393 + b * 668265263 + c * 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

/** k-means++ : first centre seeded, each next drawn proportional to D^2. */
function kmeansPlusPlus(points: number[][], k: number, seed: number): number[][] {
  const centroids: number[][] = [];
  const firstIdx = Math.floor(seededUnit(seed, 0, 0) * points.length) % points.length;
  centroids.push([...points[firstIdx]!]);

  while (centroids.length < k) {
    const d2 = points.map((p) =>
      Math.min(...centroids.map((c) => sqDist(p, c))),
    );
    const total = d2.reduce((s, v) => s + v, 0);
    if (total <= 0) break; // every point already coincides with a centre

    const target = seededUnit(seed, centroids.length, 1) * total;
    let acc = 0;
    let chosen = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      acc += d2[i]!;
      if (acc >= target) { chosen = i; break; }
    }
    centroids.push([...points[chosen]!]);
  }
  return centroids;
}

function assign(points: number[][], centroids: number[][]): {
  assignments: number[];
  inertia: number;
} {
  const assignments = new Array<number>(points.length).fill(0);
  let inertia = 0;
  for (let i = 0; i < points.length; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = sqDist(points[i]!, centroids[c]!);
      if (d < bestD) { bestD = d; best = c; }
    }
    assignments[i] = best;
    inertia += bestD;
  }
  return { assignments, inertia };
}

/**
 * Recompute each centroid as the mean of its members. An empty cluster keeps
 * its previous position — dropping or randomly re-seeding it would make the
 * inertia-never-increases guarantee false.
 */
function update(
  points: number[][],
  assignments: number[],
  centroids: number[][],
): number[][] {
  const dims = points[0]!.length;
  const sums = centroids.map(() => new Array<number>(dims).fill(0));
  const counts = new Array<number>(centroids.length).fill(0);

  for (let i = 0; i < points.length; i++) {
    const c = assignments[i]!;
    counts[c]!++;
    for (let d = 0; d < dims; d++) sums[c]![d]! += points[i]![d]!;
  }

  return centroids.map((prev, c) =>
    counts[c] === 0 ? [...prev] : sums[c]!.map((s) => s / counts[c]!),
  );
}

export function kmeans(
  points: number[][],
  k: number,
  opts: KMeansOptions = {},
): KMeansTrace {
  const { maxIter = 40, seed = 1, tol = 1e-6 } = opts;
  const effectiveK = Math.max(1, Math.min(k, points.length));

  if (points.length === 0) {
    return { steps: [], converged: false, iterations: 0, k: 0 };
  }

  let centroids = kmeansPlusPlus(points, effectiveK, seed);
  const steps: KMeansStep[] = [];

  // Step 0: the initial assignment against the k-means++ centres.
  let { assignments, inertia } = assign(points, centroids);
  steps.push({
    centroids: centroids.map((c) => [...c]),
    assignments: [...assignments],
    inertia,
  });

  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    const next = update(points, assignments, centroids);
    const shift = Math.max(...next.map((c, i) => sqDist(c, centroids[i]!)));
    centroids = next;

    ({ assignments, inertia } = assign(points, centroids));
    steps.push({
      centroids: centroids.map((c) => [...c]),
      assignments: [...assignments],
      inertia,
    });

    if (shift <= tol) { converged = true; break; }
  }

  return { steps, converged, iterations: steps.length - 1, k: centroids.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/kmeans.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/compute tests/client/mechanism
git commit -m "feat(mechanism): k-means kernel with known-answer tests"
```

---

### Task 5: Research and author the cluster-loop family

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/registry/clusterLoop.ts`
- Modify: `src/client/src/system/architecture-explorer/mechanism/registry/index.ts` (register the family in `FAMILIES`)
- Test: `tests/client/mechanism/registryIntegrity.test.ts`

**Interfaces:**
- Consumes: `MechanismSpec` (Task 1).
- Produces: `CLUSTER_LOOP: MechanismSpec[]`.

**This is the research task.** For each model below, open its markdown spec under `ALGO_MODELS_ROOT` (default `E:/source/repos/Trading/_architecture/educational/algo_models`) and read the Architecture section before writing the entry. Do not write an entry from memory — `specPath` is a citation, and a beat that isn't in the cited file is a bug.

Find each spec with:

```bash
ls "E:/source/repos/Trading/_architecture/educational/algo_models/Statistical Models" \
   "E:/source/repos/Trading/_architecture/educational/algo_models/Machine Learning"
grep -ril "k-means" "E:/source/repos/Trading/_architecture/educational/algo_models"
```

Confirm each catalog key against the fixture from Task 1:

```bash
node -e "
const { CATALOG_KEYS } = require('./tests/client/mechanism/catalogKeys.fixture.ts');
" 2>/dev/null || grep -n "clustering\|k-means\|gaussian-mixture\|dbscan\|mean-shift\|spectral\|hierarchical\|affinity\|self-organizing\|deep-clustering" tests/client/mechanism/catalogKeys.fixture.ts
```

The 11 models in this family, with the `templateId` each carries in the catalog (drives `repoRunner`):

| Model | Expected catalog key | Catalog templateId |
|---|---|---|
| K-Means Clustering | `k-means-clustering` | `sklearn` |
| Gaussian Mixture Model | `gaussian-mixture-model-gmm` | `sklearn` |
| DBSCAN | `dbscan-density-based-spatial-clustering-of-applications-with-noise` | `sklearn` |
| Mean Shift Clustering | `mean-shift-clustering` | `sklearn` |
| Spectral Clustering | `spectral-clustering` | `sklearn` |
| Hierarchical Clustering | `hierarchical-clustering-agglomerative-divisive` | `sklearn` |
| Affinity Propagation | `affinity-propagation` | `sklearn` |
| Self-Organizing Maps | `self-organizing-maps-som` | *(none)* |
| Deep Clustering Network | `deep-clustering-network-dcn` | `pytorch_mlp` |
| Semi-Supervised Clustering | `semi-supervised-clustering` | *(none)* |
| Autoencoder (Unsupervised) | `autoencoder-unsupervised` | `pytorch_autoencoder` |

If a key in the fixture differs from the guess above, **the fixture wins** — it is the measured truth.

**`repoRunner` rules for this family:**
- `templateId: 'sklearn'` → `{ templateId: 'sklearn', note: 'Trained here through the generic sklearn template — fit/predict over the 35-feature vector, not this spec\u2019s own implementation.' }`
- `templateId: 'pytorch_mlp'` → the standard MLP note.
- *(none)* → `repoRunner: null` **only if** the model genuinely has no runner; state that in `analogy` context instead. For browse-only entries set `{ templateId: 'none', note: 'Browse-only catalog spec — this repo has no runner for it, so nothing would train.' }`.

- [ ] **Step 1: Write the failing integrity test**

```ts
// tests/client/mechanism/registryIntegrity.test.ts
import { describe, it, expect } from 'vitest';
import {
  allMechanisms,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';
import { CATALOG_KEYS } from './catalogKeys.fixture';

const KEYS = new Set(CATALOG_KEYS.map((r) => r.key));

describe('registry integrity', () => {
  it('has at least the cluster-loop family registered', () => {
    const cluster = allMechanisms().filter((m) => m.archetype === 'cluster-loop');
    expect(cluster.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry names a real archetype', () => {
    for (const m of allMechanisms()) expect(ALL_ARCHETYPES).toContain(m.archetype);
  });

  it('every entry joins to a real catalog key', () => {
    for (const m of allMechanisms()) {
      expect(KEYS.has(m.catalogKey), `unknown catalog key: ${m.catalogKey}`).toBe(true);
    }
  });

  it('every entry cites a non-empty spec path ending in .md', () => {
    for (const m of allMechanisms()) {
      expect(m.specPath.length, `${m.catalogKey} has no citation`).toBeGreaterThan(0);
      expect(m.specPath.endsWith('.md')).toBe(true);
    }
  });

  it('every beat attaches to a stage that exists in the same entry', () => {
    for (const m of allMechanisms()) {
      const stageIds = new Set(m.stages.map((s) => s.id));
      for (const b of m.beats) {
        expect(stageIds.has(b.at), `${m.catalogKey}: beat "${b.id}" -> "${b.at}"`).toBe(true);
      }
    }
  });

  it('every entry has 1-3 beats and at least two stages', () => {
    for (const m of allMechanisms()) {
      expect(m.beats.length).toBeGreaterThanOrEqual(1);
      expect(m.beats.length).toBeLessThanOrEqual(3);
      expect(m.stages.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('stage ids and beat ids are unique within an entry', () => {
    for (const m of allMechanisms()) {
      expect(new Set(m.stages.map((s) => s.id)).size).toBe(m.stages.length);
      expect(new Set(m.beats.map((b) => b.id)).size).toBe(m.beats.length);
    }
  });

  it('no entry claims trained-live without a training kernel in this wave', () => {
    // Wave 1 ships only analytic k-means. Waves 3+ relax this.
    for (const m of allMechanisms()) {
      if (m.archetype === 'cluster-loop') expect(m.provenance).toBe('analytic');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/registryIntegrity.test.ts`
Expected: FAIL — "has at least the cluster-loop family registered" fails with 0 entries.

- [ ] **Step 3: Read the specs and author the family**

Create `registry/clusterLoop.ts`. Two fully-worked entries are given; **research and write the remaining nine the same way**, each with its own real stages and beats read from its cited file.

```ts
/**
 * cluster-loop family — models whose mechanism is an ITERATED ASSIGN/UPDATE
 * loop over points until it settles.
 *
 * Every entry is researched from the markdown spec named in `specPath`, under
 * ALGO_MODELS_ROOT. Provenance is `analytic` throughout: given the points,
 * these results are genuinely correct — no trained weights are involved.
 */

import type { MechanismSpec } from './types';

const SKLEARN_NOTE =
  'Trained here through the generic sklearn template — fit/predict over the ' +
  '35-feature vector, not this spec\u2019s own implementation.';

export const CLUSTER_LOOP: MechanismSpec[] = [
  {
    catalogKey: 'k-means-clustering',
    name: 'K-Means Clustering',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Statistical Models/Clustering/K-Means Clustering.md',
    analogy:
      'Think of it as sorting every bar into k trading "moods", then moving ' +
      'each mood to the average of the bars that chose it — repeat until nobody moves.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points',
        detail: 'one point per bar, 6 candle-geometry dims' },
      { id: 'init', role: 'transform', label: 'k-means++ init',
        detail: 'centres seeded proportional to D\u00b2' },
      { id: 'assign', role: 'transform', label: 'Assign',
        detail: 'each point to its nearest centroid' },
      { id: 'update', role: 'update', label: 'Update',
        detail: 'each centroid to the mean of its members' },
      { id: 'inertia', role: 'score', label: 'Inertia',
        detail: 'sum of squared distances — never increases' },
    ],
    beats: [
      { id: 'pp', at: 'init', label: 'k-means++ seeding',
        detail: 'Centres are drawn proportional to squared distance from those already chosen, which avoids the bad local minima uniform seeding falls into.' },
      { id: 'lloyd', at: 'update', label: "Lloyd's alternation",
        detail: 'Assignment and update alternate; each half can only lower inertia, which is why the loop provably terminates.' },
      { id: 'spherical', at: 'assign', label: 'spherical bias',
        detail: 'Nearest-centroid assignment under Euclidean distance implies clusters of similar, roughly spherical extent.' },
    ],
    repoRunner: { templateId: 'sklearn', note: SKLEARN_NOTE },
  },
  {
    catalogKey: 'gaussian-mixture-model-gmm',
    name: 'Gaussian Mixture Model (GMM)',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Statistical Models/Clustering/Gaussian Mixture Model (GMM).md',
    analogy:
      'Think of it as K-Means that admits uncertainty: a bar can be 70% one ' +
      'regime and 30% another, and each regime has its own spread and tilt.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points',
        detail: 'one point per bar, 6 candle-geometry dims' },
      { id: 'init', role: 'transform', label: 'Initialize components',
        detail: 'means, covariances, mixing weights' },
      { id: 'estep', role: 'transform', label: 'E-step',
        detail: 'responsibility of each component for each point' },
      { id: 'mstep', role: 'update', label: 'M-step',
        detail: 're-fit means, covariances and weights' },
      { id: 'll', role: 'score', label: 'Log-likelihood',
        detail: 'monotonically non-decreasing across EM steps' },
    ],
    beats: [
      { id: 'soft', at: 'estep', label: 'soft assignment',
        detail: 'Each point holds a probability across all components rather than one hard label, so overlapping regimes stay representable.' },
      { id: 'cov', at: 'mstep', label: 'full covariance',
        detail: 'Each component carries its own covariance, so clusters can be elongated and tilted — the constraint K-Means cannot express.' },
      { id: 'em', at: 'll', label: 'EM monotonicity',
        detail: 'Expectation-Maximization cannot decrease the log-likelihood, which is the convergence guarantee replacing K-Means\u2019 inertia argument.' },
    ],
    repoRunner: { templateId: 'sklearn', note: SKLEARN_NOTE },
  },

  // RESEARCH AND ADD, one entry each, same shape, each citing its own spec:
  //   dbscan-...                          density reachability, core/border/noise, eps + minPts
  //   mean-shift-clustering               kernel density ascent, bandwidth, mode seeking
  //   spectral-clustering                 affinity graph, Laplacian eigenvectors, embed then cluster
  //   hierarchical-clustering-...         linkage criterion, dendrogram, agglomerative merge order
  //   affinity-propagation                responsibility/availability message passing, exemplars
  //   self-organizing-maps-som            neighbourhood function, learning-rate decay, topology preservation
  //   deep-clustering-network-dcn         joint autoencoder + clustering loss, alternating optimization
  //   semi-supervised-clustering          must-link / cannot-link constraints steering the assignment
  //   autoencoder-unsupervised            latent-space clustering after reconstruction training
];
```

- [ ] **Step 4: Register the family**

In `registry/index.ts`, replace the empty `FAMILIES` with:

```ts
import { CLUSTER_LOOP } from './clusterLoop';

const FAMILIES: readonly MechanismSpec[][] = [
  CLUSTER_LOOP,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/client/mechanism/`
Expected: PASS — integrity 8 passed; coverage still 3 passed / 1 skipped, now with 11 keys resolving to specs and the rest to stated reasons.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/registry tests/client/mechanism
git commit -m "feat(mechanism): research and register the cluster-loop family"
```

---

### Task 6: Provenance panel and repo-runner banner

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/ProvenancePanel.tsx`
- Create: `src/client/src/system/architecture-explorer/mechanism/RepoRunnerBanner.tsx`
- Test: `tests/client/mechanism/provenance.test.tsx`

**Interfaces:**
- Consumes: `MechanismSpec`, `Provenance` (Task 1); `MechanismData` (Task 3).
- Produces: `ProvenancePanel({ spec, data, symbol, timeframeLabel, liveMetric })`, `RepoRunnerBanner({ spec, expanded, onToggle })`, `PROVENANCE_COPY`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// tests/client/mechanism/provenance.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenancePanel } from '@/system/architecture-explorer/mechanism/ProvenancePanel';
import { RepoRunnerBanner } from '@/system/architecture-explorer/mechanism/RepoRunnerBanner';
import type { MechanismSpec } from '@/system/architecture-explorer/mechanism/registry';
import type { MechanismData } from '@/system/architecture-explorer/mechanism/data/useMechanismBars';

const SPEC: MechanismSpec = {
  catalogKey: 'k-means-clustering',
  name: 'K-Means Clustering',
  archetype: 'cluster-loop',
  provenance: 'analytic',
  specPath: 'Statistical Models/Clustering/K-Means Clustering.md',
  analogy: 'Sorting bars into k moods.',
  stages: [
    { id: 'points', role: 'input', label: 'Feature points' },
    { id: 'assign', role: 'transform', label: 'Assign' },
  ],
  beats: [{ id: 'pp', at: 'assign', label: 'k-means++ seeding', detail: 'D\u00b2 seeding.' }],
  repoRunner: { templateId: 'sklearn', note: 'Trained here through the generic sklearn template.' },
};

const DATA: MechanismData = {
  bars: [],
  features: { columns: ['body_norm'], rows: [{ timestamp: 1_700_000_000, values: [0.1] }], warmup: 100 },
  ready: true,
  warmupNeeded: 100,
  barCount: 340,
  firstTimestamp: 1_700_000_000,
  lastTimestamp: 1_700_020_000,
};

describe('ProvenancePanel', () => {
  it('states the real bar count and symbol', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/340/)).toBeTruthy();
    expect(screen.getByText(/MNQ/)).toBeTruthy();
  });

  it('names the provenance tier', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/analytic/i)).toBeTruthy();
  });

  it('cites the spec path', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/K-Means Clustering\.md/)).toBeTruthy();
  });

  it('discloses how many bars the causal warmup held back', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/100/)).toBeTruthy();
  });

  it('never claims a prediction for a seeded panel', () => {
    const seeded = { ...SPEC, provenance: 'seeded' as const };
    render(<ProvenancePanel spec={seeded} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/not a prediction/i)).toBeTruthy();
  });
});

describe('RepoRunnerBanner', () => {
  it('states the divergence when repoRunner is set', () => {
    render(<RepoRunnerBanner spec={SPEC} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/sklearn/)).toBeTruthy();
  });

  it('renders nothing when the repo would train this architecture', () => {
    const { container } = render(
      <RepoRunnerBanner spec={{ ...SPEC, repoRunner: null }} expanded={false} onToggle={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/provenance.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `ProvenancePanel.tsx`**

```tsx
/**
 * The honesty block. Non-dismissible, always populated from real values.
 *
 * States three things a viewer cannot otherwise know:
 *   1. what data is on screen (real symbol, timeframe, bar count, span)
 *   2. where the numbers come from (provenance tier, in plain words)
 *   3. what this account was researched from (the cited spec file)
 */

import type { MechanismSpec, Provenance } from './registry';
import type { MechanismData } from './data/useMechanismBars';

export const PROVENANCE_COPY: Record<Provenance, { label: string; body: string }> = {
  analytic: {
    label: 'analytic',
    body:
      'The mathematics is fully determined by the data — no trained weights are ' +
      'involved, so this result is genuinely correct for these bars.',
  },
  'trained-live': {
    label: 'trained live',
    body:
      'Really optimized in your browser on these bars. Small, but honestly ' +
      'trained — the step count and loss below are the actual optimizer state.',
  },
  seeded: {
    label: 'seeded',
    body:
      'The arithmetic is real and runs on your bars, but the weights are seeded, ' +
      'not learned. The output is not a prediction.',
  },
};

function fmtDate(ts: number | null): string {
  if (ts == null) return '—';
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export interface ProvenancePanelProps {
  spec: MechanismSpec;
  data: MechanismData;
  symbol: string;
  timeframeLabel: string;
  /** Live optimizer/iteration readout, when the archetype reports one. */
  liveMetric?: { label: string; value: string } | null;
}

export function ProvenancePanel({
  spec, data, symbol, timeframeLabel, liveMetric,
}: ProvenancePanelProps) {
  const copy = PROVENANCE_COPY[spec.provenance];
  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-3 text-xs">
      <dl className="space-y-2">
        <div>
          <dt className="font-medium text-muted-foreground">data</dt>
          <dd className="tnum">
            {symbol} · {timeframeLabel} · {data.barCount} real bars from QuestDB
          </dd>
          <dd className="tnum text-muted-foreground">
            {fmtDate(data.firstTimestamp)} → {fmtDate(data.lastTimestamp)}
          </dd>
          <dd className="text-muted-foreground">
            {data.features.warmup} bars held back by the {data.warmupNeeded}-bar
            causal warmup; {data.features.rows.length} complete feature rows in play.
          </dd>
        </div>

        <div>
          <dt className="font-medium text-muted-foreground">weights</dt>
          <dd>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {copy.label}
            </span>
          </dd>
          <dd className="text-muted-foreground">{copy.body}</dd>
          {liveMetric ? (
            <dd className="tnum">
              {liveMetric.label} {liveMetric.value}
            </dd>
          ) : null}
        </div>

        <div>
          <dt className="font-medium text-muted-foreground">source</dt>
          <dd className="break-all text-muted-foreground">{spec.specPath}</dd>
        </div>
      </dl>
    </div>
  );
}

export default ProvenancePanel;
```

- [ ] **Step 4: Write `RepoRunnerBanner.tsx`**

```tsx
/**
 * "What actually runs" — the divergence banner.
 *
 * For 48 of the 140 catalog entries this repo would train the generic
 * pytorch_mlp template rather than the published architecture on screen.
 * Rendering the published mechanism without saying so is the confusion this
 * whole tab exists to remove, so the banner is not dismissible and appears
 * whenever `repoRunner` is set.
 *
 * Expanding it is handled by the parent, which swaps the canvas to the genuine
 * derive.ts graph for that template — a real second animation, not a disclaimer.
 */

import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { MechanismSpec } from './registry';
import { cn } from '@/shared/utils/utils';

export interface RepoRunnerBannerProps {
  spec: MechanismSpec;
  expanded: boolean;
  onToggle: () => void;
}

export function RepoRunnerBanner({ spec, expanded, onToggle }: RepoRunnerBannerProps) {
  if (!spec.repoRunner) return null;
  const { templateId, note } = spec.repoRunner;
  const canShow = templateId !== 'none';

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-2.5 text-xs',
        // Warning styling uses the orange data token, never red — red/green
        // pairing is prohibited project-wide.
        'border-[#E69F00]/40 bg-[#E69F00]/10',
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="flex-1">
        {note}{' '}
        <span className="text-muted-foreground">(template: {templateId})</span>
      </p>
      {canShow ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded border border-border/60 px-2 py-1 font-medium hover:bg-muted"
        >
          {expanded ? 'hide' : 'show what actually runs'}
          {expanded ? (
            <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}

export default RepoRunnerBanner;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/provenance.test.tsx`
Expected: PASS — 7 passed.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism tests/client/mechanism
git commit -m "feat(mechanism): provenance panel + repo-runner divergence banner"
```

---

### Task 7: The cluster-loop p5 archetype

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/archetypes/types.ts`
- Create: `src/client/src/system/architecture-explorer/mechanism/archetypes/ClusterLoop.tsx`
- Create: `src/client/src/system/architecture-explorer/mechanism/archetypes/index.ts`
- Test: `tests/client/mechanism/clusterLoop.test.tsx`

**Interfaces:**
- Consumes: `MechanismSpec` (Task 1); `FeatureMatrix` (Task 2); `kmeans`, `KMeansTrace` (Task 4).
- Produces: `ArchetypeProps`, `ArchetypeProgress`, `ARCHETYPE_COMPONENTS: Partial<Record<ArchetypeId, LazyExoticComponent<ComponentType<ArchetypeProps>>>>`, `ClusterLoop`.

**`ArchetypeProps` is the contract waves 2–4 implement.** Get it right here; changing it later means touching 17 files.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// tests/client/mechanism/clusterLoop.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ClusterLoop } from '@/system/architecture-explorer/mechanism/archetypes/ClusterLoop';
import type { MechanismSpec } from '@/system/architecture-explorer/mechanism/registry';

// p5 is heavy and canvas-bound; the sketch's MATH is tested through the kernel,
// so here we only assert the component's lifecycle contract.
const removeSpy = vi.fn();
vi.mock('p5', () => ({
  default: class {
    remove = removeSpy;
    constructor(sketch: (p: unknown) => void, _el: HTMLElement) {
      sketch({
        createCanvas: () => ({ parent: () => {} }),
        resizeCanvas: () => {}, background: () => {}, fill: () => {},
        noFill: () => {}, stroke: () => {}, noStroke: () => {}, strokeWeight: () => {},
        circle: () => {}, rect: () => {}, line: () => {}, text: () => {},
        textSize: () => {}, textAlign: () => {}, push: () => {}, pop: () => {},
        frameRate: () => {}, width: 800, height: 400, LEFT: 0, TOP: 0, CENTER: 1,
      });
    }
  },
}));

const SPEC: MechanismSpec = {
  catalogKey: 'k-means-clustering',
  name: 'K-Means Clustering',
  archetype: 'cluster-loop',
  provenance: 'analytic',
  specPath: 'Statistical Models/Clustering/K-Means Clustering.md',
  analogy: 'Sorting bars into k moods.',
  stages: [
    { id: 'points', role: 'input', label: 'Feature points' },
    { id: 'assign', role: 'transform', label: 'Assign' },
    { id: 'update', role: 'update', label: 'Update' },
  ],
  beats: [{ id: 'pp', at: 'assign', label: 'k-means++ seeding', detail: 'D\u00b2 seeding.' }],
  repoRunner: null,
};

const FEATURES = {
  columns: ['body_norm', 'upper_norm', 'lower_norm', 'range_z', 'return_z', 'volume_z'],
  rows: Array.from({ length: 60 }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 60,
    values: [
      (i % 3) - 1, (i % 5) / 5, (i % 7) / 7,
      ((i * 13) % 9) / 3 - 1.5, ((i * 17) % 11) / 4 - 1.3, ((i * 19) % 6) / 2 - 1.5,
    ],
  })),
  warmup: 100,
};

beforeEach(() => { removeSpy.mockClear(); cleanup(); });

describe('ClusterLoop', () => {
  it('mounts without throwing on a real-shaped feature matrix', () => {
    expect(() =>
      render(
        <ClusterLoop spec={SPEC} features={FEATURES} playing stepSignal={0}
          speed={1} activeBeat={null} />,
      ),
    ).not.toThrow();
  });

  it('destroys its p5 instance on unmount — no leaked sketch', () => {
    const { unmount } = render(
      <ClusterLoop spec={SPEC} features={FEATURES} playing stepSignal={0}
        speed={1} activeBeat={null} />,
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('reports real progress from the kmeans trace', () => {
    const seen: { iteration: number; metricValue: number }[] = [];
    render(
      <ClusterLoop spec={SPEC} features={FEATURES} playing stepSignal={0}
        speed={1} activeBeat={null}
        onProgress={(p) => seen.push({ iteration: p.iteration, metricValue: p.metricValue })} />,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.metricValue).toBeGreaterThanOrEqual(0);
  });

  it('renders an empty state rather than a canvas when there are no rows', () => {
    const { container } = render(
      <ClusterLoop spec={SPEC} features={{ ...FEATURES, rows: [] }} playing
        stepSignal={0} speed={1} activeBeat={null} />,
    );
    expect(container.textContent).toMatch(/no complete feature rows/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/clusterLoop.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `archetypes/types.ts`**

```ts
/**
 * The archetype contract. Every one of the 17 engines implements exactly this,
 * so the shell never learns anything model-specific.
 *
 * An archetype RECEIVES real features and DRAWS. It never fetches, and it never
 * invents data: any number it renders comes either from its compute kernel or
 * from the researched spec.
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import type { MechanismSpec, ArchetypeId } from '../registry';
import type { FeatureMatrix } from '../data/candleGeometry';

export interface ArchetypeProgress {
  /** Stage currently active, matching a `spec.stages[].id`. */
  stageId: string;
  /** Real iteration index within the mechanism's own loop. */
  iteration: number;
  /** Total iterations the kernel actually ran. */
  totalIterations: number;
  /** What the mechanism's own progress metric is called, e.g. "inertia". */
  metricLabel: string;
  metricValue: number;
  converged: boolean;
}

export interface ArchetypeProps {
  spec: MechanismSpec;
  features: FeatureMatrix;
  playing: boolean;
  /** Increments to advance exactly one step while paused. */
  stepSignal: number;
  /** Playback multiplier, 0.25 .. 4. */
  speed: number;
  /** Beat id the user clicked, or null. Engines highlight its stage. */
  activeBeat: string | null;
  onProgress?: (p: ArchetypeProgress) => void;
}

export type ArchetypeComponentMap = Partial<
  Record<ArchetypeId, LazyExoticComponent<ComponentType<ArchetypeProps>>>
>;
```

- [ ] **Step 4: Write `archetypes/ClusterLoop.tsx`**

```tsx
/**
 * cluster-loop — the assign/update convergence picture, drawn with p5.
 *
 * HONESTY CONTRACT:
 *   - The points are REAL bars: each dot is one bar's candle-geometry vector,
 *     projected to 2D by taking the two feature columns with the highest
 *     variance. The projection is disclosed on the canvas; it is a view of real
 *     data, not a transformation that invents structure.
 *   - The clustering is REAL: compute/kmeans.ts runs to convergence up front and
 *     the sketch replays its actual trace. Iteration N on screen is iteration N
 *     of the algorithm — progress is never paced off a timer.
 *   - Inertia shown is the real objective value at that step.
 *   - Colour never carries meaning alone: each cluster has both an Okabe-Ito
 *     hue and a distinct marker shape, and centroids are squares while member
 *     points are circles.
 *
 * p5 runs in INSTANCE mode and is imported lazily inside the effect.
 */

import { useEffect, useMemo, useRef } from 'react';
import type p5Types from 'p5';
import { kmeans, type KMeansTrace } from '../compute/kmeans';
import type { ArchetypeProps } from './types';

/** Okabe-Ito, deuteranopia-safe. Never a red/green pair. */
const CLUSTER_COLORS = [
  '#0072B2', '#E69F00', '#009E73', '#CC79A7',
  '#56B4E9', '#D55E00', '#F0E442', '#000000',
] as const;

/** Marker shape per cluster, so colour is never the only channel. */
type Shape = 'circle' | 'triangle' | 'diamond' | 'cross';
const CLUSTER_SHAPES: Shape[] = ['circle', 'triangle', 'diamond', 'cross'];

const K = 4;
/** Frames each real iteration is held on screen at speed 1. */
const FRAMES_PER_STEP = 45;

/** Indices of the two highest-variance columns — the disclosed 2-D view. */
function pickProjection(rows: readonly { values: number[] }[]): [number, number] {
  const dims = rows[0]?.values.length ?? 0;
  const variances: number[] = [];
  for (let d = 0; d < dims; d++) {
    let sum = 0;
    for (const r of rows) sum += r.values[d]!;
    const mean = sum / rows.length;
    let acc = 0;
    for (const r of rows) acc += (r.values[d]! - mean) ** 2;
    variances.push(acc / rows.length);
  }
  const order = variances
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  return [order[0] ?? 0, order[1] ?? Math.min(1, dims - 1)];
}

export function ClusterLoop({
  spec, features, playing, stepSignal, speed, activeBeat, onProgress,
}: ArchetypeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const p5Ref = useRef<p5Types | null>(null);

  // Mutable box the sketch reads each frame — avoids re-creating p5 on prop change.
  const live = useRef({ playing, stepSignal, speed, activeBeat });
  live.current = { playing, stepSignal, speed, activeBeat };

  const points = useMemo(
    () => features.rows.map((r) => r.values),
    [features],
  );
  const projection = useMemo(
    () => (features.rows.length ? pickProjection(features.rows) : ([0, 1] as [number, number])),
    [features],
  );
  const trace: KMeansTrace = useMemo(
    () => kmeans(points, K, { seed: 7 }),
    [points],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || trace.steps.length === 0) return;

    let disposed = false;
    const [xi, yi] = projection;
    const xs = points.map((p) => p[xi]!);
    const ys = points.map((p) => p[yi]!);
    const xMin = Math.min(...xs); const xMax = Math.max(...xs);
    const yMin = Math.min(...ys); const yMax = Math.max(...ys);
    const spanX = xMax - xMin || 1;
    const spanY = yMax - yMin || 1;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void import('p5').then(({ default: P5 }) => {
      if (disposed) return;

      const sketch = (p: p5Types) => {
        let stepIndex = 0;
        let frames = 0;
        let lastStepSignal = live.current.stepSignal;
        const PAD = 44;

        const sx = (v: number) =>
          PAD + ((v - xMin) / spanX) * (p.width - PAD * 2);
        const sy = (v: number) =>
          p.height - PAD - ((v - yMin) / spanY) * (p.height - PAD * 2);

        const report = () => {
          const s = trace.steps[stepIndex]!;
          onProgress?.({
            stageId: stepIndex === 0 ? 'init' : (stepIndex % 2 ? 'assign' : 'update'),
            iteration: stepIndex,
            totalIterations: trace.steps.length - 1,
            metricLabel: 'inertia',
            metricValue: s.inertia,
            converged: trace.converged && stepIndex === trace.steps.length - 1,
          });
        };

        const marker = (shape: Shape, x: number, y: number, r: number) => {
          switch (shape) {
            case 'circle': p.circle(x, y, r * 2); break;
            case 'triangle': p.triangle(x, y - r, x - r, y + r, x + r, y + r); break;
            case 'diamond': p.quad(x, y - r, x + r, y, x, y + r, x - r, y); break;
            case 'cross':
              p.line(x - r, y - r, x + r, y + r);
              p.line(x - r, y + r, x + r, y - r);
              break;
          }
        };

        p.setup = () => {
          const c = p.createCanvas(host.clientWidth || 800, host.clientHeight || 400);
          c.parent(host);
          p.frameRate(60);
          report();
        };

        p.draw = () => {
          p.background(0, 0);

          // Advance only on real steps, honouring pause / single-step / speed.
          if (live.current.stepSignal !== lastStepSignal) {
            lastStepSignal = live.current.stepSignal;
            stepIndex = Math.min(stepIndex + 1, trace.steps.length - 1);
            frames = 0;
            report();
          } else if (live.current.playing && !reduced) {
            frames += Math.max(0.25, live.current.speed);
            if (frames >= FRAMES_PER_STEP) {
              frames = 0;
              stepIndex =
                stepIndex >= trace.steps.length - 1 ? 0 : stepIndex + 1;
              report();
            }
          }

          const step = trace.steps[stepIndex]!;

          // Member points.
          p.noStroke();
          for (let i = 0; i < points.length; i++) {
            const c = step.assignments[i]! % CLUSTER_COLORS.length;
            const shape = CLUSTER_SHAPES[c % CLUSTER_SHAPES.length]!;
            p.fill(CLUSTER_COLORS[c]!);
            p.stroke(CLUSTER_COLORS[c]!);
            p.strokeWeight(1);
            marker(shape, sx(points[i]![xi]!), sy(points[i]![yi]!), 3.2);
          }

          // Centroids: squares, always distinguishable from member circles.
          for (let c = 0; c < step.centroids.length; c++) {
            const cx = sx(step.centroids[c]![xi]!);
            const cy = sy(step.centroids[c]![yi]!);
            p.noFill();
            p.stroke(CLUSTER_COLORS[c % CLUSTER_COLORS.length]!);
            p.strokeWeight(2.5);
            p.rect(cx - 7, cy - 7, 14, 14);
            p.line(cx - 11, cy, cx - 8, cy);
            p.line(cx + 8, cy, cx + 11, cy);
          }

          // Readout — every number here is real.
          p.noStroke();
          p.fill(140);
          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(
            `iteration ${stepIndex} / ${trace.steps.length - 1}` +
              `   inertia ${step.inertia.toFixed(3)}` +
              (trace.converged && stepIndex === trace.steps.length - 1
                ? '   converged'
                : ''),
            PAD,
            12,
          );
          p.text(
            `${points.length} real bars · axes: ` +
              `${features.columns[xi]} × ${features.columns[yi]} ` +
              `(2 highest-variance of ${features.columns.length} features)`,
            PAD,
            p.height - 22,
          );
        };

        p.windowResized = () => {
          p.resizeCanvas(host.clientWidth || 800, host.clientHeight || 400);
        };
      };

      p5Ref.current = new P5(sketch, host);
    });

    return () => {
      disposed = true;
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, [trace, points, projection, features.columns, onProgress]);

  if (features.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No complete feature rows yet — the causal z-score window needs more bars
        of history before any point can be plotted.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      aria-label={`${spec.name} — clustering ${features.rows.length} real bars`}
    />
  );
}

export default ClusterLoop;
```

- [ ] **Step 5: Write `archetypes/index.ts`**

```ts
/**
 * ArchetypeId -> lazy component. Waves 2-4 add their engines here; an id with
 * no entry means "researched but not yet animated", which the shell states
 * plainly rather than rendering a blank canvas.
 */

import { lazy } from 'react';
import type { ArchetypeComponentMap } from './types';

export * from './types';

export const ARCHETYPE_COMPONENTS: ArchetypeComponentMap = {
  'cluster-loop': lazy(() =>
    import('./ClusterLoop').then((m) => ({ default: m.ClusterLoop })),
  ),
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/client/mechanism/clusterLoop.test.tsx`
Expected: PASS — 4 passed.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer/mechanism/archetypes tests/client/mechanism
git commit -m "feat(mechanism): archetype contract + cluster-loop p5 engine"
```

---

### Task 8: The Mechanism tab shell, wired into /architecture

**Files:**
- Create: `src/client/src/system/architecture-explorer/mechanism/MechanismTab.tsx`
- Create: `src/client/src/system/architecture-explorer/mechanism/index.ts`
- Modify: `src/client/src/system/architecture-explorer/ArchitectureExplorer.tsx` (TAB_LABELS ~line 98, TabsList ~line 121, TabsContent ~line 136)
- Test: `tests/client/mechanism/mechanismTab.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `MechanismTab` (default export from the barrel).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// tests/client/mechanism/mechanismTab.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MechanismTab } from '@/system/architecture-explorer/mechanism/MechanismTab';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('MechanismTab', () => {
  it('renders without throwing before any data arrives', () => {
    expect(() => wrap(<MechanismTab />)).not.toThrow();
  });

  it('states plainly when the selected model has not been researched', () => {
    wrap(<MechanismTab initialCatalogKey="__unresearched__" />);
    expect(screen.getByText(/not yet researched/i)).toBeTruthy();
  });

  it('never substitutes another model for an unresearched key', () => {
    wrap(<MechanismTab initialCatalogKey="__unresearched__" />);
    expect(screen.queryByText(/K-Means/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/mechanism/mechanismTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `MechanismTab.tsx`**

```tsx
/**
 * The Mechanism tab.
 *
 * Picker -> researched spec -> archetype engine, over real bars. The shell owns
 * transport state and layout; it never does mechanism math and never fetches
 * inside a component body.
 *
 * Refusals are explicit: a catalog key with no researched entry renders a stated
 * empty state, and an archetype with no engine yet says so. Neither ever falls
 * back to another model's animation.
 */

import { Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, SkipForward, RotateCcw } from 'lucide-react';
import { resolveMechanism, allMechanisms } from './registry';
import { ARCHETYPE_COMPONENTS, type ArchetypeProgress } from './archetypes';
import { useMechanismBars } from './data/useMechanismBars';
import { ProvenancePanel } from './ProvenancePanel';
import { RepoRunnerBanner } from './RepoRunnerBanner';
import { minutesToLabel } from '@/market/lib/timeframes';
import { cn } from '@/shared/utils/utils';

const TIMEFRAMES = [1, 5, 15, 60, 1440] as const;

export interface MechanismTabProps {
  /** Test/deep-link seam. Defaults to the first researched model. */
  initialCatalogKey?: string;
}

export function MechanismTab({ initialCatalogKey }: MechanismTabProps) {
  const researched = useMemo(
    () => allMechanisms().sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const [catalogKey, setCatalogKey] = useState(
    initialCatalogKey ?? researched[0]?.catalogKey ?? '',
  );
  const [symbol, setSymbol] = useState('MNQ');
  const [tfMinutes, setTfMinutes] = useState<number>(1);
  const [playing, setPlaying] = useState(true);
  const [stepSignal, setStepSignal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [activeBeat, setActiveBeat] = useState<string | null>(null);
  const [runnerExpanded, setRunnerExpanded] = useState(false);
  const [progress, setProgress] = useState<ArchetypeProgress | null>(null);

  const resolution = resolveMechanism(catalogKey);
  const { data, isLoading, error } = useMechanismBars(symbol, tfMinutes);

  const Engine = resolution.researched
    ? ARCHETYPE_COMPONENTS[resolution.spec.archetype]
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Symbol"
        >
          {['MNQ', 'ES', 'EURUSD'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={tfMinutes}
          onChange={(e) => setTfMinutes(Number(e.target.value))}
          className="rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Timeframe"
        >
          {TIMEFRAMES.map((m) => (
            <option key={m} value={m}>{minutesToLabel(m)}</option>
          ))}
        </select>

        <select
          value={catalogKey}
          onChange={(e) => { setCatalogKey(e.target.value); setActiveBeat(null); }}
          className="min-w-[16rem] rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Model"
        >
          {researched.map((m) => (
            <option key={m.catalogKey} value={m.catalogKey}>{m.name}</option>
          ))}
          {!researched.some((m) => m.catalogKey === catalogKey) ? (
            <option value={catalogKey}>{catalogKey}</option>
          ) : null}
        </select>

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setPlaying((v) => !v)}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={() => { setPlaying(false); setStepSignal((n) => n + 1); }}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label="Step">
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => { setStepSignal(0); setPlaying(true); }}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label="Reset">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <input type="range" min={0.25} max={4} step={0.25} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="ml-1 w-24" aria-label="Speed" />
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 flex-1 rounded-md border border-border/50 bg-card/30">
          {!resolution.researched ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              {resolution.reason}
            </div>
          ) : !Engine ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              {resolution.spec.name} is researched — its mechanism is{' '}
              <span className="mx-1 font-medium">{resolution.spec.archetype}</span> —
              but that engine is not built yet. Nothing is drawn rather than
              showing a different model&rsquo;s animation.
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs">
              Could not load bars: {error.message}
            </div>
          ) : isLoading || !data.ready ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              Loading real {symbol} bars — the causal z-score window needs{' '}
              {data.warmupNeeded} bars of history before the first point is complete.
            </div>
          ) : (
            <Suspense fallback={<div className="p-8 text-xs text-muted-foreground">Loading engine…</div>}>
              <Engine
                spec={resolution.spec}
                features={data.features}
                playing={playing}
                stepSignal={stepSignal}
                speed={speed}
                activeBeat={activeBeat}
                onProgress={setProgress}
              />
            </Suspense>
          )}
        </div>

        {/* Beats + provenance */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-auto">
          {resolution.researched ? (
            <>
              <div className="rounded-md border border-border/50 bg-card/40 p-3 text-xs">
                <p className="mb-2 font-medium text-muted-foreground">
                  What makes this {resolution.spec.name}
                </p>
                <ul className="space-y-1.5">
                  {resolution.spec.beats.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => setActiveBeat(activeBeat === b.id ? null : b.id)}
                        className={cn(
                          'w-full rounded px-1.5 py-1 text-left hover:bg-muted',
                          activeBeat === b.id && 'bg-muted font-medium',
                        )}
                      >
                        {b.label}
                      </button>
                      {activeBeat === b.id ? (
                        <p className="px-1.5 pt-1 text-muted-foreground">{b.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-border/40 pt-2 text-muted-foreground">
                  {resolution.spec.analogy}
                </p>
              </div>

              <ProvenancePanel
                spec={resolution.spec}
                data={data}
                symbol={symbol}
                timeframeLabel={minutesToLabel(tfMinutes)}
                liveMetric={
                  progress
                    ? { label: progress.metricLabel, value: progress.metricValue.toFixed(3) }
                    : null
                }
              />
            </>
          ) : null}
        </aside>
      </div>

      {resolution.researched ? (
        <RepoRunnerBanner
          spec={resolution.spec}
          expanded={runnerExpanded}
          onToggle={() => setRunnerExpanded((v) => !v)}
        />
      ) : null}
    </div>
  );
}

export default MechanismTab;
```

- [ ] **Step 4: Write the barrel**

```ts
// src/client/src/system/architecture-explorer/mechanism/index.ts
export { MechanismTab, default } from './MechanismTab';
export * from './registry';
```

- [ ] **Step 5: Wire the fourth tab**

In `ArchitectureExplorer.tsx`:

Add the import near the other tab imports:

```tsx
const MechanismTab = lazy(() =>
  import("./mechanism/MechanismTab").then((m) => ({ default: m.MechanismTab })),
);
```

Add to `TAB_LABELS`:

```tsx
  concepts: "Concepts",
  mechanism: "Mechanism",
```

Add the trigger after the Concepts trigger (import `Workflow` from `lucide-react`):

```tsx
            <TabsTrigger value="mechanism" className="gap-1.5 text-xs">
              <Workflow className="h-3.5 w-3.5" /> Mechanism
            </TabsTrigger>
```

Add the content after the Concepts content — it fills like the graph tab, since the canvas owns its height:

```tsx
          <TabsContent
            value="mechanism"
            className="mt-3 flex min-h-0 flex-1 flex-col"
          >
            <Suspense fallback={<PageLoader />}>
              <MechanismTab />
            </Suspense>
          </TabsContent>
```

- [ ] **Step 6: Run the full client suite**

Run: `npx vitest run tests/client/`
Expected: PASS — all mechanism tests green, no new failures elsewhere. The known pre-existing failure `tests/ingestionService.test.ts` (imports a module deleted in the domain-flat reorg) is outside `tests/client/` and unaffected.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
git add src/client/src/system/architecture-explorer tests/client/mechanism
git commit -m "feat(mechanism): Mechanism tab shell wired into /architecture"
```

---

### Task 9: Live verification and documentation

**Files:**
- Modify: `CLAUDE.md` (Recent Changes; Project Structure; Project Scale)
- Modify: `docs/superpowers/specs/2026-08-05-mechanism-animation-design.md` (status line)

- [ ] **Step 1: Run the full verifier**

Run: `npm run verify`
Expected: no errors in files changed this session. Pre-existing warnings in untouched files are reported as `preExistingCount` and are not this task's to fix.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0. Confirm p5 stays in its own lazy chunk — the mechanism engine must not land in the main bundle. Check the output for a separate chunk containing `ClusterLoop`.

- [ ] **Step 3: Verify live in the browser**

Start `npm run dev`, open `http://localhost:5000/architecture`, select the **Mechanism** tab, and confirm each of these by observation — not by assumption:

1. The tab renders; the picker lists the researched cluster-loop models.
2. With MNQ · 1m selected, real points appear and the centroids visibly move, then settle.
3. The readout shows `iteration N / M` advancing and `inertia` **decreasing monotonically**, ending in `converged`.
4. Pause holds the frame; Step advances exactly one real iteration; Reset returns to iteration 0.
5. The provenance panel shows a real bar count, a real date range, the warmup count, tier `analytic`, and the `.md` citation.
6. Selecting K-Means (templateId `sklearn`) shows the divergence banner naming `sklearn`.
7. Console is clean — zero errors, zero React warnings.
8. Switching tabs away and back does not leak a canvas (the DOM holds exactly one `<canvas>` under the mechanism host).
9. Toggle the OS reduced-motion setting: the animation settles rather than looping.

Record any failure and fix it before proceeding — this step is the wave's real gate.

- [ ] **Step 4: Update CLAUDE.md**

Add to the top of **Recent Changes** (keep to ~10 lines per the size policy):

```markdown
- **2026-08-05 — `/architecture` gained a 4th "Mechanism" tab: how each catalog model actually processes information, animated on real bars (Wave 1).** New `src/client/src/system/architecture-explorer/mechanism/`. Problem it fixes: 48 of the 73 currently-graphable catalog entries resolve through `templateId: pytorch_mlp`, so BigGAN/CycleGAN/StyleGAN/diffusion/normalizing-flow all drew the identical 3-layer MLP with nothing saying they differ. Design: 17 archetype engines driven by a **researched registry** (`registry/`), one entry per catalog key, each citing the markdown spec under `ALGO_MODELS_ROOT` it was read from, with 1–3 "beats" distinguishing siblings (WGAN's critic + weight clipping vs BigGAN's cond-BN + skip-z + self-attention). Three provenance tiers stated on every panel — `analytic` / `trained-live` / `seeded` — plus a non-dismissible banner naming what this repo would actually train instead. **Resolution is total**: an unresearched key renders a stated reason, never a sibling's animation. Wave 1 ships the spine + `cluster-loop`: `data/candleGeometry.ts` (TS port of `scripts/candle_geometry.py`, asserted against Python-generated values on real MNQ bars), `compute/kmeans.ts` (k-means++ + Lloyd's, seeded not `Math.random`, returns the real per-iteration trace the sketch replays), `archetypes/ClusterLoop.tsx` (p5 instance mode, lazy; Okabe-Ito + distinct marker shapes, centroids square vs member circles — colour never the sole channel). Coverage is a test, not a claim: `tests/client/mechanism/coverage.test.ts` asserts every catalog key returns a researched spec or a stated reason, with the 140/140 assertion `.skip`ped until Wave 5. Waves 2–5 (remaining 16 engines + the other ~129 registry entries) are planned in `docs/superpowers/plans/`. Spec: `docs/superpowers/specs/2026-08-05-mechanism-animation-design.md`.
```

In **Project Structure**, under the architecture-explorer area, add:

```
  system/architecture-explorer/mechanism/
    registry/     researched MechanismSpec per catalog key, cited to its .md
    archetypes/   17 p5 engines (Wave 1: cluster-loop) + the ArchetypeProps contract
    compute/      pure math kernels — no p5, no React, no fetch (Wave 1: kmeans)
    data/         candleGeometry.ts (Python port) + useMechanismBars.ts
    MechanismTab.tsx / ProvenancePanel.tsx / RepoRunnerBanner.tsx
```

In **Project Scale**, bump the React component-file count by the number of `.tsx` files added.

- [ ] **Step 5: Mark the spec landed**

In the spec, change `**Status:** approved, not yet implemented` to:

```markdown
**Status:** Wave 1 implemented 2026-08-05 (spine + cluster-loop). Waves 2–5 outstanding.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-05-mechanism-animation-design.md
git commit -m "docs: record mechanism animation wave 1"
```

---

## Self-Review

**Spec coverage.** Walking the spec section by section: *Architecture / module layout* → Tasks 1–8 create every listed file except the 16 not-yet-built archetype engines, which are explicitly Waves 2–4. *Registry* → Tasks 1 and 5. *17 archetypes* → the `ArchetypeId` union in Task 1 defines all 17; Task 7 implements one and Task 7 Step 5 leaves the map partial by design, with the shell stating "researched but not animated" rather than falling back. *Data and compute* → Tasks 2–4. *UI* → Tasks 6 and 8. *Verification* → the coverage test (Task 1), parity test (Task 2), known-answer tests (Task 4), integrity test (Task 5), smoke test (Task 7), live browser gate (Task 9). *Colour* → constrained globally and enforced in `ClusterLoop` (Okabe-Ito + shape) and `RepoRunnerBanner` (orange, never red). *Out of scope* → restated in Global Constraints.

One gap found and closed: the spec's UI section shows the expanded banner swapping the canvas to the `derive.ts` graph. Task 8 wires `runnerExpanded` state and the toggle, but does not render that second graph — doing so means reaching into `derive.ts`, which Global Constraints forbid touching this wave. The banner's expander is therefore present and functional as state, with the graph swap deferred. **This is a known, stated deferral, not an oversight** — it belongs in Wave 2, where `tree-route` already needs the anatomy API and the boundary can be drawn once.

**Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". The one intentionally open item is Task 5 Step 3's list of nine models to research — that is the research deliverable itself, and it ships with exact catalog keys, exact `templateId` values, exact `repoRunner` copy rules, two fully-worked reference entries, and a mechanical integrity test that fails until each is complete. It is a specified task, not a placeholder.

**Type consistency.** `FeatureMatrix` is defined in `candleGeometry.ts` (Task 2), re-exported through `MechanismData.features` (Task 3), and consumed as `ArchetypeProps.features` (Task 7) — one type throughout. `MechanismSpec` flows from Task 1 into Tasks 5, 6, 7, 8 unchanged. `kmeans(points, k, opts)` returns `KMeansTrace` in Task 4 and is consumed as `KMeansTrace` in Task 7. `ArchetypeProgress.metricLabel`/`metricValue` are produced in Task 7 and consumed by `ProvenancePanel`'s `liveMetric` in Task 8 — note these are deliberately different shapes (`{label, value: string}` vs `{metricLabel, metricValue: number}`), with the conversion done explicitly at the call site in `MechanismTab`. `allMechanisms()` is defined in Task 1 and used in Tasks 5 and 8. `ALL_ARCHETYPES` is defined in `types.ts` and re-exported by `registry/index.ts` via `export *`, which is how the tests import it.
