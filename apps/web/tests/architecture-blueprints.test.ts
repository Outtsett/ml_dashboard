/**
 * Every catalog blueprint must be drawable and internally honest, and every
 * WRITTEN spec must have one. `tests/fixtures/catalog-written-specs.json` is the
 * corpus's written specs at the time the blueprints were authored; a spec
 * written later shows the catalog's stated "no blueprint yet" box, not an error.
 *
 * Set BLUEPRINT_GROUP=<category> to check one group while authoring it.
 */

import { describe, it, expect } from 'vitest';
import written from '../../../tests/fixtures/catalog-written-specs.json';
import { BLUEPRINTS } from '../src/ml/architecture/blueprints';
import { validateBlueprint } from '../src/ml/architecture/blueprint';

type Written = Record<string, { id: string; name: string }[]>;
const only = process.env.BLUEPRINT_GROUP;
const groups = Object.entries(written as Written).filter(([category]) => !only || category === only);

describe('catalog architecture blueprints', () => {
  it('registers no blueprint under an id the corpus does not have', () => {
    const known = new Set(Object.values(written as Written).flat().map((s) => s.id));
    expect(Object.keys(BLUEPRINTS).filter((id) => !known.has(id))).toEqual([]);
  });

  for (const [category, specs] of groups) {
    describe(category, () => {
      it('covers every written spec', () => {
        expect(specs.filter((s) => !BLUEPRINTS[s.id]).map((s) => s.name)).toEqual([]);
      });

      for (const spec of specs) {
        const graph = BLUEPRINTS[spec.id];
        if (!graph) continue;
        it(`${spec.name} is sound`, () => {
          expect(validateBlueprint(graph)).toEqual([]);
          expect(graph.totalParams).toBe(graph.nodes.reduce((t, n) => t + (n.params ?? 0), 0));
        });
      }
    });
  }
});
