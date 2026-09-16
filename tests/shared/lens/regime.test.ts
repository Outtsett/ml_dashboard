import { describe, expect, it } from "vitest";
import {
  classifyRegimes,
  clampLensParams,
  computeRolling,
  pageHinkleyDrift,
  regimeSegments,
  regimeShare,
  resolveRange,
  simulateTrades,
  stampTradeRegimes,
} from "@shared/lens/index";
import { makeManifest, makeSeries } from "./fixtures";

function geometric(start: number, growth: number, count: number): number[] {
  const out: number[] = [];
  let value = start;
  for (let index = 0; index < count; index += 1) {
    out.push(value);
    value *= growth;
  }
  return out;
}

describe("classifyRegimes", () => {
  it("leaves the lookback warmup null rather than calling it sideways", () => {
    const close = Float64Array.from(geometric(100, 1.01, 10));
    const regimes = classifyRegimes(close, 3, 1);
    expect(regimes.slice(0, 3)).toEqual([null, null, null]);
    expect(regimes.slice(3).every((regime) => regime !== null)).toBe(true);
  });

  it("calls a steady climb bull and a steady fall bear", () => {
    const up = classifyRegimes(Float64Array.from(geometric(100, 1.01, 12)), 3, 1);
    const down = classifyRegimes(Float64Array.from(geometric(100, 0.99, 12)), 3, 1);
    expect(up.slice(3).every((regime) => regime === "bull")).toBe(true);
    expect(down.slice(3).every((regime) => regime === "bear")).toBe(true);
  });

  it("calls a flat tape sideways", () => {
    const flat = classifyRegimes(Float64Array.from(new Array(12).fill(100)), 3, 1);
    expect(flat.slice(3).every((regime) => regime === "sideways")).toBe(true);
  });

  it("widens the sideways band as the threshold rises", () => {
    // A noisy drift: high volatility relative to the move, so a bigger k
    // pushes rows out of bull and into sideways.
    const close = Float64Array.from([
      100, 103, 99, 104, 100, 105, 101, 106, 102, 107, 103, 108, 104, 109, 105, 110,
    ]);
    const loose = classifyRegimes(close, 5, 0.25);
    const strict = classifyRegimes(close, 5, 3);
    const sidewaysLoose = loose.filter((regime) => regime === "sideways").length;
    const sidewaysStrict = strict.filter((regime) => regime === "sideways").length;
    expect(sidewaysStrict).toBeGreaterThan(sidewaysLoose);
  });

  it("run-length encodes the range and shares add up to at most one", () => {
    const close = geometric(100, 1.01, 10).concat(geometric(110, 0.99, 10));
    const series = makeSeries({ close, probabilityUp: new Array(20).fill(0.5), horizonBars: 2 });
    const manifest = makeManifest(series);
    const params = clampLensParams({ regimeLookbackBars: 10, regimeThreshold: 1 }, manifest);
    const range = resolveRange(series, params);
    const regimes = classifyRegimes(series.close, params.regimeLookbackBars, params.regimeThreshold);
    const segments = regimeSegments(series, regimes, range);

    expect(segments[0]?.regime).toBeNull();
    expect(segments[0]?.startRowIndex).toBe(0);
    expect(segments[segments.length - 1]?.endRowIndex).toBe(19);
    // Segments tile the range with no gap and no overlap.
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]?.startRowIndex).toBe((segments[index - 1]?.endRowIndex as number) + 1);
    }
    const share = regimeShare(regimes, range);
    expect(share.bull + share.bear + share.sideways).toBeLessThanOrEqual(1 + 1e-12);
    // 10 warmup rows out of 20 carry no regime.
    expect(share.bull + share.bear + share.sideways).toBeCloseTo(0.5, 12);
  });

  it("stamps each trade with the regime that held at its entry row", () => {
    const series = makeSeries({
      close: [100, 101, 102, 103, 104, 105, 106, 107],
      probabilityUp: [0.9, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.5],
      horizonBars: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.6 });
    const params = clampLensParams({ regimeLookbackBars: 3, regimeThreshold: 1 }, manifest);
    const range = resolveRange(series, params);
    const regimes = classifyRegimes(series.close, 3, 1);
    const { trades } = simulateTrades(series, params, range);
    stampTradeRegimes(trades, regimes);
    expect(trades[0]?.regime).toBeNull(); // entered inside the warmup
    expect(trades[1]?.regime).toBe(regimes[4]);
  });
});

describe("computeRolling", () => {
  it("requires a full window and produces one point per row after it", () => {
    const close = [100, 101, 102, 103, 104, 105];
    const series = makeSeries({
      close,
      probabilityUp: [0.9, 0.9, 0.1, 0.1, 0.9, 0.9],
      label: [1, 1, 0, 1, 1, 1],
      horizonBars: 2,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({ rollingWindowBars: 20, rollingWindowTrades: 10 }, manifest);
    const range = resolveRange(series, params);
    const { trades } = simulateTrades(series, params, range);
    const rolling = computeRolling(series, { ...params, rollingWindowBars: 4 }, range, trades);

    expect(rolling.windowBars).toBe(4);
    expect(rolling.points).toHaveLength(3);
    expect(rolling.points[0]?.rowIndex).toBe(3);
    expect(rolling.points[0]?.labelledCount).toBe(4);
    // rows 0..3: predicted up, up, down, down against labels 1, 1, 0, 1 -> 3 of 4.
    expect(rolling.points[0]?.hitRate).toBeCloseTo(0.75, 12);
    expect(rolling.downsampled).toBe(false);
  });

  it("reports a null band that a coin flip would sit inside", () => {
    const close = new Array(40).fill(0).map((_, index) => 100 + index);
    const series = makeSeries({
      close,
      probabilityUp: new Array(40).fill(0.5),
      label: new Array(40).fill(1),
      horizonBars: 4,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({ rollingWindowBars: 20 }, manifest);
    const rolling = computeRolling(series, params, resolveRange(series, params), []);
    // 20 rows at horizon 4 hold 5 independent outcomes.
    expect(rolling.effectiveSampleSizePerWindow).toBeCloseTo(5, 12);
    expect(rolling.nullBand.lower).toBeCloseTo(0.5 - 1.959963984540054 * Math.sqrt(0.25 / 5), 12);
    expect(rolling.nullBand.upper).toBeCloseTo(0.5 + 1.959963984540054 * Math.sqrt(0.25 / 5), 12);
  });

  it("emits no rolling point when the window is longer than the record", () => {
    const series = makeSeries({ close: [1, 2, 3], probabilityUp: [0.5, 0.5, 0.5], horizonBars: 1 });
    const manifest = makeManifest(series);
    const params = clampLensParams({ rollingWindowBars: 20 }, manifest);
    const rolling = computeRolling(series, { ...params, rollingWindowBars: 10 }, resolveRange(series, params), []);
    expect(rolling.points).toHaveLength(0);
  });
});

describe("pageHinkleyDrift", () => {
  it("stays quiet on a stable series and fires on a sustained collapse", () => {
    const stable = Array.from({ length: 120 }, (_, index) => ({
      netUsd: index % 2 === 0 ? 1 : -1,
      exitTimestampSeconds: index,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quiet = pageHinkleyDrift(stable as any);
    expect(quiet.alarms).toHaveLength(0);
    expect(quiet.lambda).toBeGreaterThan(0);

    const collapsing = stable.concat(
      Array.from({ length: 400 }, (_, index) => ({ netUsd: -60, exitTimestampSeconds: 1000 + index })),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alarmed = pageHinkleyDrift(collapsing as any);
    expect(alarmed.alarms.length).toBeGreaterThan(0);
    expect(alarmed.alarms[0]?.direction).toBe("deterioration");
    expect(alarmed.alarms[0]?.tradeIndex).toBeGreaterThanOrEqual(120);
  });

  it("reports no threshold at all when there is nothing to test", () => {
    const drift = pageHinkleyDrift([]);
    expect(drift.delta).toBe(0);
    expect(drift.lambda).toBe(0);
    expect(drift.alarms).toHaveLength(0);
  });
});
