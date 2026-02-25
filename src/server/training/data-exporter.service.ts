import { Injectable, Inject } from '@nestjs/common';
import { QuestDBService } from '../database/questdb.service';
import { DuckDBService } from '../database/duckdb.service';
import {
  exportTrainingData,
  getNormalizedFeaturesPath,
  cleanupDataFile,
  type ExportResult,
} from './dataExporter';

@Injectable()
export class DataExporterService {
  constructor(
    @Inject(QuestDBService) private questdb: QuestDBService,
    @Inject(DuckDBService) private duckdb: DuckDBService,
  ) {}

  /** Export OHLCV from QuestDB to temp parquet for Python trainers. */
  export(
    symbol: string,
    timeframe: string,
    dateRange?: { start: string; end: string },
  ): Promise<ExportResult> {
    return exportTrainingData(symbol, timeframe, dateRange);
  }

  /** Check if pre-computed normalized features exist for a symbol/timeframe. */
  getNormalizedPath(symbol: string, timeframe: string): string | null {
    return getNormalizedFeaturesPath(symbol, timeframe);
  }

  /** Clean up a temp parquet file after training completes. */
  cleanup(dataFile: string): void {
    return cleanupDataFile(dataFile);
  }
}
