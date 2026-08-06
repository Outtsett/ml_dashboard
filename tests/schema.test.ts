import { describe, it, expect } from 'vitest';
import { insertInstrumentSchema } from '../src/shared/schema';

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
      contractMonths: JSON.stringify(['H', 'M', 'U', 'Z']),
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
