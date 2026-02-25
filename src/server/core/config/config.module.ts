import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadAppConfig } from '../../app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadAppConfig],
      isGlobal: true,
    }),
  ],
})
export class AppConfigModule {}
