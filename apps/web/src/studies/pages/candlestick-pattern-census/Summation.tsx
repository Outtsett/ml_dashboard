/**
 * The count written out as the sum it is, N_present(tau, m, c) = sum over the
 * patterns in view of 1[f >= m], with every symbol defined beside it and a step
 * index that lights each term and the running total.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, FormulaCard, GRID, OKABE, SliderControl, TOOLTIP, fmtInt } from "@/studies/kit";
import type { SummationTerm, TimeframeChoice } from "@shared/studies/candlestick-pattern-census";

export function Summation({
  terms, threshold, timeframe, holdoutOnly, candleSizes, step, onStep,
}: {
  terms: readonly SummationTerm[];
  threshold: number;
  timeframe: TimeframeChoice;
  holdoutOnly: boolean;
  candleSizes: readonly number[];
  step: number;
  onStep: (value: number) => void;
}) {
  const count = terms.length;
  const index = Math.min(Math.max(1, step), Math.max(1, count));
  const current = terms[index - 1];
  const final = terms[count - 1]?.runningTotal ?? 0;
  const zeroTerms = terms.filter((term) => term.firings === 0);
  const timeframeLabel = timeframe === "all" ? "all five timeframes, summed" : timeframe;
  const split = holdoutOnly ? "2025 holdout only" : "every bar";

  return (
    <div className="space-y-2">
      <FormulaCard
        tex={String.raw`N_{\text{present}}(\tau,\, m,\, c) \;=\; \sum_{p=1}^{P(c)} \mathbb{1}\!\left[\, f_{p,\tau} \ \ge\ m \,\right]`}
        caption="Drag the step to walk the sum one pattern at a time; the legend holds the value each symbol carries at that step."
        symbols={[
          { tex: String.raw`\sum_{p=1}^{P(c)}`, name: "sum over one term per pattern of the selected candle counts", value: `${count} terms` },
          { tex: "c", name: "candle counts in view (the toggles)", value: candleSizes.join(", ") },
          { tex: "P(c)", name: "patterns in view: 61 with every count selected, 13 with only 1-candle", value: String(count) },
          { tex: "p", name: "pattern index, in TA-Lib order (the step)", value: current ? `${index} (${current.pattern.talib_function})` : "-" },
          { tex: String.raw`\tau`, name: `timeframe being counted (${split})`, value: timeframeLabel },
          { tex: String.raw`f_{p,\tau}`, name: "firing count: bars this pattern fired on at that timeframe", value: current ? fmtInt(current.firings) : "-" },
          { tex: "m", name: "minimum firing count (the slider; a value of 0 still needs one firing)", value: fmtInt(Math.max(threshold, 1)) },
          { tex: String.raw`\mathbb{1}[\cdot]`, name: "indicator: 1 when the condition holds, 0 when it does not", value: current ? String(current.indicator) : "-" },
          { tex: String.raw`N_{\text{present}}`, name: "patterns present: the running total at this step, and over all terms", value: `${current?.runningTotal ?? 0} of ${final}` },
        ]}
      />
      <SliderControl
        label={`Step the summation index p, term p of ${count}`}
        value={index}
        min={1}
        max={Math.max(1, count)}
        onChange={onStep}
        format={(value) => String(value)}
      />
      {current && (
        <p className="font-mono text-[11px] text-neutral-300">
          term {index}: {current.pattern.talib_function} ({current.pattern.pattern_name}, {current.pattern.candle_count}-candle {current.pattern.pattern_type}) · f = {fmtInt(current.firings)}{" "}
          {current.indicator === 1 ? "≥" : "<"} m = {fmtInt(Math.max(threshold, 1))} → indicator {current.indicator} · running total {current.runningTotal} · final {final}
        </p>
      )}
      <div className="flex flex-wrap gap-0.5" aria-label="Every term of the sum">
        {terms.map((term) => {
          const reached = term.index <= index;
          const on = term.indicator === 1;
          return (
            <button
              key={term.pattern.pattern_name}
              type="button"
              onClick={() => onStep(term.index)}
              title={`${term.index}. ${term.pattern.talib_function}: f = ${fmtInt(term.firings)} → ${term.indicator}; running total ${term.runningTotal}`}
              className={`h-6 w-6 rounded-sm text-center font-mono text-[10px] leading-6 ${term.index === index ? "ring-2 ring-white" : ""}`}
              style={{
                background: on ? OKABE.orange : "#262626",
                color: on ? "#000" : OKABE.sky,
                border: `1px solid ${on ? OKABE.orange : OKABE.blue}`,
                opacity: reached ? 1 : 0.3,
              }}
            >
              {term.indicator}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>■ 1 clears m</span> · <span style={{ color: OKABE.sky }}>□ 0 does not</span> · faded terms are not yet added to the total
      </p>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={terms.map((term) => ({ index: term.index, total: term.runningTotal, name: term.pattern.talib_function }))} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="index" type="number" domain={[1, Math.max(1, count)]} {...AXIS} />
          <YAxis {...AXIS} width={32} allowDecimals={false} />
          <Tooltip {...TOOLTIP} formatter={(value) => [String(value), "running total"]} labelFormatter={(label) => `after term ${label}`} />
          <ReferenceLine x={index} stroke={OKABE.purple} />
          <Line dataKey="total" type="stepAfter" stroke={OKABE.orange} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">
        {zeroTerms.length > 0
          ? `${zeroTerms.length} of the ${count} terms are zero at every threshold here (${zeroTerms.map((term) => `${term.pattern.talib_function} is term ${term.index}`).join(", ")}), so the sum can never reach ${count} however far the slider is dragged left.`
          : `Every term fires at least once in this view, so dragging the slider to 1 makes the sum reach ${count}.`}
      </p>
    </div>
  );
}
