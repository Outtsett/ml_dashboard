/**
 * Panel B: the same blocks on four targets. Each cell is the block's
 * out-of-sample increment over the rung below; a check mark means it also beat
 * its shuffled control (and the materiality floor). The tint is scaled within
 * each row because the rows are in different units (area under the curve
 * against R squared); orange is a gain, blue a loss, and the sign is printed.
 */

import { OKABE, Empty } from "@/studies/kit";
import { BLOCK_ORDER, TARGETS, blockLabel, isEarned, metricLabel, rungsOf, signed, targetLabel, type LadderRow } from "@shared/studies/feature-ladder-what-to-encode";

function tint(value: number | null, scale: number): string {
  if (value === null || scale === 0) return "transparent";
  const strength = Math.min(1, Math.abs(value) / scale) * 0.5;
  const rgb = value >= 0 ? "230,159,0" : "0,114,178";
  return `rgba(${rgb},${strength.toFixed(3)})`;
}

export function IncrementMatrix({ rows, minimumIncrement }: { rows: readonly LadderRow[]; minimumIncrement: number }) {
  const targets = TARGETS.filter((target) => rungsOf(rows, "derivatives_first", target.key).length > 0);
  if (targets.length === 0) return <Empty>The ladder is not landed.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[11px]">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-1 text-left font-normal">target (metric)</th>
            {BLOCK_ORDER.map((block) => (
              <th key={block} className="px-1 py-1 text-right font-normal">
                {blockLabel(block)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => {
            const rungs = rungsOf(rows, "derivatives_first", target.key).filter((row) => row.rung_index > 0);
            const scale = Math.max(...rungs.map((row) => Math.abs(row.score_increment_over_previous_rung ?? 0)));
            const metric = metricLabel(rungs[0]?.metric ?? "");
            return (
              <tr key={target.key} className="border-t border-neutral-900">
                <th scope="row" className="py-1 pr-2 text-left font-normal text-neutral-300">
                  {targetLabel(target.key)}
                  <span className="block text-[10px] text-neutral-500">{metric}</span>
                </th>
                {BLOCK_ORDER.map((block) => {
                  const row = rungs.find((entry) => entry.block_added === block);
                  const value = row?.score_increment_over_previous_rung ?? null;
                  const earned = row ? isEarned(row, minimumIncrement) : false;
                  return (
                    <td
                      key={block}
                      className="px-1 py-1 text-right font-mono tnum"
                      style={{ background: tint(value, scale), color: earned ? "#fafafa" : "#a3a3a3" }}
                      title={row ? `${blockLabel(block)} on ${targetLabel(target.key)}: ${signed(value, 5)}; best shuffle ${signed(row.shuffled_block_score_best_of_five, 5)}` : undefined}
                    >
                      {signed(value)}
                      <span className="ml-1 inline-block w-3 text-left" style={{ color: earned ? OKABE.orange : undefined }}>
                        {earned ? "✓" : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-neutral-500">✓ = increment above {minimumIncrement.toFixed(4)} and score above the best of five shuffles. Tint scaled within each row: orange gain, blue loss.</p>
    </div>
  );
}
