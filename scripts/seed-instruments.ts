/**
 * Seed the instruments table with known symbols and their metadata.
 * Run: npx tsx scripts/seed-instruments.ts
 *
 * Futures rows come from `packages/config/contract_specifications.json` through
 * `packages/shared/src/instruments.ts` (the roots the lake carries); forex rows are listed here.
 */
import { db, closeDatabases } from '../apps/api/infrastructure/database/db';
import { instruments, type InsertInstrument } from '../packages/shared/src/pg_schema';
import { futuresInstrumentRows } from '../packages/shared/src/instruments';

const FOREX_INSTRUMENTS: InsertInstrument[] = [
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

const INSTRUMENTS: InsertInstrument[] = [...futuresInstrumentRows(), ...FOREX_INSTRUMENTS];

async function main() {
  console.log('[seed] Seeding instruments table...');

  for (const inst of INSTRUMENTS) {
    await db.insert(instruments)
      .values(inst)
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
          pipSize: inst.pipSize ?? null,
          contractMonths: inst.contractMonths ?? null,
          tradingHours: inst.tradingHours ?? null,
        },
      });
    const detail = inst.pipSize ? ` pip=${inst.pipSize}` : ` tick=${inst.tickSize}=${inst.currency} ${inst.tickValue} months=${inst.contractMonths}`;
    console.log(`  ${inst.symbol} (${inst.assetType})${detail}`);
  }

  console.log(`[seed] Done. ${INSTRUMENTS.length} instruments seeded.`);
  closeDatabases();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
