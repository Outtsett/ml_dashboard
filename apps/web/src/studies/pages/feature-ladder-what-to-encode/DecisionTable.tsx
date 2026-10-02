/**
 * The decision rule: for each block, on how many of the four targets it earns
 * its place (and its best earned increment), under both ladder orderings. A
 * filled dot is a target it earned on, a hollow dot one it did not, in the
 * order direction, range, signed gap, gap magnitude.
 */

import { Empty, fmtInt } from "@/studies/kit";
import { TARGETS, blockLabel, blockSummaries, signed, targetShort, type BlockSummary, type LadderRow } from "@shared/studies/feature-ladder-what-to-encode";

function Dots({ summary }: { summary: BlockSummary }) {
  return (
    <span className="font-mono tracking-wider" aria-label={`earned on ${summary.earnedTargets.map(targetShort).join(", ") || "no target"}`}>
      {TARGETS.map((target) => (
        <span key={target.key} title={`${target.short}: ${summary.earnedTargets.includes(target.key) ? "earned" : "not earned"}`} className={summary.earnedTargets.includes(target.key) ? "text-[#E69F00]" : "text-neutral-600"}>
          {summary.earnedTargets.includes(target.key) ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

export function DecisionTable({ rows, minimumIncrement }: { rows: readonly LadderRow[]; minimumIncrement: number }) {
  const original = blockSummaries(rows, "derivatives_first", minimumIncrement);
  if (original.length === 0) return <Empty>The ladder is not landed.</Empty>;
  const volumeFirst = new Map(blockSummaries(rows, "volume_first", minimumIncrement).map((summary) => [summary.block, summary]));

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-neutral-500">
          <th className="py-0.5 text-left font-normal">block</th>
          <th className="py-0.5 text-right font-normal">targets it earns its place on</th>
          <th className="py-0.5 text-center font-normal" title="direction, range, signed gap, gap magnitude">which</th>
          <th className="py-0.5 text-right font-normal">best increment</th>
          <th className="py-0.5 text-right font-normal">volume first: targets</th>
        </tr>
      </thead>
      <tbody>
        {original.map((summary) => {
          const other = volumeFirst.get(summary.block);
          return (
            <tr key={summary.block} className="border-t border-neutral-900">
              <td className="py-0.5 font-mono text-neutral-200">{blockLabel(summary.block)}</td>
              <td className="py-0.5 text-right font-mono tnum text-neutral-200">
                {fmtInt(summary.targetsEarnedOn)} of {fmtInt(summary.targetCount)}
              </td>
              <td className="py-0.5 text-center">
                <Dots summary={summary} />
              </td>
              <td className="py-0.5 text-right font-mono tnum text-neutral-200">{signed(summary.bestIncrement)}</td>
              <td className="py-0.5 text-right font-mono tnum text-neutral-400">{other ? `${fmtInt(other.targetsEarnedOn)} of ${fmtInt(other.targetCount)}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
