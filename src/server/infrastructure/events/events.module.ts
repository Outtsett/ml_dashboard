import { Module, Global } from '@nestjs/common';
import { EventStore } from './event-store';
import { EventBus, getEventBus } from './event-bus';
import { db } from '../database/db';

@Global()
@Module({
  providers: [
    {
      provide: EventStore,
      useFactory: () => new EventStore(db),
    },
    {
      provide: EventBus,
      useFactory: () => getEventBus(),
    },
  ],
  exports: [EventStore, EventBus],
})
export class EventsModule {}
