import { Module, Global } from '@nestjs/common';
import { QuestDBService } from './questdb.service';
import { QuestDBAutomationService } from './questdb/automation.service';
import { SQLiteService } from './sqlite.service';

@Global()
@Module({
  providers: [QuestDBService, QuestDBAutomationService, SQLiteService],
  exports: [QuestDBService, QuestDBAutomationService, SQLiteService],
})
export class DatabaseModule {}
