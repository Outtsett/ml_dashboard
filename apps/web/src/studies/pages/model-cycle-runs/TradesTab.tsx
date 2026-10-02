/**
 * Trades and folds of the chosen run: the closed trades by net profit and
 * side, their eight numbers, every column graphed, the trade log, and each
 * fold with the hyperparameters its models were fitted with.
 */

import { ColumnGrid, Finding, OKABE, Section, Stat, fmtInt, fmtUsd } from "@/studies/kit";
import { groupedBins } from "@shared/studies/model-cycle-runs";
import { EightNumberTable, TradesHistogram, summariesOf } from "./charts";
import { stampCell, type TabProps } from "./common";
import { DataTable, recordColumns } from "./Table";

export function TradesTab({ run, controls }: TabProps) {
  const trades = run.trades;
  const bins = groupedBins(trades.map((trade) => ({ value: trade.net_profit_usd, group: trade.side })), controls.bins, ["long", "short"]);
  const net = trades.reduce((sum, trade) => sum + trade.net_profit_usd, 0);
  const winners = trades.filter((trade) => trade.net_profit_usd > 0).length;
  const longs = trades.filter((trade) => trade.side === "long").length;
  const summaries = summariesOf(trades);

  return (
    <div className="space-y-3">
      {trades.length === 0 ? (
        <Section title="Trades: none landed"><p className="text-xs text-neutral-400">{run.absent.trades}</p></Section>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
            <Stat label="Closed trades" value={fmtInt(trades.length)} hint={`${fmtInt(longs)} long ▲, ${fmtInt(trades.length - longs)} short ▼`} />
            <Stat label="Net profit, all trades" value={fmtUsd(net)} tone={net >= 0 ? OKABE.orange : OKABE.blue} />
            <Stat label="Winners" value={`${fmtInt(winners)} of ${fmtInt(trades.length)}`} hint="trades with a positive net profit after costs" />
            <Stat label="Mean trade" value={fmtUsd(net / trades.length)} tone={net >= 0 ? OKABE.orange : OKABE.blue} />
          </div>

          <Section title={`Trades: ${fmtInt(trades.length)}`} question="Closed trades by net profit, stacked by side; the bin count is the slider above.">
            <TradesHistogram bins={bins} />
            <Finding>
              {fmtInt(winners)} of {fmtInt(trades.length)} trades won; the largest win is {fmtUsd(Math.max(...trades.map((trade) => trade.net_profit_usd)))} and the largest loss {fmtUsd(Math.min(...trades.map((trade) => trade.net_profit_usd)))}.
              Mean {fmtUsd(net / trades.length)} per trade.
            </Finding>
          </Section>

          <Section title="The eight numbers of every trade column">
            <EightNumberTable columns={summaries} />
          </Section>

          <Section title="Every column of the trades frame" question="Each numeric column as its own histogram with its eight numbers.">
            <ColumnGrid rows={trades} title="trades" />
          </Section>

          <Section title="Trade log">
            <DataTable
              rows={trades}
              columns={recordColumns(trades, { entry_timestamp: stampCell, exit_timestamp: stampCell })}
              rowKey={(row) => `${row.fold_index}-${row.trade_number}`}
              pageSize={12}
            />
          </Section>
        </>
      )}

      <Section title={run.folds.length > 0 ? `Folds: ${run.folds.length}, each with the hyperparameters its models were fitted with` : "Folds: none landed"}>
        {run.folds.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.folds}</p>
        ) : (
          <DataTable rows={run.folds} columns={recordColumns(run.folds)} rowKey={(row) => String(row.fold_index)} pageSize={10} />
        )}
      </Section>
    </div>
  );
}
