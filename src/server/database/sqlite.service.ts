import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { db } from './db';

@Injectable()
export class SQLiteService implements OnModuleDestroy {
  private readonly logger = new Logger('SQLite');

  /** Drizzle ORM instance — use for all SQLite queries. */
  get database() {
    return db;
  }

  onModuleDestroy() {
    this.logger.log('Closed');
  }
}
