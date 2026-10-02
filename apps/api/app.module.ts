import { Module } from '@nestjs/common';
import { CoreModule } from './infrastructure/core/core.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { EventsModule } from './infrastructure/events/events.module';
import { LabelsModule } from './ml/labels/labels.module';
import { XaiModule } from './ml/xai/xai.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    EventsModule,
    LabelsModule,
    XaiModule,
    TrainingModule,
  ],
})
export class AppModule {}
