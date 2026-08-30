import fs from 'fs';
import path from 'path';

const schemaPath = path.join(process.cwd(), 'src', 'shared', 'schema.ts');
let content = fs.readFileSync(schemaPath, 'utf8');

// 1. Imports
content = content.replace(
  /import \{([^}]+)\} from "drizzle-orm\/sqlite-core";/g,
  (match, p1) => {
    let imports = p1.replace(/sqliteTable/g, 'pgTable')
                    .replace(/AnySQLiteColumn/g, 'AnyPgColumn')
                    .replace(/real/g, 'doublePrecision')
                    .split(',')
                    .map(s => s.trim());
    
    if (!imports.includes('serial')) imports.push('serial');
    if (!imports.includes('jsonb')) imports.push('jsonb');
    if (!imports.includes('boolean')) imports.push('boolean');
    if (!imports.includes('timestamp')) imports.push('timestamp');
    
    // Some sqlite imports might not exist in pg, let's just replace them and typescript will complain if wrong
    return `import { ${imports.filter(i => !!i && i !== 'blob').join(', ')} } from "drizzle-orm/pg-core";`;
  }
);

// 2. Table definitions
content = content.replace(/sqliteTable\(/g, 'pgTable(');

// 3. real -> doublePrecision
content = content.replace(/real\(/g, 'doublePrecision(');

// 4. integer primary key autoIncrement -> serial
content = content.replace(/integer\((['"]\w+['"])\)\.primaryKey\(\{ autoIncrement: true \}\)/g, 'serial($1).primaryKey()');

// 5. JSON text mode -> jsonb
content = content.replace(/text\((['"]\w+['"]),\s*\{\s*mode:\s*['"]json['"]\s*\}\)/g, 'jsonb($1)');

// 6. Boolean mode (SQLite uses integer for boolean, Postgres has boolean)
content = content.replace(/integer\((['"]\w+['"]),\s*\{\s*mode:\s*['"]boolean['"]\s*\}\)/g, 'boolean($1)');

// 7. blob -> jsonb (as a fallback, or we can leave it if we import bytea)
content = content.replace(/blob\(/g, 'jsonb(');

// Write back
fs.writeFileSync(schemaPath, content, 'utf8');
console.log('Schema migrated to Postgres syntax (mostly).');
