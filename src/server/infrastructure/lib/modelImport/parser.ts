/**
 * Model Spec Parser — Reads markdown files from the algo_models directory
 * and extracts structured model definitions.
 *
 * Think of it as: a librarian who reads every model textbook in the shelf,
 * pulls out the key facts (name, what it does, settings knobs), and
 * creates an index card for each one.
 *
 * Each .md file follows a template:
 *   # Model Name
 *   ## Overview  (or ## Definition)
 *   ## Principles
 *   ## Algorithm (optional: ### Variants)
 *   ## Training Methodology (contains hyperparameters)
 *   ## Key Features
 *   ## Applications
 *   ## Implementation Details (code examples)
 */

import fs from 'fs';
import path from 'path';
import type {
  ParsedModelSpec,
  ModelCatalog,
  ExtractedHyperparameter,
  AlgoModelCategory,
} from './types';
import { FOLDER_TO_CATEGORY } from './types';
import { lookupCatalogClass } from './classMap';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a display name to a slug ID: "XGBoost" → "xgboost", "CNN (Conv)" → "cnn-conv" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract a short name from e.g. "Convolutional Neural Network (CNN)" → "CNN" */
function extractShortName(name: string): string {
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inner = parenMatch[1]!;
    // If the parenthesized text is an acronym (all caps, ≤8 chars), use it
    if (inner.length <= 8 && /^[A-Z0-9-]+$/.test(inner.replace(/\s/g, ''))) {
      return inner;
    }
  }
  // Otherwise abbreviate: take first letters of multi-word, or first 10 chars
  const words = name.split(/\s+/);
  if (words.length >= 3) {
    return words.map(w => w[0]?.toUpperCase()).join('').slice(0, 6);
  }
  return name.slice(0, 12);
}

/** Slugify a folder name: "Boosting Methods" → "boosting-methods" */
function slugifyFolder(name: string): string {
  return name
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Section extraction ──────────────────────────────────────────────────────

interface MarkdownSections {
  title: string;
  overview: string;
  principles: string[];
  algorithm: string;
  variants: string[];
  trainingMethodology: string;
  keyFeatures: string[];
  applications: string[];
  implementation: string;
}

/** Split markdown into named sections by ## headers */
function parseSections(markdown: string): MarkdownSections {
  const sections: Record<string, string> = {};
  let currentSection = '_preamble';
  const lines = markdown.split('\n');
  let title = '';

  for (const line of lines) {
    // Top-level title
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match && !title) {
      title = h1Match[1]!.trim();
      continue;
    }

    // Section header
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      currentSection = h2Match[1]!.trim().toLowerCase();
      sections[currentSection] = '';
      continue;
    }

    if (sections[currentSection] !== undefined) {
      sections[currentSection] += line + '\n';
    }
  }

  return {
    title,
    overview: sections['overview']?.trim() || (sections['definition']?.trim() ?? ''),
    principles: extractBullets(sections['principles'] ?? ''),
    algorithm: sections['algorithm']?.trim() ?? '',
    variants: extractVariants(sections['algorithm'] ?? ''),
    trainingMethodology: sections['training methodology']?.trim() ?? '',
    keyFeatures: extractBullets(sections['key features'] ?? ''),
    applications: extractBullets(sections['applications'] ?? ''),
    implementation: sections['implementation details']?.trim() ?? '',
  };
}

/** Extract bullet points from a section */
function extractBullets(text: string): string[] {
  const bullets: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^[-*]\s+\*\*(.+?)\*\*[:\s]*(.+)/);
    if (match) {
      bullets.push(`${match[1]!}: ${match[2]!.trim()}`);
      continue;
    }
    const simpleBullet = line.match(/^[-*]\s+(.+)/);
    if (simpleBullet) {
      bullets.push(simpleBullet[1]!.trim());
    }
  }
  return bullets;
}

/** Extract variant names from ### Variants subsection */
function extractVariants(algorithmText: string): string[] {
  const variants: string[] = [];
  let inVariants = false;

  for (const line of algorithmText.split('\n')) {
    if (line.match(/^###\s+[Vv]ariants/)) {
      inVariants = true;
      continue;
    }
    if (line.match(/^###?\s+/) && inVariants) {
      break; // next section
    }
    if (inVariants) {
      const match = line.match(/^[-*]\s+\*\*(.+?)\*\*/);
      if (match) {
        variants.push(match[1]!.trim());
      }
    }
  }
  return variants;
}

// ─── Hyperparameter extraction ──────────────────────────────────────────────

/** Extract hyperparameters from the Training Methodology section */
function extractHyperparameters(trainingText: string): ExtractedHyperparameter[] {
  const params: ExtractedHyperparameter[] = [];
  const lines = trainingText.split('\n');

  for (const line of lines) {
    // Pattern: "- Name ($symbol$): range" or "- Name: range"
    const paramMatch = line.match(
      /[-*]\s+(?:\*\*)?(.+?)(?:\*\*)?[\s]*(?:\(.*?\))?[\s]*[:\s]+([\d.]+(?:\s*-\s*[\d.]+)?)/
    );
    if (paramMatch) {
      const name = paramMatch[1]!.replace(/\*\*/g, '').trim();
      const rangeStr = paramMatch[2]!.trim();

      // Skip non-parameter lines
      if (name.length > 50 || name.includes('compute') || name.includes('data')) continue;

      const rangeParts = rangeStr.split('-').map(s => parseFloat(s.trim()));
      if (rangeParts.some(isNaN)) continue;

      const paramName = slugify(name).replace(/-/g, '_');
      if (!paramName || paramName.length < 2) continue;

      // Determine type from range
      const min = rangeParts[0]!;
      const max = rangeParts.length > 1 ? rangeParts[1]! : min * 10;
      const defaultVal = rangeParts.length > 1
        ? Math.round((min + max) / 2 * 100) / 100
        : min;

      // Determine step from value scale
      const step = min < 1 ? 0.01 : min < 10 ? 0.1 : 1;

      params.push({
        name: paramName,
        type: 'number',
        default: defaultVal,
        min,
        max,
        step,
        description: name,
      });
    }

    // Pattern: select-style "- Name: option1, option2, option3"
    const selectMatch = line.match(
      /[-*]\s+(?:\*\*)?(.+?)(?:\*\*)?[:\s]+(?:['"]?)([\w-]+(?:,\s*[\w-]+)+)/
    );
    if (selectMatch && !paramMatch) {
      const name = selectMatch[1]!.replace(/\*\*/g, '').trim();
      const options = selectMatch[2]!.split(',').map(s => s.trim()).filter(Boolean);
      if (options.length >= 2 && options.length <= 10 && name.length <= 40) {
        params.push({
          name: slugify(name).replace(/-/g, '_'),
          type: 'select',
          default: options[0]!,
          options,
          description: name,
        });
      }
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return params.filter(p => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

// ─── Class import extraction (for ParsedModelSpec.module_path/class_name) ───

/**
 * Tokenize a spec name into normalized lowercase tokens used for matching
 * against imported symbols.  Strips parentheses, splits on non-alphanumerics,
 * drops 1-char tokens.  Examples:
 *   "Random Forest"                 -> ["random", "forest"]
 *   "K-Nearest Neighbors (k-NN)"    -> ["k", "nearest", "neighbors", "knn"]
 *   "XGBoost"                       -> ["xgboost"]
 *   "Gaussian Mixture Model (GMM)"  -> ["gaussian", "mixture", "model", "gmm"]
 */
function tokenizeSpecName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Score how strongly an imported symbol matches the spec name tokens.
 * Higher = better.  Hard requirement: at least one shared token (case-
 * insensitive substring); bonus for additional matches.  Long tokens (4+ chars)
 * count double to penalise generic 2-3 char overlaps.
 */
function scoreSymbolMatch(symbol: string, specTokens: string[]): number {
  const lowSym = symbol.toLowerCase();
  let score = 0;
  for (const tok of specTokens) {
    if (lowSym.includes(tok)) score += tok.length >= 4 ? 2 : 1;
  }
  return score;
}

// Use module-scoped regexes (per-call `lastIndex` reset is required because
// the /g flag makes RegExp.prototype.exec stateful).
type RegMatch = ReturnType<RegExp['exec']>;

/**
 * Scan the spec's markdown for fenced ``` python ``` (or just ``` ```) code
 * blocks and harvest the first `from X import Y` (or `from X import Y as Z`)
 * statement whose imported symbol case-insensitively matches a token in the
 * spec name.
 *
 * Returns `null` when no usable import is found.  Callers should fall back to
 * `lookupCatalogClass(spec.id)` from `classMap.ts`.
 *
 * The regex is intentionally conservative -- multi-import (`from X import A, B`)
 * is split and each symbol scored independently; aliased imports
 * (`from X import Y as Z`) score against the original `Y`.
 */
export function extractClassImport(
  rawMarkdown: string,
  specName: string,
): { module_path: string; class_name: string } | null {
  if (!rawMarkdown) return null;

  // Pull out fenced code blocks. Match ```python ... ``` and bare ``` ... ```
  // (some specs omit the language tag on the inference snippet).
  const blocks: string[] = [];
  const fenceRe = /```(?:python|py)?\n([\s\S]*?)```/gi;
  let fenceMatch: RegMatch;
  while ((fenceMatch = fenceRe.exec(rawMarkdown)) !== null) {
    blocks.push(fenceMatch[1] ?? '');
  }
  if (blocks.length === 0) return null;

  const specTokens = tokenizeSpecName(specName);
  if (specTokens.length === 0) return null;

  // Match `from <module> import <symbols>`. Multi-symbol + aliased forms
  // handled in the loop body.
  const importRe = /^\s*from\s+([\w.]+)\s+import\s+(.+?)\s*$/gm;

  let best: { module_path: string; class_name: string; score: number } | null = null;

  for (const block of blocks) {
    importRe.lastIndex = 0;
    let importMatch: RegMatch;
    while ((importMatch = importRe.exec(block)) !== null) {
      const modulePath = importMatch[1]!;
      const symbolsRaw = importMatch[2]!;
      const symbolsClean = symbolsRaw.split('#')[0]!.trim();
      const symbols = symbolsClean
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/i)[0]!.trim())
        .filter((s) => /^[A-Z][\w]*$/.test(s)); // PascalCase classes only

      for (const symbol of symbols) {
        const score = scoreSymbolMatch(symbol, specTokens);
        if (score > 0 && (!best || score > best.score)) {
          best = { module_path: modulePath, class_name: symbol, score };
        }
      }
    }
  }

  if (!best) return null;
  return { module_path: best.module_path, class_name: best.class_name };
}

// ─── Single file parser ─────────────────────────────────────────────────────

/** Parse a single model spec markdown file into a structured object */
export function parseModelSpec(
  filePath: string,
  algoModelsRoot: string,
  includeRaw: boolean = false,
): ParsedModelSpec | null {
  const stat = fs.statSync(filePath);
  const relativePath = path.relative(algoModelsRoot, filePath).replace(/\\/g, '/');
  let parts = relativePath.split('/');

  // The top-level folders are wrappers: 'Deep Learning' and 'Machine Learning'.
  // Strip them to get the actual category folder, but record the parent
  // so models can also be aggregated under the wrapper.
  let parentCategory: AlgoModelCategory | undefined;
  if (parts[0] === 'Deep Learning' || parts[0] === 'Machine Learning') {
    parentCategory = FOLDER_TO_CATEGORY[parts[0]!];
    parts = parts.slice(1);
  }

  // Need at least: Category/Name.md or Category/Subcategory/Name.md
  if (parts.length < 2) {
    // File is directly inside a wrapper with no subfolder — use wrapper as category
    if (parentCategory && parts.length === 1) {
      const fileName = path.basename(filePath, '.md');
      const hasContent = stat.size > 0;
      if (!hasContent && !includeRaw) {
        return {
          id: slugify(fileName), name: fileName, shortName: extractShortName(fileName),
          category: parentCategory, subcategory: 'general', parentCategory,
          relativePath, overview: '', principles: [], applications: [],
          keyFeatures: [], variants: [], hyperparameters: [],
          hasContent: false, fileSize: 0,
        };
      }
    }
    if (!parentCategory) return null;
  }

  const topFolder = parts[0]!;
  const category = FOLDER_TO_CATEGORY[topFolder];
  if (!category) return null;

  // Subcategory: second folder, or 'general' if file is directly in category
  const subcategory = parts.length >= 3
    ? slugifyFolder(parts[parts.length - 2]!)
    : 'general';

  const fileName = path.basename(filePath, '.md');
  const hasContent = stat.size > 0;

  if (!hasContent) {
    return {
      id: slugify(fileName),
      name: fileName,
      shortName: extractShortName(fileName),
      category,
      ...(parentCategory ? { parentCategory } : {}),
      subcategory,
      relativePath,
      overview: '',
      principles: [],
      applications: [],
      keyFeatures: [],
      variants: [],
      hyperparameters: [],
      hasContent: false,
      fileSize: 0,
    };
  }

  const markdown = fs.readFileSync(filePath, 'utf-8');
  const sections = parseSections(markdown);

  const name = sections.title || fileName;
  const hyperparameters = extractHyperparameters(sections.trainingMethodology);
  const id = slugify(fileName);

  // Resolve canonical Python class for this spec.
  // Order: (1) fenced ``` python ``` import scan, (2) curated CATALOG_CLASS_MAP.
  // The result powers Jinja2 template rendering downstream.
  let classInfo: { module_path: string; class_name: string; classOrigin: ParsedModelSpec['classOrigin'] } | null = null;
  const fenced = extractClassImport(markdown, name);
  if (fenced) {
    classInfo = { ...fenced, classOrigin: 'fenced-block' };
  } else {
    const curated = lookupCatalogClass(id);
    if (curated) classInfo = { ...curated, classOrigin: 'class-map' };
  }

  return {
    id,
    name,
    shortName: extractShortName(name),
    category,
    ...(parentCategory ? { parentCategory } : {}),
    subcategory,
    relativePath,
    overview: sections.overview.slice(0, 1000), // cap for API response
    principles: sections.principles.slice(0, 10),
    applications: sections.applications.slice(0, 10),
    keyFeatures: sections.keyFeatures.slice(0, 10),
    variants: sections.variants,
    hyperparameters,
    hasContent: true,
    fileSize: stat.size,
    ...(includeRaw ? { rawMarkdown: markdown } : {}),
    ...(classInfo ? {
      module_path: classInfo.module_path,
      class_name: classInfo.class_name,
      classOrigin: classInfo.classOrigin,
    } : {}),
  };
}

// ─── Directory scanner ──────────────────────────────────────────────────────

/** Recursively find all .md files in a directory */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip .vs and other hidden/system folders
      if (entry.name.startsWith('.')) continue;
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Scan the entire algo_models directory and return a complete catalog */
export function scanModelCatalog(
  algoModelsRoot: string,
  options: { includeEmpty?: boolean; includeRaw?: boolean } = {},
): ModelCatalog {
  const { includeEmpty = false, includeRaw = false } = options;
  const files = findMarkdownFiles(algoModelsRoot);

  const models: ParsedModelSpec[] = [];
  let filesWithContent = 0;
  let emptyPlaceholders = 0;

  for (const file of files) {
    const spec = parseModelSpec(file, algoModelsRoot, includeRaw);
    if (!spec) continue;

    if (spec.hasContent) {
      filesWithContent++;
      models.push(spec);
    } else {
      emptyPlaceholders++;
      if (includeEmpty) {
        models.push(spec);
      }
    }
  }

  // Build taxonomy tree — also count models under parent categories
  const taxonomy: Record<string, Record<string, number>> = {};
  for (const m of models) {
    if (!taxonomy[m.category]) taxonomy[m.category] = {};
    taxonomy[m.category]![m.subcategory] = (taxonomy[m.category]![m.subcategory] ?? 0) + 1;

    // Roll up into parent category (e.g. machine-learning, deep-learning)
    if (m.parentCategory && m.parentCategory !== m.category) {
      if (!taxonomy[m.parentCategory]) taxonomy[m.parentCategory] = {};
      const subKey = m.category; // use the child category as subcategory name under the parent
      taxonomy[m.parentCategory]![subKey] = (taxonomy[m.parentCategory]![subKey] ?? 0) + 1;
    }
  }

  return {
    totalFiles: files.length,
    filesWithContent,
    emptyPlaceholders,
    models,
    taxonomy,
    scannedAt: Date.now(),
  };
}

