/**
 * check-catalog-batch — parse every spec in one fixture batch through the REAL
 * catalog parser and fail on anything the Model Catalog would render blank.
 *
 *   npx tsx scripts/check-catalog-batch.ts <batchKey>
 *
 * Batches are the keys of tests/fixtures/catalog-written-specs.json.
 */

import fs from 'fs';
import path from 'path';
import { parseModelSpec } from '../apps/api/infrastructure/lib/modelImport/parser';

const ROOT = path.resolve(
  process.env.ALGO_MODELS_ROOT ?? 'E:/source/repos/ml_dashboard/Trading/_architecture/educational/algo_models',
);
const REQUIRED_HEADINGS = [
  '## Overview',
  '## Principles',
  '## Algorithm',
  '### Variants',
  '## Training Methodology',
  '## Key Features',
  '## Applications',
  '## Implementation Details',
];

const batchKey = process.argv[2];
const fixture = JSON.parse(
  fs.readFileSync(path.resolve('tests/fixtures/catalog-written-specs.json'), 'utf-8'),
) as Record<string, { id: string; name: string; path: string }[]>;
const batch = batchKey ? fixture[batchKey] : undefined;
if (!batch) {
  console.error(`unknown batch "${batchKey}". Batches: ${Object.keys(fixture).join(', ')}`);
  process.exit(2);
}

let failures = 0;
for (const entry of batch) {
  const file = path.join(ROOT, entry.path);
  const problems: string[] = [];
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const spec = raw ? parseModelSpec(file, ROOT, false) : null;

  if (!raw) problems.push('file is empty or missing');
  if (spec) {
    if (spec.id !== entry.id) problems.push(`id is ${spec.id}`);
    if (spec.name !== entry.name) problems.push(`H1 "${spec.name}" does not match the filename "${entry.name}"`);
    if (!raw.startsWith('# ')) problems.push('does not start at the H1');
    for (const heading of REQUIRED_HEADINGS) if (!raw.includes(`\n${heading}`)) problems.push(`missing "${heading}"`);
    if (spec.overview.length < 300) problems.push(`overview is ${spec.overview.length} characters`);
    if (spec.principles.length < 4) problems.push(`${spec.principles.length} principles`);
    if (spec.variants.length < 3) problems.push(`${spec.variants.length} variants`);
    if (spec.keyFeatures.length < 4) problems.push(`${spec.keyFeatures.length} key features`);
    if (spec.applications.length < 4) problems.push(`${spec.applications.length} applications`);
    if (spec.hyperparameters.length < 5) problems.push(`${spec.hyperparameters.length} hyperparameters extracted`);
    if (!/```python\n[\s\S]*?```/.test(raw)) problems.push('no fenced python block');
    if (raw.length < 3500) problems.push(`only ${raw.length} characters`);
    const nonAscii = raw.match(/[^\x00-\x7F]/g);
    if (nonAscii) problems.push(`${nonAscii.length} non-ASCII characters (first: U+${nonAscii[0]!.charCodeAt(0).toString(16)})`);
  }

  if (problems.length) {
    failures++;
    console.log(`FAIL  ${entry.name}\n      ${problems.join('\n      ')}`);
  } else {
    console.log(`ok    ${entry.name}  (${raw.length} chars, ${spec!.hyperparameters.length} hyperparameters)`);
  }
}

console.log(`\n${batch.length - failures} of ${batch.length} specs sound`);
process.exit(failures ? 1 : 0);
