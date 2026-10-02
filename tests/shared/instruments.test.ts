/**
 * `packages/config/contract_specifications.json` is the one place stock-index futures specs live.
 * These tests hold the file to itself (every tick value is tick size × multiplier, every month
 * code is real) and hold its two derived readers — the chart's tick table and the instruments
 * seed — plus `cost_model.json` to it, so none of the four can drift again.
 */
import { describe, expect, it } from 'vitest';

import costModel from '../../packages/config/cost_model.json';
import { futuresTickInfo as chartFuturesTickInfo } from '../../apps/web/src/market/components/chartConfig';
import {
  CONTRACT_SPECIFICATIONS,
  MONTH_CODES,
  contractSpecification,
  futuresInstrumentRows,
  futuresTickInfo,
} from '../../packages/shared/src/instruments';
import { insertInstrumentSchema } from '../../packages/shared/src/schema';

const LAKE_ROOTS = ['ES', 'M2K', 'MES', 'MNQ', 'MYM', 'NQ', 'RTY', 'YM'];

describe('contract_specifications.json', () => {
  it('lists every stock-index contract on the AMP page exactly once', () => {
    expect(CONTRACT_SPECIFICATIONS.length).toBe(42);
    const symbols = CONTRACT_SPECIFICATIONS.map((contract) => contract.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('tick value is tick size × multiplier on every row', () => {
    for (const contract of CONTRACT_SPECIFICATIONS) {
      expect(
        contract.tick_size_index_points * contract.contract_multiplier_per_index_point,
        contract.symbol,
      ).toBeCloseTo(contract.tick_value_per_contract, 9);
      expect(contract.tick_size_index_points, contract.symbol).toBeGreaterThan(0);
      expect(contract.contract_multiplier_per_index_point, contract.symbol).toBeGreaterThan(0);
    }
  });

  it('price decimal places are exactly the digits the tick size needs', () => {
    for (const contract of CONTRACT_SPECIFICATIONS) {
      const tick = contract.tick_size_index_points;
      const decimals = contract.price_decimal_places;
      expect(Number(tick.toFixed(decimals)), contract.symbol).toBe(tick);
      if (decimals > 0) expect(Number(tick.toFixed(decimals - 1)), contract.symbol).not.toBe(tick);
    }
  });

  it('month codes are real, and every quarterly row is H, M, U, Z', () => {
    expect(Object.keys(MONTH_CODES)).toEqual(['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']);
    for (const contract of CONTRACT_SPECIFICATIONS) {
      if (contract.contract_months === null) {
        expect(contract.contract_months_note, contract.symbol).toMatch(/exchange|all calendar months/);
        continue;
      }
      expect(contract.contract_months, contract.symbol).toEqual(['H', 'M', 'U', 'Z']);
      for (const code of contract.contract_months) expect(MONTH_CODES[code], contract.symbol).toBeDefined();
    }
  });

  it('flags exactly the eight roots the lake carries', () => {
    const inLake = CONTRACT_SPECIFICATIONS.filter((contract) => contract.in_lake).map((c) => c.symbol).sort();
    expect(inLake).toEqual(LAKE_ROOTS);
  });

  it('every lake root is verified against CME Group and carries the exchange fields', () => {
    for (const symbol of LAKE_ROOTS) {
      const contract = contractSpecification(symbol);
      expect(contract, symbol).toBeDefined();
      expect(contract!.verification, symbol).toContain('cme_group');
      expect(contract!.globex_code, symbol).toBe(symbol);
      expect(contract!.trading_hours_central_time, symbol).toContain('4:00 p.m. - 5:00 p.m. CT');
      expect(contract!.last_trading_day, symbol).toMatch(/3rd Friday/i);
      expect(contract!.settlement, symbol).toBeTruthy();
      expect(contract!.currency, symbol).toBe('USD');
    }
  });

  it('YM and MYM are CBOT-listed; every other lake root is CME', () => {
    for (const symbol of LAKE_ROOTS) {
      expect(contractSpecification(symbol)!.exchange, symbol).toBe(symbol === 'YM' || symbol === 'MYM' ? 'CBOT' : 'CME');
    }
  });
});

describe('readers derived from the specification', () => {
  it('the chart tick table is the specification, not a copy', () => {
    expect(chartFuturesTickInfo).toBe(futuresTickInfo);
    for (const contract of CONTRACT_SPECIFICATIONS) {
      expect(futuresTickInfo[contract.symbol]).toEqual({
        tickSize: contract.tick_size_index_points,
        tickValue: contract.tick_value_per_contract,
        decimals: contract.price_decimal_places,
      });
    }
    // The values the chart showed before the table was derived (2026-09-25), kept as a regression pin.
    expect(futuresTickInfo.ES).toEqual({ tickSize: 0.25, tickValue: 12.5, decimals: 2 });
    expect(futuresTickInfo.MNQ).toEqual({ tickSize: 0.25, tickValue: 0.5, decimals: 2 });
    expect(futuresTickInfo.YM).toEqual({ tickSize: 1, tickValue: 5, decimals: 0 });
    expect(futuresTickInfo.RTY).toEqual({ tickSize: 0.1, tickValue: 5, decimals: 1 });
  });

  it('the seed rows are the lake roots and pass the instruments insert schema', () => {
    const rows = futuresInstrumentRows();
    expect(rows.map((row) => row.symbol).sort()).toEqual(LAKE_ROOTS);
    for (const row of rows) {
      const contract = contractSpecification(row.symbol)!;
      expect(insertInstrumentSchema.safeParse(row).success, row.symbol).toBe(true);
      expect(row.assetType).toBe('futures');
      expect(row.tickSize).toBe(contract.tick_size_index_points);
      expect(row.tickValue).toBe(contract.tick_value_per_contract);
      expect(row.pointValue).toBe(contract.contract_multiplier_per_index_point);
      expect(row.decimalPlaces).toBe(contract.price_decimal_places);
      expect(row.exchange).toBe(contract.exchange);
      expect(JSON.parse(row.contractMonths as string)).toEqual(contract.contract_months);
      expect(row.tradingHours).toBe(contract.trading_hours_central_time);
    }
  });

  it('cost_model.json agrees with the specification for every symbol it prices', () => {
    for (const [symbol, entry] of Object.entries(costModel)) {
      const contract = contractSpecification(symbol);
      expect(contract, symbol).toBeDefined();
      expect(entry.tick_size, symbol).toBe(contract!.tick_size_index_points);
      expect(entry.tick_value, symbol).toBe(contract!.tick_value_per_contract);
      expect(entry.point_value, symbol).toBe(contract!.contract_multiplier_per_index_point);
    }
  });
});
