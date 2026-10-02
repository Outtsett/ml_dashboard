/**
 * One tree drawn as the path this bar took: a step down per question, left for
 * "yes" and right for "no", ending at the leaf — a dot sized by how hard the
 * leaf pushes, orange with ▲ when it pushes up, blue with ▼ when it pushes
 * down. Small enough that hundreds fit in a grid.
 */
import { cn } from "@/shared/utils/utils";

import { CYCLE_COLORS } from "../../chartModel";
import { formatSigned, pushColor, pushGlyph } from "./treeTypes";

export interface TreePathGlyphProps {
  treeIndex: number;
  /** One per question, root first: true = the "yes" branch. */
  answers: boolean[];
  leafValue: number;
  /** The leaf's push (its value less the centre it is measured against). */
  push: number;
  /** Largest |push| over the trees, for sizing the dot. */
  maxAbsPush: number;
  /** Counted in the running total at the current step. */
  included: boolean;
  /** The tree the last step added. */
  current: boolean;
  selected: boolean;
  /** For the hover title: the path in words. */
  pathText: string;
  onHover: (treeIndex: number | null) => void;
  onOpen: (treeIndex: number) => void;
}

const WIDTH = 34;
const STEP_HEIGHT = 7;
const TOP = 4;

export function TreePathGlyph({ treeIndex, answers, leafValue, push, maxAbsPush, included, current, selected, pathText, onHover, onOpen }: TreePathGlyphProps) {
  const depth = answers.length;
  const height = TOP + Math.max(depth, 1) * STEP_HEIGHT + 16;
  let x = WIDTH / 2;
  let y = TOP;
  const points = [`${x},${y}`];
  answers.forEach((yes, level) => {
    const dx = Math.max(1.5, 7 / (level + 1));
    x += yes ? -dx : dx;
    y += STEP_HEIGHT;
    points.push(`${x},${y}`);
  });
  const radius = 2 + 5 * (maxAbsPush > 0 ? Math.min(1, Math.abs(push) / maxAbsPush) : 0);
  const color = pushColor(push);
  const label = `Tree ${treeIndex + 1}: leaf ${formatSigned(leafValue)}, ${pushGlyph(push)} ${push > 0 ? "pushes up" : push < 0 ? "pushes down" : "pushes neither way"}`;

  return (
    <button
      type="button"
      data-testid="tree-glyph"
      data-tree-index={treeIndex}
      aria-label={label}
      title={`${label}\n${pathText}\nClick to open the whole tree.`}
      onPointerEnter={() => onHover(treeIndex)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(treeIndex)}
      onBlur={() => onHover(null)}
      onClick={() => onOpen(treeIndex)}
      className={cn(
        "flex flex-col items-center rounded border px-0.5 pt-0.5 transition-opacity",
        selected ? "border-[#CC79A7]" : current ? "border-white/60" : "border-white/10 hover:border-white/40",
        included ? "opacity-100" : "opacity-25",
      )}
    >
      <svg width={WIDTH} height={height - 12} aria-hidden="true">
        <polyline points={points.join(" ")} fill="none" stroke={included ? CYCLE_COLORS.neutral : "rgba(255,255,255,0.3)"} strokeWidth={1.5} strokeLinejoin="round" />
        <circle cx={x} cy={y} r={radius} fill={color} />
      </svg>
      <span className="font-mono text-[9px] leading-3" style={{ color }}>
        {pushGlyph(push)}
        {formatSigned(leafValue, 2)}
      </span>
      <span className="text-[8px] leading-3 text-neutral-500">{treeIndex + 1}</span>
    </button>
  );
}
