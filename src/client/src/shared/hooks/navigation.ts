/**
 * Sidebar navigation — organized by the quant research lifecycle, not by
 * feature buckets.
 *
 *   LIVE      — what's happening RIGHT NOW (market, risk, positions, watch)
 *   RESEARCH  — alpha discovery (data, features, labels, training)
 *   VALIDATE  — does it work? (experiments, HPO, backtest)
 *   OPERATE   — deploy and monitor (registry, paper trade, news)
 *   SYSTEM    — infra (terminals, hardware, settings)
 *
 * Routes still registered in App.tsx but intentionally hidden from the sidebar:
 *   /curriculum    — moved into Settings → Help in a future phase
 *   /fourier       — stub; folds into ML Studio Features stage
 *
 * /architecture graduated from stub to a real sidebar item (Research group,
 * 2026-07-15): live network graphs derived from hyperparameters + real tree
 * structure from trained artifacts under data/models.
 *
 * Pages NEW in this redesign (rendered once Phases 2-4 ship): /risk,
 * /experiments, /hpo, /registry, /paper. Until they exist as page modules,
 * adding the nav entry would render NotFound — so they're commented in below
 * to be uncommented as each phase lands.
 */

import {
  Activity,
  AlertTriangle,
  BarChart2,
  BookOpen,
  BookMarked,
  BrainCircuit,
  Cpu,
  Database,
  FlaskConical,
  GitBranch,
  GitMerge,
  Goal,
  List,
  Network,
  Newspaper,
  Radio,
  Settings,
  Sliders,
  TerminalSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Optional one-line description used inside collapsed-sidebar tooltips and
   *  the command palette. */
  description?: string;
  /** True for pages that aren't yet implemented — sidebar shows them muted
   *  with a "soon" affordance instead of routing. */
  pending?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAVIGATION_CONFIG: NavGroup[] = [
  {
    title: "Live",
    items: [
      {
        icon: BarChart2,
        label: "Market",
        href: "/",
        description: "Chart with model signals + replay",
      },
      {
        icon: AlertTriangle,
        label: "Risk",
        href: "/risk",
        description: "VaR / ES / exposure / drawdown / correlation",
      },
      {
        icon: Goal,
        label: "Positions",
        href: "/portfolio",
        description: "Open positions, P&L, equity curve",
      },
      {
        icon: List,
        label: "Watchlist",
        href: "/watchlist",
        description: "Symbols + tape",
      },
    ],
  },
  {
    title: "Research",
    items: [
      {
        icon: BrainCircuit,
        label: "ML Studio",
        href: "/ml-studio",
        description: "Data → Features → Labels → Train pipeline",
      },
      {
        icon: Network,
        label: "Architecture",
        href: "/architecture",
        description: "Live network graphs + real tree structure",
      },
      {
        icon: BookOpen,
        label: "Catalog",
        href: "/model-catalog",
        description: "300+ model spec library",
      },
      {
        icon: Database,
        label: "Data",
        href: "/databases",
        description: "Data pipeline + freshness",
      },
      {
        icon: BookMarked,
        label: "Glossary",
        href: "/glossary",
        description: "Term + symbol bank for every metric on screen",
      },
    ],
  },
  {
    title: "Validate",
    items: [
      {
        icon: FlaskConical,
        label: "Experiments",
        href: "/experiments",
        description: "Ledger of every training run",
      },
      {
        icon: Sliders,
        label: "HPO",
        href: "/hpo",
        description: "Optuna sessions + trial drill-down",
      },
      {
        icon: Workflow,
        label: "Backtest",
        href: "/backtest",
        description: "Walk-forward, Monte Carlo, benchmark",
      },
    ],
  },
  {
    title: "Operate",
    items: [
      {
        icon: GitMerge,
        label: "Registry",
        href: "/registry",
        description: "Promoted models + lineage",
      },
      {
        icon: Radio,
        label: "Paper",
        href: "/paper",
        description: "Paper trade + drift monitor",
      },
      {
        icon: Newspaper,
        label: "News",
        href: "/news",
        description: "Symbol news feed",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        icon: TerminalSquare,
        label: "Terminals",
        href: "/terminals",
        description: "Interactive shell sessions",
      },
      {
        icon: Cpu,
        label: "Hardware",
        href: "/hardware",
        description: "GPU / CPU / RAM telemetry",
      },
      {
        icon: Settings,
        label: "Settings",
        href: "/settings",
      },
    ],
  },
];

/** Items kept in ROUTE_META so breadcrumbs / current-page meta still resolve
 *  for routes that are intentionally hidden from the sidebar. */
const HIDDEN_NAV_META: NavItem[] = [
  {
    icon: BookOpen,
    label: "Curriculum",
    href: "/curriculum",
    description: "ML learning materials",
  },
  {
    icon: Activity,
    label: "Transform",
    href: "/fourier",
    description: "Fourier / wavelet analysis tools",
  },
  {
    icon: GitBranch,
    label: "Training",
    href: "/training",
    description: "Standalone training surface (legacy)",
  },
];

export const getRouteMeta = () => {
  const meta: Record<string, NavItem> = {};
  NAVIGATION_CONFIG.forEach((group) => {
    group.items.forEach((item) => {
      meta[item.href] = item;
    });
  });
  HIDDEN_NAV_META.forEach((item) => {
    meta[item.href] = item;
  });
  return meta;
};

export const ROUTE_META = getRouteMeta();

/** Flat list of every primary-nav item — used by CommandPalette so users can
 *  jump to any page (including pending ones) by name. */
export const ALL_NAV_ITEMS: NavItem[] = NAVIGATION_CONFIG.flatMap(
  (g) => g.items,
);
