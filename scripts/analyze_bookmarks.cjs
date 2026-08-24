const fs = require('fs');
const path = 'C:/Users/tyler/AppData/Local/Google/Chrome/User Data/Default/Bookmarks';
const b = JSON.parse(fs.readFileSync(path, 'utf8'));

function count(node) {
  if (!node) return 0;
  let c = node.type === 'url' ? 1 : 0;
  if (node.children) node.children.forEach(ch => c += count(ch));
  return c;
}

function showFolders(node, depth) {
  if (!node) return;
  if (node.type === 'folder') {
    console.log('  '.repeat(depth) + node.name + ' (' + count(node) + ' urls)');
  }
  if (node.children) node.children.forEach(ch => showFolders(ch, depth + 1));
}

function collectUrls(node, folderPath) {
  let urls = [];
  if (!node) return urls;
  if (node.type === 'url') {
    urls.push({ name: node.name, url: node.url, folder: folderPath });
  }
  if (node.children) {
    const fp = folderPath ? folderPath + '/' + node.name : node.name;
    node.children.forEach(ch => urls.push(...collectUrls(ch, fp)));
  }
  return urls;
}

const roots = b.roots;
console.log('=== Bookmark Bar ===');
showFolders(roots.bookmark_bar, 0);
console.log('\n=== Other Bookmarks ===');
showFolders(roots.other, 0);

const allUrls = [
  ...collectUrls(roots.bookmark_bar, ''),
  ...collectUrls(roots.other, ''),
];
console.log('\nTotal bookmark URLs:', allUrls.length);

// Find duplicates
const urlMap = new Map();
allUrls.forEach(b => {
  const normalized = b.url.replace(/\/$/, '').split('?')[0].split('#')[0];
  if (!urlMap.has(normalized)) urlMap.set(normalized, []);
  urlMap.get(normalized).push(b);
});

const dupes = [...urlMap.entries()].filter(([, v]) => v.length > 1);
console.log('\nDuplicate URLs:', dupes.length);
dupes.slice(0, 20).forEach(([url, entries]) => {
  console.log('  ' + url);
  entries.forEach(e => console.log('    -> "' + e.name + '" in ' + e.folder));
});
if (dupes.length > 20) console.log('  ... and ' + (dupes.length - 20) + ' more');

// Domain breakdown
const domainCounts = new Map();
allUrls.forEach(b => {
  try {
    const domain = new URL(b.url).hostname.replace('www.', '');
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
  } catch {}
});
console.log('\nTop 30 domains:');
[...domainCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .forEach(([d, c]) => console.log('  ' + c + 'x ' + d));
