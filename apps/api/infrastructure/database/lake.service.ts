import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  closeLake,
  queryLake,
  checkLakeHealth,
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
}

