import { describe, expect, it } from "vitest";
import type { LensFeatureFamilyKey } from "../../../src/shared/lens/types";
import {
  candleStripWindow,
  decisionText,
  findNextTradeEntryIndex,
  intervalBasisPointsForCoverage,
  intervalLanding,
  regimeGlyph,
  regimeLabel,
  stepBack,
  stepForward,
  targetBarForHorizon,
  topFeaturesAtBar,
} from "../../../src/client/src/lens/playback/playbackLogic";
import { makeBar, makeBarSeries } from "./fixtures";

describe("stepForward", () => {
  it("advances the cursor while inside the window", () => {
    expect(stepForward(0, 10, false)).toEqual({ nextIndex: 1, reachedWindowEnd: false, atRecordEnd: false });
    expect(stepForward(8, 10, false)).toEqual({ nextIndex: 9, reachedWindowEnd: false, atRecordEnd: false });
  });

  it("asks the page to slide the window when more rows exist after it", () => {
    expect(stepForward(9, 10, true)).toEqual({ nextIndex: null, reachedWindowEnd: true, atRecordEnd: false });
  });

  it("stops at the true end of the record", () => {
    expect(stepForward(9, 10, false)).toEqual({ nextIndex: null, reachedWindowEnd: false, atRecordEnd: true });
  });
});

describe("stepBack", () => {
  it("never goes below 0", () => {
    expect(stepBack(0)).toBe(0);
    expect(stepBack(5)).toBe(4);
  });
});

describe("findNextTradeEntryIndex", () => {
  it("finds the next enter_long or enter_short strictly after the cursor", () => {
    const bars = makeBarSeries(6).map((b, i) => (i === 3 ? { ...b, decision: "enter_long" as const } : b));
    expect(findNextTradeEntryIndex(bars, 0)).toBe(3);
    expect(findNextTradeEntryIndex(bars, 3)).toBeNull();
    expect(findNextTradeEntryIndex(bars, 4)).toBeNull();
  });

  it("returns null when no entry decision exists in the window", () => {
    const bars = makeBarSeries(4);
    expect(findNextTradeEntryIndex(bars, 0)).toBeNull();
  });
});

describe("decisionText", () => {
  it("names the two skip reasons distinctly by resulting position", () => {
    expect(decisionText("skip", 0)).toBe("skip — conviction below threshold");
    expect(decisionText("skip", 1)).toBe("skip — already in a position");
    expect(decisionText("skip", -1)).toBe("skip — already in a position");
  });

  it("labels every other decision in plain words", () => {
    expect(decisionText("enter_long", 1)).toBe("enter long");
    expect(decisionText("enter_short", -1)).toBe("enter short");
    expect(decisionText("hold", 1)).toBe("hold — long position open");
    expect(decisionText("hold", -1)).toBe("hold — short position open");
    expect(decisionText("exit", 0)).toBe("exit position");
    expect(decisionText("flat", 0)).toBe("flat — no position");
  });
});

describe("regime words", () => {
  it("glyphs bull/bear/sideways distinctly from color alone", () => {
    expect(regimeGlyph("bull")).toBe("▲");
    expect(regimeGlyph("bear")).toBe("▼");
    expect(regimeGlyph("sideways")).toBe("◆");
    expect(regimeGlyph(null)).toBe("–");
  });

  it("labels regimes", () => {
    expect(regimeLabel("bull")).toBe("bull");
    expect(regimeLabel(null)).toBe("unknown");
  });
});

describe("candleStripWindow", () => {
  it("takes up to `count` bars ending at the cursor, oldest first", () => {
    const bars = makeBarSeries(50);
    const strip = candleStripWindow(bars, 45, 40);
    expect(strip).toHaveLength(40);
    expect(strip[0]!.rowIndex).toBe(6);
    expect(strip[strip.length - 1]!.rowIndex).toBe(45);
  });

  it("clamps to the start of the series near row 0", () => {
    const bars = makeBarSeries(10);
    const strip = candleStripWindow(bars, 2, 40);
    expect(strip).toHaveLength(3);
    expect(strip[0]!.rowIndex).toBe(0);
  });
});

describe("topFeaturesAtBar", () => {
  it("ranks by |shap| descending and drops null rows rather than treating them as 0", () => {
    const names = ["a", "b", "c", "d"];
    const families: LensFeatureFamilyKey[] = ["momentum", "volatility", "volume", "macro"];
    const shap = [0.1, -0.5, null, 0.3];
    const value = [1, 2, 3, 4];
    const top = topFeaturesAtBar(names, families, shap, value, 10);
    expect(top).toHaveLength(3);
    expect(top.map((f) => f.name)).toEqual(["b", "d", "a"]);
    expect(top.map((f) => f.rank)).toEqual([1, 2, 3]);
  });

  it("caps at topN", () => {
    const names = ["a", "b", "c"];
    const families: LensFeatureFamilyKey[] = ["momentum", "momentum", "momentum"];
    const shap = [0.9, 0.8, 0.7];
    const value = [1, 1, 1];
    expect(topFeaturesAtBar(names, families, shap, value, 2)).toHaveLength(2);
  });
});

describe("intervalBasisPointsForCoverage", () => {
  const quantiles = [-10, -6, -2, 1, 4, 8, 12];

  it("picks the 0.05/0.95 pair for 90% coverage", () => {
    expect(intervalBasisPointsForCoverage(quantiles, 0.9)).toEqual({ lowBasisPoints: -10, highBasisPoints: 12 });
  });

  it("picks the 0.25/0.75 pair for 50% coverage", () => {
    expect(intervalBasisPointsForCoverage(quantiles, 0.5)).toEqual({ lowBasisPoints: -2, highBasisPoints: 4 });
  });

  it("returns null during warmup (no quantiles)", () => {
    expect(intervalBasisPointsForCoverage(null, 0.9)).toBeNull();
  });
});

describe("targetBarForHorizon + intervalLanding", () => {
  it("finds the bar H rows later and classifies where price landed", () => {
    const bars = makeBarSeries(10);
    const bar = { ...bars[0]!, intervalLowerPrice: 7501, intervalUpperPrice: 7503 };
    const target = targetBarForHorizon(bars, bar, 5);
    expect(target?.rowIndex).toBe(5);

    expect(intervalLanding(bar, 7502)).toBe("inside");
    expect(intervalLanding(bar, 7510)).toBe("above");
    expect(intervalLanding(bar, 7000)).toBe("below");
  });

  it("returns null when the target row falls outside the loaded window", () => {
    const bars = makeBarSeries(3);
    const bar = bars[0]!;
    expect(targetBarForHorizon(bars, bar, 5)).toBeNull();
  });

  it("returns null landing when the bar carries no interval (warmup)", () => {
    const bar = makeBar({ intervalLowerPrice: null, intervalUpperPrice: null });
    expect(intervalLanding(bar, 7500)).toBeNull();
  });
});
