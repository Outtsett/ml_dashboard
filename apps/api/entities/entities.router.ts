import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, or } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { db } from '../infrastructure/database/db';
import { derivedViews } from '../infrastructure/database/lake/derivedDatasets';
import {
  entityRelationships,
  datasets,
  datasetVersions,
  features,
  featureDependencies,
  featureTransforms,
  wfvDefinitions,
  modelDriftMetrics,
  systemComponents
} from '@shared/schema';

const logger = new Logger('EntitiesRouter');

interface ConfiguredFeature {
  name: string;
  displayName?: string;
  category?: string;
  type?: string;
  params?: Record<string, unknown>;
  requires?: string[];
  description?: string;
}

/** A parent category: the display name and description the config gives it. */
interface ConfiguredCategory {
  name: string;
  description?: string;
}

/** Read the `categories` block — the parent table for features. */
function readConfiguredCategories(): Map<string, ConfiguredCategory> {
  const file = path.resolve(process.cwd(), 'packages', 'config', 'features.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    categories?: Record<string, ConfiguredCategory>;
  };
  const entries = Object.entries(parsed.categories ?? {});
  return new Map(entries.map(([id, value]) => [id, value]));
}

/** A category's display name, falling back to a readable form of its id. */
function featureCategoryLabel(id: string | null | undefined): string {
  if (!id) return 'Other';
  const configured = readConfiguredCategories().get(id);
  if (configured?.name) return configured.name;
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * `packages/config/features.json` is the single definition of every feature
 * (CLAUDE.md: "Config-driven features … is the single source of truth"). Read
 * it per request rather than caching it, so a feature added while the server
 * runs shows up on the next read — the file is a few tens of kilobytes and the
 * entity browser reads it once per page load.
 */
function readConfiguredFeatures(): ConfiguredFeature[] {
  const file = path.resolve(process.cwd(), 'packages', 'config', 'features.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    features?: ConfiguredFeature[];
  };
  return Array.isArray(parsed.features) ? parsed.features : [];
}

export function createEntitiesRouter(): Router {
  const router = Router();

  // Helper for generating UUIDs
  const genId = () => crypto.randomUUID();

  // ============================================================================
  // entity_relationships
  // ============================================================================
  const RelationshipSchema = z.object({
    sourceType: z.string(),
    sourceId: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    relationshipType: z.string(),
  });

  /** List all entity relationships */
  router.get('/entities/relationships', async (req: Request, res: Response) => {
    try {
      const records = await db.select().from(entityRelationships);
      res.json(records);
    } catch (err) {
      logger.error('Error fetching relationships', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get a specific relationship by ID */
  router.get('/entities/relationships/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(entityRelationships).where(eq(entityRelationships.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching relationship ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get full graph for a given entity (all connected entities) */
  router.get('/entities/graph/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const records = await db
        .select()
        .from(entityRelationships)
        .where(or(
          eq(entityRelationships.sourceId, req.params.id as string),
          eq(entityRelationships.targetId, req.params.id as string)
        ));
      res.json(records);
    } catch (err) {
      logger.error(`Error fetching graph for ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new relationship */
  router.post('/entities/relationships', async (req: Request, res: Response) => {
    try {
      const parsed = RelationshipSchema.parse(req.body);
      const newId = genId();
      await db.insert(entityRelationships).values({
        id: newId,
        ...parsed
      });
      const record = await db.select().from(entityRelationships).where(eq(entityRelationships.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating relationship', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a relationship */
  router.put('/entities/relationships/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = RelationshipSchema.parse(req.body);
      await db.update(entityRelationships).set(parsed).where(eq(entityRelationships.id, id));
      const record = await db.select().from(entityRelationships).where(eq(entityRelationships.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating relationship ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a relationship */
  router.delete('/entities/relationships/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(entityRelationships).where(eq(entityRelationships.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting relationship ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // datasets
  // ============================================================================
  const DatasetSchema = z.object({
    name: z.string(),
    description: z.string().optional().nullable(),
  });

  // ============================================================================
  // datasets and features — read from their real definitions
  // ============================================================================
  //
  // The SQLite `datasets` and `features` tables hold zero rows: nothing in the
  // app ever wrote them, so the entity browser listed zero datasets and zero
  // features while the lake held 79 manifested datasets and features.json 44.
  // A dataset IS its ingest manifest and a feature IS its features.json entry,
  // so those are what these two reads answer from. Writes still go to the
  // tables, which remain the home for a hand-authored entry. Both reads also
  // return a `category`: a feature's own from features.json, a dataset's
  // classified from its manifest path.

  /**
   * Dataset categories, matched on the dataset name against the manifest path.
   *
   * Order matters: the first match wins, so the specific rules are tested before
   * the general ones. A name that matches nothing is `Other` rather than a
   * guess, because a wrong category is worse than an honest unclassified one —
   * it hides the dataset in a group nobody thinks to look in.
   *
   * The groups are what the lake actually holds, not a taxonomy imposed on it:
   * bars and features, labels, studies, model/training records, strategy output,
   * audit/verification, and charting series.
   */
  const DATASET_CATEGORY_RULES: ReadonlyArray<{ id: string; name: string; match: RegExp }> = [
    { id: 'labels', name: 'Labels', match: /(^label|^labels$|label_|labels$|_labels$|label_audit)/ },
    { id: 'news_sentiment', name: 'News & Sentiment', match: /(news|sentiment|finbert)/ },
    { id: 'model_training', name: 'Model & Training', match: /(model_cycle|multimodal|runs$|training|overfitting|audit_)/ },
    { id: 'strategy_output', name: 'Strategy Output', match: /(^ta_|^study_(crossover|conditional_edges|regime_gated|quant_oos|ta_strategy)|strategy)/ },
    { id: 'audit_verification', name: 'Audit & Verification', match: /(audit|census|validation|inventory|monitor|lifecycle)/ },
    { id: 'studies', name: 'Studies', match: /^(study_|mnq_)/ },
    { id: 'diagnostics', name: 'Diagnostics', match: /(regression_tab_performance|perf)/ },
    { id: 'features_indicators', name: 'Features & Indicators', match: /(feature|indicator|talib|zone_|trend_state|candle_|pattern|shape|windows|next_candles|vector|hwma|mnq_eda)/ },
    { id: 'macro_series', name: 'Macro Series', match: /^(fred_|market_calendar)/ },
    { id: 'market_data', name: 'Market Data', match: /(bars|candles|live_bars|ohlcv|volume)/ },
  ];

  /** Classify a dataset by name. `other` when nothing matches. */
  function datasetCategory(name: string): { id: string; name: string } {
    const lower = name.toLowerCase();
    for (const rule of DATASET_CATEGORY_RULES) {
      if (rule.match.test(lower)) return { id: rule.id, name: rule.name };
    }
    return { id: 'other', name: 'Other' };
  }

  /**
   * Every manifested lake dataset, plus any hand-authored SQLite row.
   *
   * One row per dataset, not one per view: a dataset that lands several `table=`
   * parts is one entity with several tables, and listing `data_lifecycle_audit`
   * 41 times is not what the browser is for. The views are folded up, and the id
   * stays the dataset's own first view so the detail route keeps resolving.
   */
  router.get('/entities/datasets', async (req: Request, res: Response) => {
    try {
      const grouped = new Map<string, { id: string; name: string; tables: string[]; recipes: number }>();
      for (const view of derivedViews()) {
        const existing = grouped.get(view.dataset);
        if (existing) {
          if (view.table && !existing.tables.includes(view.table)) existing.tables.push(view.table);
          existing.recipes = Math.max(existing.recipes, view.recipeCount);
        } else {
          grouped.set(view.dataset, {
            id: view.viewName,
            name: view.dataset,
            tables: view.table ? [view.table] : [],
            recipes: view.recipeCount,
          });
        }
      }
      const fromLake = [...grouped.values()].map((entry) => {
        const category = datasetCategory(entry.name);
        return {
          id: entry.id,
          name: entry.name,
          category: category.name,
          categoryId: category.id,
          description:
          entry.tables.length > 0
            ? `${entry.recipes} recipe(s), ${entry.tables.length} table(s): ${entry.tables.join(', ')}`
            : `${entry.recipes} recipe(s)`,
          source: 'lake' as const,
        };
      });
      const authored = (await db.select().from(datasets)).map((row) => {
        const category = datasetCategory(row.name);
        return {
          id: row.id,
          name: row.name,
          category: category.name,
          categoryId: category.id,
          description: row.description,
          source: 'sqlite' as const,
        };
      });
      // A hand-authored row whose name matches a manifest adds a description, not a duplicate.
      const lakeNames = new Set(fromLake.map((row) => row.name));
      res.json([...fromLake, ...authored.filter((row) => !lakeNames.has(row.name))]);
    } catch (err) {
      logger.error('Error fetching datasets', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get dataset by ID */
  router.get('/entities/datasets/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(datasets).where(eq(datasets.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching dataset ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new dataset */
  router.post('/entities/datasets', async (req: Request, res: Response) => {
    try {
      const parsed = DatasetSchema.parse(req.body);
      const newId = genId();
      await db.insert(datasets).values({ id: newId, ...parsed });
      const record = await db.select().from(datasets).where(eq(datasets.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating dataset', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a dataset */
  router.put('/entities/datasets/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = DatasetSchema.parse(req.body);
      await db.update(datasets).set(parsed).where(eq(datasets.id, id));
      const record = await db.select().from(datasets).where(eq(datasets.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating dataset ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a dataset */
  router.delete('/entities/datasets/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(datasets).where(eq(datasets.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting dataset ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // dataset_versions
  // ============================================================================
  const DatasetVersionSchema = z.object({
    datasetId: z.string(),
    versionHash: z.string(),
    rowCount: z.number().int(),
    s3Path: z.string(),
  });

  /** List all dataset versions */
  router.get('/entities/dataset-versions', async (req: Request, res: Response) => {
    try {
      const records = await db.select().from(datasetVersions);
      res.json(records);
    } catch (err) {
      logger.error('Error fetching dataset versions', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get dataset version by ID */
  router.get('/entities/dataset-versions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(datasetVersions).where(eq(datasetVersions.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching dataset version ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new dataset version */
  router.post('/entities/dataset-versions', async (req: Request, res: Response) => {
    try {
      const parsed = DatasetVersionSchema.parse(req.body);
      const newId = genId();
      await db.insert(datasetVersions).values({ id: newId, ...parsed });
      const record = await db.select().from(datasetVersions).where(eq(datasetVersions.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating dataset version', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a dataset version */
  router.put('/entities/dataset-versions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = DatasetVersionSchema.parse(req.body);
      await db.update(datasetVersions).set(parsed).where(eq(datasetVersions.id, id));
      const record = await db.select().from(datasetVersions).where(eq(datasetVersions.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating dataset version ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a dataset version */
  router.delete('/entities/dataset-versions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(datasetVersions).where(eq(datasetVersions.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting dataset version ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // features
  // ============================================================================
  const FeatureSchema = z.object({
    name: z.string(),
    category: z.string(),
    computationLogic: z.string(),
    codeReference: z.string().optional().nullable(),
  });

  /** The parent table for datasets, with live child counts. */
  router.get('/entities/dataset-categories', async (req: Request, res: Response) => {
    try {
      // Counted through `datasetCategory`, so a name lands in the same bucket
      // here as it does in the dataset list. Counting each rule independently
      // would double-count every name two patterns both match.
      const counts = new Map<string, { name: string; datasetCount: number }>(
        DATASET_CATEGORY_RULES.map((rule) => [rule.id, { name: rule.name, datasetCount: 0 }]),
      );
      let otherCount = 0;
      const seen = new Set<string>();
      for (const view of derivedViews()) {
        if (seen.has(view.dataset)) continue;
        seen.add(view.dataset);
        const category = datasetCategory(view.dataset);
        const bucket = counts.get(category.id);
        if (bucket) bucket.datasetCount += 1;
        else otherCount += 1;
      }
      const rows = [...counts.values()]
        .concat(otherCount > 0 ? [{ name: 'Other', datasetCount: otherCount }] : [])
        .sort((a, b) => b.datasetCount - a.datasetCount || a.name.localeCompare(b.name));
      res.json(rows.map((row) => ({
        id: DATASET_CATEGORY_RULES.find((rule) => rule.name === row.name)?.id ?? 'other',
        name: row.name,
        datasetCount: row.datasetCount,
      })));
    } catch (err) {
      logger.error('Error fetching dataset categories', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * The parents, so a client renders the hierarchy in one request instead of
   * grouping a flat list itself. Each carries its live child count.
   */
  router.get('/entities/feature-categories', async (req: Request, res: Response) => {
    try {
      const configured = readConfiguredCategories();
      const counts = new Map<string, number>();
      for (const feature of readConfiguredFeatures()) {
        const key = feature.category ?? 'other';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const rows = [...configured.entries()]
        .map(([id, value]) => ({
          id,
          name: value.name,
          description: value.description,
          featureCount: counts.get(id) ?? 0,
        }))
        .sort((a, b) => b.featureCount - a.featureCount || a.name.localeCompare(b.name));
      res.json(rows);
    } catch (err) {
      logger.error('Error fetching feature categories', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** The distinct kinds of metric or calculation, with their counts. */
  router.get('/entities/feature-types', async (req: Request, res: Response) => {
    try {
      const counts = new Map<string, number>();
      for (const feature of readConfiguredFeatures()) {
        if (feature.type) counts.set(feature.type, (counts.get(feature.type) ?? 0) + 1);
      }
      const rows = [...counts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
      res.json(rows);
    } catch (err) {
      logger.error('Error fetching feature types', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * The feature dependency graph, as nodes and edges.
   *
   * Served as an explicit two-component structure because the data IS two
   * disconnected components, and returning one flat node list would invite a
   * drawing that implies a bridge that does not exist:
   *
   *   base     12 raw columns -> 44 features in `features.json`
   *   derived  130 indicator columns -> 400 columns `feature_extraction.json` derives
   *
   * Nothing joins them: `features.json` computes its indicators inline from raw
   * bars, while the derived layer transforms indicator columns from a separate
   * producer written in a different naming convention. `disconnected: true` is
   * returned so a client can say so on screen rather than leave the viewer to
   * infer it from two unconnected clusters.
   *
   * `?component=base|derived` narrows the response; `?transform=` narrows the
   * derived layer to one transform, which is the only useful size to draw.
   */
  router.get('/entities/feature-graph', async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(featureDependencies);
      const transforms = await db.select().from(featureTransforms);

      const wanted = typeof req.query.component === 'string' ? req.query.component : null;
      const wantedTransform = typeof req.query.transform === 'string' ? req.query.transform : null;

      // Which component an edge belongs to is decided by the EDGE, not by its
      // endpoints: the derived layer's parents are `column:` nodes too, so a
      // prefix test on either end would classify all 507 edges as base.
      const componentOfEdge = (kind: string): 'base' | 'derived' =>
        kind === 'input_column' || kind === 'depends_on' ? 'base' : 'derived';

      let edges = rows.filter((edge) => edge.kind !== 'computes');
      if (wanted === 'base' || wanted === 'derived') {
        edges = edges.filter((edge) => componentOfEdge(edge.kind) === wanted);
      }
      if (wantedTransform) {
        // `via` carries the transform on a `derives` edge and the transform name
        // on the tail of a sibling edge's label, so match either rather than
        // keeping every sibling edge in the graph.
        edges = edges.filter(
          (edge) =>
            edge.via === wantedTransform ||
            (edge.kind === 'derives_with' && (edge.via ?? '').startsWith(`${wantedTransform} `))
        );
      }

      const componentOf = (node: string): 'base' | 'derived' =>
        node.startsWith('derived:') || node.startsWith('transform:') ? 'derived' : 'base';

      // Union the two endpoint columns into a node list, since the edge table is
      // the only place node identity exists.
      const nodes = new Map<string, { id: string; kind: string; component: 'base' | 'derived' }>();
      for (const edge of edges) {
        for (const node of [edge.source, edge.target]) {
          if (nodes.has(node)) continue;
          const colon = node.indexOf(':');
          nodes.set(node, {
            id: node,
            kind: colon === -1 ? node : node.slice(0, colon),
            component: componentOf(node)
          });
        }
      }

      res.json({
        nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
        edges,
        transforms,
        counts: {
          baseFeatures: new Set(
            edges.filter((e) => e.kind === 'input_column').map((e) => e.target)
          ).size,
          derivedColumns: new Set(
            edges
              .filter((e) => e.kind !== 'input_column')
              .map((e) => e.target)
              .filter((t) => t.startsWith('derived:'))
          ).size
        },
        disconnected: true
      });
    } catch (err) {
      logger.error('Error fetching feature graph', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Every feature in `packages/config/features.json`, plus any hand-authored row. */
  router.get('/entities/features', async (req: Request, res: Response) => {
    try {
      const fromConfig = readConfiguredFeatures().map((feature) => ({
        id: feature.name,
        name: feature.displayName ?? feature.name,
        category: featureCategoryLabel(feature.category),
        categoryId: feature.category ?? 'other',
        // The type is the "kind of metric or calculation" a feature category is
        // a parent of — it is its own axis, not a restatement of the category.
        type: feature.type ?? null,
        params: feature.params ?? {},
        requires: feature.requires ?? [],
        description: feature.description,
        source: 'config' as const,
      }));
      const authored = (await db.select().from(features)).map((row) => ({
        id: row.id,
        name: row.displayName ?? row.name,
        category: featureCategoryLabel(row.categoryId),
        categoryId: row.categoryId,
        type: row.typeId,
        params: {},
        requires: [],
        description: row.computationLogic,
        source: 'sqlite' as const,
      }));
      const configNames = new Set(fromConfig.map((row) => row.id));
      res.json([...fromConfig, ...authored.filter((row) => !configNames.has(row.id))]);
    } catch (err) {
      logger.error('Error fetching features', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get feature by ID */
  router.get('/entities/features/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(features).where(eq(features.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching feature ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new feature */
  router.post('/entities/features', async (req: Request, res: Response) => {
    try {
      const parsed = FeatureSchema.parse(req.body);
      const newId = genId();
      await db.insert(features).values({ id: newId, ...parsed });
      const record = await db.select().from(features).where(eq(features.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating feature', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a feature */
  router.put('/entities/features/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = FeatureSchema.parse(req.body);
      await db.update(features).set(parsed).where(eq(features.id, id));
      const record = await db.select().from(features).where(eq(features.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating feature ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a feature */
  router.delete('/entities/features/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(features).where(eq(features.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting feature ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // wfv_definitions
  // ============================================================================
  const WfvDefinitionSchema = z.object({
    name: z.string(),
    foldIndex: z.number().int(),
    inSampleStart: z.coerce.date(),
    inSampleEnd: z.coerce.date(),
    outSampleStart: z.coerce.date(),
    outSampleEnd: z.coerce.date(),
  });

  /** List all WFV definitions */
  router.get('/entities/wfv-definitions', async (req: Request, res: Response) => {
    try {
      const records = await db.select().from(wfvDefinitions);
      res.json(records);
    } catch (err) {
      logger.error('Error fetching WFV definitions', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get WFV definition by ID */
  router.get('/entities/wfv-definitions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(wfvDefinitions).where(eq(wfvDefinitions.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching WFV definition ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new WFV definition */
  router.post('/entities/wfv-definitions', async (req: Request, res: Response) => {
    try {
      const parsed = WfvDefinitionSchema.parse(req.body);
      const newId = genId();
      await db.insert(wfvDefinitions).values({ 
        id: newId, 
        ...parsed, 
        inSampleStart: new Date(parsed.inSampleStart),
        inSampleEnd: new Date(parsed.inSampleEnd),
        outSampleStart: new Date(parsed.outSampleStart),
        outSampleEnd: new Date(parsed.outSampleEnd)
      });
      const record = await db.select().from(wfvDefinitions).where(eq(wfvDefinitions.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating WFV definition', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a WFV definition */
  router.put('/entities/wfv-definitions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = WfvDefinitionSchema.parse(req.body);
      await db.update(wfvDefinitions).set({
        ...parsed,
        inSampleStart: new Date(parsed.inSampleStart),
        inSampleEnd: new Date(parsed.inSampleEnd),
        outSampleStart: new Date(parsed.outSampleStart),
        outSampleEnd: new Date(parsed.outSampleEnd)
      }).where(eq(wfvDefinitions.id, id));
      const record = await db.select().from(wfvDefinitions).where(eq(wfvDefinitions.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating WFV definition ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a WFV definition */
  router.delete('/entities/wfv-definitions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(wfvDefinitions).where(eq(wfvDefinitions.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting WFV definition ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // model_drift_metrics
  // ============================================================================
  const ModelDriftMetricSchema = z.object({
    modelId: z.string(),
    featureId: z.string().optional().nullable(),
    psiScore: z.number(),
    klDivergence: z.number(),
    measuredAt: z.coerce.date(),
  });

  /** List all model drift metrics */
  router.get('/entities/model-drift-metrics', async (req: Request, res: Response) => {
    try {
      const records = await db.select().from(modelDriftMetrics);
      res.json(records);
    } catch (err) {
      logger.error('Error fetching model drift metrics', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get model drift metric by ID */
  router.get('/entities/model-drift-metrics/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(modelDriftMetrics).where(eq(modelDriftMetrics.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching model drift metric ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new model drift metric */
  router.post('/entities/model-drift-metrics', async (req: Request, res: Response) => {
    try {
      const parsed = ModelDriftMetricSchema.parse(req.body);
      const newId = genId();
      await db.insert(modelDriftMetrics).values({ id: newId, ...parsed });
      const record = await db.select().from(modelDriftMetrics).where(eq(modelDriftMetrics.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating model drift metric', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a model drift metric */
  router.put('/entities/model-drift-metrics/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = ModelDriftMetricSchema.parse(req.body);
      await db.update(modelDriftMetrics).set(parsed).where(eq(modelDriftMetrics.id, id));
      const record = await db.select().from(modelDriftMetrics).where(eq(modelDriftMetrics.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating model drift metric ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a model drift metric */
  router.delete('/entities/model-drift-metrics/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(modelDriftMetrics).where(eq(modelDriftMetrics.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting model drift metric ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================================================
  // system_components
  // ============================================================================
  const SystemComponentSchema = z.object({
    componentType: z.string(),
    name: z.string(),
    description: z.string().optional().nullable(),
    gitPath: z.string().optional().nullable(),
  });

  /** List all system components */
  router.get('/entities/system-components', async (req: Request, res: Response) => {
    try {
      const records = await db.select().from(systemComponents);
      res.json(records);
    } catch (err) {
      logger.error('Error fetching system components', err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get system component by ID */
  router.get('/entities/system-components/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const record = await db.select().from(systemComponents).where(eq(systemComponents.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error fetching system component ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new system component */
  router.post('/entities/system-components', async (req: Request, res: Response) => {
    try {
      const parsed = SystemComponentSchema.parse(req.body);
      const newId = genId();
      await db.insert(systemComponents).values({ id: newId, ...parsed });
      const record = await db.select().from(systemComponents).where(eq(systemComponents.id, newId)).get();
      res.status(201).json(record);
    } catch (err) {
      logger.error('Error creating system component', err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Update a system component */
  router.put('/entities/system-components/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const parsed = SystemComponentSchema.parse(req.body);
      await db.update(systemComponents).set(parsed).where(eq(systemComponents.id, id));
      const record = await db.select().from(systemComponents).where(eq(systemComponents.id, id)).get();
      if (!record) return res.status(404).json({ error: 'Not found' });
      res.json(record);
    } catch (err) {
      logger.error(`Error updating system component ${req.params.id}`, err);
      res.status(400).json({ error: String(err) });
    }
  });

  /** Delete a system component */
  router.delete('/entities/system-components/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await db.delete(systemComponents).where(eq(systemComponents.id, id));
      res.status(204).send();
    } catch (err) {
      logger.error(`Error deleting system component ${req.params.id}`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

export default createEntitiesRouter();
