import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { UsersModule } from './modules/users/users.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuthModule } from './modules/auth/auth.module';
import { TaskProcessorModule } from './queues/task-processor/task-processor.module';
import { ScheduledTasksModule } from './queues/scheduled-tasks/scheduled-tasks.module';

import { CacheService } from './common/services/cache.service';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { HealthModule } from '@modules/health/health.module';
import { MetricsModule } from '@common/metrics/metrics.module';

@Module({
  imports: [
    // 1) Config
    ConfigModule.forRoot({ isGlobal: true }),

    // 2) Database (parse numbers; keep sync only in dev)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get<string>('DB_HOST', '127.0.0.1'),
        port: parseInt(cfg.get<string>('DB_PORT', '5432'), 10),
        username: cfg.get<string>('DB_USERNAME', 'postgres'),
        password: cfg.get<string>('DB_PASSWORD', 'postgres'),
        database: cfg.get<string>('DB_DATABASE', 'taskflow'),
        // autoLoadEntities helps avoid entity glob issues during TS/JS builds:
        autoLoadEntities: true,
        synchronize: cfg.get<string>('NODE_ENV') === 'development',
        logging: cfg.get<string>('NODE_ENV') === 'development',
      }),
    }),

    // 3) Scheduler
    ScheduleModule.forRoot(),

    // 4) BullMQ (Redis connection parsed as numbers)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host: cfg.get<string>('REDIS_HOST', '127.0.0.1'),
          port: parseInt(cfg.get<string>('REDIS_PORT', '6379'), 10),
        },
      }),
    }),

    // 5) Throttling (global) with Redis storage
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        throttlers: [
          {
            ttl: cfg.get<number>('THROTTLE_TTL') ?? 60, // seconds
            limit: cfg.get<number>('THROTTLE_LIMIT') ?? 10,
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: cfg.get<string>('REDIS_HOST', '127.0.0.1'),
            port: parseInt(cfg.get<string>('REDIS_PORT', '6379'), 10),
          }),
        ),
      }),
    }),

    // 6) Feature modules
    UsersModule,
    TasksModule,
    AuthModule,
    TaskProcessorModule,
    ScheduledTasksModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    CacheService,

    // Enable Throttler globally via DI (don’t instantiate manually in main.ts)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [CacheService],
})
export class AppModule {}
