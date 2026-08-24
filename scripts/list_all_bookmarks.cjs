const fs = require('fs');
const path = 'C:/Users/tyler/AppData/Local/Google/Chrome/User Data/Default/Bookmarks';
const b = JSON.parse(fs.readFileSync(path, 'utf8'));

function collectAll(node, folderPath) {
  let items = [];
  if (!node) return items;
  if (node.type === 'url') {
    let domain = '';
    try { domain = new URL(node.url).hostname.replace('www.', ''); } catch {}
    items.push({
      name: node.name,
      url: node.url,
      domain,
      folder: folderPath
    });
  }
  if (node.children) {
    const fp = folderPath ? folderPath + ' > ' + node.name : node.name;
    node.children.forEach(ch => items.push(...collectAll(ch, fp)));
  }
  return items;
}

const all = collectAll(b.roots.bookmark_bar, '');
all.forEach((bm, i) => {
  console.log(`${i + 1}. [${bm.folder || 'ROOT'}] "${bm.name}" => ${bm.domain}`);
});
