const fs = require('fs');
let content = fs.readFileSync('apps/web/src/ml/ModelCatalogPage.tsx', 'utf8');
content = content.replace(/useCatalogLifecycle, } from.*\] as const;/g, 'useCatalogLifecycle } from "@/ml/lib/useModelCatalog";\nimport { LIFECYCLE_STAGES } from "@shared/catalogLifecycle";\n\nconst STAGE_FILTERS = [\n  { id: "all", label: "All Models", minimumStage: null },\n  { id: "trainable", label: "Trainable", minimumStage: "untrained" },\n  { id: "trained", label: "Trained", minimumStage: "trained" }\n] as const;');
fs.writeFileSync('apps/web/src/ml/ModelCatalogPage.tsx', content);
