import { describe, it, expect } from 'vitest';
import { insertInstrumentSchema, insertContractRolloverSchema } from '../shared/schema';

describe('instruments table', () => {
  it('should accept pip_size for forex instruments', () => {
    const result = insertInstrumentSchema.safeParse({
      symbol: 'EURUSD',
      name: 'EUR/USD',
      assetType: 'forex',
      exchange: 'OANDA',
      tickSize: 0.00001,
      tickValue: 1,
      pointValue: 100000,
      contractSize: 100000,
      currency: 'USD',
      decimalPlaces: 5,
      pipSize: 0.0001,
    });
    expect(result.success).toBe(true);
  });

  it('should accept contract_months for futures instruments', () => {
    const result = insertInstrumentSchema.safeParse({
      symbol: 'MNQ',
      name: 'Micro Nasdaq',
      assetType: 'futures',
      exchange: 'CME',
      tickSize: 0.25,
      tickValue: 0.5,
      pointValue: 2,
      contractSize: 1,
      currency: 'USD',
      decimalPlaces: 2,
      contractMonths: ['H', 'M', 'U', 'Z'],
    });
    expect(result.success).toBe(true);
  });

  it('should allow pip_size to be null for futures', () => {
    const result = insertInstrumentSchema.safeParse({
      symbol: 'MNQ',
      name: 'Micro Nasdaq',
      assetType: 'futures',
      exchange: 'CME',
      tickSize: 0.25,
      tickValue: 0.5,
      pointValue: 2,
      contractSize: 1,
      currency: 'USD',
      decimalPlaces: 2,
    });
    expect(result.success).toBe(true);
  });
});

describe('contractRollovers table', () => {
  it('should accept ratio back-adjustment fields', () => {
    const result = insertContractRolloverSchema.safeParse({
      baseSymbol: 'MNQ',
      fromContract: 'MNQH26',
      toContract: 'MNQM26',
      rolloverTimestamp: 1710547200000,
      fromClose: 18250.50,
      toClose: 18275.25,
      ratio: 18275.25 / 18250.50,
      rolloverType: 'volume',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ratio).toBeCloseTo(1.001355, 4);
    }
  });

  it('should reject missing ratio fields', () => {
    const result = insertContractRolloverSchema.safeParse({
      baseSymbol: 'MNQ',
      fromContract: 'MNQH26',
      toContract: 'MNQM26',
      rolloverTimestamp: 1710547200000,
      rolloverType: 'volume',
    });
    expect(result.success).toBe(false);
  });
});
