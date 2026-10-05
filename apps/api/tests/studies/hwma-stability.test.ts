/**
 * The HWMA stability study (apps/api/studies/handlers/hwma-stability.ts and
 * packages/shared/src/studies/hwma-stability.ts).
 *
 * Reference numbers are numpy's: radii from the landed grid (measured by
 * scripts/hwma_stability.py with np.linalg.eigvals), and the recursion's
 * results on a deterministic synthetic series from the notebook's own
 * `hwma_path`, run outside the repo. The guarded path is also held equal to the
 * chart's `calcHWMA`, so the study and the indicator share one definition.
 */

import { describe, expect, it } from "vitest";
import { calcHWMA } from "@/market/lib/calculators/overlay/averages";
import handler, { EMPTY_BODY, GRID_SQL, PRICES_SQL, RUN_INFORMATION_SQL } from "../../studies/handlers/hwma-stability";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  columnHistogram, columnSummary, countsByAcceleration, eigenvalues, emittedLevel, gridRowAt, hwmaRun,
  onGrid, radiusContour, spectralRadius, stateMatrix, type HwmaGridRow,
} from "@shared/studies/hwma-stability";

/** [na, nb, nc, spectral radius] from the landed grid, every 229th row. */
const LANDED_RADII: Array<[number, number, number, number]> = [
  [0.05, 0.05, 0.05, 0.9990503055490652], [0.05, 0.65, 0.1, 1.004420839056816], [0.1, 0.3, 0.15, 1.0037936916532226],
  [0.1, 0.9, 0.2, 0.9934512483581245], [0.15, 0.55, 0.25, 0.996466539240979], [0.2, 0.2, 0.3, 1.0019172187208685],
  [0.2, 0.8, 0.35, 0.9752214562341366], [0.25, 0.45, 0.4, 0.9874208829065744], [0.3, 0.1, 0.45, 0.9990863217305271],
  [0.3, 0.7, 0.5, 0.9571891003059875], [0.35, 0.35, 0.55, 0.9792103778193836], [0.35, 0.95, 0.6, 0.9089825210109783],
  [0.4, 0.6, 0.65, 0.9405380355402002], [0.45, 0.25, 0.7, 0.974103556698447], [0.45, 0.85, 0.75, 0.8815525683685772],
  [0.5, 0.5, 0.8, 0.926586926534899], [0.55, 0.15, 0.85, 0.9756484626573316], [0.55, 0.75, 0.9, 0.8563885466512776],
  [0.6, 0.4, 0.95, 0.917480343714124], [0.65, 0.1, 0.05, 0.9470841324146726], [0.65, 0.7, 0.1, 0.8955019223888341],
  [0.7, 0.35, 0.15, 0.7634485280140468], [0.7, 0.95, 0.2, 0.800317680437698], [0.75, 0.6, 0.25, 0.6796001590718792],
  [0.8, 0.25, 0.3, 0.871422821762714], [0.8, 0.85, 0.35, 0.634008247152959], [0.85, 0.5, 0.4, 0.7103029231644118],
  [0.9, 0.15, 0.45, 0.9254950764280363], [0.9, 0.75, 0.5, 0.49056780421829527], [0.95, 0.4, 0.55, 0.779612373211685],
];

/** 2,000 deterministic closes, the same series the reference values were computed on. */
function syntheticCloses(count = 2000): number[] {
  return Array.from({ length: count }, (_, i) => 25000 + 10 * Math.sin(i / 5) + (i % 7) * 0.25);
}

describe("state matrix and eigenvalues", () => {
  it("reproduces numpy's spectral radius on 30 landed grid rows", () => {
    for (const [na, nb, nc, expected] of LANDED_RADII) {
      expect(spectralRadius(na, nb, nc)).toBeCloseTo(expected, 10);
    }
  });

  it("finds the complex pair at the default and the real root", () => {
    const values = eigenvalues(stateMatrix(0.2, 0.1, 0.1)).sort((a, b) => a.imaginary - b.imaginary);
    expect(values[0]!.real).toBeCloseTo(0.96422522, 7);
    expect(values[0]!.imaginary).toBeCloseTo(-0.10802455, 7);
    expect(values[1]!.real).toBeCloseTo(0.84554957, 7);
    expect(values[1]!.imaginary).toBeCloseTo(0, 9);
    expect(values[2]!.imaginary).toBeCloseTo(0.10802455, 7);
    expect(spectralRadius(0.2, 0.1, 0.1)).toBeCloseTo(0.9702574761582572, 12);
  });

  it("collapses to a pure follower (radius 0) when every correction weight is 1", () => {
    // n = 1 everywhere: every state is rebuilt from the price, so the loop matrix is nilpotent (radius 0).
    expect(spectralRadius(1, 1, 1)).toBeCloseTo(0, 6);
  });
});

describe("the recursion", () => {
  const closes = syntheticCloses();

  it("matches the notebook's hwma_path at the default (stable, never leaves)", () => {
    const run = hwmaRun(closes, 0.2, 0.1, 0.1);
    expect(run.leftAt).toBeNull();
    expect(run.level[1999]).toBeCloseTo(25002.247072765895, 6);
    expect(run.level[100]).toBeCloseTo(25002.529275914152, 6);
    expect(run.unboundedMinimum).toBeCloseTo(24988.865766038933, 6);
    expect(run.unboundedMaximum).toBeCloseTo(25011.295529735416, 6);
  });

  it("records where an unstable setting leaves the range and what it reaches unbounded", () => {
    const run = hwmaRun(closes, 0.05, 0.05, 0.15);
    expect(run.leftAt).toBe(381);
    expect(run.unboundedMinimum / -217890245522.38965).toBeCloseTo(1, 9);
    expect(run.unboundedMaximum / 148756689051.9337).toBeCloseTo(1, 9);
    const drawn = emittedLevel(run, true);
    expect(drawn[380]).not.toBeNull();
    expect(drawn[381]).toBeNull();
    expect(drawn.slice(381).every((value) => value === null)).toBe(true);
    expect(emittedLevel(run, false)[1999]).toBeCloseTo(-217890245522.38965, -1);
  });

  it("finds a leave-the-range bar for a setting that goes negative", () => {
    const run = hwmaRun(closes, 0.4, 0.2, 0.9);
    expect(run.leftAt).toBe(840);
    expect(run.unboundedMinimum).toBeCloseTo(-51408.15614474165, 4);
  });

  it("is the chart's calcHWMA: the guarded path equals its output point for point", () => {
    const bars = closes.map((close, i) => ({ timestamp: 1_700_000_000_000 + i * 60_000, open: close, high: close, low: close, close, volume: 1 }));
    for (const [na, nb, nc] of [[0.2, 0.1, 0.1], [0.05, 0.05, 0.15], [0.4, 0.2, 0.9]] as const) {
      const fromChart = calcHWMA(bars, na, nb, nc).map((point) => point.value);
      const guarded = emittedLevel(hwmaRun(closes, na, nb, nc), true).filter((value): value is number => value !== null);
      expect(guarded.length).toBe(fromChart.length);
      guarded.forEach((value, index) => expect(value).toBeCloseTo(fromChart[index]!, 8));
    }
  });
});

describe("grid helpers", () => {
  const row = (na: number, nb: number, nc: number, over: Partial<HwmaGridRow> = {}): HwmaGridRow => ({
    na, nb, nc, spectral_radius: 0.9, spectrally_stable: true, bars_emitted: 2000, left_range_at_bar: null,
    emitted_minimum: 1, emitted_maximum: 2, unbounded_minimum: 1, unbounded_maximum: 2,
    went_negative_unbounded: false, went_negative_emitted: false, ...over,
  });

  it("counts per acceleration and finds a row by its settings", () => {
    const rows = [
      row(0.05, 0.05, 0.05),
      row(0.05, 0.05, 0.1, { spectrally_stable: false, left_range_at_bar: 559, went_negative_unbounded: true }),
      row(0.1, 0.05, 0.1, { spectrally_stable: false }),
    ];
    expect(countsByAcceleration(rows)).toEqual([
      { nc: 0.05, unstable: 0, goesNegative: 0, stoppedEarly: 0, combinations: 1 },
      { nc: 0.1, unstable: 2, goesNegative: 1, stoppedEarly: 1, combinations: 2 },
    ]);
    expect(gridRowAt(rows, 0.05, 0.05, 0.1)?.left_range_at_bar).toBe(559);
    expect(gridRowAt(rows, 0.5, 0.5, 0.5)).toBeNull();
  });

  it("rounds slider arithmetic onto the grid", () => {
    expect(onGrid(0.15000000000000002)).toBe(0.15);
    expect(onGrid(0.30000000000000004)).toBe(0.3);
  });

  it("draws the rho = 1 contour only where the radius crosses 1", () => {
    // at nc = 0.05 the whole 0.05..0.95 square is stable in the landed grid (no unstable pair), so no crossing
    expect(radiusContour(0.05, 0.05, 0.95, 24)).toHaveLength(0);
    const segments = radiusContour(0.5, 0.05, 0.95, 24);
    expect(segments.length).toBeGreaterThan(0);
    // every segment end sits on rho = 1 to interpolation accuracy
    for (const [x1, y1] of segments.slice(0, 5)) expect(Math.abs(spectralRadius(x1, y1, 0.5) - 1)).toBeLessThan(0.02);
  });
});

describe("column statistics (the notebook's scipy definitions)", () => {
  it("matches the closed-form moments of [1, 2, 3, 4, 10]", () => {
    const summary = columnSummary([1, 2, 3, 4, 10]);
    expect(summary.count).toBe(5);
    expect(summary.mean).toBe(4);
    expect(summary.median).toBe(3);
    expect(summary.standardDeviation).toBeCloseTo(Math.sqrt(12.5), 12);
    expect(summary.skewness).toBeCloseTo(36 / Math.pow(10, 1.5), 12);
    expect(summary.kurtosis).toBeCloseTo(278.8 / 100 - 3, 12);
    expect(summary.percentile25).toBe(2);
    expect(summary.percentile75).toBe(4);
    expect(summary.minimum).toBe(1);
    expect(summary.maximum).toBe(10);
  });

  it("leaves a moment null rather than zero when it is undefined", () => {
    expect(columnSummary([5, 5, 5, 5]).skewness).toBeNull();
    expect(columnSummary([5, 5, 5, 5]).kurtosis).toBeNull();
    expect(columnSummary([1, 2]).skewness).toBeNull();
    expect(columnSummary([1, 2, 3]).kurtosis).toBeNull();
    expect(columnSummary([7]).standardDeviation).toBeNull();
    expect(columnSummary([]).mean).toBeNull();
    expect(columnSummary([1, Number.NaN, Infinity, 3]).count).toBe(2);
  });

  it("bins over log10 |value| when positive values span more than four orders of magnitude", () => {
    const wide = columnHistogram([1, 10, 100, 1e6, -1e6], 10);
    expect(wide.logScale).toBe(true);
    expect(wide.bins.reduce((total, bin) => total + bin.count, 0)).toBe(5);
    const narrow = columnHistogram([1, 2, 3, 4], 4);
    expect(narrow.logScale).toBe(false);
    expect(narrow.bins.map((bin) => bin.count)).toEqual([1, 1, 1, 1]);
    expect(columnHistogram([1, 2, 3], 4, "always").logScale).toBe(true);
    expect(columnHistogram([1, 1e9], 4, "never").logScale).toBe(false);
    expect(columnHistogram([3, 3, 3], 4).bins.reduce((total, bin) => total + bin.count, 0)).toBe(3);
  });
});

describe("handler", () => {
  function fakeLake(present: boolean): { lake: StudyLake; sql: string[] } {
    const sql: string[] = [];
    const lake: StudyLake = {
      async query<T>(statement: string): Promise<T[]> {
        sql.push(statement);
        if (statement === RUN_INFORMATION_SQL) {
          return [{ generated_at_ms: 1, symbol: "MNQH6", bars: 2, snapshot: "s", grid_step: 0.05, grid_size: 1, default_na: 0.2, default_nb: 0.1, default_nc: 0.1, default_spectral_radius: 0.97, range_multiple: 10, source: "x", measures: "y", build_seconds: 1, recipe: "r" }] as T[];
        }
        if (statement === PRICES_SQL) return [{ bar_index: 0, timestamp_ms: 1, close: 25000 }, { bar_index: 1, timestamp_ms: 2, close: 25001 }] as T[];
        if (statement === GRID_SQL) return [{ na: 0.05, nb: 0.05, nc: 0.05, spectral_radius: 0.999, spectrally_stable: true }] as T[];
        throw new Error(`unexpected SQL: ${statement}`);
      },
      async hasView() {
        return present;
      },
      async columns() {
        return [];
      },
    };
    return { lake, sql };
  }

  it("declares the three landed views and takes no query", () => {
    expect(handler.slug).toBe("hwma-stability");
    expect(handler.datasets).toEqual([
      "derived_study_hwma_stability_grid",
      "derived_study_hwma_stability_price_series",
      "derived_study_hwma_stability_run_information",
    ]);
    expect(handler.query.parse({})).toEqual({});
  });

  it("returns the three tables when they are landed", async () => {
    const { lake, sql } = fakeLake(true);
    const context: StudyContext = { lake, notes: [] };
    const body = await handler.run({}, context);
    expect(body.runInformation?.symbol).toBe("MNQH6");
    expect(body.prices).toHaveLength(2);
    expect(body.grid).toHaveLength(1);
    expect(context.notes).toEqual([]);
    expect(sql).toHaveLength(3);
    for (const statement of sql) expect(statement).toMatch(/derived_study_hwma_stability_/);
  });

  it("degrades to an empty body and a note when the tables are not landed", async () => {
    const { lake, sql } = fakeLake(false);
    const context: StudyContext = { lake, notes: [] };
    const body = await handler.run({}, context);
    expect(body).toEqual(EMPTY_BODY);
    expect(sql).toHaveLength(0);
    expect(context.notes[0]).toMatch(/Not in the lake yet: derived_study_hwma_stability_grid/);
  });
});
