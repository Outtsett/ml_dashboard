/**
 * Inside the model — tree ensembles (XGBoost, LightGBM, random forest, extra
 * trees, gradient boosting, a single decision tree).
 *
 * Every used tree as a small path glyph (which way the bar went at each
 * question, the leaf as a dot sized by how hard it pushes, orange ▲ up / blue ▼
 * down); hover one for its path in words, click it for the whole tree with the
 * path in bold. A sort control orders the grid by tree order or by the biggest
 * push; the step / play / scrub control adds trees one at a time while the
 * running total (boosting) or the vote histogram (forests) builds up to the
 * model's own output. Contract: `../types.ts`.
 */
import { useEffect, useRef, useState } from "react";

import type { CycleExplainTree } from "@shared/cycle/explain";

import { cn } from "@/shared/utils/utils";

import type { InsideKindViewProps } from "../types";
import { Aggregation, TreeStepper, useTreeStepper } from "./Aggregation";
import { TreeDiagram } from "./TreeDiagram";
import { TreePathGlyph } from "./TreePathGlyph";
import { leafCenter, leafPush, pathInWords, pathNodeSet, pathSteps, sortTreeIndices, usedTreeTotal, type TreeSortMode } from "./treeTypes";

const SORT_LABELS: Record<TreeSortMode, string> = {
  tree_order: "Tree order",
  biggest_push: "Biggest push first",
};

type LoadState = { status: "idle" } | { status: "loading"; treeIndex: number } | { status: "ready"; tree: CycleExplainTree } | { status: "error"; treeIndex: number; message: string };

/** Fetch the opened tree through the shell's `loadTree`, held in a ref so a new function identity per render does not refetch. */
export function useOpenedTree(openTree: number | null, loadTree: InsideKindViewProps["loadTree"], cacheKey: string): LoadState {
  const loadRef = useRef(loadTree);
  loadRef.current = loadTree;
  const [state, setState] = useState<LoadState>({ status: "idle" });
  useEffect(() => {
    if (openTree === null) {
      setState({ status: "idle" });
      return;
    }
    const load = loadRef.current;
    if (!load) {
      setState({ status: "error", treeIndex: openTree, message: "Whole trees cannot be loaded here." });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", treeIndex: openTree });
    load(openTree).then(
      (tree) => {
        if (!cancelled) setState({ status: "ready", tree });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", treeIndex: openTree, message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [openTree, cacheKey]);
  return state;
}

export function TreesView({ structure, bar, role, featureNames, loadTree }: InsideKindViewProps) {
  const trees = bar.trees;
  const total = usedTreeTotal(trees);
  const stepper = useTreeStepper(total);
  const [sortMode, setSortMode] = useState<TreeSortMode>("tree_order");
  const [hovered, setHovered] = useState<number | null>(null);
  const [openTree, setOpenTree] = useState<number | null>(null);
  const opened = useOpenedTree(openTree, loadTree, `${bar.modelId}:${bar.foldIndex}:${role}`);

  if (!trees || !structure.trees) {
    return <p className="text-xs text-neutral-400">The explainer returned no tree paths for this bar.</p>;
  }

  const rule = structure.trees.splitRule;
  const center = leafCenter(structure);
  const order = sortTreeIndices(trees.leafValues, center, sortMode);
  const maxAbsPush = Math.max(0, ...trees.leafValues.map((value) => Math.abs(leafPush(value, center))));
  const values = bar.inputs.values;
  const focusTree = hovered ?? (stepper.step > 0 ? stepper.step - 1 : null);
  const focusText = focusTree === null ? null : pathInWords(trees, focusTree, featureNames, values, rule, center);
  const mean = structure.trees.aggregation === "mean";

  return (
    <section className="flex min-w-[280px] flex-[2] flex-col gap-2" aria-label="Inside the trees" data-testid="trees-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-neutral-200">
          {total} {mean ? "trees vote" : "trees add up"}
          {structure.trees.treeCount > total && <span className="font-normal text-neutral-500"> (of {structure.trees.treeCount}; the rest come after the best round and are not used)</span>}
        </h3>
        <label className="flex items-center gap-1 text-[11px] text-neutral-400">
          Order
          <select
            aria-label="Order the trees"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as TreeSortMode)}
            className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-200"
          >
            {(Object.keys(SORT_LABELS) as TreeSortMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">
        Each tree asks this bar a few yes/no questions (a step left for yes, right for no) and lands on a leaf. Hover a tree for its questions; click it to see the whole tree.
      </p>

      <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto pr-1" data-testid="tree-grid" onPointerLeave={() => setHovered(null)}>
        {order.map((treeIndex) => {
          const leaf = trees.leafValues[treeIndex] ?? 0;
          return (
            <TreePathGlyph
              key={treeIndex}
              treeIndex={treeIndex}
              answers={pathSteps(trees, treeIndex).map((step) => step.wentYes)}
              leafValue={leaf}
              push={leafPush(leaf, center)}
              maxAbsPush={maxAbsPush}
              included={treeIndex < stepper.step}
              current={treeIndex === stepper.step - 1}
              selected={treeIndex === openTree}
              pathText={pathInWords(trees, treeIndex, featureNames, values, rule, center).join("\n")}
              onHover={setHovered}
              onOpen={(index) => setOpenTree((current) => (current === index ? null : index))}
            />
          );
        })}
      </div>

      <div className="min-h-[3.5rem] rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5" data-testid="tree-path-readout">
        {focusText === null ? (
          <p className="text-[11px] text-neutral-500">Hover a tree, or step forward, to read its questions.</p>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-widest text-neutral-500">Tree {focusTree! + 1}</div>
            <ol className="font-mono text-[11px] text-neutral-300">
              {focusText.map((line, index) => (
                <li key={`${index}-${line}`} className={cn(index === focusText.length - 1 && "font-semibold text-neutral-100")}>
                  {line}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <TreeStepper stepper={stepper} />
      <Aggregation bar={bar} structure={structure} role={role} step={stepper.step} onStep={stepper.setStep} />

      {openTree !== null && (
        <div className="flex flex-col gap-1.5 rounded-md border border-[#CC79A7]/40 p-2" data-testid="tree-open">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200">Tree {openTree + 1}, whole</span>
            <button type="button" onClick={() => setOpenTree(null)} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/[0.06]">
              Close
            </button>
          </div>
          {opened.status === "loading" && <p className="text-[11px] text-neutral-400">Loading tree {openTree + 1}…</p>}
          {opened.status === "error" && <p className="text-[11px] text-[#D55E00]">{opened.message}</p>}
          {opened.status === "ready" && opened.tree.treeIndex === openTree && (
            <TreeDiagram
              tree={opened.tree}
              featureNames={featureNames}
              inputValues={values}
              pathNodes={pathNodeSet(trees, openTree)}
              pathText={pathInWords(trees, openTree, featureNames, values, rule, center)}
              center={center}
            />
          )}
        </div>
      )}
    </section>
  );
}
