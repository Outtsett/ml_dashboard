/**
 * Model Import Types � Structures parsed from algo_model markdown specs.
 *
 * These types describe the shape of data extracted from the
 * \E:\source\documents\algo_models\ directory tree. Each .md file
 * follows a consistent template: Overview, Principles, Algorithm,
 * Training Methodology, Key Features, Applications, Implementation.
 *
 * The folder hierarchy encodes: TopCategory / Subcategory / ModelName.md
 */

// --- Top-level category (from folder names) ---------------------------------

export type AlgoModelCategory =
  | 'deep-learning'
  | 'generative'
  | 'hybrid-composite'
  | 'machine-learning'
  | 'neural-network'
  | 'optimization'
  | 'probabilistic-symbolic'
  | 'reinforcement-learning'
  | 'simulation-decision'
  | 'statistical'
  | 'self-supervised'
  | 'semi-supervised'
  | 'supervised'
  | 'unsupervised';

// --- Subcategory mapping (second-level folders) ------------------------------

export type AlgoModelSubcategory = string; // open-ended � derived from folder names        

// --- Hyperparameter extracted from markdown code blocks ----------------------

export interface ExtractedHyperparameter {
  name: string;
  type: 'number' | 'select' | 'boolean' | 'string';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: (string | number)[];
  description: string;
}

// --- Full parsed model spec --------------------------------------------------     

export interface ParsedModelSpec {
  /** Slugified ID: e.g. "xgboost", "convolutional-neural-network-cnn" */
  id: string;

  /** Display name: "XGBoost", "Convolutional Neural Network (CNN)" */
  name: string;

  /** Short name for badges: "XGBoost", "CNN" */
  shortName: string;

  /** Top-level folder category */
  category: AlgoModelCategory;

  /** Parent wrapper category (e.g. 'machine-learning' for models under Machine Learning/) */
  parentCategory?: AlgoModelCategory;

  /** Subfolder category: "boosting-methods", "convolutional-networks" */
  subcategory: string;

  /** Full relative path from algo_models root */
  relativePath: string;

  /** Overview section text */
  overview: string;

  /** Extracted principle bullets */
  principles: string[];

  /** Applications section bullets */
  applications: string[];

  /** Key Features section bullets */
  keyFeatures: string[];

  /** Variants listed in markdown */
  variants: string[];

  /** Hyperparameters extracted from Training Methodology section */
  hyperparameters: ExtractedHyperparameter[];

  /** Whether this spec has content (> 0 bytes) */
  hasContent: boolean;

  /** File size in bytes */
  fileSize: number;

  /** Full raw markdown text (for detail view) */
  rawMarkdown?: string;

  /**
   * Python module path of the canonical class for this spec, e.g. "sklearn.ensemble".
   * Populated by `extractClassImport()` (fenced-block scan) or by the curated
   * `CATALOG_CLASS_MAP` fallback.  Consumed by Jinja2 templates
   * (`sklearn.py.j2`, `tree.py.j2`, `gmm.py.j2`, `hmm.py.j2`) as
   * `catalog_spec.module_path`.
   */
  module_path?: string;

  /**
   * Class name within `module_path`, e.g. "RandomForestClassifier".
   * Consumed by templates as `catalog_spec.class_name`.
   */
  class_name?: string;

  /**
   * Provenance flag for the `(module_path, class_name)` pair:
   *   - 'fenced-block' — extracted from a ```python ``` block in the spec
   *   - 'class-map'    — looked up in `CATALOG_CLASS_MAP`
   *   - 'manual'       — set by hand (future "edit spec metadata" UI)
   *   - 'generated'    — produced by a Jinja2 template; no upstream class
   *                      lookup (e.g. RL templates import SB3 directly)
   */
  classOrigin?: 'fenced-block' | 'class-map' | 'manual' | 'generated';
}

// --- Scan result for the entire directory -----------------------------------

export interface ModelCatalog {
  /** Total .md files found */
  totalFiles: number;

  /** Files with actual content */
  filesWithContent: number;

  /** Files that are empty placeholders */
  emptyPlaceholders: number;

  /** All parsed models (content only or include placeholders) */
  models: ParsedModelSpec[];

  /** Category ? subcategory ? model count */
  taxonomy: Record<string, Record<string, number>>;

  /** Timestamp of last scan */
  scannedAt: number;
}

// --- Folder name ? category key mapping --------------------------------------

export const FOLDER_TO_CATEGORY: Record<string, AlgoModelCategory> = {
  'Deep Learning': 'deep-learning',
  'Generative Models': 'generative',
  'Hybrid & Composite Architectures': 'hybrid-composite',
  'Machine Learning': 'machine-learning',
  'Neural Network Architectures': 'neural-network',
  'Optimization-Based Models': 'optimization',
  'Probabilistic & Symbolic Models': 'probabilistic-symbolic',
  'Reinforcement Learning': 'reinforcement-learning',
  'Reinforcement Learning (RL)': 'reinforcement-learning',
  'Simulation & Decision Models': 'simulation-decision',
  'Statistical Models': 'statistical',
  'Self-Supervised Learning': 'self-supervised',
  'Semi-Supervised Learning': 'semi-supervised',
  'Supervised Learning': 'supervised',
  'Unsupervised Learning': 'unsupervised',
};

// --- Category ? parent-category rollup ---------------------------------------

/**
 * Which leaf categories aggregate under a wrapper category that has no folder
 * of its own.
 *
 * `Machine Learning/` declares its children by containment: the four learning
 * paradigms live inside that folder, so `parseModelSpec` reads the wrapper off
 * the path and every spec under it carries `parentCategory: 'machine-learning'`.
 * `deep-learning` was given the identical treatment in the parser, the
 * taxonomy rollup, the `category || parentCategory` list filter and the
 * sidebar's nesting rule -- but there is no `Deep Learning/` folder in the
 * corpus and there never has been, so nothing ever set that parent. The whole
 * path was live and unreachable: the sidebar advertised a Deep Learning
 * category that matched zero specs and rendered "No models match your filters".
 *
 * The deep families sit at the top level instead (`Neural Network
 * Architectures/`, `Generative Models/`, `Hybrid & Composite Architectures/`),
 * and moving them under a new wrapper folder would rewrite every spec id --
 * ids are slugified from the relative path, and the mechanism registry, the
 * curated class map and the composite catalog extras all key on them. So the
 * membership is declared here instead of by directory layout. Same result,
 * no id churn.
 */
export const CATEGORY_TO_PARENT: Partial<Record<AlgoModelCategory, AlgoModelCategory>> = {
  'neural-network': 'deep-learning',
  'generative': 'deep-learning',
  'hybrid-composite': 'deep-learning',
};

export const CATEGORY_LABELS: Record<AlgoModelCategory, string> = {
  'deep-learning': 'Deep Learning',
  'generative': 'Generative Models',
  'hybrid-composite': 'Hybrid & Composite',
  'machine-learning': 'Machine Learning',
  'neural-network': 'Neural Networks',
  'optimization': 'Optimization',
  'probabilistic-symbolic': 'Probabilistic & Symbolic',
  'reinforcement-learning': 'Reinforcement Learning',
  'simulation-decision': 'Simulation & Decision',
  'statistical': 'Statistical Models',
  'self-supervised': 'Self-Supervised',
  'semi-supervised': 'Semi-Supervised',
  'supervised': 'Supervised Learning',
  'unsupervised': 'Unsupervised Learning',
};
