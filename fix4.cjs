const fs = require('fs');
let content = fs.readFileSync('apps/web/src/ml/ModelDetailView.tsx', 'utf8');
content = content.replace(/import \{ MLStudioProvider \} from "@\/ml\/lib\/MLStudioContext";\r?\n/, '');
content = content.replace(/<MLStudioProvider>/g, '');
content = content.replace(/<\/MLStudioProvider>/g, '');
fs.writeFileSync('apps/web/src/ml/ModelDetailView.tsx', content);
