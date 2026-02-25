import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { QuestDBService } from '../../database/questdb.service';

@Injectable()
export class QuestDBHealthIndicator extends HealthIndicator {
  constructor(@Inject(QuestDBService) private questdb: QuestDBService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = await this.questdb.checkHealth();
    const result = this.getStatus(key, isHealthy);
    if (isHealthy) return result;
    throw new HealthCheckError('QuestDB check failed', result);
  }
}
