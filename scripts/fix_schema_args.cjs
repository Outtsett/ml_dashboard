const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'src', 'shared', 'schema.ts');
let content = fs.readFileSync(schemaPath, 'utf8');

// fix integer with timestamp_ms mode to timestamp
content = content.replace(/integer\((['"]\w+['"]),\s*\{\s*mode:\s*['"]timestamp_ms['"]\s*\}\)/g, 'timestamp($1)');

// fix AnySQLiteColumn
content = content.replace(/AnySQLiteColumn/g, 'AnyPgColumn');

fs.writeFileSync(schemaPath, content, 'utf8');
console.log('Fixed schema args');
