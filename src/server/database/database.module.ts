import { Module, Global } from '@nestjs/common';
import { QuestDBService } from './questdb.service';
import { SQLiteService } from './sqlite.service';
import { TypeOrmConfigModule } from './typeorm.module';

@Global()
@Module({
  imports: [TypeOrmConfigModule],
  providers: [QuestDBService, SQLiteService],
  exports: [QuestDBService, SQLiteService],
})
export class DatabaseModule {}
