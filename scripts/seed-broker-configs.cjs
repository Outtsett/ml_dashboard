const { Client } = require('pg');

async function main() {
  const c = new Client('postgresql://postgres:postgres@localhost:5432/ml_dashboard');
  await c.connect();

  // ========== BROKER CONFIGS ==========
  
  // Oanda - Forex (spread-based, no commission on standard accounts)
  await c.query(`INSERT INTO broker_configs (name, broker, asset_type, commission_type, commission_per_lot, spread_type, typical_spread_pips, slippage_model, slippage_ticks, margin_type, default_margin, is_default, config)
    VALUES ('oanda_standard', 'Oanda', 'forex', 'spread_only', 0, 'variable', 1.3, 'fixed', 0.5, 'percentage', 3333, 1,
    '${JSON.stringify({
      description: 'Oanda Standard account - spread only, no commission. Margin = 30:1 leverage (3.33%)',
      symbolSpreads: {
        EURUSD: 1.3, GBPUSD: 1.7, USDJPY: 1.4, USDCHF: 1.7,
        AUDUSD: 1.6, NZDUSD: 2.0, USDCAD: 1.8,
        EURGBP: 1.5, EURJPY: 2.0, GBPJPY: 3.0,
        EURAUD: 2.5, EURCHF: 2.0, GBPAUD: 3.5, GBPCHF: 3.5,
        AUDCAD: 2.5, AUDCHF: 2.8, AUDNZD: 3.0
      }
    })}')
    ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, typical_spread_pips = EXCLUDED.typical_spread_pips`);

  // AMP Futures - Micros
  await c.query(`INSERT INTO broker_configs (name, broker, asset_type, commission_type, commission_per_side, commission_per_round_turn, spread_type, typical_spread_pips, slippage_model, slippage_ticks, margin_type, default_margin, is_default, config)
    VALUES ('amp_micros', 'AMP Futures', 'futures', 'per_side', 0.62, 1.24, 'fixed', 0.25, 'fixed', 1, 'fixed', 30, 1,
    '${JSON.stringify({
      description: 'AMP Futures micro contracts - $0.62/side ($1.24 RT) all-in. $30 intraday margin.',
      exchange: 'CME',
      symbolMargins: {
        MES: 30, MNQ: 30, MYM: 30, M2K: 30
      },
      symbolCommissions: {
        MES: 0.62, MNQ: 0.62, MYM: 0.62, M2K: 0.62
      }
    })}')
    ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, commission_per_side = EXCLUDED.commission_per_side`);

  // AMP Futures - Minis
  await c.query(`INSERT INTO broker_configs (name, broker, asset_type, commission_type, commission_per_side, commission_per_round_turn, spread_type, typical_spread_pips, slippage_model, slippage_ticks, margin_type, default_margin, is_default, config)
    VALUES ('amp_minis', 'AMP Futures', 'futures', 'per_side', 1.10, 2.20, 'fixed', 0.25, 'fixed', 1, 'fixed', 300, 0,
    '${JSON.stringify({
      description: 'AMP Futures mini/full contracts - $1.10/side ($2.20 RT). ~$300 intraday margin (varies by product).',
      exchange: 'CME',
      symbolMargins: {
        ES: 300, NQ: 300, YM: 300, RTY: 300
      },
      symbolCommissions: {
        ES: 1.10, NQ: 1.10, YM: 1.10, RTY: 1.10
      }
    })}')
    ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, commission_per_side = EXCLUDED.commission_per_side`);

  console.log('Broker configs seeded');

  // ========== INSTRUMENT MARGINS ==========
  
  // AMP Futures intraday margins
  const futuresMargins = {
    MES: 30, MNQ: 30, MYM: 30, M2K: 30,   // Micros
    ES: 300, NQ: 300, YM: 300, RTY: 300      // Minis
  };

  for (const [symbol, margin] of Object.entries(futuresMargins)) {
    const res = await c.query(
      `UPDATE instruments SET margin_requirement = $1 WHERE symbol = $2`,
      [margin, symbol]
    );
    console.log(`  ${symbol}: margin=$${margin} (${res.rowCount} rows updated)`);
  }

  // Forex margins (Oanda 30:1 leverage = 3.33% of notional)
  // For a standard lot of 100,000 units, margin varies by pair
  // We'll set margin_requirement as the USD margin for 1 standard lot
  const forexMargins = {
    EURUSD: 3333, GBPUSD: 3333, USDJPY: 3333, USDCHF: 3333,
    AUDUSD: 3333, NZDUSD: 3333, USDCAD: 3333,
    EURGBP: 3333, EURJPY: 3333, GBPJPY: 3333,
    EURAUD: 3333, EURCHF: 3333, GBPAUD: 3333, GBPCHF: 3333,
    AUDCAD: 3333, AUDCHF: 3333, AUDNZD: 3333
  };

  for (const [symbol, margin] of Object.entries(forexMargins)) {
    const res = await c.query(
      `UPDATE instruments SET margin_requirement = $1 WHERE symbol = $2`,
      [margin, symbol]
    );
    console.log(`  ${symbol}: margin=$${margin} (${res.rowCount} rows updated)`);
  }

  console.log('\\nAll instrument margins updated');
  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
