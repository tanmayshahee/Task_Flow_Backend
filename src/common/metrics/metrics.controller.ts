import { Controller, Get, Header } from '@nestjs/common';
import * as client from 'prom-client';

@Controller('metrics')
export class MetricsController {
  constructor() {
    // Optional: collect default system/process metrics
    client.collectDefaultMetrics();
  }

  @Get()
  @Header('Content-Type', client.register.contentType)
  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }
}
