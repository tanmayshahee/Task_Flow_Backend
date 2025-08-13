import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator {
  private client = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });

  constructor(private readonly health: HealthIndicatorService) {}

  async isHealthy() {
    const indicator = this.health.check('redis');
    try {
      await this.client.ping();
      return indicator.up();
    } catch (err: any) {
      return indicator.down({ error: err.message });
    }
  }
}
