const fs = require('fs');
let content = fs.readFileSync('apps/web/src/ml/ModelDetailView.tsx', 'utf8');
content = content.replace(/import \{ EvaluateStage \} from "\.\/experiments\/EvaluateStage";[\s\S]*?import \{ RiskPanel \} from "\.\/experiments\/RiskPanel";/g, '');
content = content.replace(/<EvaluateStage \/>/g, '<div className="p-8 text-center text-muted-foreground border border-dashed border-border/50 rounded-lg">Evaluate Stage (WIP)</div>');
content = content.replace(/<RLConsolePanel \/>/g, '<div className="p-8 text-center text-muted-foreground border border-dashed border-border/50 rounded-lg">RL Console (WIP)</div>');
content = content.replace(/<RiskPanel \/>/g, '<div className="p-8 text-center text-muted-foreground border border-dashed border-border/50 rounded-lg">Risk Assessment (WIP)</div>');
fs.writeFileSync('apps/web/src/ml/ModelDetailView.tsx', content);
