/**
 * `GET /api/training/cycle-models` (`training/cycleModels.router.ts`): the Cycle
 * registry joined with the model catalog, mounted on a bare test app.
 *
 * Most cases inject a small catalog so every placement rule is pinned: a
 * registry model under its own spec, an `alsoCatalogSpecIds` spec as a second
 * card for the same key, every other spec greyed with the most specific
 * reason, and the registry's fallback grouping when a spec (or the whole
 * catalog) is missing. One case reads the real catalog on disk.
 */

import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cycleModelsResponseSchema, type CycleModelCard, type CycleModelsResponse, type CycleRegistry } from '@shared/cycle/models';
import { getCycleRegistry } from '../../src/server/training/cycleModels';
import {
  buildCycleModelsResponse,
  createCycleModelsRouter,
  readCatalogSnapshot,
  type CatalogSnapshot,
} from '../../src/server/training/cycleModels.router';

const XGBOOST_SPEC = 'machine-learning-supervised-learning-boosting-methods-xgboost';
const LOGISTIC_SPEC = 'machine-learning-supervised-learning-linear-models-logistic-regression';
const LOGISTIC_STATISTICAL_SPEC = 'statistical-models-generalized-linear-models-logistic-regression';
const VISION_TRANSFORMER_SPEC = 'neural-network-architectures-attention-based-architectures-vision-transformer-vit';

const CATALOG: CatalogSnapshot = {
  specs: [
    { id: XGBOOST_SPEC, name: 'XGBoost', category: 'supervised', subcategory: 'boosting-methods' },
    { id: 'machine-learning-supervised-learning-boosting-methods-adaboost', name: 'AdaBoost', category: 'supervised', subcategory: 'boosting-methods' },
    { id: LOGISTIC_SPEC, name: 'Logistic Regression', category: 'supervised', subcategory: 'linear-models' },
    { id: LOGISTIC_STATISTICAL_SPEC, name: 'Logistic Regression', category: 'statistical', subcategory: 'generalized-linear-models' },
    { id: VISION_TRANSFORMER_SPEC, name: 'Vision Transformer (ViT)', category: 'neural-network', subcategory: 'attention-based-architectures' },
    { id: 'neural-network-graph-neural-networks-gcn', name: 'Graph Convolutional Network', category: 'neural-network', subcategory: 'graph-neural-networks' },
    { id: 'unsupervised-clustering-k-means', name: 'K-Means', category: 'unsupervised', subcategory: 'clustering' },
    { id: 'made-up-category-thing', name: 'Thing', category: 'made-up-category', subcategory: 'general' },
  ],
  categoryLabels: { supervised: 'Supervised Learning', statistical: 'Statistical Models', 'neural-network': 'Neural Networks', unsupervised: 'Unsupervised Learning' },
};

let registry: CycleRegistry;
let server: Server;
let baseUrl: string;
let catalog: CatalogSnapshot | null = CATALOG;
let registryLoad: () => { registry: CycleRegistry | null; problems: string[] };

function cards(response: CycleModelsResponse): Array<CycleModelCard & { category: string; subcategory: string }> {
  return response.categories.flatMap((category) =>
    category.subcategories.flatMap((subcategory) => subcategory.models.map((card) => ({ ...card, category: category.id, subcategory: subcategory.id }))),
  );
}

async function get(): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/training/cycle-models`);
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  registry = getCycleRegistry();
  registryLoad = () => ({ registry, problems: [] });
  const app = express();
  app.use('/api', createCycleModelsRouter({ loadRegistry: () => registryLoad(), loadCatalog: () => catalog }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

describe('GET /api/training/cycle-models', () => {
  it('answers 200 with a response that passes cycleModelsResponseSchema', async () => {
    catalog = CATALOG;
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(cycleModelsResponseSchema.safeParse(body).success).toBe(true);
    expect((body as CycleModelsResponse).catalogAvailable).toBe(true);
  });

  it('places a registry model under its own catalog spec, with the catalog labels', async () => {
    catalog = CATALOG;
    const response = (await get()).body as CycleModelsResponse;
    const xgboost = cards(response).find((card) => card.key === 'xgboost')!;
    expect(xgboost).toMatchObject({
      runnerKey: 'xgboost+walk_forward_cycle',
      catalogSpecId: XGBOOST_SPEC,
      specAvailable: true,
      category: 'supervised',
      subcategory: 'boosting-methods',
      displayName: 'XGBoost',
      runnable: registry.models.xgboost!.runnable,
      hasPriceModel: registry.models.xgboost!.price !== null,
      directionMode: registry.models.xgboost!.direction.mode,
    });
    const supervised = response.categories.find((category) => category.id === 'supervised')!;
    expect(supervised.label).toBe('Supervised Learning');
    // The primary spec's subcategory reads with the registry's label.
    expect(supervised.subcategories.find((subcategory) => subcategory.id === 'boosting-methods')!.label).toBe(registry.models.xgboost!.subcategory);
  });

  it('an alsoCatalogSpecIds spec is a second card selecting the same key', async () => {
    catalog = CATALOG;
    const response = (await get()).body as CycleModelsResponse;
    const logistic = cards(response).filter((card) => card.key === 'logistic_regression');
    expect(logistic.map((card) => card.catalogSpecId).sort()).toEqual([LOGISTIC_SPEC, LOGISTIC_STATISTICAL_SPEC].sort());
    expect(new Set(logistic.map((card) => card.runnerKey))).toEqual(new Set(['logistic_regression+walk_forward_cycle']));
    expect(logistic.find((card) => card.catalogSpecId === LOGISTIC_STATISTICAL_SPEC)!.category).toBe('statistical');
  });

  it('greys every other catalog spec with the most specific reason', async () => {
    catalog = CATALOG;
    const { shared } = registry;
    const byId = new Map(cards((await get()).body as CycleModelsResponse).map((card) => [card.catalogSpecId, card]));
    const greyed = (id: string) => byId.get(id)!;
    expect(greyed(VISION_TRANSFORMER_SPEC)).toMatchObject({ key: null, runnerKey: null, runnable: false, unavailableReason: shared.unavailableBySpec[VISION_TRANSFORMER_SPEC] });
    expect(greyed('neural-network-graph-neural-networks-gcn').unavailableReason).toBe(shared.unavailableBySubcategory['neural-network/graph-neural-networks']);
    expect(greyed('unsupervised-clustering-k-means').unavailableReason).toBe(shared.unavailableByCategory.unsupervised);
    expect(greyed('machine-learning-supervised-learning-boosting-methods-adaboost').unavailableReason).toBe(shared.unavailableByCategory.supervised);
    expect(greyed('made-up-category-thing').unavailableReason).toBe('Not built for the Cycle yet.');
    expect(greyed('made-up-category-thing').displayName).toBe('Thing');
  });

  it('a registry model whose spec the catalog lacks falls back to the registry grouping, spec link off', async () => {
    catalog = CATALOG;
    const response = (await get()).body as CycleModelsResponse;
    const lstm = cards(response).find((card) => card.key === 'lstm')!;
    expect(lstm.specAvailable).toBe(false);
    expect(lstm.catalogSpecId).toBe(registry.models.lstm!.catalogSpecId);
    const category = response.categories.find((entry) => entry.id === lstm.category)!;
    expect(category.label).toBe(registry.models.lstm!.category);
    expect(category.subcategories.find((entry) => entry.id === lstm.subcategory)!.label).toBe(registry.models.lstm!.subcategory);
  });

  it('every registry key appears; runnable counts are over models, not cards; runnable before being-built before greyed', async () => {
    catalog = CATALOG;
    const response = (await get()).body as CycleModelsResponse;
    const all = cards(response);
    expect(new Set(all.map((card) => card.key).filter((key) => key !== null))).toEqual(new Set(Object.keys(registry.models)));
    expect(response.totalCount).toBe(all.length);
    // a model shown under two catalog specs (alsoCatalogSpecIds) counts once
    const runnableKeys = (list: typeof all) => new Set(list.filter((card) => card.runnable).map((card) => card.key)).size;
    expect(response.runnableCount).toBe(runnableKeys(all));
    expect(response.runnableCount).toBe(Object.values(registry.models).filter((entry) => entry.runnable).length);
    for (const category of response.categories) {
      expect(category.runnableCount).toBe(runnableKeys(category.subcategories.flatMap((subcategory) => subcategory.models)));
      for (const subcategory of category.subcategories) {
        const rank = subcategory.models.map((card) => (card.runnable ? 0 : card.key !== null ? 1 : 2));
        expect(rank).toEqual([...rank].sort((a, b) => a - b));
      }
    }
    // Categories holding registry models come first.
    expect(response.categories[0]!.id).toBe('supervised');
  });

  it('with no catalog: catalogAvailable false and the registry fallback grouping only', async () => {
    catalog = null;
    const response = (await get()).body as CycleModelsResponse;
    expect(response.catalogAvailable).toBe(false);
    const all = cards(response);
    expect(all).toHaveLength(Object.keys(registry.models).length);
    expect(all.every((card) => card.key !== null && !card.specAvailable)).toBe(true);
    expect(new Set(response.categories.map((category) => category.label))).toEqual(new Set(Object.values(registry.models).map((entry) => entry.category)));
    catalog = CATALOG;
  });

  it('500s with the problems when the registry is invalid', async () => {
    registryLoad = () => ({ registry: null, problems: ['boosting.json: broken'] });
    const { status, body } = await get();
    registryLoad = () => ({ registry, problems: [] });
    expect(status).toBe(500);
    expect((body as { error: string }).error).toMatch(/boosting\.json: broken/);
  });
});

describe('buildCycleModelsResponse over the real catalog', () => {
  const snapshot = readCatalogSnapshot();

  it.skipIf(snapshot === null)('places every registry key and greys the rest of the catalog', () => {
    const response = buildCycleModelsResponse(getCycleRegistry(), snapshot);
    expect(response.catalogAvailable).toBe(true);
    const all = cards(response);
    const registryModels = getCycleRegistry().models;
    for (const [key, entry] of Object.entries(registryModels)) {
      const own = all.filter((card) => card.key === key);
      expect(own.length, key).toBeGreaterThanOrEqual(1);
      if (entry.catalogSpecId) expect(own.some((card) => card.catalogSpecId === entry.catalogSpecId && card.specAvailable), key).toBe(true);
    }
    const catalogIds = new Set(snapshot!.specs.map((spec) => spec.id));
    const greyed = all.filter((card) => card.key === null);
    expect(greyed.every((card) => catalogIds.has(card.catalogSpecId!) && typeof card.unavailableReason === 'string')).toBe(true);
    // Every catalog spec is on exactly one card (registry or greyed).
    const specCards = all.filter((card) => card.specAvailable).map((card) => card.catalogSpecId);
    expect(new Set(specCards).size).toBe(specCards.length);
    expect(new Set(specCards)).toEqual(catalogIds);
  });
});
