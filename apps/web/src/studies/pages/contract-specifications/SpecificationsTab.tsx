/** Tab 1: the 42 specifications, filtered, tabled, and drawn as two dot plots. */

import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, Stat, SwitchControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import {
  SPECIFICATION_SOURCE, filterSpecifications, type SpecificationRow,
} from "@shared/studies/contract-specifications";
import { Chip, EXCHANGE_GROUP_COLORS, SortableTable, exchangeColor, type Column } from "./parts";
import { splitList, toggleInList, type Controls, type SetControl } from "./controls";

const COLUMNS: Array<Column<SpecificationRow>> = [
  { key: "symbol", label: "symbol", value: (row) => row.symbol },
  { key: "name", label: "name", value: (row) => row.name },
  { key: "product_group", label: "product group", title: "product_group", value: (row) => row.product_group },
  { key: "exchange", label: "exchange", value: (row) => row.exchange },
  { key: "exchange_group", label: "exchange group", title: "exchange_group", value: (row) => row.exchange_group },
  { key: "currency", label: "currency", value: (row) => row.currency },
  { key: "contract_multiplier_per_index_point", label: "multiplier per index point", title: "contract_multiplier_per_index_point", numeric: true, value: (row) => row.contract_multiplier_per_index_point },
  { key: "tick_size_index_points", label: "tick size (index points)", title: "tick_size_index_points", numeric: true, value: (row) => row.tick_size_index_points },
  { key: "tick_value_per_contract", label: "tick value per contract", title: "tick_value_per_contract", numeric: true, value: (row) => row.tick_value_per_contract },
  { key: "contract_months", label: "contract months", title: "contract_months", value: (row) => row.contract_months },
  { key: "contract_months_note", label: "months note", title: "contract_months_note", value: (row) => row.contract_months_note },
  { key: "in_lake", label: "in the lake", title: "in_lake", value: (row) => row.in_lake, render: (row) => (row.in_lake ? "● yes" : "○ no") },
  { key: "verification", label: "verification", value: (row) => row.verification },
];

interface DotPoint {
  symbol: string;
  exchange: string;
  exchange_group: string;
  currency: string;
  x: number;
  name: string;
  multiplier: number;
  tickSize: number;
  tickValue: number;
}

function DotPlot({ rows, valueOf, shape, title, xLabel }: { rows: readonly SpecificationRow[]; valueOf: (row: SpecificationRow) => number; shape: "circle" | "diamond"; title: string; xLabel: string }) {
  const points: DotPoint[] = rows
    .map((row) => ({
      symbol: row.symbol, exchange: row.exchange, exchange_group: row.exchange_group, currency: row.currency, name: row.name,
      x: valueOf(row), multiplier: row.contract_multiplier_per_index_point, tickSize: row.tick_size_index_points, tickValue: row.tick_value_per_contract,
    }))
    .filter((point) => point.x > 0)
    .sort((a, b) => b.x - a.x);
  if (points.length === 0) return <Empty>No contract matches the filters.</Empty>;
  const low = Math.min(...points.map((point) => point.x));
  const high = Math.max(...points.map((point) => point.x));
  const exchangeBySymbol = new Map(points.map((point) => [point.symbol, point.exchange]));
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-xs font-medium text-neutral-200">{title}</h4>
      <ResponsiveContainer width="100%" height={Math.min(1100, 22 * points.length + 56)}>
        <ScatterChart margin={{ top: 4, right: 14, left: 4, bottom: 18 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" scale="log" domain={[low / 1.6, high * 1.6]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => fmt(value, value < 1 ? 2 : 0)} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis type="category" dataKey="symbol" width={86} interval={0} allowDuplicatedCategory={false} {...AXIS} tickFormatter={(symbol: string) => `${symbol} · ${exchangeBySymbol.get(symbol) ?? ""}`} />
          <ZAxis range={[80, 80]} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as DotPoint | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.symbol} · {point.name}</div>
                  <div>{point.exchange_group} · {point.currency}</div>
                  <div>multiplier per index point {fmt(point.multiplier, 4)}</div>
                  <div>tick size {fmt(point.tickSize, 4)} points</div>
                  <div>tick value {fmt(point.tickValue, 4)} {point.currency}</div>
                </div>
              );
            }}
          />
          <Scatter data={points} shape={shape} isAnimationActive={false}>
            {points.map((point) => (
              <Cell key={point.symbol} fill={exchangeColor(point.exchange_group)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpecificationsTab({ rows, controls, set }: { rows: readonly SpecificationRow[]; controls: Controls; set: SetControl }) {
  const groups = [...new Set(rows.map((row) => row.exchange_group))].sort();
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const hiddenGroups = splitList(controls.hiddenExchangeGroups);
  const hiddenCurrencies = splitList(controls.hiddenCurrencies);
  const shown = filterSpecifications(rows, hiddenGroups, hiddenCurrencies, controls.lakeOnly);
  const exchanges = new Set(shown.map((row) => row.exchange));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Contracts shown" value={`${fmtInt(shown.length)} of ${fmtInt(rows.length)}`} />
        <Stat label="Exchanges" value={fmtInt(exchanges.size)} hint={[...exchanges].join(", ")} />
        <Stat label="Roots in the lake" value={fmtInt(shown.filter((row) => row.in_lake).length)} hint="ES, NQ, YM, RTY, MES, MNQ, MYM, M2K" />
        <Stat label="Retrieved from AMP Futures" value={SPECIFICATION_SOURCE.retrievedOn} hint={SPECIFICATION_SOURCE.sourceUrl} />
      </div>

      <Section title="Filter the contracts" question="Toggle an exchange group or a currency off; every table and chart below follows.">
        <ControlBar onReset={() => { set("hiddenExchangeGroups", ""); set("hiddenCurrencies", ""); set("lakeOnly", false); }}>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Exchange groups</div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <Chip key={group} label={group} color={EXCHANGE_GROUP_COLORS[group]} on={!hiddenGroups.includes(group)} onToggle={() => set("hiddenExchangeGroups", toggleInList(controls.hiddenExchangeGroups, group))} />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Currencies</div>
            <div className="flex flex-wrap gap-1.5">
              {currencies.map((currency) => (
                <Chip key={currency} label={currency} on={!hiddenCurrencies.includes(currency)} onToggle={() => set("hiddenCurrencies", toggleInList(controls.hiddenCurrencies, currency))} />
              ))}
            </div>
          </div>
          <SwitchControl label="Only the 8 roots the lake carries" checked={controls.lakeOnly} onChange={(value) => set("lakeOnly", value)} />
        </ControlBar>
      </Section>

      <Section title="The specifications" question="Each contract is a fixed-size bet on an index number: the exchange sets the tick, what a tick is worth, and the expiry months. Click a header to sort.">
        <Finding>
          Numbers from packages/config/contract_specifications.json, the file the chart's tick label and the instruments seed read as well, built from AMP Futures' {SPECIFICATION_SOURCE.sectionsRead.join(", ")} sections;
          CME and CBOT rows also carry what CME Group's own pages state.
        </Finding>
        <SortableTable rows={shown} columns={COLUMNS} rowKey={(row) => row.symbol} filterable maxHeight={460} />
      </Section>

      <Section title="What one tick and one index point are worth" question="Two views of the same rows. Both axes are log scale, in each contract's own currency, so compare within a colour.">
        <p className="mb-2 text-[11px] text-neutral-400">
          <span style={{ color: OKABE.sky }}>● circle</span> money one tick moves · <span style={{ color: OKABE.sky }}>◆ diamond</span> money one whole index point moves (the multiplier). Colour is the exchange group, named on the axis.
        </p>
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <DotPlot rows={shown} valueOf={(row) => row.tick_value_per_contract} shape="circle" title="What one tick is worth" xLabel="one tick, in the contract's own currency (log scale)" />
          <DotPlot rows={shown} valueOf={(row) => row.contract_multiplier_per_index_point} shape="diamond" title="What one index point is worth" xLabel="one index point, in the contract's own currency (log scale)" />
        </div>
        <Finding>
          A contract with a fine tick and a big multiplier (ES: 0.25 points, 50 USD per point) sits far right on the point plot but only mid-way on the tick plot.
        </Finding>
      </Section>

      <Section title="Every numeric column of the specification table">
        <ColumnGrid rows={shown} title="Specification columns" />
      </Section>
    </div>
  );
}
