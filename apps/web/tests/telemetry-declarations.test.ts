/**
 * Metric declaration resolution.
 *
 * The contract: a runner's declarations drive the ticker, malformed input never
 * throws inside a render, and an undeclared metric is surfaced rather than
 * silently dropped.
 */

import { describe, it, expect } from "vitest";
import {
  resolveMetrics,
  isLowerBetter,
  prettifyMetricKey,
} from "@/ml/telemetry/metricDeclarations";

describe("prettifyMetricKey", () => {
  it("humanizes snake and kebab case", () => {
    expect(prettifyMetricKey("val_acc")).toBe("Val Acc");
    expect(prettifyMetricKey("kl-divergence")).toBe("Kl Divergence");
    expect(prettifyMetricKey("sharpe")).toBe("Sharpe");
  });

  it("collapses redundant separators", () => {
    expect(prettifyMetricKey("train__loss")).toBe("Train Loss");
  });
});

describe("isLowerBetter", () => {
  it("obeys an explicit declaration over any name heuristic", () => {
    // A metric named "loss" that the runner declares as higher-is-better must
    // be believed — the runner knows what it emitted, the heuristic does not.
    expect(isLowerBetter("val_loss", { higher_is_better: true })).toBe(false);
    expect(isLowerBetter("sharpe", { higher_is_better: false })).toBe(true);
  });

  it("falls back to the name only when undeclared", () => {
    expect(isLowerBetter("val_loss", {})).toBe(true);
    expect(isLowerBetter("max_drawdown", {})).toBe(true);
    expect(isLowerBetter("rmse", {})).toBe(true);
    expect(isLowerBetter("sharpe", {})).toBe(false);
    expect(isLowerBetter("accuracy", {})).toBe(false);
  });
});

describe("resolveMetrics", () => {
  it("preserves declaration order as the runner's statement of importance", () => {
    const declarations = {
      sharpe: { context: {} },
      val_loss: { context: {} },
      accuracy: { context: {} },
    };
    const resolved = resolveMetrics(declarations, {});
    expect(resolved.map((r) => r.key)).toEqual(["sharpe", "val_loss", "accuracy"]);
  });

  it("appends undeclared metrics rather than dropping them", () => {
    const resolved = resolveMetrics({ sharpe: { context: {} } }, { sharpe: 1.2, surprise: 0.4 });
    expect(resolved.map((r) => r.key)).toEqual(["sharpe", "surprise"]);
  });

  it("does not duplicate a metric that is both declared and streaming", () => {
    const resolved = resolveMetrics({ sharpe: { context: {} } }, { sharpe: 1.2 });
    expect(resolved).toHaveLength(1);
  });

  it("handles a null declaration payload", () => {
    const resolved = resolveMetrics(null, { loss: 0.5 });
    expect(resolved.map((r) => r.key)).toEqual(["loss"]);
    expect(resolved[0]!.label).toBe("Loss");
  });

  it("survives malformed declarations without throwing", () => {
    const hostile = {
      a: null,
      b: "not an object",
      c: 42,
      d: [],
      e: { context: "also not an object" },
    } as unknown as Record<string, unknown>;

    const resolved = resolveMetrics(hostile, {});
    expect(resolved).toHaveLength(5);
    // Every entry still has a usable label and an object context.
    for (const entry of resolved) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.context).toBe("object");
    }
  });

  it("uses a declared label when present", () => {
    const resolved = resolveMetrics({ kl: { label: "KL Divergence", context: {} } }, {});
    expect(resolved[0]!.label).toBe("KL Divergence");
  });

  it("ignores a blank declared label and falls back to the key", () => {
    const resolved = resolveMetrics({ kl: { label: "   ", context: {} } }, {});
    expect(resolved[0]!.label).toBe("Kl");
  });
});
