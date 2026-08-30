const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const dir = path.join(process.cwd(), 'src', 'server');

walkDir(dir, function(filePath) {
  if (!filePath.endsWith('.ts')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  // Replace .run() with await (if not already awaited)
  // We look for db.insert(...)...run()
  content = content.replace(/(?<!await\s+)(db\.(?:insert|update|delete)[\s\S]*?)\.run\(\)/g, "await $1");
  // If it was already awaited (e.g. return db.insert...run())
  content = content.replace(/(return\s+db\.(?:insert|update|delete)[\s\S]*?)\.run\(\)/g, "$1");
  // If it just has .run() and no await or return:
  content = content.replace(/\.run\(\)/g, "");
  
  // Replace .all() with await
  content = content.replace(/(?<!await\s+)(db\.select[\s\S]*?)\.all\(\)/g, "await $1");
  content = content.replace(/\.all\(\)/g, "");

  // Replace .get() with [0]
  // e.g. db.select().from(x).where(y).get() -> (await db.select().from(x).where(y))[0]
  content = content.replace(/(?<!await\s+)(db\.select[\s\S]*?)\.get\(\)/g, "(await $1)[0]");
  content = content.replace(/(return\s+db\.select[\s\S]*?)\.get\(\)/g, "($1).then(res => res[0])");
  content = content.replace(/\.get\(\)/g, "[0]"); // fallback, might be dangerous but let's see

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
});
