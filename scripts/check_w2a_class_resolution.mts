/**
 * W2.a smoke check — every catalog spec routed to sklearn / tree / gmm / hmm
 * must expose a non-empty `class_name`, otherwise the Jinja2 template will
 * render an `import None from None` line.
 *
 * Run from project root:
 *   node --import tsx scripts/check_w2a_class_resolution.mts
 *
 * Exit 0 = all specs covered; exit 1 = at least one spec needs to be added to
 * `src/server/lib/modelImport/classMap.ts`.
 */

import { getTrainableModels } from '../src/server/lib/catalogBridge.js';
import { getModelById } from '../src/server/lib/modelImport/index.js';

// Map TemplateId → demands a class_name.  These four templates render an
// `from {{ catalog_spec.module_path }} import {{ catalog_spec.class_name }}`
// line at the top of the generated `main.py`; without resolution it errors out.
const NEEDS_CLASS = new Set(['sklearn', 'tree', 'gmm', 'hmm']);

const trainable = getTrainableModels();
const missing: Array<{ key: string; catalogId: string; name: string; templateId: string; subcategory: string }> = [];
let checked = 0;
let resolved = 0;

for (const [key, entry] of Object.entries(trainable)) {
  if (!entry.templateId || !NEEDS_CLASS.has(entry.templateId)) continue;
  if (!entry.catalogId) continue; // hand-wired runner with no catalog spec — skip

  const spec = getModelById(entry.catalogId);
  if (!spec) continue;

  checked++;
  if (spec.class_name && spec.module_path) {
    resolved++;
  } else {
    missing.push({
      key,
      catalogId: entry.catalogId,
      name: spec.name,
      templateId: entry.templateId,
      subcategory: spec.subcategory,
    });
  }
}

const list = { models: Object.values(trainable) };

console.log(`W2.a class-resolution smoke`);
console.log(`  total specs scanned:        ${list.models.length}`);
console.log(`  candidates needing class:   ${checked}`);
console.log(`  resolved (class_name set):  ${resolved}`);
console.log(`  missing class_name:         ${missing.length}`);

if (missing.length > 0) {
  console.log(`\nSpecs missing class_name (add to CATALOG_CLASS_MAP):`);
  for (const m of missing) {
    console.log(`  - catalogId="${m.catalogId}"  name="${m.name}"  template=${m.templateId}  subcategory=${m.subcategory}`);
  }
  process.exit(1);
}

console.log(`OK  every (sklearn|tree|gmm|hmm) candidate has a class_name`);
process.exit(0);
