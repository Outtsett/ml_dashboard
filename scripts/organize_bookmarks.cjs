const fs = require('fs');

const BOOKMARKS_PATH = 'C:/Users/tyler/AppData/Local/Google/Chrome/User Data/Default/Bookmarks';
const BACKUP_PATH = BOOKMARKS_PATH + '.backup_' + new Date().toISOString().replace(/[:.]/g, '-');

// ── Category rules: checked in order, first match wins ──
const CATEGORIES = [
  {
    name: 'AI & Machine Learning',
    match: (bm) => /claude\.ai|aistudio\.google|openrouter\.ai|tensorflow\.org|neptune\.ai|notebooklm\.google|spinningup\.openai|stackoverflow\.ai|vertex-ai|vertexai/i.test(bm.url)
      || /\bai\b|machine.?learn|ml\b|vertex|gemini|model|neural|deep.?learn/i.test(bm.name)
  },
  {
    name: 'Finance & Market Data',
    match: (bm) => /bloomberg|finnhub|benzinga|alphavantage|alpha.?vantage|ibkr|interactive.?broker/i.test(bm.url)
      || /stock|trading|market|finance|financial/i.test(bm.name)
  },
  {
    name: 'Google Services',
    match: (bm) => /adsense\.google|admob\.google|ads\.google|myadcenter|play.*console|developer\.android|drive\.google|antigravity\.google/i.test(bm.url)
  },
  {
    name: 'Google Cloud & Firebase',
    match: (bm) => /console\.cloud\.google|firebase\.google|studio\.firebase/i.test(bm.url)
  },
  {
    name: 'Microsoft',
    match: (bm) => /microsoft|m365\.cloud|copilot\.microsoft|office\.com/i.test(bm.url)
  },
  {
    name: 'E-Commerce & Storefronts',
    match: (bm) => /shopify|etsy|gumroad/i.test(bm.url)
  },
  {
    name: 'Creative Tools',
    match: (bm) => /freepik|midjourney|figma|ludo\.ai|webflow/i.test(bm.url)
  },
  {
    name: 'Databases & Infrastructure',
    match: (bm) => /clickhouse|turbopuffer|rapids\.ai|duckdb|timescale|postgres/i.test(bm.url)
  },
  {
    name: 'Development Tools',
    match: (bm) => /github\.com|code\.visualstudio|replit\.com|vercel\.com|anaconda\.com|conda\.io|jupyterlab|developer\.nvidia|pyscript|electron\/|pub\.dev|flame-engine|docs\.rapids/i.test(bm.url)
      || /nvidia|cuda|nsight|jupyter|conda|anaconda/i.test(bm.name)
  },
  {
    name: 'Social & Personal',
    match: (bm) => /linkedin\.com|xfinity\.com|connect\./i.test(bm.url)
  },
];

// ── Helpers ──
function flattenUrls(node) {
  let urls = [];
  if (!node) return urls;
  if (node.type === 'url') {
    urls.push({ ...node });
    delete urls[urls.length - 1].children;
  }
  if (node.children) {
    node.children.forEach(ch => urls.push(...flattenUrls(ch)));
  }
  return urls;
}

function dedup(bookmarks) {
  const seen = new Map();
  const kept = [];
  const removed = [];
  for (const bm of bookmarks) {
    const normalized = bm.url.replace(/\/$/, '').split('?')[0].split('#')[0];
    if (seen.has(normalized)) {
      removed.push(bm);
    } else {
      seen.set(normalized, bm);
      kept.push(bm);
    }
  }
  return { kept, removed };
}

function categorize(bookmarks) {
  const folders = {};
  CATEGORIES.forEach(c => folders[c.name] = []);
  folders['Other'] = [];

  for (const bm of bookmarks) {
    let placed = false;
    for (const cat of CATEGORIES) {
      if (cat.match(bm)) {
        folders[cat.name].push(bm);
        placed = true;
        break;
      }
    }
    if (!placed) folders['Other'].push(bm);
  }
  return folders;
}

function sortAlpha(bookmarks) {
  return bookmarks.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

let nextId = 1000; // Start high to avoid collisions

function makeFolder(name, children) {
  return {
    children,
    date_added: String(Date.now() * 10000 + 116444736000000000), // approx Chrome epoch
    date_last_used: '0',
    date_modified: String(Date.now() * 10000 + 116444736000000000),
    guid: crypto.randomUUID(),
    id: String(nextId++),
    name,
    type: 'folder'
  };
}

function cleanBookmark(bm) {
  // Preserve original Chrome fields, strip any extras we added
  const clean = {
    date_added: bm.date_added,
    date_last_used: bm.date_last_used || '0',
    guid: bm.guid,
    id: bm.id,
    name: bm.name.trim(),
    type: 'url',
    url: bm.url,
  };
  if (bm.meta_info) clean.meta_info = bm.meta_info;
  return clean;
}

// ── Main ──
console.log('Reading bookmarks from:', BOOKMARKS_PATH);
const data = JSON.parse(fs.readFileSync(BOOKMARKS_PATH, 'utf8'));

// Collect all URLs from bookmark_bar and other
const allUrls = [
  ...flattenUrls(data.roots.bookmark_bar),
  ...flattenUrls(data.roots.other),
];
console.log('Total bookmarks found:', allUrls.length);

// Deduplicate
const { kept, removed } = dedup(allUrls);
console.log('Duplicates removed:', removed.length);
removed.forEach(r => console.log('  - "' + r.name + '" => ' + r.url));

// Categorize
const categorized = categorize(kept);

// Sort each category alphabetically
for (const [cat, bms] of Object.entries(categorized)) {
  categorized[cat] = sortAlpha(bms);
}

// Build new bookmark_bar structure
const newChildren = [];

// Create folders for non-empty categories (in defined order)
const categoryOrder = [...CATEGORIES.map(c => c.name), 'Other'];
for (const catName of categoryOrder) {
  const bms = categorized[catName];
  if (bms && bms.length > 0) {
    const folder = makeFolder(catName, bms.map(cleanBookmark));
    newChildren.push(folder);
    console.log(`\n${catName} (${bms.length}):`);
    bms.forEach(b => console.log('  ' + b.name));
  }
}

// Update the data
data.roots.bookmark_bar.children = newChildren;
// Clear checksum so Chrome recalculates
delete data.checksum;

// Backup original
console.log('\nBacking up original to:', BACKUP_PATH);
fs.copyFileSync(BOOKMARKS_PATH, BACKUP_PATH);

// Write organized bookmarks
console.log('Writing organized bookmarks...');
fs.writeFileSync(BOOKMARKS_PATH, JSON.stringify(data, null, 3), 'utf8');

console.log('\nDone! Restart Chrome to see the changes.');
console.log('If anything looks wrong, restore from:', BACKUP_PATH);
