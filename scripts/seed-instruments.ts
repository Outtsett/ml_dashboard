/**
 * Seed the instruments table with known symbols and their metadata.
 * Run: npx tsx scripts/seed-instruments.ts
 */
import { db } from '../server/db';
import { instruments } from '../shared/schema';

const INSTRUMENTS = [
  // CME Micro Futures
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 0.50, pointValue: 2, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 1.25, pointValue: 5, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'MYM', name: 'Micro E-mini Dow', assetType: 'futures', exchange: 'CBOT', tickSize: 1.0, tickValue: 0.50, pointValue: 0.50, contractSize: 1, currency: 'USD', decimalPlaces: 0, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'M2K', name: 'Micro E-mini Russell 2000', assetType: 'futures', exchange: 'CME', tickSize: 0.10, tickValue: 0.50, pointValue: 5, contractSize: 1, currency: 'USD', decimalPlaces: 1, contractMonths: ['H', 'M', 'U', 'Z'] },
  // E-mini Futures (parent contracts from Databento data)
  { symbol: 'ES', name: 'E-mini S&P 500', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 12.50, pointValue: 50, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'NQ', name: 'E-mini Nasdaq-100', assetType: 'futures', exchange: 'CME', tickSize: 0.25, tickValue: 5.00, pointValue: 20, contractSize: 1, currency: 'USD', decimalPlaces: 2, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'YM', name: 'E-mini Dow', assetType: 'futures', exchange: 'CBOT', tickSize: 1.0, tickValue: 5.00, pointValue: 5, contractSize: 1, currency: 'USD', decimalPlaces: 0, contractMonths: ['H', 'M', 'U', 'Z'] },
  { symbol: 'RTY', name: 'E-mini Russell 2000', assetType: 'futures', exchange: 'CME', tickSize: 0.10, tickValue: 5.00, pointValue: 50, contractSize: 1, currency: 'USD', decimalPlaces: 1, contractMonths: ['H', 'M', 'U', 'Z'] },

  // Major Forex Pairs
  { symbol: 'EURUSD', name: 'EUR/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'GBPUSD', name: 'GBP/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'AUDUSD', name: 'AUD/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'NZDUSD', name: 'NZD/USD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'USD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'USDCAD', name: 'USD/CAD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'CAD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'USDCHF', name: 'USD/CHF', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'CHF', decimalPlaces: 5, pipSize: 0.0001 },

  // JPY Pairs (different pip location: 0.01 instead of 0.0001)
  { symbol: 'USDJPY', name: 'USD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'EURJPY', name: 'EUR/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'GBPJPY', name: 'GBP/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'AUDJPY', name: 'AUD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'NZDJPY', name: 'NZD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'CADJPY', name: 'CAD/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },
  { symbol: 'CHFJPY', name: 'CHF/JPY', assetType: 'forex', exchange: 'OANDA', tickSize: 0.001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'JPY', decimalPlaces: 3, pipSize: 0.01 },

  // Cross Pairs
  { symbol: 'EURGBP', name: 'EUR/GBP', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'GBP', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'EURAUD', name: 'EUR/AUD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'AUD', decimalPlaces: 5, pipSize: 0.0001 },
  { symbol: 'GBPAUD', name: 'GBP/AUD', assetType: 'forex', exchange: 'OANDA', tickSize: 0.00001, tickValue: 1, pointValue: 100000, contractSize: 100000, currency: 'AUD', decimalPlaces: 5, pipSize: 0.0001 },
];

async function main() {
  console.log('[seed] Seeding instruments table...');

  for (const inst of INSTRUMENTS) {
    await db.insert(instruments)
      .values(inst as any)
      .onConflictDoUpdate({
        target: instruments.symbol,
        set: {
          name: inst.name,
          assetType: inst.assetType,
          exchange: inst.exchange,
          tickSize: inst.tickSize,
          tickValue: inst.tickValue,
          pointValue: inst.pointValue,
          contractSize: inst.contractSize,
          currency: inst.currency,
          decimalPlaces: inst.decimalPlaces,
          pipSize: (inst as any).pipSize ?? null,
          contractMonths: (inst as any).contractMonths ?? null,
        },
      });
    console.log(`  ${inst.symbol} (${inst.assetType})${(inst as any).pipSize ? ` pip=${(inst as any).pipSize}` : ''}`);
  }

  console.log(`[seed] Done. ${INSTRUMENTS.length} instruments seeded.`);
  process.exit(0);
}

main().catch(console.error);
