/**
 * The equity curve as the product it is: step through the trades one at a time
 * and watch each factor f_j = 1 + (the trade's net return) multiply into the
 * running equity. Everything here is the server's list of trades; moving the
 * slider asks for nothing.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Slider } from "@/shared/ui/slider";
import { AXIS, FormulaCard, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime } from "@/studies/kit";
import type { TradeTerm } from "@shared/studies/crossover-strategy";

export function TradeStepper({ terms, flatFactor, clipped, tradeCount }: { terms: TradeTerm[]; flatFactor: number; clipped: boolean; tradeCount: number }) {
  const [at, setAt] = useState(1);
  const total = terms.length;
  if (total === 0) return null;
  const index = Math.min(Math.max(1, at), total);

  const running: Array<{ trade: number; equity: number }> = [];
  let product = flatFactor;
  for (let i = 0; i < total; i += 1) {
    product *= (terms[i] as TradeTerm).factor;
    running.push({ trade: i + 1, equity: product });
  }
  const term = terms[index - 1] as TradeTerm;
  const current = running[index - 1] as { trade: number; equity: number };
  const positive = term.factor >= 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-neutral-700 p-1 text-neutral-300 hover:bg-neutral-800" onClick={() => setAt(Math.max(1, index - 1))} aria-label="previous trade">
          <ChevronLeft className="h-3 w-3" />
        </button>
        <Slider className="flex-1" value={[index]} min={1} max={total} step={1} onValueChange={(next) => setAt(next[0] ?? 1)} aria-label="trade index" />
        <button type="button" className="rounded border border-neutral-700 p-1 text-neutral-300 hover:bg-neutral-800" onClick={() => setAt(Math.min(total, index + 1))} aria-label="next trade">
          <ChevronRight className="h-3 w-3" />
        </button>
        <span className="w-28 text-right font-mono text-[11px] text-neutral-200">trade {fmtInt(index)} of {fmtInt(total)}</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={String.raw`E_{i} \;=\; E_{0}\prod_{j=1}^{i} f_{j}\,,\qquad f_{j} = 1 + r_{j}`}
          caption={`The equity after i trades is the flat-period factor times the first i trade factors. Term ${fmtInt(index)} is highlighted in the chart.`}
          symbols={[
            { tex: "i", name: "number of trades stepped through", value: `${fmtInt(index)} of ${fmtInt(total)}` },
            { tex: "j", name: "index of one trade, 1 to i", value: `current term j = ${fmtInt(index)}` },
            { tex: "r_{j}", name: "net return of trade j, the round trip paid when it closed included", value: `${positive ? "▲ +" : "▼ "}${fmtPercent(term.factor - 1, 3)}` },
            { tex: "f_{j}", name: "factor of trade j, one plus its net return", value: fmt(term.factor, 5) },
            { tex: "E_{0}", name: "product of the factors while the rule held no position (the warm-up)", value: fmt(flatFactor, 6) },
            { tex: "E_{i}", name: "equity after i trades, starting from 1.00", value: fmt(current.equity, 5) },
          ]}
        />
        <div className="space-y-1">
          <p className="font-mono text-[11px] text-neutral-300">
            Trade {fmtInt(index)}: {term.side === 1 ? "▲ long" : "▼ short"}, opened {fmtTime(term.startSeconds * 1000)}, held {fmtInt(term.bars)} bars, factor {fmt(term.factor, 5)} →
            equity {fmt(current.equity, 5)}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={running} margin={{ top: 6, right: 12, left: 4, bottom: 2 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="trade" type="number" domain={[1, total]} tick={AXIS} tickFormatter={(value: number) => fmtInt(value)} minTickGap={40} />
              <YAxis tick={AXIS} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 2)} width={44} />
              <Tooltip {...TOOLTIP} labelFormatter={(label) => `after trade ${fmtInt(Number(label))}`} formatter={(value) => [fmt(Number(value), 5), "equity"]} />
              <ReferenceLine y={1} stroke="#a3a3a3" strokeDasharray="4 3" />
              <Line type="monotone" dataKey="equity" stroke={OKABE.orange} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <ReferenceDot x={index} y={current.equity} r={5} fill={OKABE.yellow} stroke="#0a0a0a" />
            </LineChart>
          </ResponsiveContainer>
          {clipped && <p className="text-[10px] text-neutral-500">The first {fmtInt(total)} of {fmtInt(tradeCount)} trades are stepped; the equity above is their product.</p>}
        </div>
      </div>
    </div>
  );
}
