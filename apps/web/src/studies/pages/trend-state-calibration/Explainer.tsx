/**
 * Explainer: the least-squares line a rung keeps, its t-statistic and the scaled t
 * the levels are measured in, with a stepper that feeds the notebook's 24 prices
 * into an L = 8 ring buffer (RingRegression, the port of trend_state.RingRegression)
 * and shows the three O(1) update lines at work.
 */

import { CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, TOOLTIP, fmt } from "@/studies/kit";
import { STEPPER_PRICES, stepRingBuffer, type ThresholdRow } from "@shared/studies/trend-state-calibration";
import { DataTable, SESSION_LABEL } from "./common";

const WINDOW = 8;

function value(number: number, decimals = 4): string {
  return Number.isFinite(number) ? fmt(number, decimals) : "NaN (buffer not full)";
}

export function Explainer({ admitted, setAdmitted, thresholds, rungs }: { admitted: number; setAdmitted: (value: number) => void; thresholds: ThresholdRow[]; rungs: string[] }) {
  const count = Math.min(Math.max(1, admitted), STEPPER_PRICES.length);
  const { rows, buffer, centre } = stepRingBuffer(STEPPER_PRICES, WINDOW, count);
  const last = rows[rows.length - 1] ?? {
    bar: 0, price: Number.NaN, sumPrice: 0, sumIndexPrice: 0, sumPriceSquared: 0, slope: Number.NaN, intercept: Number.NaN, tStatistic: Number.NaN, scaledTStatistic: Number.NaN, rSquared: Number.NaN,
  };
  const previous = rows[rows.length - 2];
  const sumIndex = (WINDOW * (WINDOW - 1)) / 2;
  const sumIndexSquared = ((WINDOW - 1) * WINDOW * (2 * WINDOW - 1)) / 6;
  const standardError = Number.isFinite(last.tStatistic) ? last.slope / last.tStatistic : Number.NaN;
  const sliding = count > WINDOW && previous !== undefined;
  const leaving = sliding ? (STEPPER_PRICES[count - 1 - WINDOW] as number) - centre : Number.NaN;
  const entering = (STEPPER_PRICES[count - 1] as number) - centre;
  const firstRung = rungs[0] ?? "";
  const level = thresholds.find((row) => row.rung === firstRung && row.session_type === "regular_trading_hours");

  const windowStart = Math.max(1, count - WINDOW + 1);
  const chart = STEPPER_PRICES.map((price, index) => {
    const bar = index + 1;
    const inWindow = bar >= windowStart && bar <= count && count >= WINDOW;
    return {
      bar,
      admitted: bar <= count ? price : null,
      waiting: bar > count ? price : null,
      fitted: inWindow ? last.intercept + last.slope * (bar - windowStart) : null,
    };
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="What each rung measures" question="The least-squares line through a rung's last L closes, its t-statistic, and the scaled t that τ and η are measured in.">
          <FormulaCard
            tex={"b = \\frac{L\\,\\Sigma iP - \\Sigma i\\,\\Sigma P}{L\\,\\Sigma i^2 - (\\Sigma i)^2},\\qquad t = \\frac{b}{\\mathrm{se}(b)},\\qquad \\tilde t = \\frac{t}{\\sqrt{L}}"}
            caption={`Values below are the stepper's buffer after ${count} bar${count === 1 ? "" : "s"} (prices centred on the first one, ${fmt(centre, 3)}).`}
            symbols={[
              { tex: "P", name: "price of a bar close (log price in the live block; plain price in this stepper), the ring buffer, oldest first", value: fmt(STEPPER_PRICES[count - 1], 3) },
              { tex: "i", name: "bar index inside the window: 0 (oldest) … L − 1 (newest)", value: `0 … ${WINDOW - 1}` },
              { tex: "L", name: "window length of a rung, in that rung's bars (60 on the spec ladder, 16 … 256 on the minute ladder)", value: String(WINDOW) },
              { tex: "\\Sigma i", name: "sum of the indices, a constant of L", value: fmt(sumIndex, 0) },
              { tex: "\\Sigma i^2", name: "sum of the squared indices, a constant of L", value: fmt(sumIndexSquared, 0) },
              { tex: "\\Sigma P", name: "running sum of the (centred) prices", value: fmt(last.sumPrice, 4) },
              { tex: "\\Sigma iP", name: "running sum of index × price", value: fmt(last.sumIndexPrice, 4) },
              { tex: "\\Sigma P^2", name: "running sum of squared prices", value: fmt(last.sumPriceSquared, 4) },
              { tex: "b", name: "slope, price units per bar", value: value(last.slope) },
              { tex: "\\mathrm{se}(b)", name: "standard error of the slope, √(SSE ÷ (L − 2) ÷ (Σi² − (Σi)² ÷ L))", value: value(standardError) },
              { tex: "t", name: "slope t-statistic; grows like √L on a random walk, so it is never thresholded raw", value: value(last.tStatistic, 3) },
              { tex: "\\tilde t", name: "scaled t-statistic, t ÷ √L: what τ and η are measured in", value: value(last.scaledTStatistic, 3) },
              { tex: "\\tau", name: `entry level: the flag turns on when a rung's |t̃| reaches it (${firstRung}, ${SESSION_LABEL.regular_trading_hours}, this run)`, value: fmt(level?.entry_threshold_scaled_t, 3) },
              { tex: "\\eta", name: "exit level: the flag turns off when every rung on its side falls inside it, or the other side reaches τ", value: fmt(level?.exit_threshold_scaled_t, 3) },
            ]}
          />
          <Finding>
            τ and η are read from the null: the same block run on paths whose one-minute returns were shuffled among all returns of the same session type across the whole sample
            (the jump into each Globex day stays in place), which keeps every session type's return sizes and destroys persistence at every scale. A shuffle inside each day would
            keep the day's sum, so a rung spanning days would still see the real drift. The sign-flip null (each return keeps its size and place, only its sign is randomised) is
            recorded beside it for comparison.
          </Finding>
        </Section>

        <Section title="The three update lines, watched" question={`Step bars into an L = ${WINDOW} ring buffer: the sums update in O(1) when one bar leaves and one enters.`}>
          <ControlBar>
            <SliderControl label="Bars admitted" value={count} min={1} max={STEPPER_PRICES.length} onChange={setAdmitted} hint="The statistics are NaN until the buffer is full at bar 8" />
          </ControlBar>
          <FormulaCard
            tex={"\\Sigma iP' = \\Sigma iP - \\Sigma P + P_0 + (L-1)\\,P_n,\\qquad \\Sigma P^{2\\,\\prime} = \\Sigma P^2 - P_0^2 + P_n^2,\\qquad \\Sigma P' = \\Sigma P - P_0 + P_n"}
            caption={sliding ? "ΣiP' uses the OLD ΣP, so it is updated first." : `The buffer is still filling (${count} of ${WINDOW}); each new price is simply added, index × price into ΣiP.`}
            symbols={[
              { tex: "P_0", name: "the (centred) price leaving the window", value: sliding ? fmt(leaving, 4) : "none yet" },
              { tex: "P_n", name: "the (centred) price entering the window", value: fmt(entering, 4) },
              { tex: "\\Sigma P", name: "sum before this bar → after", value: previous ? `${fmt(previous.sumPrice, 4)} → ${fmt(last.sumPrice, 4)}` : fmt(last.sumPrice, 4) },
              { tex: "\\Sigma iP", name: "index-weighted sum before → after", value: previous ? `${fmt(previous.sumIndexPrice, 4)} → ${fmt(last.sumIndexPrice, 4)}` : fmt(last.sumIndexPrice, 4) },
              { tex: "\\Sigma P^2", name: "sum of squares before → after", value: previous ? `${fmt(previous.sumPriceSquared, 4)} → ${fmt(last.sumPriceSquared, 4)}` : fmt(last.sumPriceSquared, 4) },
            ]}
          />
          <p className="mt-2 text-[11px] text-neutral-400">
            Buffer now (oldest first): <span className="font-mono text-neutral-200">[{buffer.map((price) => price.toFixed(2)).join(", ")}]</span> → slope {value(last.slope)}, t {value(last.tStatistic, 3)},
            R² {value(last.rSquared, 3)}.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chart} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="bar" type="number" domain={[1, STEPPER_PRICES.length]} {...AXIS} />
              <YAxis domain={["dataMin - 0.5", "dataMax + 0.5"]} tickFormatter={(tick: number) => fmt(tick, 1)} {...AXIS} width={44} />
              <Tooltip {...TOOLTIP} formatter={(amount: number, name: string) => [fmt(amount, 3), name]} labelFormatter={(bar: number) => `bar ${bar}`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {count >= WINDOW && <ReferenceArea x1={windowStart} x2={count} fill={OKABE.sky} fillOpacity={0.12} />}
              <Scatter dataKey="admitted" name="● admitted" fill={OKABE.sky} isAnimationActive={false} />
              <Scatter dataKey="waiting" name="○ not yet admitted" fill="none" stroke="#737373" isAnimationActive={false} />
              <Line dataKey="fitted" name="― fitted line over the window" stroke={OKABE.orange} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <Section title="Every bar admitted" question="The running sums (on prices centred on the first one) and the fit, one row per bar.">
        <DataTable
          rows={rows as unknown as Array<Record<string, unknown>>}
          maxHeight={340}
          columns={[
            { key: "bar", label: "bar" },
            { key: "price", label: "price", render: (row) => fmt(row.price as number, 3) },
            { key: "sumPrice", label: "sum price", render: (row) => fmt(row.sumPrice as number, 4) },
            { key: "sumIndexPrice", label: "sum index × price", render: (row) => fmt(row.sumIndexPrice as number, 4) },
            { key: "sumPriceSquared", label: "sum price squared", render: (row) => fmt(row.sumPriceSquared as number, 4) },
            { key: "slope", label: "slope", render: (row) => fmt(row.slope as number, 4) },
            { key: "tStatistic", label: "t statistic", render: (row) => fmt(row.tStatistic as number, 3) },
            { key: "scaledTStatistic", label: "scaled t", render: (row) => fmt(row.scaledTStatistic as number, 3) },
            { key: "rSquared", label: "R squared", render: (row) => fmt(row.rSquared as number, 3) },
          ]}
        />
      </Section>
    </div>
  );
}
