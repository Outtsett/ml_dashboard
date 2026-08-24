import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  closeQuestDB,
  queryQuestDB,
  checkQuestDBHealth,
  getQuestDBSender,
  getQuestDBQueryPool,
  insertOHLCVBatch,
  insertOHLCVStream,
  type OHLCVRow,
} from './questdb/connection';

@Injectable()
export class QuestDBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('QuestDB');

  constructor(@Inject(ConfigService) private config: ConfigService) {}

  async onModuleInit() {
    const healthy = await checkQuestDBHealth();
    if (healthy) {
      this.logger.log('Connection verified');
    } else {
      this.logger.warn('Not reachable — queries will fail until QuestDB is available');
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing connections...');
    await closeQuestDB();
    this.logger.log('Connections closed');
  }

  query<T = any>(sql: string) {
    return queryQuestDB<T>(sql);
  }

  checkHealth() {
    return checkQuestDBHealth();
  }

  getSender() {
    return getQuestDBSender();
  }

  getPool() {
    return getQuestDBQueryPool();
  }

  insertBatch(rows: OHLCVRow[]) {
    return insertOHLCVBatch(rows);
  }

  insertStream(symbol: string, timestamp: number, open: number, high: number, low: number, close: number, volume: number) {
    return insertOHLCVStream(symbol, timestamp, open, high, low, close, volume);
  }
}
