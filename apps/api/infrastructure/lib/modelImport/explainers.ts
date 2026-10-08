/**
 * Catalog explainers — the plain-language "how it works" record of a model.
 *
 * One JSON file per specification in `packages/config/model_explainers/`,
 * validated against `modelExplainerSchema` before it is returned. The file is
 * found by looking the id up in the directory listing, never by building a
 * path from the request.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { modelExplainerSchema, type ModelExplainer } from '@shared/modelExplainer';

const EXPLAINER_DIRECTORY = path.resolve(process.cwd(), 'packages', 'config', 'model_explainers');
const EXTENSION = '.json';

interface Listing {
  directoryModifiedMs: number;
  files: Map<string, string>;
}

interface CachedExplainer {
  fileModifiedMs: number;
  explainer: ModelExplainer;
}

let listing: Listing | null = null;
const cache = new Map<string, CachedExplainer>();

async function listExplainerFiles(): Promise<Map<string, string>> {
  let directoryModifiedMs: number;
  try {
    directoryModifiedMs = (await fs.stat(EXPLAINER_DIRECTORY)).mtimeMs;
  } catch {
    return new Map();
  }
  if (listing && listing.directoryModifiedMs === directoryModifiedMs) return listing.files;
  const names = await fs.readdir(EXPLAINER_DIRECTORY);
  const files = new Map<string, string>();
  for (const name of names) {
    if (name.endsWith(EXTENSION)) files.set(name.slice(0, -EXTENSION.length), path.join(EXPLAINER_DIRECTORY, name));
  }
  listing = { directoryModifiedMs, files };
  return files;
}

/** The specification ids that have an explainer on disk. */
export async function listExplainedSpecificationIds(): Promise<string[]> {
  return [...(await listExplainerFiles()).keys()];
}

/**
 * The explainer of one specification, or `null` when none is written.
 * Throws when the file exists and does not satisfy the schema.
 */
export async function getModelExplainer(specificationId: string): Promise<ModelExplainer | null> {
  const file = (await listExplainerFiles()).get(specificationId);
  if (!file) return null;
  const fileModifiedMs = (await fs.stat(file)).mtimeMs;
  const cached = cache.get(specificationId);
  if (cached && cached.fileModifiedMs === fileModifiedMs) return cached.explainer;
  const parsed = modelExplainerSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf-8')));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`explainer for "${specificationId}" is invalid at ${issue?.path.join('.')}: ${issue?.message}`);
  }
  cache.set(specificationId, { fileModifiedMs, explainer: parsed.data });
  return parsed.data;
}
