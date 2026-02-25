import { Module } from '@nestjs/common';
import { XaiService } from './xai.service';

@Module({
  providers: [XaiService],
  exports: [XaiService],
})
export class XaiModule {}
