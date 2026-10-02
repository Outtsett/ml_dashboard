/** Tab 5: where the numbers are used, how far they were checked, and what the lake covers. */

import { Finding, Section } from "@/studies/kit";
import { verificationSummary, type RootCoverage, type SpecificationRow } from "@shared/studies/contract-specifications";
import { SortableTable, type Column } from "./parts";

const READERS: Array<{ reader: string; takes: string }> = [
  { reader: "scripts/seed-instruments.ts → SQLite instruments", takes: "tick size, tick value, multiplier (point value), exchange, months, decimal places, for the 8 lake roots; served at /api/instruments" },
  { reader: "apps/web/src/market/components/chartConfig.ts", takes: "tick size, tick value and decimals for the chart's price scale and its \"Tick: … = $…\" label" },
  { reader: "packages/config/cost_model.json (MNQ)", takes: "tick size, tick value, point value beside the broker fees; tests/test_contract_specifications.py holds it equal to the specification file" },
  { reader: "packages/ml-engine/src/cycle/simulate.py, packages/ml-engine/src/blocks/trading_env.py, packages/ml-engine/src/lens/adapters.py", takes: "read the cost model, so USD P&L = points × multiplier rests on these rows" },
];

const VERIFICATION_COLUMNS: Array<Column<ReturnType<typeof verificationSummary>[number]>> = [
  { key: "verification", label: "verification", value: (row) => row.verification },
  { key: "contracts", label: "contracts", numeric: true, value: (row) => row.contracts },
  { key: "in_lake", label: "in the lake", title: "in_lake", numeric: true, value: (row) => row.in_lake },
];

const LAKE_COLUMNS: Array<Column<SpecificationRow>> = [
  { key: "symbol", label: "symbol", value: (row) => row.symbol },
  { key: "exchange", label: "exchange", value: (row) => row.exchange },
  { key: "tick_size_index_points", label: "tick size (index points)", title: "tick_size_index_points", numeric: true, value: (row) => row.tick_size_index_points },
  { key: "tick_value_per_contract", label: "tick value per contract", title: "tick_value_per_contract", numeric: true, value: (row) => row.tick_value_per_contract },
  { key: "contract_multiplier_per_index_point", label: "multiplier per index point", title: "contract_multiplier_per_index_point", numeric: true, value: (row) => row.contract_multiplier_per_index_point },
  { key: "contract_months", label: "contract months", title: "contract_months", value: (row) => row.contract_months },
  { key: "trading_hours_central_time", label: "trading hours (Central)", title: "trading_hours_central_time", value: (row) => row.trading_hours_central_time },
  { key: "last_trading_day", label: "last trading day", title: "last_trading_day", value: (row) => row.last_trading_day },
];

const COVERAGE_COLUMNS: Array<Column<RootCoverage>> = [
  { key: "root", label: "root", value: (row) => row.root },
  { key: "first_day", label: "first daily bar", title: "first_day", value: (row) => row.first_day },
  { key: "last_day", label: "last daily bar", title: "last_day", value: (row) => row.last_day },
  { key: "day_count", label: "days with a front contract", title: "day_count", numeric: true, value: (row) => row.day_count },
];

export function UsageTab({ rows, coverage }: { rows: readonly SpecificationRow[]; coverage: readonly RootCoverage[] }) {
  return (
    <div className="space-y-3">
      <Section title="Where these numbers are used" question="Every simulator's dollar figure rests on the same specification rows.">
        <SortableTable
          rows={READERS}
          columns={[
            { key: "reader", label: "reader", value: (row) => row.reader },
            { key: "takes", label: "what it takes from the specification", value: (row) => row.takes, render: (row) => <span className="whitespace-normal">{row.takes}</span> },
          ]}
          rowKey={(row) => row.reader}
          maxHeight={300}
        />
      </Section>

      <Section title="How far they were checked" question="Contracts by verification source: AMP Futures alone, or AMP cross-checked against CME Group's own pages.">
        <SortableTable rows={verificationSummary(rows)} columns={VERIFICATION_COLUMNS} rowKey={(row) => row.verification} maxHeight={200} />
      </Section>

      <Section title="The eight roots the lake carries" question="With the CME Group fields.">
        <SortableTable rows={rows.filter((row) => row.in_lake)} columns={LAKE_COLUMNS} rowKey={(row) => row.symbol} maxHeight={360} />
      </Section>

      <Section title="What the lake holds for each root" question="First and last day of the daily front contract, measured from ohlcv_1d.">
        <SortableTable rows={coverage} columns={COVERAGE_COLUMNS} rowKey={(row) => row.root} maxHeight={300} />
        <Finding>
          {coverage.length === 0
            ? "The daily bars are not served right now."
            : `Last daily bar by root: ${coverage.map((row) => `${row.root} ${row.last_day}`).join(", ")}. A chart anchored to the newest bar of a root lands on its last day, not on today.`}
        </Finding>
      </Section>
    </div>
  );
}
