import * as tf from '@tensorflow/tfjs-node';
import * as path from 'path';
import { runQuery } from '@server/duckdb';

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

  // Validate symbol to prevent path traversal (only alphanumeric and common futures suffixes)
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) {
    throw new Error(`Invalid symbol for training: ${symbol}`);
  }

  console.log(`[ML] Loading ${symbol} data for training...`);

  let rows: any[];

  // Load from parquet files (DuckDB)
  try {
    const parquetFile = path.join(PARQUET_DIR, `${symbol}_${timeframeSuffix}.parquet`);
    // Ensure resolved path stays within PARQUET_DIR
    const resolvedPath = path.resolve(parquetFile);
    if (!resolvedPath.startsWith(path.resolve(PARQUET_DIR))) {
      throw new Error(`Path traversal detected for symbol: ${symbol}`);
    }
    const safePath = resolvedPath.replace(/\\/g, '/');
    const query = `
      SELECT timestamp, open, high, low, close, volume
      FROM read_parquet('${safePath}')
      ORDER BY timestamp ASC
      LIMIT 50000
    `;
    rows = await runQuery(query);
    console.log(`[ML] Loaded ${rows.length} rows from parquet`);
  } catch (parquetError) {
    console.error('[ML] Parquet loading failed:', parquetError);
    throw new Error(`No data available for ${symbol}. Please upload OHLCV parquet data first.`);
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
