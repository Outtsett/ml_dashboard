import fs from 'fs';
import path from 'path';

/**
 * The accessibility ratchet.
 *
 * A gate that is red on every route from the day it lands teaches everyone to
 * ignore it, and an accessibility check nobody reads is worse than none —
 * it looks like coverage. The first scan of this app found 81 violating nodes
 * across the sidebar routes, which is a real backlog, not a bug to fix in the
 * same change that adds the scanner.
 *
 * So this works the way `scripts/lint-budget.mjs` already works for ESLint in
 * this repo: a committed baseline of what is known-bad, a gate that fails on
 * anything ABOVE it, and a number that may only ever go down. New violations
 * fail immediately. Fixed violations are reported so the baseline gets tightened
 * rather than silently banking headroom for the next regression.
 *
 *   npm run test:e2e:a11y                     # gate against the baseline
 *   A11Y_UPDATE_BASELINE=1 npm run test:e2e:a11y   # re-record after fixing some
 */

const BASELINE_PATH = path.resolve(import.meta.dirname, '../a11y-baseline.json');

/** `{ "/route": { "rule-id": nodeCount } }` */
export type A11yBaseline = Record<string, Record<string, number>>;

export interface A11yBaselineFile {
  /** Why this file exists, carried in the artifact so it is read at the diff. */
  readme: string[];
  /** ISO date the counts were last recorded. */
  recordedAt: string;
  /** The rules the gate evaluates. Adding one here widens the gate. */
  rules: string[];
  counts: A11yBaseline;
}

export function loadBaseline(): A11yBaselineFile {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { readme: [], recordedAt: 'never', rules: [], counts: {} };
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as A11yBaselineFile;
}

export function writeBaseline(file: A11yBaselineFile): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
}

export interface RouteComparison {
  /** Rules firing on this route that the baseline does not know about. */
  regressions: Array<{ rule: string; actual: number; detail: string }>;
  /** Rules in the baseline that no longer fire at all — lock the win in. */
  improvements: Array<{ rule: string; baseline: number }>;
  /** Node-count movement on known rules. Reported, never gated. See below. */
  drift: Array<{ rule: string; baseline: number; actual: number }>;
}

/**
 * Compare one route's scan against its baseline.
 *
 * The gate is on the SET OF RULES, not on node counts.
 *
 * Counting nodes was the obvious design and it does not survive contact with
 * this app. Pages here render from live data, so the number of violating nodes
 * moves with the number of rows: `/watchlist` reported 1 contrast node when its
 * table was empty and 2 once a row with a `.bg-primary/20` badge arrived, and
 * `/glossary` varies with how many terms have rendered. A gate that fails on
 * that is a gate that fails at random, and a randomly-failing gate gets ignored
 * within a week — which is strictly worse than not having one.
 *
 * A rule id is stable. "This route has a colour-contrast problem" is either true
 * or it is not, and it does not depend on how many rows loaded. So a NEW rule
 * firing on a route is a regression and fails; a rule disappearing is a win and
 * is reported so the baseline can be tightened; and node counts are carried
 * along as information, because "contrast went 1 → 40" is worth seeing even
 * though it must not gate.
 */
export function compareToBaseline(
  routeBaseline: Record<string, number> | undefined,
  actual: Array<{ rule: string; nodes: number; detail: string }>,
): RouteComparison {
  const base = routeBaseline ?? {};
  const regressions: RouteComparison['regressions'] = [];
  const improvements: RouteComparison['improvements'] = [];
  const drift: RouteComparison['drift'] = [];

  for (const { rule, nodes, detail } of actual) {
    if (!(rule in base)) {
      regressions.push({ rule, actual: nodes, detail });
    } else if (base[rule] !== nodes) {
      drift.push({ rule, baseline: base[rule]!, actual: nodes });
    }
  }

  for (const [rule, allowed] of Object.entries(base)) {
    if (!actual.some((a) => a.rule === rule)) {
      improvements.push({ rule, baseline: allowed });
    }
  }

  return { regressions, improvements, drift };
}

export { BASELINE_PATH };
