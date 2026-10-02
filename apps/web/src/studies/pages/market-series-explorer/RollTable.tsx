/** The contract rolls inside the span: which contract took over, and the price jump an unadjusted series would show. */

import { fmt } from "@/studies/kit";
import type { RollEvent } from "@shared/studies/market-series-explorer";
import { clock } from "./layout";

export function RollTable({ rolls }: { rolls: readonly RollEvent[] }) {
  if (rolls.length === 0) return <p className="text-xs text-neutral-400">No contract rolls begin inside this span.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="min-w-full border-collapse text-[11px]">
        <thead className="bg-neutral-900/70 text-neutral-400">
          <tr>
            <th className="px-2 py-1 text-left font-medium">first bar of the roll day</th>
            <th className="px-2 py-1 text-left font-medium">from contract</th>
            <th className="px-2 py-1 text-left font-medium">to contract</th>
            <th className="px-2 py-1 text-right font-medium">new over old close</th>
            <th className="px-2 py-1 text-right font-medium">jump in percent</th>
          </tr>
        </thead>
        <tbody>
          {rolls.map((roll) => (
            <tr key={roll.timestamp} className="border-t border-neutral-800">
              <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{clock(roll.timestamp)}</td>
              <td className="px-2 py-0.5 font-mono text-neutral-200">{roll.fromContract || "unknown"}</td>
              <td className="px-2 py-0.5 font-mono text-neutral-200">{roll.toContract}</td>
              <td className="px-2 py-0.5 text-right font-mono tnum text-neutral-200">{roll.priceRatio === null ? "unknown" : fmt(roll.priceRatio, 5)}</td>
              <td className="px-2 py-0.5 text-right font-mono tnum text-neutral-200">{roll.priceRatio === null ? "unknown" : `${roll.priceRatio >= 1 ? "▲" : "▼"} ${fmt((roll.priceRatio - 1) * 100, 3)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
