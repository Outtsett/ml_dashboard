import * as tf from '@tensorflow/tfjs-node';
import * as path from 'path';
import { runQuery } from '../duckdb';
import { pool } from '../db';

const PARQUET_DIR = path.join(process.cwd(), 'data', 'parquet-data');

export interface TrainingData {
  features: tf.Tensor3D;
  labels: tf.Tensor2D;
  trainSize: number;
  valSize: number;
}

export interface DataConfig {
  symbol: string;
  sequenceLength: number;
  trainSplit: number;
  lookAhead: number;
  threshold: number;
}

export const defaultDataConfig: DataConfig = {
  symbol: 'MNQ',
  sequenceLength: 60,
  trainSplit: 0.8,
  lookAhead: 5,
  threshold: 0.001,
};

function normalizeData(data: number[][]): number[][] {
  if (data.length === 0) return data;
  
  const numFeatures = data[0].length;
  const mins: number[] = new Array(numFeatures).fill(Infinity);
  const maxs: number[] = new Array(numFeatures).fill(-Infinity);
  
  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) {
      if (row[j] < mins[j]) mins[j] = row[j];
      if (row[j] > maxs[j]) maxs[j] = row[j];
    }
  }
  
  return data.map(row => 
    row.map((val, j) => {
      const range = maxs[j] - mins[j];
      return range > 0 ? (val - mins[j]) / range : 0;
    })
  );
}

function createLabels(closes: number[], lookAhead: number, threshold: number): number[][] {
  const labels: number[][] = [];
  
  for (let i = 0; i < closes.length - lookAhead; i++) {
    const current = closes[i];
    const future = closes[i + lookAhead];
    const change = (future - current) / current;
    
    if (change > threshold) {
      labels.push([1, 0, 0]);
    } else if (change < -threshold) {
      labels.push([0, 0, 1]);
    } else {
      labels.push([0, 1, 0]);
    }
  }
  
  return labels;
}

export async function loadTrainingData(config: DataConfig = defaultDataConfig): Promise<TrainingData> {
  const symbol = config.symbol.toUpperCase();
  const timeframeSuffix = '5m';
  
  console.log(`[ML] Loading ${symbol} data for training...`);
  
  let rows: any[];
  
  // First try parquet files
  try {
    const query = `
      SELECT timestamp, open, high, low, close, volume
      FROM read_parquet('${path.join(PARQUET_DIR, `${symbol}_${timeframeSuffix}.parquet`).replace(/\\/g, '/')}')
      ORDER BY timestamp ASC
      LIMIT 50000
    `;
    rows = await runQuery(query);
    console.log(`[ML] Loaded ${rows.length} rows from parquet`);
  } catch (parquetError) {
    console.log('[ML] Parquet not found, loading from PostgreSQL...');
    
    // Fall back to PostgreSQL database
    try {
      // First try ohlcv_data with exact symbol match
      let result = await pool.query(`
        SELECT
          (EXTRACT(EPOCH FROM date_trunc('minute', to_timestamp(timestamp/1000))
            - (EXTRACT(MINUTE FROM to_timestamp(timestamp/1000))::int % 5) * INTERVAL '1 minute') * 1000)::bigint as timestamp,
          (ARRAY_AGG(open ORDER BY timestamp ASC))[1] as open,
          MAX(high) as high,
          MIN(low) as low,
          (ARRAY_AGG(close ORDER BY timestamp DESC))[1] as close,
          SUM(volume) as volume
        FROM ohlcv_data
        WHERE symbol = $1
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 50000
      `, [symbol]);

      // If ohlcv_data is empty, try ohlcv_1s with contract-prefix matching (e.g. MNQ -> MNQM5, MNQZ4)
      if (result.rows.length === 0) {
        console.log(`[ML] No data in ohlcv_data for ${symbol}, trying ohlcv_1s with contract matching...`);
        result = await pool.query(`
          SELECT
            (EXTRACT(EPOCH FROM date_trunc('minute', to_timestamp(timestamp/1000))
              - (EXTRACT(MINUTE FROM to_timestamp(timestamp/1000))::int % 5) * INTERVAL '1 minute') * 1000)::bigint as timestamp,
            (ARRAY_AGG(open ORDER BY timestamp ASC))[1] as open,
            MAX(high) as high,
            MIN(low) as low,
            (ARRAY_AGG(close ORDER BY timestamp DESC))[1] as close,
            SUM(volume) as volume
          FROM ohlcv_1s
          WHERE symbol LIKE $1 || '%'
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT 50000
        `, [symbol]);
      }

      rows = result.rows;
      console.log(`[ML] Loaded ${rows.length} aggregated 5m bars from PostgreSQL`);
    } catch (pgError: any) {
      console.error('[ML] PostgreSQL query failed:', pgError.message);
      throw new Error(`No data available for ${symbol}. Please upload OHLCV data first.`);
    }
  }
  
  if (rows.length < config.sequenceLength + config.lookAhead + 100) {
    throw new Error(`Insufficient data for training: got ${rows.length} rows, need at least ${config.sequenceLength + config.lookAhead + 100}`);
  }
  
  console.log(`[ML] Loaded ${rows.length} rows for ${symbol}`);
  
  const ohlcv: number[][] = rows.map(r => [
    Number(r.open),
    Number(r.high),
    Number(r.low),
    Number(r.close),
    Math.log1p(Number(r.volume)),
  ]);
  
  const closes = rows.map(r => Number(r.close));
  
  const normalizedData = normalizeData(ohlcv);
  
  const labels = createLabels(closes, config.lookAhead, config.threshold);
  
  const sequences: number[][][] = [];
  const sequenceLabels: number[][] = [];
  
  for (let i = config.sequenceLength; i < labels.length; i++) {
    const seq = normalizedData.slice(i - config.sequenceLength, i);
    sequences.push(seq);
    sequenceLabels.push(labels[i]);
  }
  
  const splitIdx = Math.floor(sequences.length * config.trainSplit);
  
  const trainX = sequences.slice(0, splitIdx);
  const trainY = sequenceLabels.slice(0, splitIdx);
  const valX = sequences.slice(splitIdx);
  const valY = sequenceLabels.slice(splitIdx);
  
  console.log(`[ML] Training samples: ${trainX.length}, Validation samples: ${valX.length}`);
  
  const featuresTensor = tf.tensor3d([...trainX, ...valX]);
  const labelsTensor = tf.tensor2d([...trainY, ...valY]);
  
  return {
    features: featuresTensor,
    labels: labelsTensor,
    trainSize: trainX.length,
    valSize: valX.length,
  };
}

export function disposeData(data: TrainingData): void {
  data.features.dispose();
  data.labels.dispose();
}
