/**
 * Trial detail: one trial's closed trades (equity, net by quarter, the outcome
 * histogram, the eight numbers, the by-head table), the per-quarter AUC of each
 * head, the policy each quarter chose, and a graphic for every numeric column
 * of the trade log and the fold table.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  binValues, equityCurve, headSummary, quarterNet, sessionDate, type MultimodalBody, type TrialRow,
} from "@shared/studies/multimodal-model";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, SummaryTable, TOOLTIP,
  eightNumberSummary, fmt, fmtInt, fmtPercent, fmtUsd,
} from "@/studies/kit";
import type { TabProps } from "./controls";
import { HEADS, headLabel, headStyle, Signed } from "./parts";

function maximumDrawdown(cumulative: number[]): number {
  let peak = 0;
  let worst = 0;
  for (const value of cumulative) {
    peak = Math.max(peak, value);
    worst = Math.max(worst, peak - value);
  }
  return worst;
}

export function TrialPicker({ trials, selected, set }: { trials: TrialRow[]; selected: string | null } & Pick<TabProps, "set">) {
  if (trials.length === 0) return null;
  return (
    <SelectControl
      label="Trial"
      value={selected ?? (trials[0] as TrialRow).recipe}
      options={trials.map((trial) => ({ value: trial.recipe, label: `${trial.label} ${trial.family ?? ""} · PF ${fmt(trial.profit_factor, 3)}` }))}
      onChange={(value) => set("trial", value)}
      hint="Drives every tab. The default is the highest profit factor."
    />
  );
}

export function WindowControl({ controls, set }: TabProps) {
  return (
    <SegmentControl
      label="Quarters"
      value={controls.window}
      options={[
        { value: "canonical", label: "2021Q2–2025Q2" },
        { value: "all", label: "all landed" },
      ]}
      onChange={(value) => set("window", value)}
      hint="The trial table is scored on 2021Q2 to 2025Q2. The run tables also hold the earlier quarters a trial needs to choose its policy; 'all landed' shows them too (what the notebook showed). Nothing after 2025Q2 is ever read."
    />
  );
}

export function TrialDetail({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const detail = body.detail;
  const trial = body.trials.find((row) => row.recipe === body.selectedRecipe) ?? null;
  const pointValue = body.pointValueUsd;

  const picker = (
    <ControlBar>
      <TrialPicker trials={body.trials} selected={body.selectedRecipe} set={set} />
      <WindowControl controls={controls} set={set} />
      <SliderControl label="Histogram bins" value={controls.bins} min={10} max={120} step={5} onChange={(value) => set("bins", value)} />
    </ControlBar>
  );
  if (!detail || detail.trades.length === 0) {
    return (
      <div className="space-y-3">
        {picker}
        <Empty>{detail ? "This trial has no closed trades in the chosen quarters." : "No trade record is landed for this trial."}</Empty>
      </div>
    );
  }

  const trades = detail.trades;
  const equity = equityCurve(trades, pointValue);
  const quarters = quarterNet(trades, pointValue);
  const heads = headSummary(trades);
  const netPoints = trades.map((trade) => trade.net_points);
  const bins = binValues(netPoints, controls.bins);
  const summary = eightNumberSummary(netPoints);
  const netUsd = netPoints.reduce((total, value) => total + value, 0) * pointValue;
  const wins = netPoints.filter((value) => value > 0).length;
  const drawdown = maximumDrawdown(equity.map((point) => point.cumulativeNetUsd));
  const positiveQuarters = quarters.filter((quarter) => quarter.netUsd > 0).length;
  const sessions = equity.length;

  const foldRows = detail.folds;
  const aucSeries = foldRows.map((fold) => ({
    fold: fold.fold,
    long_r2: fold.long_r2_auc,
    short_r2: fold.short_r2_auc,
    long_r3: fold.long_r3_auc,
    short_r3: fold.short_r3_auc,
  }));
  const meanAuc = HEADS.map((head) => {
    const values = aucSeries.map((row) => row[head]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return { head, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, count: values.length };
  });

  return (
    <div className="space-y-3">
      {picker}
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
        <Stat label="Closed trades" value={fmtInt(trades.length)} hint={`${fmtInt(sessions)} sessions with a trade; the trial table reports ${fmtInt(trial?.trade_count)} on 2021Q2 to 2025Q2`} />
        <Stat label="Net, USD per contract" value={fmtUsd(netUsd)} tone={netUsd > 0 ? OKABE.orange : OKABE.blue} hint={`${fmt(netUsd / pointValue, 2)} points × ${pointValue} USD a point; after AMP costs`} />
        <Stat label="Win rate" value={fmtPercent(wins / trades.length)} hint="share of trades with net points above zero" />
        <Stat label="Maximum drawdown, USD" value={fmtUsd(drawdown)} hint="largest fall of the session-by-session equity below its running peak" />
        <Stat label="Quarters up" value={`${positiveQuarters} of ${quarters.length}`} hint="quarters whose net is above zero (G5 needs 75%)" />
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Section title="Equity, out of sample" question="Cumulative net USD per contract, summed by session date.">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={equity} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="session" domain={["dataMin", "dataMax"]} {...AXIS} tickFormatter={(value: number) => sessionDate(value).slice(0, 7)} />
              <YAxis {...AXIS} width={56} tickFormatter={(value: number) => `$${fmtInt(value)}`} />
              <ReferenceLine y={0} stroke={OKABE.grey} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const point = payload?.[0]?.payload as (typeof equity)[number] | undefined;
                  if (!point) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{point.date}</div>
                      <div>cumulative {fmtUsd(point.cumulativeNetUsd)}</div>
                      <div>that session {fmtUsd(point.netUsd)} over {point.tradeCount} trade{point.tradeCount === 1 ? "" : "s"}</div>
                    </div>
                  );
                }}
              />
              <Line type="stepAfter" dataKey="cumulativeNetUsd" stroke={OKABE.sky} dot={false} strokeWidth={1.6} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Trade outcomes" question="Net points of every closed trade after costs; orange above zero, blue at or below it.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bins} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barCategoryGap={1}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis type="number" dataKey="middle" domain={["dataMin", "dataMax"]} {...AXIS} tickFormatter={(value: number) => fmt(value, 0)} />
              <YAxis {...AXIS} width={44} />
              <ReferenceLine x={0} stroke={OKABE.grey} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmtInt(value), "trades"]}
                labelFormatter={(_label, payload) => {
                  const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return bin ? `${fmt(bin.lower, 1)} to ${fmt(bin.upper, 1)} points` : "";
                }}
              />
              <Bar dataKey="count" isAnimationActive={false}>
                {bins.map((bin) => (
                  <Cell key={bin.lower} fill={bin.middle > 0 ? OKABE.orange : OKABE.blue} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <Section title="Net by quarter" question="Orange above zero, blue at or below it; the bar's direction carries the same sign.">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={quarters} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="quarter" {...AXIS} interval={quarters.length > 24 ? 3 : 0} angle={-40} textAnchor="end" height={48} />
            <YAxis {...AXIS} width={56} tickFormatter={(value: number) => `$${fmtInt(value)}`} />
            <ReferenceLine y={0} stroke={OKABE.grey} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof quarters)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.quarter}</div>
                    <div>net {fmtUsd(row.netUsd)} ({fmt(row.netPoints, 2)} points)</div>
                    <div>{fmtInt(row.tradeCount)} trades</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="netUsd" isAnimationActive={false}>
              {quarters.map((row) => (
                <Cell key={row.quarter} fill={row.netUsd > 0 ? OKABE.orange : OKABE.blue} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Section title="Trade net points, eight numbers" question="Skewness and kurtosis are the sample-adjusted estimators (kurtosis is excess).">
          <SummaryTable
            columns={[
              { name: "net points", summary: summary, decimals: 3 },
              { name: "net USD", summary: eightNumberSummary(netPoints.map((value) => value * pointValue)), decimals: 3 },
              { name: "minutes held", summary: eightNumberSummary(trades.map((trade) => trade.minutes_held).filter((value): value is number => value !== null)), decimals: 2 },
              { name: "probability", summary: eightNumberSummary(trades.map((trade) => trade.probability).filter((value): value is number => value !== null)), decimals: 4 },
            ]}
          />
        </Section>
        <Section title="By bracket head" question="Win rate is the share of trades above zero net points; expectancy is the mean net points per trade.">
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-0.5 text-left font-normal">head</th>
                <th className="py-0.5 text-right font-normal">trades</th>
                <th className="py-0.5 text-right font-normal">win rate</th>
                <th className="py-0.5 text-right font-normal">expectancy, points</th>
                <th className="py-0.5 text-right font-normal">forced share</th>
              </tr>
            </thead>
            <tbody>
              {heads.map((row) => (
                <tr key={row.head} className="border-t border-neutral-900">
                  <td className="py-0.5 text-neutral-200"><span style={{ color: headStyle(row.head).color }}>{headStyle(row.head).glyph}</span> {headLabel(row.head)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{fmtInt(row.tradeCount)}</td>
                  <td className="py-0.5 text-right text-neutral-200">{fmtPercent(row.winRate)}</td>
                  <td className="py-0.5 text-right"><Signed value={row.expectancyPoints} text={fmt(row.expectancyPoints, 3)} /></td>
                  <td className="py-0.5 text-right text-neutral-200">{fmtPercent(row.forcedShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Finding>
            A forced trade is one opened at the policy's forced minute because the session had produced none; it is what keeps G2 (a trade every day) at 100%.
          </Finding>
        </Section>
      </div>

      <Section title="Does the model rank outcomes, quarter by quarter?" question="Test-quarter AUC of each head: 0.5 = a coin flip (the dashed line), 1 = perfect ranking.">
        {foldRows.length === 0 ? (
          <Empty>No fold record is landed for this trial.</Empty>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={aucSeries} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="fold" {...AXIS} interval={aucSeries.length > 24 ? 3 : 0} angle={-40} textAnchor="end" height={48} />
                <YAxis {...AXIS} width={40} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 2)} />
                <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 4), headLabel(name)]} />
                {HEADS.map((head) => (
                  <Line key={head} type="monotone" dataKey={head} name={head} stroke={headStyle(head).color} strokeDasharray={headStyle(head).dash} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">
              {HEADS.map((head) => (
                <span key={head} className="mr-3">
                  <span style={{ color: headStyle(head).color }}>{headStyle(head).glyph}</span> {headLabel(head)} mean AUC {fmt(meanAuc.find((row) => row.head === head)?.mean, 4)}
                </span>
              ))}
            </p>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full min-w-[720px] text-[11px] font-mono tnum">
                <thead className="sticky top-0 bg-neutral-950 text-neutral-500">
                  <tr>
                    {["fold", "train rows", "validation rows", "test rows", "long 2:1 AUC", "short 2:1 AUC", "long 3:1 AUC", "short 3:1 AUC", "epochs (trees)", "epochs (fusion)", "validation loss"].map((label) => (
                      <th key={label} className="py-0.5 pr-2 text-right font-normal first:text-left">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {foldRows.map((fold) => (
                    <tr key={fold.fold} className="border-t border-neutral-900 text-neutral-200">
                      <td className="py-0.5 pr-2">{fold.fold}</td>
                      <td className="py-0.5 pr-2 text-right">{fmtInt(fold.train_rows)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmtInt(fold.validation_rows)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmtInt(fold.test_rows)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmt(fold.long_r2_auc, 4)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmt(fold.short_r2_auc, 4)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmt(fold.long_r3_auc, 4)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmt(fold.short_r3_auc, 4)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmtInt(fold.epochs_run)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmtInt(fold.fusion_epochs_run)}</td>
                      <td className="py-0.5 text-right">{fmt(fold.fusion_validation_loss ?? fold.validation_loss, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title="The trading policy each quarter chose" question="Chosen from the EARLIER quarters only: heads traded, the expected-points threshold, the trade cap, and the minute at which a forced trade opens.">
        {detail.policies.length === 0 ? (
          <Empty>No policy record is landed for this trial.</Empty>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[560px] text-[11px] font-mono tnum">
              <thead className="sticky top-0 bg-neutral-950 text-neutral-500">
                <tr>
                  {["quarter", "policy index", "threshold, points", "max trades", "forced minute", "heads", "history net, points"].map((label) => (
                    <th key={label} className="py-0.5 pr-2 text-right font-normal first:text-left">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.policies.map((policy) => (
                  <tr key={policy.quarter} className="border-t border-neutral-900 text-neutral-200">
                    <td className="py-0.5 pr-2">{policy.quarter}</td>
                    <td className="py-0.5 pr-2 text-right">{fmtInt(policy.policy_index)}</td>
                    <td className="py-0.5 pr-2 text-right">{fmt(policy.threshold_points, 2)}</td>
                    <td className="py-0.5 pr-2 text-right">{fmtInt(policy.max_trades)}</td>
                    <td className="py-0.5 pr-2 text-right">{fmtInt(policy.forced_minute)}</td>
                    <td className="py-0.5 pr-2 text-right">{policy.heads ?? "—"}</td>
                    <td className="py-0.5 text-right"><Signed value={policy.history_net_points} text={fmt(policy.history_net_points, 1)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Every numeric column of the trade log" question={`${fmtInt(trades.length)} closed trades, one panel per column.`}>
        <ColumnGrid rows={trades} exclude={["session"]} title="Trade log columns" />
      </Section>
      {foldRows.length > 0 && (
        <Section title="Every numeric column of the fold table" question={`${fmtInt(foldRows.length)} quarters, one panel per column.`}>
          <ColumnGrid rows={foldRows} title="Fold table columns" />
        </Section>
      )}
    </div>
  );
}
