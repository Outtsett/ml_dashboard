import { Injectable, Inject } from '@nestjs/common';
import { DuckDBService } from '../database/duckdb.service';
import { QuestDBService } from '../database/questdb.service';
import {
  listIndicators,
  getIndicator,
  getIndicatorsByCategory,
  calculateIndicator,
  generateIndicatorSQL,
  INDICATOR_REGISTRY,
  type IndicatorDefinition,
  type CalculateIndicatorParams,
  type GenerateIndicatorSQLParams,
  type IndicatorResult,
} from '../lib/indicators/registry';
import {
  computeIndicatorsRealtime,
  generateIndicatorSQL as generateBulkSQL,
  INDICATOR_PRESETS,
  type ComputeIndicatorsRequest,
  type IndicatorResult as RealtimeResult,
  type OHLCVBar,
} from '../lib/indicators/indicatorService';

@Injectable()
export class IndicatorsService {
  constructor(
    @Inject(DuckDBService) private duckdb: DuckDBService,
    @Inject(QuestDBService) private questdb: QuestDBService,
  ) {}

  /** List all 13 core indicator definitions. */
  list(): IndicatorDefinition[] {
    return listIndicators();
  }

  /** Get a single indicator definition by ID. */
  get(id: string): IndicatorDefinition | undefined {
    return getIndicator(id);
  }

  /** Filter indicators by category. */
  getByCategory(category: IndicatorDefinition['category']): IndicatorDefinition[] {
    return getIndicatorsByCategory(category);
  }

  /** Calculate a single indicator on OHLCV bars (TypeScript math). */
  calculate(params: CalculateIndicatorParams): IndicatorResult[] {
    return calculateIndicator(params);
  }

  /** Generate DuckDB SQL for a single indicator. */
  generateSQL(params: GenerateIndicatorSQLParams): string {
    return generateIndicatorSQL(params);
  }

  /** Compute multiple indicators in real-time via technicalindicators lib. */
  computeRealtime(data: OHLCVBar[], request: ComputeIndicatorsRequest): RealtimeResult[] {
    return computeIndicatorsRealtime(data, request);
  }

  /** Generate bulk indicator SQL (multiple indicators in one SELECT). */
  generateBulkSQL(request: ComputeIndicatorsRequest, tableName = 'ohlcv'): string {
    return generateBulkSQL(request, tableName);
  }

  /** Execute a DuckDB query (convenience for route handlers). */
  queryDuckDB<T = any>(sql: string): Promise<T[]> {
    return this.duckdb.query<T>(sql);
  }

  /** Get indicator presets (momentum, volatility, trend, oscillators, full). */
  getPresets() {
    return INDICATOR_PRESETS;
  }

  /** Get the full registry constant. */
  getRegistry() {
    return INDICATOR_REGISTRY;
  }
}
