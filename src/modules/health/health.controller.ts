import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HttpHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private healthCheckService: HealthCheckService,
    private dbIndicator: TypeOrmHealthIndicator,
    private httpIndicator: HttpHealthIndicator,
    private redisIndicator: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.healthCheckService.check([
      () => this.dbIndicator.pingCheck('database'),
      () => this.redisIndicator.isHealthy(),
      () => this.httpIndicator.pingCheck('nestjs-docs', 'https://docs.nestjs.com'),
    ]);
  }
}
