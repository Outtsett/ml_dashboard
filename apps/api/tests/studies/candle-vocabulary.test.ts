/**
 * The candle-vocabulary study: its handler (apps/api/studies/handlers/candle-vocabulary.ts)
 * against a fake lake, and the pure arithmetic the page shares with it
 * (packages/shared/src/studies/candle-vocabulary.ts), including the two parity checks
 * against the notebook's own numbers.
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/candle-vocabulary";
import type { StudyLake } from "../../studies/types";
import {
  MINIMUM_BODY, addedToHar, bestAddition, bitsKept, entropyTerms, glyphBars, groupArchetypes, harBaseline, nonBaselineRows,
  orderCodes, perplexity, sharedBarFraction,
  type ArchetypeBar, type ArchetypeRow, type SequenceResultRow,
} from "@shared/studies/candle-vocabulary";

function fakeLake(present: (name: string) => boolean, respond: (sql: string) => unknown[]): StudyLake & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      return respond(sql) as T[];
    },
    async hasView(name) {
      return present(name);
    },
    async columns() {
      return [];
    },
  };
}

function sequenceRow(run: string, magnitude: boolean, representation: string, alone: number, plus: number, added: number | null = null): SequenceResultRow {
  return {
    run_name: run, symbol: "MNQ", timeframe: "5m", code_count: 24, width_bars: 4, horizon_bars: 12, history_months: 36,
    with_magnitude_channels: magnitude, channel_count: magnitude ? 7 : 5, representation, stored_model_name: representation,
    out_of_sample_r_squared: alone, har_plus_r_squared: plus, added_to_har_r_squared: added, codebook_perplexity: 20, codes_used_count: 24,
    windows_assigned_count: 1000, bar_count: 2000, train_sequence_count: 1000, test_sequence_count: 250, random_seed: 42, test_fraction: 0.2,
    elapsed_seconds: 1, source_file: `${run}.json`,
  };
}

// The with-magnitude run as stored on disk (candle_seq/MNQ_5m_k24_w4_h12_scale1.json), full precision.
const SCALE1 = [
  sequenceRow("scale1", true, "har_rv_baseline", 0.4964303790188328, 0.4964303790188328),
  sequenceRow("scale1", true, "code_with_random_embedding", 0.2736239602650564, 0.5283949940488077),
  sequenceRow("scale1", true, "code_with_codebook_embedding", 0.293235840859131, 0.5352276384334942),
  sequenceRow("scale1", true, "continuous_latent_without_quantisation", 0.30405444325985476, 0.5397411245140465),
];
const SCALE0 = [
  sequenceRow("scale0", false, "har_rv_baseline", 0.4964303790188328, 0.4964303790188328),
  sequenceRow("scale0", false, "code_with_random_embedding", -0.02559240412689312, 0.4932915354823031),
  sequenceRow("scale0", false, "code_with_codebook_embedding", 0.0005122158580460612, 0.4962124114098023),
  sequenceRow("scale0", false, "continuous_latent_without_quantisation", 0.03706191173464146, 0.4967202015878712),
];

describe("candle-vocabulary handler", () => {
  it("returns empty data and a note when the views are not landed", async () => {
    const lake = fakeLake(() => false, () => []);
    const notes: string[] = [];
    const data = await handler.run(handler.query.parse({}), { lake, notes });
    expect(data).toEqual({ sequenceResults: [], archetypes: [], languageModel: [], languageModelDirection: [] });
    expect(notes[0]).toContain("derived_study_candle_vocabulary_sequence_results");
    expect(lake.seen).toHaveLength(0);
  });

  it("reads the four tables, each ordered and without the hive recipe column", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.includes("_sequence_results")) return SCALE1;
      if (sql.includes("_archetypes")) return [{ code: 1 }];
      if (sql.includes("_language_model_results")) return [{ model: "unigram" }];
      return [{ model: "bigram" }];
    });
    const notes: string[] = [];
    const data = (await handler.run(handler.query.parse({}), { lake, notes })) as { sequenceResults: unknown[]; archetypes: unknown[]; languageModel: unknown[]; languageModelDirection: unknown[] };
    expect(data.sequenceResults).toHaveLength(4);
    expect(data.archetypes).toHaveLength(1);
    expect(data.languageModel).toHaveLength(1);
    expect(data.languageModelDirection).toHaveLength(1);
    expect(notes).toEqual([]);
    expect(lake.seen).toHaveLength(4);
    for (const sql of lake.seen) {
      expect(sql).toContain("EXCLUDE (recipe)");
      expect(sql).toContain("ORDER BY");
    }
  });

  it("names every view it reads in datasets and takes no query parameters", () => {
    expect(handler.slug).toBe("candle-vocabulary");
    expect(handler.datasets).toHaveLength(4);
    for (const name of handler.datasets) expect(name.startsWith("derived_study_candle_vocabulary_")).toBe(true);
    expect(handler.query.safeParse({}).success).toBe(true);
  });
});

describe("added to HAR-RV (parity with the notebook's seq['added_to_har'])", () => {
  it("reproduces the notebook's +0.0433 for the latent representation with magnitude", () => {
    const added = addedToHar([...SCALE0, ...SCALE1]);
    const latent = added.find((entry) => entry.row.run_name === "scale1" && entry.row.representation === "continuous_latent_without_quantisation");
    expect(latent?.added).toBeCloseTo(0.5397411245140465 - 0.4964303790188328, 12);
    expect(Number(latent?.added?.toFixed(4))).toBe(0.0433);
    const shape = added.find((entry) => entry.row.run_name === "scale0" && entry.row.representation === "code_with_random_embedding");
    expect(Number(shape?.added?.toFixed(4))).toBe(-0.0031);
  });

  it("measures against the HAR row of the same run, wherever it sits in the list (the notebook's transform('first') depended on order)", () => {
    const shuffled = [SCALE1[3] as SequenceResultRow, SCALE1[0] as SequenceResultRow, SCALE0[2] as SequenceResultRow, SCALE0[0] as SequenceResultRow];
    const added = addedToHar(shuffled);
    expect(added[0]?.added).toBeCloseTo(0.0433107, 6);
    expect(added[1]?.added).toBeCloseTo(0, 12);
    expect(added[2]?.added).toBeCloseTo(0.4962124114098023 - 0.4964303790188328, 12);
  });

  it("is null when a run has no HAR row to compare with", () => {
    expect(addedToHar([SCALE1[3] as SequenceResultRow])[0]?.added).toBeNull();
  });

  it("finds the best addition among the non-baseline rows, over every run", () => {
    const rows = [...SCALE0, ...SCALE1].map((row) => ({ ...row, added_to_har_r_squared: addedToHar([...SCALE0, ...SCALE1]).find((entry) => entry.row === row)?.added ?? null }));
    const best = bestAddition(rows);
    expect(best?.representation).toBe("continuous_latent_without_quantisation");
    expect(best?.with_magnitude_channels).toBe(true);
    expect(nonBaselineRows(rows).every((row) => row.representation !== "har_rv_baseline")).toBe(true);
    expect(harBaseline(rows, "scale1")).toBeCloseTo(0.4964303790188328, 12);
    expect(harBaseline(rows, "nothing")).toBeNull();
  });
});

describe("bits and overlap arithmetic", () => {
  it("keeps log2 K bits: 4.58 for the stored K = 24", () => {
    expect(bitsKept(24)).toBeCloseTo(4.584962500721156, 12);
    expect(bitsKept(64)).toBe(6);
    expect(bitsKept(1)).toBe(0);
    expect(Number.isNaN(bitsKept(0))).toBe(true);
  });

  it("shares width - stride of a symbol's bars with the next, never below zero", () => {
    expect(sharedBarFraction(16, 1)).toBeCloseTo(15 / 16, 12);
    expect(sharedBarFraction(16, 16)).toBe(0);
    expect(sharedBarFraction(16, 40)).toBe(0);
  });
});

function archetypeRows(run: string, code: number, count: number, bars: Array<Partial<ArchetypeRow>>): ArchetypeRow[] {
  return bars.map((bar, position) => ({
    run_name: run, symbol: "MNQ", timeframe: "5m", code_count: 3, width_bars: bars.length, with_magnitude_channels: false, code, bar_position: position,
    windows_assigned_count: count, share_of_windows_fraction: null, rank_by_window_count: 1,
    open_position_fraction: 0.5, close_position_fraction: 0.5, body_fraction: 0, upper_wick_fraction: 0.25, lower_wick_fraction: 0.25,
    log_range_zscore: null, log_volume_zscore: null, source_file: `${run}.npz`, ...bar,
  }));
}

describe("archetype glyphs (the notebook's candle drawing)", () => {
  it("draws the body between open and close with wicks beyond it, rising when close >= open", () => {
    const bars: ArchetypeBar[] = [
      { position: 0, open: 0.2, close: 0.7, body: 0.5, upperWick: 0.2, lowerWick: 0.1, logRangeZscore: null, logVolumeZscore: null },
      { position: 1, open: 0.8, close: 0.4, body: -0.4, upperWick: 0.1, lowerWick: 0.3, logRangeZscore: null, logVolumeZscore: null },
    ];
    const [rising, falling] = glyphBars(bars);
    expect(rising).toMatchObject({ bodyBottom: 0.2, rising: true });
    expect(rising?.bodyHeight).toBeCloseTo(0.5, 12);
    expect(rising?.wickHigh).toBeCloseTo(0.9, 12);
    expect(rising?.wickLow).toBeCloseTo(0.1, 12);
    expect(falling).toMatchObject({ bodyBottom: 0.4, rising: false });
    expect(falling?.wickHigh).toBeCloseTo(0.9, 12);
    expect(falling?.wickLow).toBeCloseTo(0.1, 12);
  });

  it("keeps a doji visible at the minimum body height and treats close = open as rising", () => {
    const [doji] = glyphBars([{ position: 0, open: 0.5, close: 0.5, body: 0, upperWick: 0.2, lowerWick: 0.2, logRangeZscore: null, logVolumeZscore: null }]);
    expect(doji?.bodyHeight).toBe(MINIMUM_BODY);
    expect(doji?.rising).toBe(true);
  });

  it("skips a bar whose channels are missing (a code no window was assigned to)", () => {
    expect(glyphBars([{ position: 0, open: null, close: null, body: null, upperWick: null, lowerWick: null, logRangeZscore: null, logVolumeZscore: null }])).toEqual([]);
  });

  it("groups the flat table into sets and codes, bars in time order, and orders codes commonest first", () => {
    const rows = [
      ...archetypeRows("b", 1, 10, [{ open_position_fraction: 0.1 }, { open_position_fraction: 0.2 }]),
      ...archetypeRows("b", 0, 30, [{ open_position_fraction: 0.3 }, { open_position_fraction: 0.4 }]),
      ...archetypeRows("a", 0, 5, [{}]),
    ].reverse();
    const sets = groupArchetypes(rows);
    expect(sets.map((set) => set.runName)).toEqual(["a", "b"]);
    const setB = sets[1];
    expect(setB?.codes.map((code) => code.code)).toEqual([0, 1]);
    expect(setB?.codes[0]?.bars.map((bar) => bar.position)).toEqual([0, 1]);
    expect(setB?.codes[0]?.bars.map((bar) => bar.open)).toEqual([0.3, 0.4]);
    expect(orderCodes(setB?.codes ?? [], "count").map((code) => code.code)).toEqual([0, 1]);
    expect(orderCodes(setB?.codes ?? [], "rare").map((code) => code.code)).toEqual([1, 0]);
    expect(orderCodes(setB?.codes ?? [], "code").map((code) => code.code)).toEqual([0, 1]);
  });
});

describe("perplexity of the code usage (parity with the stored codebook perplexity)", () => {
  it("is exp of the entropy: K for a uniform usage, 1 for a single code", () => {
    expect(perplexity([5, 5, 5, 5])).toBeCloseTo(4, 12);
    expect(perplexity([9, 0, 0])).toBeCloseTo(1, 12);
    expect(Number.isNaN(perplexity([0, 0]))).toBe(true);
  });

  it("reproduces the codebook perplexity the trainer stored, from the stored counts of both archetype sets", () => {
    const shapeOnly = [7396, 5841, 8019, 7311, 8734, 9102, 7675, 5645, 10722, 11312, 7985, 5219, 3498, 4642, 5804, 12536, 4416, 8502, 8223, 5144, 5453, 5993, 7176, 5596];
    const withMagnitude = [650, 6525, 551, 17356, 10360, 11259, 4262, 10218, 3445, 13308, 8798, 3923, 503, 10010, 1123, 12998, 8088, 3610, 8117, 3051, 3407, 6340, 12925, 11117];
    expect(shapeOnly.reduce((a, b) => a + b, 0)).toBe(171944);
    expect(perplexity(shapeOnly)).toBeCloseTo(22.912037942368833, 9);
    expect(perplexity(withMagnitude)).toBeCloseTo(18.902401192170903, 9);
  });

  it("steps the sum: the last running total is the entropy, and terms are non-negative", () => {
    const terms = entropyTerms([6, 3, 1]);
    expect(terms).toHaveLength(3);
    expect(terms.every((term) => term.term >= 0)).toBe(true);
    expect(Math.exp(terms[2]?.running ?? Number.NaN)).toBeCloseTo(perplexity([6, 3, 1]), 12);
    expect(terms[0]?.running).toBeCloseTo(terms[0]?.term ?? Number.NaN, 12);
    expect(terms[1]?.running).toBeCloseTo((terms[0]?.term ?? 0) + (terms[1]?.term ?? 0), 12);
  });
});
