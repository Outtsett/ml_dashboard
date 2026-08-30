import * as Comlink from 'comlink';

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class MathProcessor {
  /**
   * Calculates a Simple Moving Average (SMA).
   */
  public calculateSMA(data: OHLCV[], period: number): { time: number; value: number }[] {
    const sma: { time: number; value: number }[] = [];
    if (data.length < period) return sma;

    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i]!.close;
    }
    
    sma.push({ time: data[period - 1]!.timestamp, value: sum / period });

    for (let i = period; i < data.length; i++) {
      sum += data[i]!.close - data[i - period]!.close;
      sma.push({ time: data[i]!.timestamp, value: sum / period });
    }

    return sma;
  }

  /**
   * Calculates Volume Weighted Average Price (VWAP) for the entire series.
   * Assumes data is pre-sliced to the trading session.
   */
  public calculateVWAP(data: OHLCV[]): { time: number; value: number }[] {
    const vwap: { time: number; value: number }[] = [];
    let cumulativeVolume = 0;
    let cumulativeVolumePrice = 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const typicalPrice = (d.high + d.low + d.close) / 3;
      const volume = d.volume || 0;
      
      cumulativeVolume += volume;
      cumulativeVolumePrice += typicalPrice * volume;
      
      vwap.push({
        time: d.timestamp,
        value: cumulativeVolume === 0 ? typicalPrice : cumulativeVolumePrice / cumulativeVolume
      });
    }

    return vwap;
  }

  /**
   * Mock heavy operation to test thread blocking.
   */
  public async computeHeavyLoad(iterations: number): Promise<string> {
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i);
    }
    return `Computed ${iterations} iterations in worker. Result: ${result}`;
  }
}

Comlink.expose(MathProcessor);
