// @vitest-environment jsdom
/**
 * Inside the model — the tree views (`apps/web/src/cycle/inside/trees/`)
 * against the fixtures in `tests/fixtures/cycle_explain_client/` (every file
 * parsed with the `@shared/cycle/explain` schemas first): the pure helpers
 * (paths in words, the running total, sorting, CatBoost leaf spelling), the
 * grid of path glyphs, the step / play / scrub control whose last value must
 * equal the fixture's `output.raw`, the sort control, the whole-tree view, and
 * the rule that every hex colour in the owned `inside/` sources is Okabe-Ito.
 */
import "./setup";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  cycleExplainTreeSchema,
  type CycleExplainBar,
  type CycleExplainManifest,
  type CycleExplainStructure,
  type CycleExplainTree,
} from "@shared/cycle/explain";
import { ObliviousTreesView } from "../src/cycle/inside/trees/ObliviousTreesView";
import { TreesView } from "../src/cycle/inside/trees/TreesView";
import { TreeDiagram } from "../src/cycle/inside/trees/TreeDiagram";
import { Aggregation } from "../src/cycle/inside/trees/Aggregation";
import {
  aggregationAt,
  buildTreeNodes,
  pathInWords,
  pathNodeSet,
  pathSteps,
  questionText,
  sortTreeIndices,
  spellObliviousLeaf,
  splitCountsFromPaths,
  leafCenter,
} from "../src/cycle/inside/trees/treeTypes";
import { linkProbability, standardNormalCumulative } from "../src/cycle/inside/OutputChain";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/cycle_explain_client");
const INSIDE = path.resolve(__dirname, "../src/cycle/inside");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf-8"));
}
const manifest = (name: string): CycleExplainManifest => cycleExplainManifestSchema.parse(fixture(name));
const structure = (name: string): CycleExplainStructure => cycleExplainStructureSchema.parse(fixture(name));
const bar = (name: string): CycleExplainBar => cycleExplainBarSchema.parse(fixture(name));
const tree = (name: string): CycleExplainTree => cycleExplainTreeSchema.parse(fixture(name));

const XGBOOST = { manifest: manifest("manifest_xgboost.json"), structure: structure("structure_xgboost.json"), bar: bar("bar_xgboost.json") };
const PRICE = { structure: structure("structure_xgboost_price.json"), bar: bar("bar_xgboost_price.json") };
const FOREST = { manifest: manifest("manifest_no_price.json"), structure: structure("structure_forest.json"), bar: bar("bar_forest.json") };
const CATBOOST = { manifest: manifest("manifest_catboost.json"), structure: structure("structure_catboost.json"), bar: bar("bar_catboost.json") };
const NAMES = XGBOOST.manifest.featureDisplayNames;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("fixtures", () => {
  it("every fixture file parses with its explain schema", () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const name of files) {
      const schema = name.startsWith("manifest")
        ? cycleExplainManifestSchema
        : name.startsWith("structure")
          ? cycleExplainStructureSchema
          : name.startsWith("tree")
            ? cycleExplainTreeSchema
            : cycleExplainBarSchema;
      const result = schema.safeParse(fixture(name));
      expect(result.success, `${name}: ${result.success ? "" : result.error.message}`).toBe(true);
    }
  });

  it("the fixtures keep the contract's own promise: the last running total is the raw output, and the link gives P(up)", () => {
    for (const { bar: b } of [XGBOOST, FOREST, CATBOOST, PRICE]) {
      expect(b.trees!.runningTotal.at(-1)).toBe(b.output.raw);
    }
    expect(linkProbability("logistic", XGBOOST.bar.output.raw, XGBOOST.structure)).toBeCloseTo(XGBOOST.bar.output.probabilityUp!, 12);
    expect(linkProbability("mean_probability", FOREST.bar.output.raw, FOREST.structure)).toBe(FOREST.bar.output.probabilityUp);
  });
});

describe("tree helpers", () => {
  it("reads each tree's path and writes its questions in words", () => {
    const trees = XGBOOST.bar.trees!;
    expect(pathSteps(trees, 0)).toEqual([
      { node: 0, feature: 0, threshold: 0.5, wentYes: false },
      { node: 2, feature: 2, threshold: 0.9, wentYes: false },
    ]);
    expect(questionText(pathSteps(trees, 0)[0]!, NAMES, XGBOOST.bar.inputs.values, "less_than")).toBe("Relative strength index 14 = 0.8 < 0.5? no →");
    expect(questionText(pathSteps(trees, 1)[0]!, NAMES, XGBOOST.bar.inputs.values, "less_than")).toBe("Log return over 1 bar = -0.3 < 0.1? yes →");
    expect(questionText(pathSteps(trees, 1)[0]!, NAMES, [null, null, null, null], "less_or_equal")).toBe('Log return over 1 bar is missing, so it goes the "yes" way →');
    const words = pathInWords(trees, 0, NAMES, XGBOOST.bar.inputs.values, "less_than", 0);
    expect(words.at(-1)).toBe("leaf +0.12 ▲ pushes up");
    expect([...pathNodeSet(trees, 0)].sort()).toEqual([0, 2, 6]);
    expect(splitCountsFromPaths(trees, 4)).toEqual([2, 2, 1, 1]);
  });

  it("the running total starts at the base value and ends at the model's raw output", () => {
    expect(aggregationAt(XGBOOST.bar, XGBOOST.structure, 0)).toMatchObject({ treesIncluded: 0, value: -0.02, leafSum: 0 });
    expect(aggregationAt(XGBOOST.bar, XGBOOST.structure, 1).value).toBeCloseTo(0.1, 12);
    const last = aggregationAt(XGBOOST.bar, XGBOOST.structure, 99);
    expect(last.treesIncluded).toBe(3);
    expect(last.value).toBe(XGBOOST.bar.output.raw);
    expect(last.probabilityUp).toBeCloseTo(XGBOOST.bar.output.probabilityUp!, 12);
    // A forest is a mean: no trees = no answer yet, all trees = the output.
    expect(aggregationAt(FOREST.bar, FOREST.structure, 0).value).toBeNull();
    expect(aggregationAt(FOREST.bar, FOREST.structure, 3).value).toBe(FOREST.bar.output.raw);
    expect(aggregationAt(CATBOOST.bar, CATBOOST.structure, 2).value).toBe(CATBOOST.bar.output.raw);
    // A price model has no link to P(up).
    expect(aggregationAt(PRICE.bar, PRICE.structure, 2)).toMatchObject({ value: PRICE.bar.output.raw, probabilityUp: null });
  });

  it("sorts by the biggest push, measured from one half for a forest's votes", () => {
    expect(sortTreeIndices(XGBOOST.bar.trees!.leafValues, 0, "tree_order")).toEqual([0, 1, 2]);
    expect(sortTreeIndices(XGBOOST.bar.trees!.leafValues, 0, "biggest_push")).toEqual([0, 2, 1]);
    expect(leafCenter(FOREST.structure)).toBe(0.5);
    expect(sortTreeIndices(FOREST.bar.trees!.leafValues, 0.5, "biggest_push")).toEqual([2, 0, 1]);
  });

  it("spells a symmetric tree's leaf number in the bit order that reproduces the library's index", () => {
    expect(spellObliviousLeaf([true, false], 1)).toEqual({ bits: "01", order: "first_level_lowest", index: 1 });
    expect(spellObliviousLeaf([true, false], 2)).toEqual({ bits: "10", order: "first_level_highest", index: 2 });
    expect(spellObliviousLeaf([true, true], 3).bits).toBe("11");
    expect(spellObliviousLeaf([true, false], 0).order).toBeNull();
  });

  it("builds the whole tree from the node columns", () => {
    const root = buildTreeNodes(tree("tree_xgboost_0.json"))!;
    expect(root.index).toBe(0);
    expect(root.children.map((child) => child.index)).toEqual([1, 2]);
    expect(root.children[1]!.children.map((child) => child.value)).toEqual([-0.01, 0.12]);
    expect(root.children[1]!.children[1]!.isLeaf).toBe(true);
    expect(buildTreeNodes(tree("tree_catboost_0.json"))).toBeNull();
  });

  it("the probit link is the normal curve", () => {
    expect(standardNormalCumulative(0)).toBeCloseTo(0.5, 7);
    expect(standardNormalCumulative(1.959963985)).toBeCloseTo(0.975, 6);
    expect(standardNormalCumulative(-1)).toBeCloseTo(0.158655254, 6);
  });
});

function renderTrees(fixtureSet: { structure: CycleExplainStructure; bar: CycleExplainBar }, loadTree = vi.fn(async (index: number) => tree(`tree_xgboost_${index}.json`))) {
  const utils = render(
    <TreesView manifest={XGBOOST.manifest} structure={fixtureSet.structure} bar={fixtureSet.bar} role={fixtureSet.bar.role} featureNames={NAMES} loadTree={loadTree} />,
  );
  return { ...utils, loadTree };
}

const readout = () => screen.getByTestId("aggregation-readout");

describe("TreesView", () => {
  it("draws every used tree as a glyph and starts with all of them counted", () => {
    renderTrees(XGBOOST);
    const glyphs = screen.getAllByTestId("tree-glyph");
    expect(glyphs.map((glyph) => glyph.getAttribute("data-tree-index"))).toEqual(["0", "1", "2"]);
    expect(glyphs[0]!.getAttribute("aria-label")).toBe("Tree 1: leaf +0.12, ▲ pushes up");
    expect(glyphs[1]!.getAttribute("aria-label")).toBe("Tree 2: leaf −0.05, ▼ pushes down");
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("3 of 3 trees");
    expect(Number(readout().getAttribute("data-value"))).toBe(XGBOOST.bar.output.raw);
    expect(screen.getByTestId("aggregation-final").textContent).toContain("✓ the same number");
  });

  it("steps, scrubs and lands on the fixture's output", () => {
    renderTrees(XGBOOST);
    fireEvent.click(screen.getByRole("button", { name: "Back to no trees" }));
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("0 of 3 trees");
    expect(Number(readout().getAttribute("data-value"))).toBe(-0.02);
    expect(screen.getAllByTestId("tree-glyph").every((glyph) => glyph.className.includes("opacity-25"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add one tree" }));
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("1 of 3 trees");
    expect(Number(readout().getAttribute("data-value"))).toBeCloseTo(0.1, 12);
    expect(readout().textContent).toContain("start -0.02 + leaves +0.12 = 0.1");
    expect(screen.getAllByTestId("tree-glyph")[0]!.className).toContain("opacity-100");
    // The path readout follows the tree just added.
    expect(screen.getByTestId("tree-path-readout").textContent).toContain("Relative strength index 14 = 0.8 < 0.5? no →");

    fireEvent.change(screen.getByRole("slider", { name: "Trees counted" }), { target: { value: "3" } });
    expect(Number(readout().getAttribute("data-value"))).toBe(XGBOOST.bar.output.raw);
    expect(readout().textContent).toContain("53.0% chance of up");
  });

  it("plays the trees in one at a time up to the output", () => {
    vi.useFakeTimers();
    renderTrees(XGBOOST);
    fireEvent.click(screen.getByRole("button", { name: "Play: add the trees one at a time" }));
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("0 of 3 trees");
    act(() => {
      vi.advanceTimersByTime(65);
    });
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("1 of 3 trees");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("tree-stepper-count").textContent).toBe("3 of 3 trees");
    expect(Number(readout().getAttribute("data-value"))).toBe(XGBOOST.bar.output.raw);
    expect(screen.getByRole("button", { name: "Play: add the trees one at a time" })).toBeTruthy();
  });

  it("sorts the grid by the biggest push", () => {
    renderTrees(XGBOOST);
    fireEvent.change(screen.getByRole("combobox", { name: "Order the trees" }), { target: { value: "biggest_push" } });
    expect(screen.getAllByTestId("tree-glyph").map((glyph) => glyph.getAttribute("data-tree-index"))).toEqual(["0", "2", "1"]);
  });

  it("hovering a glyph reads its path; clicking opens the whole tree with the path in words", async () => {
    const { loadTree } = renderTrees(XGBOOST);
    const glyph = screen.getAllByTestId("tree-glyph")[0]!;
    fireEvent.pointerEnter(glyph);
    expect(screen.getByTestId("tree-path-readout").textContent).toContain("Volume z-score over 20 bars = 1.2 < 0.9? no →");
    fireEvent.click(glyph);
    expect(loadTree).toHaveBeenCalledWith(0);
    const opened = await screen.findByTestId("tree-diagram");
    const lines = within(opened).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["Relative strength index 14 = 0.8 < 0.5? no →", "Volume z-score over 20 bars = 1.2 < 0.9? no →", "leaf +0.12 ▲ pushes up"]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("tree-open")).toBeNull();
  });

  it("a forest shows the average vote, which is the output", () => {
    renderTrees(FOREST);
    expect(Number(readout().getAttribute("data-value"))).toBe(FOREST.bar.output.raw);
    expect(readout().textContent).toContain("the average vote is 0.6 = 60.0% chance of up");
    expect(screen.getAllByTestId("tree-glyph")[1]!.getAttribute("aria-label")).toBe("Tree 2: leaf +0.4, ▼ pushes down");
  });

  it("a price model's total is in target units and points", () => {
    renderTrees(PRICE);
    expect(Number(readout().getAttribute("data-value"))).toBe(PRICE.bar.output.raw);
    expect(readout().textContent).toContain("× 12.5 = +5 points");
  });
});

describe("ObliviousTreesView", () => {
  it("draws each symmetric tree as its table, spells the leaf, and adds up to the output", async () => {
    const loadTree = vi.fn(async (index: number) => tree(`tree_catboost_${index}.json`));
    render(<ObliviousTreesView manifest={CATBOOST.manifest} structure={CATBOOST.structure} bar={CATBOOST.bar} role="direction" featureNames={NAMES} loadTree={loadTree} />);
    const tables = screen.getAllByTestId("oblivious-tree");
    expect(tables).toHaveLength(2);
    expect(within(tables[0]!).getByTestId("oblivious-leaf").textContent).toContain("Answers spell 01");
    expect(within(tables[0]!).getByTestId("oblivious-leaf").textContent).toContain("= leaf 1");
    expect(within(tables[1]!).getByTestId("oblivious-leaf").textContent).toContain("Answers spell 11");
    expect(within(tables[0]!).getAllByRole("row")[1]!.textContent).toContain("yes = 1");
    expect(within(tables[0]!).getAllByRole("row")[2]!.textContent).toContain("no = 0");
    expect(Number(readout().getAttribute("data-value"))).toBe(CATBOOST.bar.output.raw);

    fireEvent.click(screen.getByRole("button", { name: "Back to no trees" }));
    expect(Number(readout().getAttribute("data-value"))).toBe(0);
    fireEvent.change(screen.getByRole("slider", { name: "Trees counted" }), { target: { value: "2" } });
    expect(Number(readout().getAttribute("data-value"))).toBe(CATBOOST.bar.output.raw);

    fireEvent.click(tables[1]!);
    expect(loadTree).toHaveBeenCalledWith(1);
    const strip = await screen.findByTestId("oblivious-leaf-strip");
    expect(strip.textContent).toContain("All 4 leaves of tree 2");
  });
});

describe("drawn charts (with layout)", () => {
  // jsdom lays nothing out; `Measured` draws only once its box has a size.
  const restore: Array<() => void> = [];
  function giveElementsASize() {
    for (const [property, value] of [["clientWidth", 640], ["clientHeight", 420]] as const) {
      const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
      Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => value });
      restore.push(() => (previous ? Object.defineProperty(HTMLElement.prototype, property, previous) : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property]));
    }
  }
  afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  it("the whole tree draws this bar's path in bold with the value beside each question, the rest faded", () => {
    giveElementsASize();
    const trees = XGBOOST.bar.trees!;
    render(
      <TreeDiagram
        tree={tree("tree_xgboost_0.json")}
        featureNames={NAMES}
        inputValues={XGBOOST.bar.inputs.values}
        pathNodes={pathNodeSet(trees, 0)}
        pathText={pathInWords(trees, 0, NAMES, XGBOOST.bar.inputs.values, "less_than", 0)}
        center={0}
      />,
    );
    const svg = screen.getByRole("img", { name: "Tree 1, this bar's path in bold" });
    const text = svg.textContent ?? "";
    expect(text).toContain("0.8 < 0.5?");
    expect(text).toContain("1.2 < 0.9?");
    expect(text).toContain("▲ +0.12");
    expect(text).toContain("▼ −0.08");
    // Off-path nodes are faded; on-path ones are not.
    const groups = Array.from(svg.querySelectorAll("g[opacity]"));
    expect(groups.some((group) => group.getAttribute("opacity") === "0.25")).toBe(true);
    expect(groups.some((group) => group.getAttribute("opacity") === "1")).toBe(true);
  });

  it("the running-total chart draws the base, the final line and the chance-of-up axis", () => {
    giveElementsASize();
    render(<Aggregation bar={XGBOOST.bar} structure={XGBOOST.structure} role="direction" step={3} onStep={() => {}} />);
    const svg = screen.getByRole("img", { name: "Running total of the trees" });
    expect(svg.textContent).toContain("final 0.12");
    expect(svg.textContent).toContain("50% up");
    expect(svg.textContent).toContain("log-odds");
  });

  it("the vote chart counts the forest's votes", () => {
    giveElementsASize();
    render(<Aggregation bar={FOREST.bar} structure={FOREST.structure} role="direction" step={3} onStep={() => {}} />);
    const svg = screen.getByRole("img", { name: "The trees' votes" });
    expect(svg.textContent).toContain("50%");
  });
});

describe("colours", () => {
  it("every hex colour in the Inside-the-model shell and tree sources is Okabe-Ito", () => {
    const allowed = new Set(["#E69F00", "#0072B2", "#56B4E9", "#D55E00", "#F0E442", "#009E73", "#CC79A7", "#B8BEC8", "#000000"]);
    const files = [
      "InsidePanel.tsx",
      "useExplain.ts",
      "InputsColumn.tsx",
      "OutputChain.tsx",
      ...readdirSync(path.join(INSIDE, "trees")).map((name) => `trees/${name}`),
    ];
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(INSIDE, file), "utf-8");
      for (const match of source.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)) {
        if (!allowed.has(match[0].toUpperCase())) found.push(`${file}: ${match[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});

