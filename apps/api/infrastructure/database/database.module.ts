import { Module, Global } from '@nestjs/common';
import { LakeService } from './lake.service';
import { LakeAutomationService } from './lake/automation.service';
import { SQLiteService } from './sqlite.service';

@Global()
@Module({
  providers: [LakeService, LakeAutomationService, SQLiteService],
  exports: [LakeService, LakeAutomationService, SQLiteService],
})
export class DatabaseModule {}
