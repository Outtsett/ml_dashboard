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

export const CATEGORY_LABELS: Record<AlgoModelCategory, string> = {
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
