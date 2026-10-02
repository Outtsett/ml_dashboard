import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  closeLake,
  queryLake,
  checkLakeHealth,
  lakeSender,
  lakePool,
  insertLakeBatch,
  insertLakeStream,
  type OHLCVRow,
} from './lake/connection';

@Injectable()
export class LakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('lake');

  constructor(@Inject(ConfigService) private config: ConfigService) {}

  async onModuleInit() {
    const healthy = await checkLakeHealth();
    if (healthy) {
      this.logger.log('Connection verified');
    } else {
      this.logger.warn('Not reachable — queries will fail until lake is available');
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing connections...');
    await closeLake();
    this.logger.log('Connections closed');
  }

  query<T = never>(sql: string) {
    return queryLake<T>(sql);
  }

  checkHealth() {
    return checkLakeHealth();
  }

  getSender() {
    return lakeSender();
  }

  getPool() {
    return lakePool();
  }

  insertBatch(rows: OHLCVRow[]) {
    return insertLakeBatch(rows);
  }

  insertStream(symbol: string, timestamp: number, open: number, high: number, low: number, close: number, volume: number) {
    return insertLakeStream(symbol, timestamp, open, high, low, close, volume);
  }
}

