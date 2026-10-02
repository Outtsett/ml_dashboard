/**
 * Section 1: one firing, one trade. Pick a pattern side and a year; step
 * through its trades (in time order, best first or worst first), or through
 * the same number of random bars traded the same way.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ControlBar, Finding, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, fmtInt, fmtPercent,
  useStudyQuery,
} from "@/studies/kit";
import type { CaseBody } from "@shared/studies/pattern-casebook";
import { CandleTradeChart } from "./CandleTradeChart";
import { TIMEFRAME_LABELS, YEARS, splitPatternSide, type Controls, type SetControl } from "./controls";
import { easternTime, price, signed, signedDollars } from "./format";

export interface PatternSideOption {
  value: string;
  label: string;
}

export function TradeSection({ controls, set, patternSide, options, cost }: {
  controls: Controls; set: SetControl; patternSide: string; options: PatternSideOption[]; cost: number | undefined;
}) {
  const { pattern, side } = splitPatternSide(patternSide);
  const query = useStudyQuery<CaseBody | null>("pattern-casebook", {
    part: "case", timeframe: controls.timeframe, year: controls.year, candle: controls.candle, pattern, side,
    population: controls.population, order: controls.order, draw: controls.draw, step: controls.step, cost,
  });
  const body = query.data?.data ?? null;
  const trade = body?.trade ?? null;
  const count = body?.tradeCount ?? 0;
  // a new selection starts again at trade 1, as the notebook's slider did
  const choose = <K extends keyof Controls>(key: K, value: Controls[K]) => {
    set(key, value);
    set("step", 1);
  };
  const step = (delta: number) => set("step", Math.min(Math.max(1, controls.step + delta), Math.max(1, count)));
  const isPattern = controls.population === "pattern";
  const verb = body?.tradeDirection === -1 ? "Sold" : "Bought";

  return (
    <Section
      title="1 · One firing, one trade"
      question="The actual MNQ contract around one firing: buy (or sell) at the next candle's open, exit at the close of candle k. If the random bars look alike, that is what 'no edge' means."
    >
      <ControlBar>
        <SegmentControl label="Candles" value={controls.timeframe} options={Object.entries(TIMEFRAME_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => choose("timeframe", value)} />
        <SegmentControl label="Year" value={controls.year} options={YEARS.map((year) => ({ value: year, label: String(year) }))} onChange={(value) => choose("year", value)} />
        <SliderControl label="Exit at the close of candle k" value={controls.candle} min={1} max={6} onChange={(value) => choose("candle", value)} />
      </ControlBar>
      <div className="mt-2">
        <ControlBar>
          <div className="w-full max-w-md">
            <SelectControl label="Pattern side (trades exiting at candle 1, at least 30)" value={patternSide} options={options} onChange={(value) => choose("patternSide", value)} />
          </div>
          <SegmentControl
            label="Trade"
            value={controls.population}
            options={[{ value: "pattern", label: "the pattern's firings" }, { value: "random", label: "the same number of random bars" }]}
            onChange={(value) => choose("population", value)}
          />
          <SegmentControl
            label="Step through"
            value={controls.order}
            options={[{ value: "time", label: "in time order" }, { value: "best", label: "best first" }, { value: "worst", label: "worst first" }]}
            onChange={(value) => choose("order", value)}
          />
          <label className="flex flex-col gap-1" title="Which random draw of bars (only used when trading random bars)">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Random draw number</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={controls.draw}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value)) choose("draw", Math.min(1000, Math.max(1, value)));
              }}
              className="h-7 w-24 rounded border border-neutral-700 bg-neutral-950 px-2 font-mono text-xs text-neutral-200"
            />
          </label>
        </ControlBar>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <button type="button" onClick={() => step(-1)} className="rounded border border-neutral-700 p-1 text-neutral-300 hover:bg-neutral-800" aria-label="previous trade">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <SliderControl label="Trade number" value={Math.min(controls.step, Math.max(1, count))} min={1} max={Math.max(1, count)} onChange={(value) => set("step", value)} format={(value) => `${fmtInt(value)} of ${fmtInt(count)}`} />
        </div>
        <button type="button" onClick={() => step(1)} className="rounded border border-neutral-700 p-1 text-neutral-300 hover:bg-neutral-800" aria-label="next trade">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && trade && (
          <div className="mt-2 space-y-2">
            <h4 className="text-lg font-semibold" style={{ color: trade.net_dollars > 0 ? OKABE.orange : OKABE.blue }}>
              {signedDollars(trade.net_dollars)} net on one contract {trade.net_dollars > 0 ? "▲" : "▼"}
            </h4>
            <CandleTradeChart body={body} candle={controls.candle} />
            <Finding>
              <strong>{easternTime(trade.bar_timestamp_milliseconds)}</strong> · {trade.contract_symbol} ·{" "}
              {isPattern ? <>{controls.timeframe} <strong>{pattern} ({side})</strong></> : <>a <strong>random {controls.timeframe} bar</strong> (traded like {pattern}, {side})</>} closed at{" "}
              <strong>{price(trade.pattern_close_price)}</strong>. {verb} at the next open <strong>{price(trade.entry_price)}</strong>, out at the close of candle {controls.candle}{" "}
              <strong>{price(trade.exit_price)}</strong>: {signed(trade.gross_ticks, 0)} ticks gross − {body.costTicks.toFixed(2)} ticks cost = {signed(trade.net_ticks)} ticks ={" "}
              <strong>{signedDollars(trade.net_dollars)}</strong> on one contract.
            </Finding>
            <Finding>
              Trade {fmtInt(body.step)} of {fmtInt(body.tradeCount)} (rank {fmtInt(trade.rank_best_first)} best to worst). Across all {fmtInt(body.tradeCount)}:{" "}
              <strong>{fmtPercent(body.shareNetPositive)}</strong> made money after costs, <strong>{signedDollars(body.totalNetDollars, 0)}</strong> in total, median{" "}
              <strong>{signedDollars(body.medianNetDollars)}</strong> per trade.
              {!isPattern && " Random bars here are drawn by the dashboard's own seeded generator, so draw n is not the notebook's numpy draw n: the same kind of sample, different bars."}
            </Finding>
          </div>
        )}
      </StudyState>
    </Section>
  );
}
