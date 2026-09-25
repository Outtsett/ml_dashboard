/**
 * Futures instrument metadata, read from `src/config/contract_specifications.json`.
 *
 * That file is built by `scripts/build_contract_specifications.py` from AMP Futures' contract
 * specifications (tick, exchange, contract size, months) and is the one place the numbers live.
 * Two readers derive from it here so they cannot drift from each other:
 *   - `futuresTickInfo` — the chart's price-scale precision and "Tick: … = $…" label
 *     (`src/client/src/market/components/chartConfig.ts`);
 *   - `futuresInstrumentRows()` — the futures rows `scripts/seed-instruments.ts` upserts into the
 *     SQLite `instruments` table, served at `/api/instruments`.
 * `tests/shared/instruments.test.ts` holds both to the JSON; `tests/test_contract_specifications.py`
 * holds `src/config/cost_model.json` to it.
 */
import specifications from '../config/contract_specifications.json';
import type { InsertInstrument } from './schema';

export interface ContractSpecification {
  symbol: string;
  name: string;
  product_group: 'e_nano' | 'micro_e_mini' | 'stock_index';
  exchange: string;
  exchange_group: string;
  currency: string;
  /** Currency per index point, per contract — the "point value" the simulators multiply by. */
  contract_multiplier_per_index_point: number;
  /** Minimum price fluctuation, in index points. */
  tick_size_index_points: number;
  /** What one tick is worth for one contract, in `currency`. */
  tick_value_per_contract: number;
  price_decimal_places: number;
  /** Month codes (H, M, U, Z …), or null when AMP defers to the exchange's listing cycle. */
  contract_months: string[] | null;
  contract_months_note: string;
  /** True for the roots the lake carries (ES, NQ, YM, RTY, MES, MNQ, MYM, M2K). */
  in_lake: boolean;
  verification: string[];
  trading_hours_central_time?: string;
  last_trading_day?: string;
  settlement?: string;
  globex_code?: string;
}

export const CONTRACT_SPECIFICATIONS: readonly ContractSpecification[] =
  specifications.contracts as ContractSpecification[];

export const MONTH_CODES: Readonly<Record<string, string>> = specifications.month_codes;

const BY_SYMBOL = new Map(CONTRACT_SPECIFICATIONS.map((contract) => [contract.symbol, contract]));

export function contractSpecification(symbol: string): ContractSpecification | undefined {
  return BY_SYMBOL.get(symbol);
}

export interface FuturesTickInfo {
  tickSize: number;
  tickValue: number;
  decimals: number;
}

/** Keyed by root symbol. Every stock-index contract AMP lists, so a chart of any of them formats its scale. */
export const futuresTickInfo: Readonly<Record<string, FuturesTickInfo>> = Object.fromEntries(
  CONTRACT_SPECIFICATIONS.map((contract) => [
    contract.symbol,
    {
      tickSize: contract.tick_size_index_points,
      tickValue: contract.tick_value_per_contract,
      decimals: contract.price_decimal_places,
    },
  ]),
);

/** The `instruments` rows for the roots the lake carries — the symbols the pickers offer. */
export function futuresInstrumentRows(): InsertInstrument[] {
  return CONTRACT_SPECIFICATIONS.filter((contract) => contract.in_lake).map((contract) => ({
    symbol: contract.symbol,
    name: contract.name,
    assetType: 'futures',
    exchange: contract.exchange,
    tickSize: contract.tick_size_index_points,
    tickValue: contract.tick_value_per_contract,
    pointValue: contract.contract_multiplier_per_index_point,
    contractSize: 1,
    currency: contract.currency,
    decimalPlaces: contract.price_decimal_places,
    pipSize: null,
    contractMonths: contract.contract_months ? JSON.stringify(contract.contract_months) : null,
    tradingHours: contract.trading_hours_central_time ?? null,
    marginRequirement: null,
  }));
}
