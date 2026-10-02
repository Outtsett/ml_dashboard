/**
 * Pattern casebook. Five sections, each fetching only its own part of
 * GET /api/studies/pattern-casebook, so a control refetches only what it
 * moves. Section 1's candles, year, exit candle and pattern side drive
 * sections 2, 3 and 5, as they did in the notebook.
 */

import {
  ControlBar, Finding, SegmentControl, StudyNotes, StudyState, fmt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type { OverviewBody, SidesBody } from "@shared/studies/pattern-casebook";
import { ColumnsSection } from "./ColumnsSection";
import { DEFAULTS, type Controls, type SetControl } from "./controls";
import { DistributionSection } from "./DistributionSection";
import { FindingsSection } from "./FindingsSection";
import { signedDollars } from "./format";
import { PersistenceSection } from "./PersistenceSection";
import { SidesSection } from "./SidesSection";
import { TradeSection, type PatternSideOption } from "./TradeSection";

const DEFAULT_SIDE = "engulfing|bullish";

export default function Page() {
  const [controls, setControl, reset] = useStudyControls(DEFAULTS);
  const set = setControl as SetControl;
  const overview = useStudyQuery<OverviewBody>("pattern-casebook", { part: "overview" });
  const run = overview.data?.data.run ?? null;
  const dashboardCost = overview.data?.data.dashboardCostTicks ?? null;
  // undefined = the casebook's own cost (the server's default)
  const cost = controls.costSource === "dashboard" && dashboardCost !== null ? dashboardCost : undefined;
  const costTicks = cost ?? run?.round_trip_cost_ticks ?? null;
  const dollarsPerTick = run?.dollars_per_tick ?? 0.5;

  const sides = useStudyQuery<SidesBody | null>("pattern-casebook", { part: "sides", timeframe: controls.timeframe, year: controls.year, cost });
  const sideRows = sides.data?.data?.rows ?? [];
  const options: PatternSideOption[] = sideRows
    .filter((row) => row.candle === 1 && row.trade_count >= 30)
    .map((row) => ({ value: `${row.pattern}|${row.side}`, label: `${row.pattern} — ${row.side} (trade ${row.trade_direction}) · ${row.trade_count.toLocaleString("en-US")} trades` }));
  const values = new Set(options.map((option) => option.value));
  // the notebook fell back to bullish engulfing, then to the first pattern side, when the choice has no trades here
  const patternSide = values.has(controls.patternSide) ? controls.patternSide : values.has(DEFAULT_SIDE) ? DEFAULT_SIDE : (options[0]?.value ?? controls.patternSide);

  return (
    <div className="space-y-3">
      <StudyState isLoading={overview.isLoading} error={overview.error}>
        <StudyNotes notes={overview.data?.notes ?? []} />
        {run && (
          <>
            <Finding>
              Most recent results say <strong>no edge</strong> or <strong>too small to trade</strong>, in units nobody trades (average ranges, AUC, a t-statistic). This page restates them as{" "}
              <strong>a dated MNQ candle, an entry price, an exit price, whole ticks, and dollars on one contract</strong> after the round trip, always beside random bars traded the same way. Trade rule for every pattern: {run.trade_rule}.
            </Finding>
            <ControlBar onReset={reset}>
              <SegmentControl
                label="Round trip that prices every trade"
                value={controls.costSource}
                options={[
                  { value: "casebook", label: `casebook build ${fmt(run.round_trip_cost_ticks, 2)} ticks = ${signedDollars(run.round_trip_cost_dollars)}` },
                  ...(dashboardCost !== null ? [{ value: "dashboard", label: `dashboard cost_model.json ${fmt(dashboardCost, 2)} ticks = ${signedDollars(dashboardCost * dollarsPerTick)}` }] : []),
                ]}
                onChange={(value) => set("costSource", value)}
                hint="The casebook was built with Trading/quant's MNQ cost model; the dashboard's packages/config/cost_model.json is the AMP account's. Gross ticks are the same either way."
              />
              <span className="self-center text-[11px] text-neutral-500">
                pricing at {fmt(costTicks, 4)} ticks × {signedDollars(dollarsPerTick)} a tick · tick {fmt(run.tick_size_points, 2)} points
              </span>
            </ControlBar>
          </>
        )}
        <FindingsSection findings={overview.data?.data.findings ?? []} shown={controls.verdicts} onShownChange={(value) => set("verdicts", value)} />
        <TradeSection controls={controls} set={set} patternSide={patternSide} options={options} cost={cost} />
        <DistributionSection controls={controls} set={set} patternSide={patternSide} cost={cost} />
        <StudyState isLoading={sides.isLoading} error={sides.error}>
          <StudyNotes notes={sides.data?.notes ?? []} />
          <SidesSection controls={controls as Controls} rows={sideRows} />
        </StudyState>
        {run && (
          <PersistenceSection controls={controls} set={set} rules={overview.data?.data.rules ?? []} defaultCost={costTicks ?? run.round_trip_cost_ticks} dollarsPerTick={dollarsPerTick} />
        )}
        <ColumnsSection controls={controls} set={set} patternSide={patternSide} cost={cost} />
      </StudyState>
    </div>
  );
}
