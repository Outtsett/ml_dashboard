/**
 * apps/api/tests/catalogDeepLearning.test.ts
 *
 * Pins the two defects that made whole sidebar entries render "No models match
 * your filters" on `/model-catalog`:
 *
 *   1. `deep-learning` is a WRAPPER category. `parseModelSpec` only ever set a
 *      wrapper by reading a literal `Deep Learning/` folder off the path, and
 *      the corpus has never had one -- the deep families sit at the top level.
 *      So the category was advertised in the sidebar, matched zero specs, and
 *      the grid came back empty. `CATEGORY_TO_PARENT` declares the membership
 *      instead, without moving files (spec ids are slugified from the relative
 *      path, so a move would rewrite every id).
 *
 *   2. The taxonomy rolls children up under a wrapper using the CHILD CATEGORY
 *      as the subcategory key, so the sidebar sends `subcategory=neural-network`
 *      / `subcategory=supervised`. No spec carries those as its own subcategory,
 *      so the list filter matched nothing for EVERY nested sidebar entry --
 *      Machine Learning's four children included, which had been broken all
 *      along.
 *
 * Both are exercised against a real on-disk fixture corpus rather than a
 * synthesised spec, because the bug lived in the path-to-category derivation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { scanModelCatalog } from '../infrastructure/lib/modelImport/parser';
import { CATEGORY_TO_PARENT } from '../infrastructure/lib/modelImport/types';

// ── Fixture corpus: the real layout in miniature ────────────────────────────
//
// Three deep families at the TOP level (no `Deep Learning/` folder, exactly as
// the corpus is), plus a `Machine Learning/` wrapper to prove the folder-based
// path still wins and still works.

/** The H1 becomes `spec.name`, so each fixture titles itself after its file. */
const spec = (title: string) =>
  [
    `# ${title}`,
    '',
    '## Overview',
    'A fixture spec with enough content that `hasContent` is true.',
    '',
    '## Training Methodology',
    '- **Hidden Units**: 32 - 512',
    '',
  ].join('\n');

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-models-fixture-'));

  const write = (relative: string) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, spec(path.basename(relative, '.md')), 'utf-8');
  };

  write('Neural Network Architectures/Convolutional Networks/Fixture CNN.md');
  write('Neural Network Architectures/Recurrent & Sequential Models/Fixture LSTM.md');
  write('Generative Models/Adversarial/Fixture GAN.md');
  write('Hybrid & Composite Architectures/Classical Hybrids/Fixture Hybrid.md');
  write('Machine Learning/Supervised Learning/Tree-Based Models/Fixture Tree.md');
  write('Statistical Models/Fixture ARIMA.md');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('deep-learning wrapper category', () => {
  it('declares the three deep families', () => {
    expect(CATEGORY_TO_PARENT['neural-network']).toBe('deep-learning');
    expect(CATEGORY_TO_PARENT['generative']).toBe('deep-learning');
    expect(CATEGORY_TO_PARENT['hybrid-composite']).toBe('deep-learning');
  });

  it('stamps parentCategory on specs in a deep family that has no wrapper folder', () => {
    const catalog = scanModelCatalog(root, { includeEmpty: true });

    const deep = catalog.models.filter(m => m.parentCategory === 'deep-learning');
    expect(deep.map(m => m.category).sort()).toEqual([
      'generative',
      'hybrid-composite',
      'neural-network',
      'neural-network',
    ]);

    // The leaf category is unchanged -- only the rollup is added, so no spec id
    // or existing category filter shifts.
    const cnn = catalog.models.find(m => m.name === 'Fixture CNN');
    expect(cnn?.category).toBe('neural-network');
    expect(cnn?.subcategory).toBe('convolutional-networks');
  });

  it('leaves a non-deep category with no parent', () => {
    const catalog = scanModelCatalog(root, { includeEmpty: true });
    const arima = catalog.models.find(m => m.name === 'Fixture ARIMA');
    expect(arima?.category).toBe('statistical');
    expect(arima?.parentCategory).toBeUndefined();
  });

  it('still prefers a real wrapper FOLDER when the path has one', () => {
    const catalog = scanModelCatalog(root, { includeEmpty: true });
    const tree = catalog.models.find(m => m.name === 'Fixture Tree');
    expect(tree?.category).toBe('supervised');
    expect(tree?.parentCategory).toBe('machine-learning');
  });

  it('rolls the deep families into the taxonomy under deep-learning', () => {
    const { taxonomy } = scanModelCatalog(root, { includeEmpty: true });
    expect(taxonomy['deep-learning']).toEqual({
      'neural-network': 2,
      'generative': 1,
      'hybrid-composite': 1,
    });
  });
});

describe('nested subcategory filtering', () => {
  it('matches a nested entry by child category, and a leaf entry by real subcategory', async () => {
    process.env.ALGO_MODELS_ROOT = root;
    // Imported after the env var is set -- DEFAULT_ROOT is resolved at module load.
    const { getCatalogModels, refreshCatalog } = await import(
      '../infrastructure/lib/modelImport/catalogService'
    );
    refreshCatalog();

    // Nested: the sidebar sends the CHILD CATEGORY as the subcategory.
    const nested = getCatalogModels({
      category: 'deep-learning',
      subcategory: 'neural-network',
      includeEmpty: true,
    });
    expect(nested.count).toBe(2);

    // The same shape under the folder-based wrapper, broken until now.
    const ml = getCatalogModels({
      category: 'machine-learning',
      subcategory: 'supervised',
      includeEmpty: true,
    });
    expect(ml.count).toBe(1);

    // Leaf: a real subcategory still matches, and nothing else leaks in.
    const leaf = getCatalogModels({
      category: 'neural-network',
      subcategory: 'convolutional-networks',
      includeEmpty: true,
    });
    expect(leaf.count).toBe(1);
    expect(leaf.models[0]?.name).toBe('Fixture CNN');
  });
});
