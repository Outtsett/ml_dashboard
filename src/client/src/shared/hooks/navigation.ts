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
 * Routes still registered in App.tsx but intentionally hidden from the sidebar
 * (kept in HIDDEN_NAV_META below so breadcrumbs still resolve):
 *   /curriculum    — moved into Settings → Help in a future phase
 *   /fourier       — stub; folds into ML Studio Features stage
 *   /training      — legacy standalone training surface
 *
 * pending: true (updated 2026-08-30, see audit findings this date) — these 4
 * sidebar entries have no mounted route in App.tsx and 404 today:
 *   /architecture — deleted in bf2be98 (74 files removed; the commit's own
 *                   message states this was a product decision to replace it
 *                   with the model catalog + ML Studio's live graph, not an
 *                   oversight — restoring it is a real "revive or drop the
 *                   nav entry" call for a human, not a mechanical fix)
 *   /registry, /experiments — no page component exists on disk for either
 *   /backtest     — see the "// Backtest Domain / Consolidated into ML
 *                   Studio" comment in App.tsx; BacktestPage.tsx exists on
 *                   disk but may be superseded, not simply forgotten
 * /paper is real, mounted, and NOT pending as of this date.
 *
 * Consolidated 2026-09-16: Risk is a tab of /portfolio and RL Console a tab of
 * /ml-studio, so neither has its own entry; /hpo and /operate were deleted.
 */

import {
  Activity,
  BarChart2,
  BookOpen,
  BookMarked,
  Microscope,
  NotebookPen,
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
  ScatterChart,
  Settings,
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
        icon: ScatterChart,
        label: "Regression",
        href: "/regression",
        description:
          "Price against every variable, one scatter each: fitted line, confidence and prediction bands, outliers",
      },
      {
        icon: Goal,
        label: "Portfolio",
        href: "/portfolio",
        description: "Positions, P&L, equity curve · Risk tab: VaR / ES / exposure",
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
        description:
          "Data → Features → Labels → Train pipeline · RL Console tab: PPO / DQN launcher",
      },
      {
        icon: Network,
        label: "Architecture",
        href: "/architecture",
        description: "Live network graphs + real tree structure",
        pending: true,
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
        icon: Microscope,
        label: "Model Lens",
        href: "/lens",
        description: "A model's out-of-sample record: predictions, trades, stability, attribution",
      },
      {
        icon: NotebookPen,
        label: "Notebooks",
        href: "/marimo",
        description: "Every marimo notebook on the machine, served in place",
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
        pending: true,
      },
      {
        icon: Workflow,
        label: "Backtest",
        href: "/backtest",
        description: "Walk-forward, Monte Carlo, benchmark",
        pending: true,
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
        pending: true,
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
