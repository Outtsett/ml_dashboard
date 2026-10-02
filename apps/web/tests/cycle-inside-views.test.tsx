// @vitest-environment jsdom
/**
 * The Inside-the-model views for linear, neighbors, naive Bayes, support
 * vectors, calibration and stacking models (`apps/web/src/cycle/inside/`).
 *
 * Every fixture in `tests/fixtures/cycle_explain_client_views/` is a
 * schema-valid {manifest, structure, bar} made internally consistent (raw =
 * base + Σ contributions, P(up) = link(raw)), so each view must land on the
 * fixture's own `bar.output.raw` / `probabilityUp` from what it draws, and its
 * control must change what is shown.
 */
import "./setup";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalibrationView, readCalibrationMap } from "../src/cycle/inside/calibration/CalibrationView";
import { LinearView } from "../src/cycle/inside/linear/LinearView";
import { applyLink, formatSigned, standardNormalCumulative } from "../src/cycle/inside/linear/link";
import { orderTerms, waterfallTotal } from "../src/cycle/inside/linear/Waterfall";
import { logLikelihoodRatio } from "../src/cycle/inside/naiveBayes/BellCurves";
import { NaiveBayesView } from "../src/cycle/inside/naiveBayes/NaiveBayesView";
import { NeighborsView } from "../src/cycle/inside/neighbors/NeighborsView";
import { neighborVote, sortedNeighbors } from "../src/cycle/inside/neighbors/vote";
import { StackingView } from "../src/cycle/inside/stacking/StackingView";
import { SupportVectorsView, supportVectorTerms } from "../src/cycle/inside/supportVectors/SupportVectorsView";
import type { InsideKindViewProps } from "../src/cycle/inside/types";
import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  type CycleExplainBar,
  type CycleExplainManifest,
  type CycleExplainStructure,
} from "@shared/cycle/explain";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/cycle_explain_client_views");
const INSIDE = path.resolve(__dirname, "../src/cycle/inside");
const OWNED_FOLDERS = ["linear", "neighbors", "naiveBayes", "supportVectors", "calibration", "stacking"];

interface Fixture {
  manifest: CycleExplainManifest;
  structure: CycleExplainStructure;
  bar: CycleExplainBar;
}

function load(name: string): Fixture {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf-8")) as Fixture;
  return {
    manifest: cycleExplainManifestSchema.parse(raw.manifest),
    structure: cycleExplainStructureSchema.parse(raw.structure),
    bar: cycleExplainBarSchema.parse(raw.bar),
  };
}

function props(fixture: Fixture): InsideKindViewProps {
  return {
    manifest: fixture.manifest,
    structure: fixture.structure,
    bar: fixture.bar,
    role: fixture.bar.role,
    featureNames: fixture.manifest.featureDisplayNames,
  };
}

function numberOf(testId: string): number {
  const element = screen.getByTestId(testId);
  return Number(element.getAttribute("data-value"));
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

// ─── fixtures ───────────────────────────────────────────────────────────────

describe("fixtures", () => {
  const names = readdirSync(FIXTURES)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));

  it("has one fixture per view kind at least", () => {
    for (const kind of ["linear", "neighbors", "naive_bayes", "support_vectors", "calibration", "stacking"]) {
      expect(names.some((name) => load(name).structure.explainKind === kind)).toBe(true);
    }
  });

  it.each(names)("%s is schema-valid and internally consistent", (name) => {
    const fixture = load(name);
    expect(fixture.bar.explainKind).toBe(fixture.structure.explainKind);
    expect(fixture.bar.link).toBe(fixture.structure.link);
    if (fixture.bar.contributions) {
      const sum = fixture.bar.contributions.values.reduce((total, value) => total + value, fixture.bar.contributions.base);
      expect(sum).toBeCloseTo(fixture.bar.output.raw, 12);
    }
    const probability = applyLink(fixture.bar.link, fixture.bar.output.raw, fixture.structure.logisticCurve);
    if (probability !== null) expect(probability).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 12);
  });
});

// ─── shared arithmetic ──────────────────────────────────────────────────────

describe("link arithmetic", () => {
  it("probit matches the standard normal cumulative distribution to 1e-12", () => {
    // Reference values: scipy.stats.norm.cdf.
    expect(standardNormalCumulative(0)).toBe(0.5);
    expect(standardNormalCumulative(1)).toBeCloseTo(0.8413447460685429, 12);
    expect(standardNormalCumulative(-1.96)).toBeCloseTo(0.024997895148220435, 12);
    expect(standardNormalCumulative(3.5)).toBeCloseTo(0.9997673709209645, 12);
  });

  it("the identity link has no probability", () => {
    expect(applyLink("identity", 1.2, null)).toBeNull();
  });

  it("signed numbers always carry their sign", () => {
    expect(formatSigned(0.5, 2)).toBe("+0.50");
    expect(formatSigned(-0.5, 2)).toBe("−0.50");
    expect(formatSigned(0, 2)).toBe("0.00");
  });

  it("ordering the waterfall never changes its total", () => {
    const terms = [0.3, -1.2, 0.05, 0.8].map((value, index) => ({ key: String(index), label: `f${index}`, value, detail: "" }));
    const sorted = orderTerms(terms, "magnitude");
    expect(sorted.map((term) => term.key)).toEqual(["1", "3", "0", "2"]);
    expect(waterfallTotal({ label: "b", value: 0.1, detail: "" }, sorted)).toBeCloseTo(0.05, 12);
  });
});

// ─── linear ─────────────────────────────────────────────────────────────────

describe("LinearView", () => {
  it.each(["linear_logistic", "linear_probit", "linear_logistic_curve"])("%s: the sum is the raw output and the link gives P(up)", (name) => {
    const fixture = load(name);
    render(<LinearView {...props(fixture)} />);
    expect(screen.getByTestId("inside-linear-view")).toBeInTheDocument();
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 10);
    expect(screen.getByTestId("inside-link-curve")).toHaveAttribute("data-link", fixture.bar.link);
    // The intercept is drawn first, then one row per feature, each named in full.
    expect(screen.getByTestId("waterfall-base")).toHaveTextContent("Intercept");
    expect(screen.getAllByTestId("waterfall-term")).toHaveLength(fixture.manifest.featureNames.length);
    for (const name of fixture.manifest.featureDisplayNames) expect(screen.getByTestId("waterfall")).toHaveTextContent(name);
  });

  it("stepping adds one feature at a time onto the intercept", () => {
    const fixture = load("linear_logistic");
    render(<LinearView {...props(fixture)} />);
    const running = () => Number(screen.getByTestId("waterfall-running").getAttribute("data-value"));
    const step = () => Number(screen.getByTestId("waterfall-running").getAttribute("data-step"));
    expect(step()).toBe(6);
    expect(running()).toBeCloseTo(fixture.bar.output.raw, 10);

    click("Reset to only the constant");
    expect(step()).toBe(0);
    expect(running()).toBeCloseTo(fixture.bar.contributions?.base ?? Number.NaN, 12);
    expect(screen.getByTestId("inside-link-running")).toBeInTheDocument();

    click("Add the next feature");
    const largest = [...(fixture.bar.contributions?.values ?? [])].sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? 0;
    expect(step()).toBe(1);
    expect(running()).toBeCloseTo((fixture.bar.contributions?.base ?? 0) + largest, 12);
    expect(screen.getAllByTestId("waterfall-term").filter((row) => row.getAttribute("data-added") === "true")).toHaveLength(1);

    click("Take back the last feature");
    expect(step()).toBe(0);
  });

  it("play adds the features on a timer and stops at the last one", () => {
    vi.useFakeTimers();
    const fixture = load("linear_logistic");
    render(<LinearView {...props(fixture)} />);
    click("Reset to only the constant");
    click("Play: add one feature at a time");
    act(() => {
      vi.advanceTimersByTime(700 * 3);
    });
    expect(screen.getByTestId("waterfall-running")).toHaveAttribute("data-step", "3");
    act(() => {
      vi.advanceTimersByTime(700 * 10);
    });
    expect(screen.getByTestId("waterfall-running")).toHaveAttribute("data-step", "6");
    expect(screen.getByRole("button", { name: /^Play/ })).toBeInTheDocument();
  });

  it("the sort toggle reorders the rows and keeps the sum", () => {
    const fixture = load("linear_logistic");
    render(<LinearView {...props(fixture)} />);
    const order = () => screen.getAllByTestId("waterfall-term").map((row) => row.getAttribute("data-term"));
    const sorted = order();
    click("Show in feature order");
    expect(order()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(order()).not.toEqual(sorted);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
  });

  it("hovering a row reads out its weight × input", () => {
    const fixture = load("linear_logistic");
    render(<LinearView {...props(fixture)} />);
    const row = screen.getAllByTestId("waterfall-term").find((element) => element.getAttribute("data-term") === "0");
    expect(row).toBeDefined();
    fireEvent.mouseEnter(row as HTMLElement);
    const weight = fixture.structure.linear?.coefficients[0] ?? 0;
    expect(screen.getByTestId("inside-hover-readout")).toHaveTextContent(`weight ${formatSigned(weight, 4)}`);
    expect(screen.getByTestId("inside-hover-readout")).toHaveTextContent(fixture.manifest.featureDisplayNames[0] ?? "");
  });

  it("a price model ends on the move in points, not a probability", () => {
    const fixture = load("linear_price");
    render(<LinearView {...props(fixture)} />);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-price-move")).toBeCloseTo(fixture.bar.output.movePoints ?? Number.NaN, 8);
    expect(screen.queryByTestId("inside-probability")).toBeNull();
  });
});

// ─── neighbors ──────────────────────────────────────────────────────────────

describe("NeighborsView", () => {
  it("at the model's k the vote is P(up), and the slider changes the vote", () => {
    const fixture = load("neighbors");
    render(<NeighborsView {...props(fixture)} />);
    const k = fixture.structure.neighbors?.neighborCount ?? 0;
    expect(screen.getByTestId("inside-neighbors-counted")).toHaveTextContent(String(k));
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 12);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 12);
    expect(numberOf("inside-neighbors-vote")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 12);
    const markers = screen.getAllByTestId("inside-neighbor-marker");
    expect(markers).toHaveLength(fixture.bar.neighbors?.timestamps.length ?? 0);
    expect(markers.filter((marker) => marker.getAttribute("data-counted") === "true")).toHaveLength(k);

    fireEvent.change(screen.getByRole("slider", { name: "Neighbors counted" }), { target: { value: "1" } });
    const closest = sortedNeighbors(fixture.bar.neighbors as NonNullable<CycleExplainBar["neighbors"]>)[0];
    expect(numberOf("inside-neighbors-vote")).toBe(closest?.target);
    expect(screen.getAllByTestId("inside-neighbor-marker").filter((marker) => marker.getAttribute("data-counted") === "true")).toHaveLength(1);
    // The model's own answer does not move with the slider.
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 12);

    click(`Back to the model's ${k}`);
    expect(screen.getByTestId("inside-neighbors-counted")).toHaveTextContent(String(k));
  });

  it("hovering a neighbor reads out its distance, weight and outcome", () => {
    const fixture = load("neighbors");
    render(<NeighborsView {...props(fixture)} />);
    const first = screen.getAllByTestId("inside-neighbor-marker")[0] as Element;
    fireEvent.mouseEnter(first);
    expect(screen.getByTestId("inside-hover-readout")).toHaveTextContent(/#1 .*distance .*vote weight .*went (up ▲|down ▼)/);
  });

  it("the vote is the weighted share of the counted neighbors", () => {
    const neighbors = [
      { timestamp: 1, distance: 0.5, target: 1, weight: 2 },
      { timestamp: 2, distance: 1.0, target: 0, weight: 1 },
    ];
    expect(neighborVote(neighbors, 1)).toBe(1);
    expect(neighborVote(neighbors, 2)).toBeCloseTo(2 / 3, 12);
    expect(neighborVote(neighbors, 0)).toBeNull();
  });
});

// ─── naive Bayes ────────────────────────────────────────────────────────────

describe("NaiveBayesView", () => {
  it("prior + Σ evidence = the raw output, and P(up) is its S-curve", () => {
    const fixture = load("naive_bayes");
    render(<NaiveBayesView {...props(fixture)} />);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 10);
    expect(screen.getByTestId("waterfall-base")).toHaveTextContent("Prior");
    expect(screen.getByTestId("bell-curve-up")).toBeInTheDocument();
    expect(screen.getByTestId("bell-curve-down")).toBeInTheDocument();
    expect(screen.getByTestId("inside-bell-curves")).toHaveTextContent("Up bars (orange, solid)");
  });

  it("every feature's evidence is ln(up height ÷ down height) of the fitted bell curves", () => {
    const fixture = load("naive_bayes");
    const model = fixture.structure.naiveBayes;
    expect(model).not.toBeNull();
    fixture.bar.contributions?.values.forEach((value, index) => {
      const ratio = logLikelihoodRatio(fixture.bar.inputs.values[index] ?? Number.NaN, model?.means[index] ?? [0, 0], model?.variances[index] ?? [1, 1]);
      expect(ratio).toBeCloseTo(value, 10);
    });
  });

  it("stepping moves the bell curves to the feature just added; the picker overrides it", () => {
    const fixture = load("naive_bayes");
    render(<NaiveBayesView {...props(fixture)} />);
    click("Reset to only the constant");
    click("Add the next feature");
    const firstAdded = screen.getAllByTestId("waterfall-term").find((row) => row.getAttribute("data-added") === "true");
    const firstName = fixture.manifest.featureDisplayNames[Number(firstAdded?.getAttribute("data-term"))];
    expect(screen.getByTestId("inside-bell-curves")).toHaveAttribute("data-feature", firstName);
    click("Add the next feature");
    const added = screen.getAllByTestId("waterfall-term").filter((row) => row.getAttribute("data-added") === "true");
    const secondName = fixture.manifest.featureDisplayNames[Number(added[1]?.getAttribute("data-term"))];
    expect(screen.getByTestId("inside-bell-curves")).toHaveAttribute("data-feature", secondName);
    expect(secondName).not.toBe(firstName);

    fireEvent.change(screen.getByRole("combobox", { name: "Feature whose bell curves are shown" }), { target: { value: "5" } });
    expect(screen.getByTestId("inside-bell-curves")).toHaveAttribute("data-feature", fixture.manifest.featureDisplayNames[5]);
    expect(Number(screen.getByTestId("waterfall-running").getAttribute("data-value"))).toBeCloseTo(
      (fixture.bar.contributions?.base ?? 0) + added.reduce((sum, row) => sum + (fixture.bar.contributions?.values[Number(row.getAttribute("data-term"))] ?? 0), 0),
      12,
    );
  });
});

// ─── support vectors ────────────────────────────────────────────────────────

describe("SupportVectorsView", () => {
  it("intercept + listed + everything else = the decision value, then the validation curve gives P(up)", () => {
    const fixture = load("support_vectors");
    render(<SupportVectorsView {...props(fixture)} />);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.supportVectors?.decisionValue ?? Number.NaN, 10);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 10);
    const listed = fixture.bar.supportVectors?.timestamps.length ?? 0;
    expect(screen.getAllByTestId("waterfall-term")).toHaveLength(listed + 1);
    expect(screen.getByTestId("waterfall")).toHaveTextContent(/Everything else \(the other [\d,]+ support vectors\)/);
  });

  it("the slider folds support vectors into 'everything else' without changing the sum", () => {
    const fixture = load("support_vectors");
    render(<SupportVectorsView {...props(fixture)} />);
    fireEvent.change(screen.getByRole("slider", { name: "Support vectors listed one by one" }), { target: { value: "2" } });
    expect(screen.getByTestId("inside-support-vectors-shown")).toHaveTextContent("2 of 6");
    expect(screen.getAllByTestId("waterfall-term")).toHaveLength(3);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 10);
    const { terms } = supportVectorTerms(props(fixture), 0);
    expect(terms).toHaveLength(1);
  });
});

// ─── calibration ────────────────────────────────────────────────────────────

describe("CalibrationView", () => {
  it("shows the map, this bar's point and its P(up); the toggle hides how far calibration moved it", () => {
    const fixture = load("calibration");
    render(<CalibrationView {...props(fixture)} />);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 12);
    expect(screen.getByTestId("inside-calibration-map")).toBeInTheDocument();
    expect(screen.getByTestId("inside-calibration-reference")).toBeInTheDocument();
    expect(screen.getByTestId("inside-calibration-move")).toBeInTheDocument();
    expect(screen.getByTestId("inside-calibration-view")).toHaveTextContent(/moved it (▲ up|▼ down) by [\d.]+ percentage points/);
    click("Hide how far calibration moved it");
    expect(screen.queryByTestId("inside-calibration-move")).toBeNull();
    click("Show how far calibration moved it");
    expect(screen.getByTestId("inside-calibration-move")).toBeInTheDocument();
  });

  it("the probe slider reads the map at any score", () => {
    const fixture = load("calibration");
    render(<CalibrationView {...props(fixture)} />);
    const curve = fixture.structure.calibration?.curve ?? { baseScore: [], probabilityUp: [] };
    const atBar = numberOf("inside-calibration-probe");
    expect(atBar).toBeCloseTo(fixture.bar.calibration?.probabilityUp ?? Number.NaN, 3);
    fireEvent.change(screen.getByRole("slider", { name: "Read the calibration map at a base score" }), { target: { value: "0.2" } });
    expect(numberOf("inside-calibration-probe")).toBeCloseTo(readCalibrationMap(curve, 0.2) ?? Number.NaN, 12);
    expect(numberOf("inside-calibration-probe")).not.toBeCloseTo(atBar, 3);
  });

  it("reads the map by straight lines between samples, flat beyond the ends", () => {
    const curve = { baseScore: [0, 1], probabilityUp: [0.2, 0.6] };
    expect(readCalibrationMap(curve, 0.5)).toBeCloseTo(0.4, 12);
    expect(readCalibrationMap(curve, -1)).toBe(0.2);
    expect(readCalibrationMap(curve, 2)).toBe(0.6);
  });
});

// ─── stacking ───────────────────────────────────────────────────────────────

describe("StackingView", () => {
  it("intercept + Σ weight × answer = the raw output; the S-curve gives P(up)", () => {
    const fixture = load("stacking");
    render(<StackingView {...props(fixture)} />);
    expect(numberOf("inside-sum")).toBeCloseTo(fixture.bar.output.raw, 10);
    expect(numberOf("inside-probability")).toBeCloseTo(fixture.bar.output.probabilityUp ?? Number.NaN, 10);
    const answers = screen.getByTestId("inside-stacking-answers");
    expect(within(answers).getByText("Gradient boosting")).toBeInTheDocument();
    expect(screen.getAllByTestId("waterfall-term")).toHaveLength(3);
  });

  it("stepping adds one base model at a time", () => {
    const fixture = load("stacking");
    render(<StackingView {...props(fixture)} />);
    click("Reset to only the constant");
    expect(Number(screen.getByTestId("waterfall-running").getAttribute("data-value"))).toBeCloseTo(fixture.structure.stacking?.metaIntercept ?? Number.NaN, 12);
    click("Add the next base model");
    expect(Number(screen.getByTestId("waterfall-running").getAttribute("data-value"))).toBeCloseTo(
      (fixture.structure.stacking?.metaIntercept ?? 0) + (fixture.bar.stacking?.metaContributions[0] ?? 0),
      12,
    );
    expect(screen.getByTestId("waterfall-running")).toHaveTextContent("Logistic regression");
  });
});

// ─── colours ────────────────────────────────────────────────────────────────

describe("colours", () => {
  const OKABE_ITO = new Set(["#E69F00", "#0072B2", "#56B4E9", "#D55E00", "#F0E442", "#009E73", "#CC79A7", "#000000", "#B8BEC8"]);

  function filesUnder(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const full = path.join(directory, entry);
      return statSync(full).isDirectory() ? filesUnder(full) : [full];
    });
  }

  it("only Okabe-Ito hex values appear under the six view folders", () => {
    const offenders: string[] = [];
    for (const folder of OWNED_FOLDERS) {
      for (const file of filesUnder(path.join(INSIDE, folder))) {
        const text = readFileSync(file, "utf-8");
        for (const match of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
          if (!OKABE_ITO.has(match[0].toUpperCase())) offenders.push(`${path.relative(INSIDE, file)}: ${match[0]}`);
        }
        expect(text).not.toMatch(/\b(text|bg|border|fill|stroke)-(red|green|emerald|lime|rose)-\d/);
      }
    }
    expect(offenders).toEqual([]);
  });
});
