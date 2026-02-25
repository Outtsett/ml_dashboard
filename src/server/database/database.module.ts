import { Module, Global } from '@nestjs/common';
import { QuestDBService } from './questdb.service';
import { DuckDBService } from './duckdb.service';
import { SQLiteService } from './sqlite.service';
import { TypeOrmConfigModule } from './typeorm.module';

@Global()
@Module({
  imports: [TypeOrmConfigModule],
  providers: [QuestDBService, DuckDBService, SQLiteService],
  exports: [QuestDBService, DuckDBService, SQLiteService],
})
export class DatabaseModule {}
