/**
 * Inside the model — CatBoost's symmetric ("oblivious") trees. Every level of
 * a tree asks ONE question of every bar, so a tree is a short table: the
 * input, the border, and this bar's yes / no. Read as binary digits, the
 * answers spell the number of the leaf the bar lands in; that leaf's value is
 * what the tree adds. The same step / play / scrub control and running total
 * as the other tree ensembles close the view. Contract: `../types.ts`.
 */
import { useState } from "react";

import type { CycleExplainTree } from "@shared/cycle/explain";

import { cn } from "@/shared/utils/utils";

import { CYCLE_COLORS } from "../../chartModel";
import type { InsideKindViewProps } from "../types";
import { Aggregation, TreeStepper, useTreeStepper } from "./Aggregation";
import { useOpenedTree } from "./TreesView";
import {
  formatSigned,
  formatValue,
  leafCenter,
  leafPush,
  pathSteps,
  pushColor,
  pushGlyph,
  pushWords,
  sortTreeIndices,
  spellObliviousLeaf,
  SPLIT_OPERATOR,
  usedTreeTotal,
  type BarTrees,
  type SplitRule,
  type TreeSortMode,
} from "./treeTypes";

/** Trees drawn as tables before "Show all" (hundreds are common). */
export const OBLIVIOUS_TABLES_SHOWN = 12;

const SORT_LABELS: Record<TreeSortMode, string> = {
  tree_order: "Tree order",
  biggest_push: "Biggest push first",
};

interface TreeTableProps {
  trees: BarTrees;
  treeIndex: number;
  featureNames: string[];
  values: readonly (number | null)[];
  rule: SplitRule;
  center: number;
  included: boolean;
  current: boolean;
  selected: boolean;
  onOpen: (treeIndex: number) => void;
}

function ObliviousTreeTable({ trees, treeIndex, featureNames, values, rule, center, included, current, selected, onOpen }: TreeTableProps) {
  const steps = pathSteps(trees, treeIndex);
  const leafIndex = trees.leafNode[treeIndex] ?? 0;
  const leafValue = trees.leafValues[treeIndex] ?? 0;
  const push = leafPush(leafValue, center);
  const spelled = spellObliviousLeaf(
    steps.map((step) => step.wentYes),
    leafIndex,
  );
  const color = pushColor(push);
  return (
    <button
      type="button"
      data-testid="oblivious-tree"
      data-tree-index={treeIndex}
      onClick={() => onOpen(treeIndex)}
      title={`Tree ${treeIndex + 1}: leaf ${leafIndex}, value ${leafValue}. Click to see all of its leaves.`}
      className={cn(
        "flex min-w-[220px] flex-1 flex-col gap-1 rounded-md border p-1.5 text-left transition-opacity",
        selected ? "border-[#CC79A7]" : current ? "border-white/60" : "border-white/10 hover:border-white/40",
        included ? "opacity-100" : "opacity-40",
      )}
    >
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-neutral-200">Tree {treeIndex + 1}</span>
        <span className="font-mono" style={{ color }}>
          {pushGlyph(push)} {formatSigned(leafValue)}
        </span>
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-neutral-500">
            <th className="text-left font-normal">Level</th>
            <th className="text-left font-normal">Input</th>
            <th className="text-right font-normal">Border</th>
            <th className="text-right font-normal">This bar</th>
            <th className="text-right font-normal">Answer</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, level) => {
            const value = values[step.feature];
            return (
              <tr key={level} className="text-neutral-300">
                <td>{level + 1}</td>
                <td className="max-w-[9rem] truncate" title={featureNames[step.feature]}>
                  {featureNames[step.feature] ?? `Input ${step.feature + 1}`}
                </td>
                <td className="text-right font-mono">
                  {SPLIT_OPERATOR[rule]} {formatValue(step.threshold, 3)}
                </td>
                <td className="text-right font-mono">{value === null || value === undefined ? "missing" : formatValue(value, 3)}</td>
                <td className={cn("text-right font-semibold", step.wentYes ? "text-neutral-100" : "text-neutral-400")}>{step.wentYes ? "yes = 1" : "no = 0"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-neutral-400" data-testid="oblivious-leaf">
        {spelled.order === null ? (
          <>The library puts this bar in leaf {leafIndex}</>
        ) : (
          <>
            Answers spell <span className="font-mono text-neutral-200">{spelled.bits}</span> ({spelled.order === "first_level_lowest" ? "level 1 is the last digit" : "level 1 is the first digit"}) = leaf{" "}
            <span className="font-mono text-neutral-200">{leafIndex}</span>
          </>
        )}{" "}
        → {formatSigned(leafValue)} {pushWords(push)}
      </div>
    </button>
  );
}

function LeafStrip({ tree, reached, center }: { tree: CycleExplainTree; reached: number; center: number }) {
  const leaves = tree.obliviousLeafValues ?? [];
  const maxAbs = Math.max(0, ...leaves.map((value) => Math.abs(value - center)));
  const depth = tree.obliviousLevels?.length ?? 0;
  return (
    <div className="flex flex-col gap-1" data-testid="oblivious-leaf-strip">
      <p className="text-[11px] text-neutral-500">
        All {leaves.length} leaves of tree {tree.treeIndex + 1}; every bar lands in one of them. This bar's is outlined.
      </p>
      <div className="flex flex-wrap gap-1">
        {leaves.map((value, index) => {
          const push = value - center;
          return (
            <div
              key={index}
              title={`Leaf ${index} (${index.toString(2).padStart(depth, "0")}): ${value}`}
              className="flex min-w-[3.5rem] flex-col items-center rounded border px-1 py-0.5"
              style={{
                borderColor: index === reached ? CYCLE_COLORS.active : "rgba(255,255,255,0.1)",
                borderWidth: index === reached ? 2 : 1,
                background: `${pushColor(push)}${Math.round((maxAbs > 0 ? 0.15 + 0.5 * Math.min(1, Math.abs(push) / maxAbs) : 0.2) * 255)
                  .toString(16)
                  .padStart(2, "0")}`,
              }}
            >
              <span className="font-mono text-[9px] text-neutral-400">{index.toString(2).padStart(depth, "0")}</span>
              <span className="font-mono text-[10px] text-neutral-100">
                {pushGlyph(push)}
                {formatSigned(value, 2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ObliviousTreesView({ structure, bar, role, featureNames, loadTree }: InsideKindViewProps) {
  const trees = bar.trees;
  const total = usedTreeTotal(trees);
  const stepper = useTreeStepper(total);
  const [sortMode, setSortMode] = useState<TreeSortMode>("tree_order");
  const [showAll, setShowAll] = useState(false);
  const [openTree, setOpenTree] = useState<number | null>(null);
  const opened = useOpenedTree(openTree, loadTree, `${bar.modelId}:${bar.foldIndex}:${role}`);

  if (!trees || !structure.trees) {
    return <p className="text-xs text-neutral-400">The explainer returned no tree paths for this bar.</p>;
  }

  const rule = structure.trees.splitRule;
  const center = leafCenter(structure);
  const order = sortTreeIndices(trees.leafValues, center, sortMode);
  const current = stepper.step - 1;
  // Keep the tree the scrubber just added in view even when the list is cut short.
  const shown = showAll ? order : order.slice(0, OBLIVIOUS_TABLES_SHOWN);
  if (!showAll && current >= 0 && !shown.includes(current)) shown.push(current);

  return (
    <section className="flex min-w-[280px] flex-[2] flex-col gap-2" aria-label="Inside the symmetric trees" data-testid="oblivious-trees-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-neutral-200">
          {total} symmetric trees add up
          {structure.trees.treeCount > total && <span className="font-normal text-neutral-500"> (of {structure.trees.treeCount}; the rest come after the best round)</span>}
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
        A CatBoost tree asks the same question of every bar at each level. Written as ones (yes) and zeros (no), the answers spell the leaf this bar lands in.
      </p>

      <div className="flex max-h-[22rem] flex-wrap gap-1.5 overflow-y-auto pr-1" data-testid="oblivious-grid">
        {shown.map((treeIndex) => (
          <ObliviousTreeTable
            key={treeIndex}
            trees={trees}
            treeIndex={treeIndex}
            featureNames={featureNames}
            values={bar.inputs.values}
            rule={rule}
            center={center}
            included={treeIndex < stepper.step}
            current={treeIndex === current}
            selected={treeIndex === openTree}
            onOpen={(index) => setOpenTree((selected) => (selected === index ? null : index))}
          />
        ))}
      </div>
      {total > OBLIVIOUS_TABLES_SHOWN && (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="self-start rounded border border-white/10 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/[0.06]">
          {showAll ? `Show the first ${OBLIVIOUS_TABLES_SHOWN}` : `Show all ${total} trees`}
        </button>
      )}

      {openTree !== null && (
        <div className="flex flex-col gap-1.5 rounded-md border border-[#CC79A7]/40 p-2" data-testid="tree-open">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200">Tree {openTree + 1}, every leaf</span>
            <button type="button" onClick={() => setOpenTree(null)} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/[0.06]">
              Close
            </button>
          </div>
          {opened.status === "loading" && <p className="text-[11px] text-neutral-400">Loading tree {openTree + 1}…</p>}
          {opened.status === "error" && <p className="text-[11px] text-[#D55E00]">{opened.message}</p>}
          {opened.status === "ready" && opened.tree.treeIndex === openTree && <LeafStrip tree={opened.tree} reached={trees.leafNode[openTree] ?? -1} center={center} />}
        </div>
      )}

      <TreeStepper stepper={stepper} />
      <Aggregation bar={bar} structure={structure} role={role} step={stepper.step} onStep={stepper.setStep} />
    </section>
  );
}
