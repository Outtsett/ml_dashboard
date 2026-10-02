export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Histogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Map<number, number>;
}

class MetricsRegistry {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private timeSeries: Map<string, MetricPoint[]> = new Map();
  private maxTimeSeriesLength = 1000;
  
  private static instance: MetricsRegistry;
  
  static getInstance(): MetricsRegistry {
    if (!MetricsRegistry.instance) {
      MetricsRegistry.instance = new MetricsRegistry();
    }
    return MetricsRegistry.instance;
  }

  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    let histogram = this.histograms.get(key);
    
    if (!histogram) {
      histogram = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map([
          [0.01, 0], [0.05, 0], [0.1, 0], [0.25, 0], [0.5, 0],
          [1, 0], [2.5, 0], [5, 0], [10, 0], [Infinity, 0]
        ])
      };
      this.histograms.set(key, histogram);
    }
    
    histogram.count++;
    histogram.sum += value;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);
    
    for (const [bucket, count] of Array.from(histogram.buckets)) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, count + 1);
        break;
      }
    }
  }

  recordTimeSeries(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    let series = this.timeSeries.get(key);
    
    if (!series) {
      series = [];
      this.timeSeries.set(key, series);
    }
    
    series.push({ timestamp: Date.now(), value, labels });
    
    if (series.length > this.maxTimeSeriesLength) {
      series.shift();
    }
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.buildKey(name, labels);
    return this.counters.get(key) || 0;
  }

  getGauge(name: string, labels?: Record<string, string>): number {
    const key = this.buildKey(name, labels);
    return this.gauges.get(key) || 0;
  }

  getHistogram(name: string, labels?: Record<string, string>): Histogram | undefined {
    const key = this.buildKey(name, labels);
    return this.histograms.get(key);
  }

  getTimeSeries(name: string, labels?: Record<string, string>): MetricPoint[] {
    const key = this.buildKey(name, labels);
    return this.timeSeries.get(key) || [];
  }

  getAllMetrics(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }>;
  } {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }> = {};
    
    for (const [key, value] of Array.from(this.counters)) {
      counters[key] = value;
    }
    
    for (const [key, value] of Array.from(this.gauges)) {
      gauges[key] = value;
    }
    
    for (const [key, hist] of Array.from(this.histograms)) {
      histograms[key] = {
        count: hist.count,
        sum: hist.sum,
        min: hist.min === Infinity ? 0 : hist.min,
        max: hist.max === -Infinity ? 0 : hist.max,
        avg: hist.count > 0 ? hist.sum / hist.count : 0
      };
    }
    
    return { counters, gauges, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timeSeries.clear();
  }

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }
}

export const metrics = MetricsRegistry.getInstance();

export function withTiming<T>(
  metricName: string,
  fn: () => Promise<T>,
  labels?: Record<string, string>
): Promise<T> {
  const start = Date.now();
  return fn().finally(() => {
    const duration = (Date.now() - start) / 1000;
    metrics.recordHistogram(metricName, duration, labels);
    metrics.recordTimeSeries(`${metricName}_duration`, duration, labels);
  });
}

export class DataPipelineMetrics {
  recordUpload(symbol: string, recordCount: number, durationMs: number, success: boolean): void {
    metrics.incrementCounter('data_pipeline_uploads_total', 1, { symbol, success: String(success) });
    metrics.incrementCounter('data_pipeline_records_uploaded', recordCount, { symbol });
    metrics.recordHistogram('data_pipeline_upload_duration_seconds', durationMs / 1000, { symbol });
    
    if (success) {
      metrics.setGauge('data_pipeline_last_upload_timestamp', Date.now(), { symbol });
      metrics.setGauge('data_pipeline_last_upload_records', recordCount, { symbol });
    }
  }

  recordQuery(source: string, symbol: string, durationMs: number, rowCount: number): void {
    metrics.incrementCounter('data_pipeline_queries_total', 1, { source, symbol });
    metrics.incrementCounter('data_pipeline_rows_returned', rowCount, { source, symbol });
    metrics.recordHistogram('data_pipeline_query_duration_seconds', durationMs / 1000, { source, symbol });
    metrics.recordTimeSeries('data_pipeline_query_throughput', rowCount / (durationMs / 1000), { source, symbol });
  }

  recordDatabaseHealth(database: string, healthy: boolean, latencyMs: number): void {
    metrics.setGauge('database_health', healthy ? 1 : 0, { database });
    metrics.recordHistogram('database_health_check_latency_seconds', latencyMs / 1000, { database });
  }

  recordCacheHit(source: string, hit: boolean): void {
    metrics.incrementCounter('cache_requests_total', 1, { source, hit: String(hit) });
  }

  recordlakeInsert(symbol: string, rowCount: number, durationMs: number, success: boolean): void {
    metrics.incrementCounter('lake_inserts_total', 1, { symbol, success: String(success) });
    if (success) {
      metrics.incrementCounter('lake_rows_inserted', rowCount, { symbol });
    }
    metrics.recordHistogram('lake_insert_duration_seconds', durationMs / 1000, { symbol });
  }

  recordlakeQuery(symbol: string, timeframe: string, durationMs: number, rowCount: number, success: boolean): void {
    metrics.incrementCounter('lake_queries_total', 1, { symbol, timeframe, success: String(success) });
    if (success) {
      metrics.incrementCounter('lake_rows_returned', rowCount, { symbol, timeframe });
    }
    metrics.recordHistogram('lake_query_duration_seconds', durationMs / 1000, { symbol, timeframe });
  }

  recordPipelineOperation(operation: string, durationMs: number): void {
    metrics.incrementCounter('pipeline_operations_total', 1, { operation });
    metrics.recordHistogram('pipeline_operation_duration_seconds', durationMs / 1000, { operation });
  }

  recordCloudSync(symbol: string, direction: 'upload' | 'download', success: boolean): void {
    metrics.incrementCounter('cloud_sync_total', 1, { symbol, direction, success: String(success) });
    if (success) {
      metrics.setGauge('cloud_sync_last_timestamp', Date.now(), { symbol, direction });
    }
  }

  getSnapshot(): ReturnType<typeof metrics.getAllMetrics> {
    return metrics.getAllMetrics();
  }
}

export const pipelineMetrics = new DataPipelineMetrics();

