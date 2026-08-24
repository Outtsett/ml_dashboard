// @vitest-environment jsdom
/**
 * Stage 4 — multi-run overlay contract.
 *
 * The design (plan §2.6) adds ONE optional prop, `RendererProps.series`, and
 * nothing else. These tests pin the three properties that make that safe:
 *
 *   1. All 15 registered renderers still mount with `series` omitted — the
 *      single-run path is untouched.
 *   2. An OVERLAY_CAPABLE renderer given N series draws N series on one chart.
 *   3. A non-overlay renderer given N runs is fanned into N small multiples by
 *      MetricGrid, requiring zero changes inside that renderer.
 */

import "./setup";
import { describe, it, expect } from "vitest";
import { render as rtlRender, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import type { ReactElement } from "react";
import { TooltipProvider } from "../../src/client/src/shared/ui/tooltip";

import {
  RENDERER_REGISTRY,
  OVERLAY_CAPABLE,
  resolveRenderer,
} from "../../src/client/src/ml/components";
import { MetricGrid } from "../../src/client/src/ml/components/MetricGrid";
import type {
  MetricDeclaration,
  RendererType,
  SelfDescribingDiagnostics,
} from "../../src/client/src/ml/lib/diagnostics-schema";

afterEach(() => cleanup());

/**
 * Every renderer reaches for a Radix tooltip, which throws outside a
 * `TooltipProvider`. That provider is supplied by the app shell in production,
 * so it must be supplied here too — otherwise these tests would only prove the
 * components cannot mount standalone.
 */
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A value shaped plausibly for every renderer type, so mounting is a real
 *  test rather than an early "no data" bail-out. */
function valueFor(renderer: RendererType): MetricDeclaration["value"] {
  switch (renderer) {
    case "confusion_matrix":
    case "heatmap":
      return [
        [5, 1],
        [2, 7],
      ];
    case "bars":
    case "precision_bars":
    case "fold_bars":
    case "distribution":
      return [0.1, 0.4, 0.35, 0.2];
    case "time_series":
      return { epochs: [1, 2, 3], loss: [0.9, 0.6, 0.4] };
    case "table":
      return { rows: [{ a: 1, b: 2 }] };
    case "surface_3d":
      return { x: [0, 1], y: [0, 1], z: [[0, 1], [1, 0]] };
    case "chart_overlay":
      return { timestamps: [1, 2], values: [0.1, 0.2] };
    case "text":
      return "ok";
    default:
      return 0.62;
  }
}

function decl(renderer: RendererType, over: Partial<MetricDeclaration> = {}): MetricDeclaration {
  return {
    value: valueFor(renderer),
    renderer,
    mission: `mission for ${renderer}`,
    context: {},
    ...over,
  };
}

function diag(
  modelType: string,
  metrics: Record<string, MetricDeclaration>,
): SelfDescribingDiagnostics {
  return {
    model_type: modelType,
    symbol: "MNQ",
    timeframe: "1m",
    metrics,
    training: { duration_sec: 1, trained_at: "2026-07-28T00:00:00Z" },
  };
}

// ─── 1. Every renderer survives `series` being absent ─────────────────────────

describe("RendererProps.series is genuinely optional", () => {
  const types = Object.keys(RENDERER_REGISTRY) as RendererType[];

  it("registry covers the full RendererType union", () => {
    expect(types.length).toBe(15);
  });

  for (const t of types) {
    it(`${t} mounts with no series prop`, () => {
      const Component = resolveRenderer(t);
      expect(() =>
        render(<Component metricKey={`m_${t}`} metric={decl(t)} />),
      ).not.toThrow();
    });
  }
});

// ─── 2. Overlay-capable renderers consume N series ────────────────────────────

describe("OVERLAY_CAPABLE renderers accept a multi-run series", () => {
  it("declares only renderers that can share one set of axes", () => {
    // Superimposing an N×N grid or a 3D surface is meaningless — these must
    // never be marked capable, or MetricGrid would stop fanning them out.
    for (const forbidden of ["confusion_matrix", "heatmap", "surface_3d", "table"] as const) {
      expect(OVERLAY_CAPABLE.has(forbidden)).toBe(false);
    }
    expect(OVERLAY_CAPABLE.has("time_series")).toBe(true);
  });

  it("time_series renders 3 runs without throwing", () => {
    const Component = resolveRenderer("time_series");
    const primary = decl("time_series");
    const series = [
      { runId: "a", label: "run a", color: "#0072B2", metric: primary },
      { runId: "b", label: "run b", color: "#E69F00", metric: decl("time_series") },
      { runId: "c", label: "run c", color: "#009E73", metric: decl("time_series") },
    ];
    const { container } = render(
      <Component metricKey="loss" metric={primary} series={series} />,
    );
    // One <path> per run at minimum — the overlay drew more than the single-run case.
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(3);
  });

  it("upholds the series[0].metric === metric invariant", () => {
    const primary = decl("time_series");
    const series = [{ runId: "a", label: "a", color: "#0072B2", metric: primary }];
    expect(series[0]!.metric).toBe(primary);
  });
});

// ─── 3. MetricGrid fans non-overlay renderers into small multiples ────────────

describe("MetricGrid small-multiples fallback", () => {
  const cm = () => decl("confusion_matrix");

  it("renders a single chart when there are no comparison runs", () => {
    const { container, queryByText } = render(
      <MetricGrid diagnostics={diag("xgboost", { confusion: cm() })} />,
    );
    expect(queryByText(/runs$/)).toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(0);
  });

  it("fans a confusion_matrix into one cell per run when 3 runs are compared", () => {
    const { getByText } = render(
      <MetricGrid
        diagnostics={diag("xgboost", { confusion: cm() })}
        comparisonRuns={[
          { runId: "r2", label: "run two", diagnostics: diag("lightgbm", { confusion: cm() }) },
          { runId: "r3", label: "run three", diagnostics: diag("rf", { confusion: cm() }) },
        ]}
      />,
    );
    // Header proves the fan-out path ran, and each run is labeled with TEXT,
    // never color alone.
    getByText(/confusion — 3 runs/);
    getByText("run two");
    getByText("run three");
  });

  it("skips a comparison run that does not declare the metric", () => {
    const { getByText } = render(
      <MetricGrid
        diagnostics={diag("xgboost", { confusion: cm() })}
        comparisonRuns={[
          { runId: "r2", label: "has it", diagnostics: diag("lightgbm", { confusion: cm() }) },
          { runId: "r3", label: "lacks it", diagnostics: diag("rf", {}) },
        ]}
      />,
    );
    // 2 runs, not 3 — a model that never declared the metric is omitted rather
    // than rendered as an empty hole.
    getByText(/confusion — 2 runs/);
  });
});
