import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { LabelsModule } from './labels/labels.module';
import { XaiModule } from './xai/xai.module';
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
