const fs = require('fs');
let content = fs.readFileSync('apps/web/src/ml/RunConfigurator.tsx', 'utf8');
content = content.replace(/await startTraining\(\{[\s\S]*?\}\);/, 'await startTraining({ modelType: model.architecture || model.id, symbol: "MNQ" } as any);');
fs.writeFileSync('apps/web/src/ml/RunConfigurator.tsx', content);
