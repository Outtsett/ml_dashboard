export interface ForecastMetadata {
  model: string;
  model_size: string;
  device: string;
  num_samples: number;
  context_length: number;
  forecast_horizon: number;
  elapsed_seconds: number;
  generated_at: string;
  symbol: string;
  timeframe_sec: number;
  timeframe_label: string;
  look_ahead_proof: {
    context_end: string;
    forecast_start: string;
    model_saw_only: string;
    compared_against: string;
  };
}

export interface ForecastMetrics {
  mae: number;
  mape: number;
  direction_accuracy: number;
}

export interface ForecastData {
  metadata: ForecastMetadata;
  metrics: ForecastMetrics;
  context: {
    timestamps: string[];
    close: number[];
    open: number[];
    high: number[];
    low: number[];
  };
  forecast: {
    timestamps: string[];
    median: number[];
    mean: number[];
    low_10: number[];
    low_25: number[];
    high_75: number[];
    high_90: number[];
    actual_close: number[];
  };
}

export interface ForecastListItem {
  filename: string;
  size: number;
  modified: string;
  metadata?: ForecastMetadata;
  metrics?: ForecastMetrics;
}

export interface ChartPoint {
  ts: string;
  rawTs: string;
  close?: number;
  actual?: number;
  predicted?: number;
  band90?: [number, number];
  band50?: [number, number];
  zone: "context" | "forecast";
}
